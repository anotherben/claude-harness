// Guard stdout — MCP uses stdio transport, any console.log corrupts the protocol
console.log = console.error;

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { initDb } from './storage/db.js';
import { SessionStore } from './storage/sessions.js';
import { VectorStore } from './storage/vectors.js';
import { SearchEngine } from './search/engine.js';
import { createEmbedder, preWarmModel } from './indexer/embedder.js';
import { indexSession } from './indexer/pipeline.js';
import { parseTranscript, parseTranscriptData } from './indexer/chunker.js';
import { getSessionSources, findJsonlFilesForSources, isAllowedTranscriptPath } from './session-sources.js';

const DB_PATH = join(homedir(), '.cortex-memory', 'index.db');
const SESSION_SOURCES = getSessionSources();

let db, sessions, vectors, searchEngine, embedder;

function normalizeProject(project) {
  return project ? resolve(project) : null;
}

function normalizePlatform(platform) {
  return platform ? String(platform).trim().toLowerCase() : null;
}

try {
  db = initDb(DB_PATH);
  sessions = new SessionStore(db);
  vectors = new VectorStore(db);
  searchEngine = new SearchEngine(vectors, sessions);
  embedder = createEmbedder();
} catch (err) {
  console.error(`[cortex-memory] Failed to initialize: ${err.message}`);
  process.exit(1);
}

const server = new McpServer({
  name: 'cortex-memory',
  version: '0.2.0'
});

// Tool 1: search_sessions
server.tool('search_sessions',
  'Search indexed session transcripts by semantic query. Use this to find prior decisions, bug fixes, patterns, or context from earlier work. Returns ranked results with excerpts. Start here when you need to recall what was done before.',
  {
    query: z.string().max(1000).describe('Natural language search query'),
    project: z.string().optional().describe('Filter by project path'),
    platform: z.string().optional().describe('Filter by transcript platform/source'),
    since: z.string().optional().describe('Filter sessions after this date (ISO 8601 or relative: 2h, 1d, 7d)'),
    limit: z.number().int().min(1).max(20).optional().default(5).describe('Max session results (1-20)')
  },
  async ({ query, project, platform, since, limit }) => {
    try {
      const queryEmbedding = await embedder.embed(query);
      const normalizedProject = normalizeProject(project);
      const normalizedPlatform = normalizePlatform(platform);
      const results = searchEngine.search(queryEmbedding, { project: normalizedProject, platform: normalizedPlatform, limit });

      // Filter by since if provided
      let filtered = results;
      if (since) {
        const sinceDate = parseSince(since);
        if (sinceDate) {
          filtered = results.filter(r => r.endedAt && new Date(r.endedAt) >= sinceDate);
        }
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(filtered, null, 2) }]
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Search error: ${err.message}` }], isError: true };
    }
  }
);

// Tool 2: get_session
server.tool('get_session',
  'Retrieve the filtered transcript of a specific session by ID. Use only when you need complete context — prefer search_sessions first to find relevant excerpts.',
  {
    session_id: z.string().max(200).describe('Session UUID'),
    limit: z.number().int().min(1).max(200).optional().default(50).describe('Max messages to return')
  },
  async ({ session_id, limit }) => {
    try {
      const session = sessions.get(session_id);
      if (!session) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'Session not found' }) }], isError: true };
      }
      const resolved = resolve(session.transcript_path);
      if (!isAllowedTranscriptPath(resolved, SESSION_SOURCES)) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'Invalid transcript path' }) }], isError: true };
      }
      const content = await readFile(resolved, 'utf-8');
      const messages = parseTranscript(content);
      return {
        content: [{ type: 'text', text: JSON.stringify({ session, messages: messages.slice(-limit) }) }]
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// Tool 3: list_sessions
server.tool('list_sessions',
  'List recent sessions by date without searching content. Use to browse what sessions exist or find a session_id. Does NOT search content — use search_sessions for that.',
  {
    project: z.string().optional().describe('Filter by project path'),
    platform: z.string().optional().describe('Filter by transcript platform/source'),
    since: z.string().optional().describe('Filter sessions after this date (ISO 8601 or relative: 2h, 1d, 7d)'),
    limit: z.number().int().min(1).max(100).optional().default(20).describe('Max results')
  },
  async ({ project, platform, since, limit }) => {
    try {
      const normalizedProject = normalizeProject(project);
      const normalizedPlatform = normalizePlatform(platform);
      // Fetch 3x limit to allow for JS-side filtering by project/since.
      // At scale, push these filters into SQL queries instead.
      let list = sessions.listRecent(limit * 3);
      if (normalizedProject) list = list.filter(s => normalizeProject(s.project_path) === normalizedProject);
      if (normalizedPlatform) list = list.filter(s => s.platform === normalizedPlatform);
      if (since) {
        const sinceDate = parseSince(since);
        if (sinceDate) list = list.filter(s => s.ended_at && new Date(s.ended_at) >= sinceDate);
      }
      list = list.slice(0, limit);
      return {
        content: [{ type: 'text', text: JSON.stringify(list, null, 2) }]
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// Tool 4: index_sessions
server.tool('index_sessions',
  'Index new session transcripts for search. Call this if search results seem stale or after completing work you want searchable.',
  {
    scope: z.enum(['recent', 'project', 'all']).default('recent').describe("'recent' (last 24h), 'project' (specific project), 'all' (full reindex)"),
    platform: z.string().optional().describe('Limit indexing to one transcript platform/source'),
    since: z.string().optional().describe('Time filter for recent scope (e.g., 2h, 1d, 7d). Default: 24h'),
    project: z.string().optional().describe('Project path. Only used when scope is project.')
  },
  async ({ scope, since, project, platform }) => {
    try {
      const normalizedProject = normalizeProject(project);
      const normalizedPlatform = normalizePlatform(platform);
      const sources = normalizedPlatform
        ? SESSION_SOURCES.filter((source) => source.platform === normalizedPlatform)
        : SESSION_SOURCES;

      const files = scope === 'project' && normalizedProject
        ? await findFilesForProject(normalizedProject, sources)
        : await findJsonlFilesForSources(sources);

      let filtered = files;
      if (scope === 'recent') {
        const sinceDate = parseSince(since || '1d');
        filtered = files.filter(f => f.mtime >= sinceDate);
      }

      let indexed = 0, skipped = 0, errors = 0;

      for (const file of filtered) {
        try {
          const result = await indexSession({
            sessionId: file.sessionId,
            transcriptPath: file.path,
            projectPath: file.projectDir,
            sessions,
            vectors,
            embedder,
          });
          if (result.skipped) skipped++;
          else indexed++;
        } catch {
          errors++;
        }
      }

      return {
        content: [{ type: 'text', text: JSON.stringify({ indexed, skipped, errors, total: filtered.length }) }]
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Index error: ${err.message}` }], isError: true };
    }
  }
);

function parseSince(str) {
  if (!str) return null;
  const match = str.match(/^(\d+)([dhm])$/);
  if (match) {
    const ms = { d: 86400000, h: 3600000, m: 60000 };
    return new Date(Date.now() - parseInt(match[1]) * ms[match[2]]);
  }
  const date = new Date(str);
  return isNaN(date.getTime()) ? null : date;
}

async function findFilesForProject(projectPath, sources) {
  const files = await findJsonlFilesForSources(sources);
  const matches = [];

  for (const file of files) {
    if (normalizeProject(file.projectDir) === projectPath) {
      matches.push(file);
      continue;
    }

    try {
      const content = await readFile(file.path, 'utf8');
      const metadata = parseTranscriptData(content);
      if (normalizeProject(metadata.projectPath) === projectPath) {
        matches.push(file);
      }
    } catch {
      // Ignore malformed or unreadable transcripts while building the project slice.
    }
  }

  return matches;
}

// --- Start ---

const transport = new StdioServerTransport();
await server.connect(transport);

// Pre-warm embedding model in background (non-blocking)
preWarmModel().catch(err => console.error(`[cortex-memory] Model pre-warm failed: ${err.message}`));

// Graceful shutdown
process.on('exit', () => { try { db.pragma('wal_checkpoint(TRUNCATE)'); db.close(); } catch {} });
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
