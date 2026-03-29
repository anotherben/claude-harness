#!/usr/bin/env node

/**
 * cortex-memory CLI — bulk indexing, search, and status from the terminal.
 *
 * Usage:
 *   cortex-memory status                  Show index statistics
 *   cortex-memory index --all             Index all projects
 *   cortex-memory index --project <path>  Index one project directory
 *   cortex-memory index --since <dur>     Index sessions from last N days/hours (e.g. 7d, 24h)
 *   cortex-memory search "query"          Search indexed sessions
 */

// Re-exec with increased heap if not already done.
// Large JSONL transcripts (up to 40MB each) + ONNX embedder need headroom.
if (!process.env.__CORTEX_MEM_HEAP) {
  const { execFileSync } = await import('child_process');
  try {
    execFileSync(process.execPath, ['--max-old-space-size=4096', ...process.argv.slice(1)], {
      stdio: 'inherit',
      env: { ...process.env, __CORTEX_MEM_HEAP: '1' },
    });
  } catch (e) {
    process.exit(e.status ?? 1);
  }
  process.exit(0);
}

import { readFile, stat } from 'fs/promises';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { initDb } from './src/storage/db.js';
import { SessionStore } from './src/storage/sessions.js';
import { VectorStore } from './src/storage/vectors.js';
import { SearchEngine } from './src/search/engine.js';
import { indexSession, getEmbedder } from './src/indexer/pipeline.js';
import { parseTranscriptData } from './src/indexer/chunker.js';
import { findJsonlFilesForSources, getSessionSources } from './src/session-sources.js';

const DB_PATH = join(homedir(), '.cortex-memory', 'index.db');
const SESSION_SOURCES = getSessionSources();

const args = process.argv.slice(2);
const command = args[0];

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parse a duration string like "7d", "24h", "30m" into milliseconds.
 * @param {string} str
 * @returns {number|null} milliseconds, or null if invalid
 */
function parseDuration(str) {
  const match = str.match(/^(\d+)([dhm])$/);
  if (!match) return null;
  const [, num, unit] = match;
  const ms = { d: 86400000, h: 3600000, m: 60000 };
  return parseInt(num) * ms[unit];
}

/**
 * Format bytes into a human-readable string.
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function normalizePlatform(platform) {
  return platform ? String(platform).trim().toLowerCase() : null;
}

// ── Commands ─────────────────────────────────────────────────────────────────

/**
 * Show index statistics: total sessions, chunks, DB size, last indexed.
 */
async function showStatus(sessions, vectors, db) {
  const sessionCount = sessions.count();
  const chunkCount = vectors.chunkCount();

  // DB file size
  const dbStat = await stat(DB_PATH).catch(() => null);
  const dbSize = dbStat ? formatBytes(dbStat.size) : 'unknown';

  // Last indexed session
  const recent = sessions.listRecent(1);
  const lastIndexed = recent.length > 0 ? recent[0].indexed_at || 'never' : 'never';
  const lastSessionId = recent.length > 0 ? recent[0].id : 'none';

  const allFiles = await findJsonlFilesForSources(SESSION_SOURCES);

  console.log('');
  console.log('  cortex-memory status');
  console.log('  ────────────────────────────────────');
  console.log(`  Sessions indexed:  ${sessionCount}`);
  console.log(`  Total chunks:      ${chunkCount}`);
  console.log(`  DB size:           ${dbSize}`);
  console.log(`  Last indexed:      ${lastIndexed}`);
  console.log(`  Last session:      ${lastSessionId}`);
  console.log(`  JSONL files found: ${allFiles.length}`);
  console.log(`  Source roots:      ${SESSION_SOURCES.map((source) => `${source.platform}=${source.root}`).join(', ')}`);
  console.log('');
}

/**
 * Index transcripts based on flags: --all, --project <path>, --since <duration>.
 */
async function indexCommand(flags, sessions, vectors) {
  // Parse flags
  let mode = null;
  let projectPath = null;
  let platform = null;
  let sinceMs = null;

  for (let i = 0; i < flags.length; i++) {
    if (flags[i] === '--all') {
      mode = 'all';
    } else if (flags[i] === '--project' && flags[i + 1]) {
      mode = 'project';
      projectPath = flags[i + 1];
      i++;
    } else if (flags[i] === '--platform' && flags[i + 1]) {
      platform = normalizePlatform(flags[i + 1]);
      i++;
    } else if (flags[i] === '--since' && flags[i + 1]) {
      mode = 'since';
      sinceMs = parseDuration(flags[i + 1]);
      if (sinceMs === null) {
        console.error(`Invalid duration: "${flags[i + 1]}". Use format like 7d, 24h, 30m.`);
        process.exit(1);
      }
      i++;
    }
  }

  if (!mode) {
    console.error('Usage: cortex-memory index [--all | --project <path> | --since <duration>]');
    process.exit(1);
  }

  // Find JSONL files
  const sources = platform
    ? SESSION_SOURCES.filter((source) => source.platform === platform)
    : SESSION_SOURCES;

  let files = await findJsonlFilesForSources(sources);
  if (mode === 'project') {
    const resolvedProject = resolve(projectPath);
    const matches = [];

    for (const file of files) {
      if (resolve(file.projectDir) === resolvedProject) {
        matches.push(file);
        continue;
      }

      try {
        const content = await readFile(file.path, 'utf8');
        const metadata = parseTranscriptData(content);
        if (metadata.projectPath && resolve(metadata.projectPath) === resolvedProject) {
          matches.push(file);
        }
      } catch {
        // Ignore malformed/unreadable transcripts during project filtering.
      }
    }

    files = matches;
  }

  // Filter by mtime if --since
  if (mode === 'since') {
    const cutoff = new Date(Date.now() - sinceMs);
    files = files.filter((f) => f.mtime >= cutoff);
  }

  if (files.length === 0) {
    console.log('No transcript files found matching criteria.');
    return;
  }

  console.log(`Found ${files.length} transcript file(s) to process.\n`);

  // Initialize embedder once (may download model on first run)
  const embedder = getEmbedder();

  let indexed = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const progress = `[${i + 1}/${files.length}]`;

    try {
      const result = await indexSession({
        sessionId: file.sessionId,
        transcriptPath: file.path,
        projectPath: file.projectDir,
        sessions,
        vectors,
        embedder,
      });

      if (result.skipped) {
        console.log(`${progress} Skipped ${file.sessionId} (already indexed)`);
        skipped++;
      } else {
        console.log(`${progress} Indexed ${file.sessionId} (${result.chunkCount} chunks)`);
        indexed++;
      }
    } catch (err) {
      console.error(`${progress} ERROR ${file.sessionId}: ${err.message}`);
      errors++;
    }
  }

  console.log(`\nDone. Indexed: ${indexed}, Skipped: ${skipped}, Errors: ${errors}`);
}

/**
 * Search indexed sessions from the terminal.
 */
async function searchCommand(searchArgs, sessions, vectors) {
  let platform = null;
  const terms = [];
  for (let i = 0; i < searchArgs.length; i++) {
    if (searchArgs[i] === '--platform' && searchArgs[i + 1]) {
      platform = normalizePlatform(searchArgs[i + 1]);
      i++;
      continue;
    }
    terms.push(searchArgs[i]);
  }

  const query = terms.join(' ').trim();
  if (!query) {
    console.error('Usage: cortex-memory search "your query"');
    process.exit(1);
  }

  console.log(`Searching for: "${query}"\n`);

  // Initialize embedder and search engine
  const embedder = getEmbedder();
  const engine = new SearchEngine(vectors, sessions);

  // Embed the query
  const queryEmbedding = await embedder.embed(query);

  // Search
  const results = engine.search(queryEmbedding, { platform, limit: 5 });

  if (results.length === 0) {
    console.log('No results found.');
    return;
  }

  for (const result of results) {
    const session = sessions.get(result.sessionId);
    const date = session?.indexed_at || session?.ended_at || 'unknown';
    const project = session?.project_path || 'unknown';
    const resultPlatform = session?.platform || result.platform || 'unknown';

    console.log(`── Session: ${result.sessionId} ──`);
    console.log(`   Score: ${result.score.toFixed(3)} (sim=${result.similarity.toFixed(3)} rec=${result.recency.toFixed(3)} breadth=${result.breadth.toFixed(3)})`);
    console.log(`   Date:  ${date}`);
    console.log(`   Platform: ${resultPlatform}`);
    console.log(`   Project: ${project}`);

    // Show top 2 excerpts
    const excerpts = result.excerpts.slice(0, 2);
    for (const excerpt of excerpts) {
      const truncated = excerpt.content.length > 200
        ? excerpt.content.slice(0, 200) + '...'
        : excerpt.content;
      console.log(`   > ${truncated.replace(/\n/g, '\n     ')}`);
    }
    console.log('');
  }
}

/**
 * Show help text.
 */
function showHelp() {
  console.log(`
  cortex-memory — CLI for bulk indexing and search across agent session sources

  Commands:
    status                  Show index statistics
    index --all             Index all configured session sources
    index --project <path>  Index transcripts in a specific directory
    index --platform <id>   Limit indexing to one configured source
    index --since <dur>     Index transcripts modified in last N days/hours
                            (e.g. 7d, 24h, 30m)
    search [--platform id] "query"
                            Search indexed sessions

  Examples:
    cortex-memory status
    cortex-memory index --all
    cortex-memory index --platform claude --since 7d
    cortex-memory index --since 7d
    cortex-memory search "TDZ error"
  `);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const db = initDb(DB_PATH);
  const sessions = new SessionStore(db);
  const vectors = new VectorStore(db);

  try {
    switch (command) {
      case 'status':
        await showStatus(sessions, vectors, db);
        break;
      case 'index':
        await indexCommand(args.slice(1), sessions, vectors);
        break;
      case 'search':
        await searchCommand(args.slice(1), sessions, vectors);
        break;
      default:
        showHelp();
    }
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
