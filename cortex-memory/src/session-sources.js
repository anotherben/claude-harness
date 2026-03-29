import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const DEFAULT_SESSION_SOURCES = [
  { platform: 'claude', root: join(homedir(), '.claude', 'projects') },
  { platform: 'codex', root: join(homedir(), '.codex', 'archived_sessions') },
];

function normalizePlatform(platform, fallback = 'unknown') {
  const value = String(platform || fallback).trim().toLowerCase();
  return value || fallback;
}

function parseSourceEntry(entry, index) {
  const trimmed = entry.trim();
  if (!trimmed) return null;

  const eqIndex = trimmed.indexOf('=');
  if (eqIndex === -1) {
    return {
      platform: `source-${index + 1}`,
      root: resolve(trimmed),
    };
  }

  const platform = normalizePlatform(trimmed.slice(0, eqIndex), `source-${index + 1}`);
  const root = resolve(trimmed.slice(eqIndex + 1));
  return root ? { platform, root } : null;
}

export function getSessionSources(envValue = process.env.CORTEX_MEMORY_SESSION_SOURCES) {
  const parsed = envValue
    ? envValue
        .split(/[,\n;]+/)
        .map((entry, index) => parseSourceEntry(entry, index))
        .filter(Boolean)
    : DEFAULT_SESSION_SOURCES;

  const deduped = [];
  const seen = new Set();
  for (const source of parsed) {
    const key = `${source.platform}:${source.root}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({
      platform: normalizePlatform(source.platform),
      root: resolve(source.root),
    });
  }

  return deduped;
}

export function isPathWithinRoot(candidatePath, rootPath) {
  if (!candidatePath || !rootPath) return false;

  const resolvedCandidate = resolve(candidatePath);
  const resolvedRoot = resolve(rootPath);
  return (
    resolvedCandidate === resolvedRoot ||
    resolvedCandidate.startsWith(`${resolvedRoot}/`)
  );
}

export function findSourceForPath(filePath, sources = getSessionSources()) {
  return sources.find((source) => isPathWithinRoot(filePath, source.root)) ?? null;
}

export function isAllowedTranscriptPath(filePath, sources = getSessionSources()) {
  return findSourceForPath(filePath, sources) !== null;
}

async function findJsonlFilesInDir(dir, metadata) {
  const results = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await findJsonlFilesInDir(fullPath, metadata);
      results.push(...nested);
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      const fileStat = await stat(fullPath);
      results.push({
        path: fullPath,
        sessionId: basename(entry.name, '.jsonl'),
        projectDir: dir,
        mtime: fileStat.mtime,
        platform: metadata.platform,
        sourceRoot: metadata.root,
      });
    }
  }

  return results;
}

export async function findJsonlFilesForSources(sources = getSessionSources()) {
  const results = [];
  for (const source of sources) {
    results.push(...await findJsonlFilesInDir(source.root, source));
  }
  return results;
}
