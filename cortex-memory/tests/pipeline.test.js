import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initDb } from '../src/storage/db.js';
import { SessionStore } from '../src/storage/sessions.js';
import { VectorStore } from '../src/storage/vectors.js';
import { indexSession, getEmbedder } from '../src/indexer/pipeline.js';

let db;
let tmpDir;
let sessions;
let vectors;

function setup() {
  tmpDir = mkdtempSync(join(tmpdir(), 'cortex-pipeline-test-'));
  const dbPath = join(tmpDir, 'test.db');
  db = initDb(dbPath);
  sessions = new SessionStore(db);
  vectors = new VectorStore(db);
}

function teardown() {
  if (db) {
    db.close();
    db = null;
  }
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  }
}

const SAMPLE_JSONL = [
  JSON.stringify({
    type: 'user',
    timestamp: '2026-03-27T07:34:38.195Z',
    cwd: '/Users/ben/Projects/helpdesk',
    message: { role: 'user', content: 'How do I fix the TDZ error in React?' },
  }),
  JSON.stringify({
    type: 'assistant',
    timestamp: '2026-03-27T07:34:41.853Z',
    cwd: '/Users/ben/Projects/helpdesk',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'A Temporal Dead Zone error occurs when you reference a const or let variable before its declaration. This commonly happens in React when you have circular imports between context files. The solution is to consolidate your context into a single file or use lazy initialization patterns to break the circular dependency.' }],
    },
  }),
  JSON.stringify({ type: 'tool_use', name: 'Read', input: { file_path: '/some/file.js' } }),
  JSON.stringify({ type: 'tool_result', content: 'file contents here' }),
  JSON.stringify({
    type: 'user',
    timestamp: '2026-03-27T07:35:10.000Z',
    cwd: '/Users/ben/Projects/helpdesk',
    message: { role: 'user', content: 'Thanks, that fixed it! Can you also check if there are any other circular imports in the codebase?' },
  }),
  JSON.stringify({
    type: 'assistant',
    timestamp: '2026-03-27T07:35:40.000Z',
    cwd: '/Users/ben/Projects/helpdesk',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'I will search the codebase for potential circular import patterns. Let me check the import graph for any other files that might have mutual dependencies.' }],
    },
  }),
].join('\n');

function makeFakeEmbedder() {
  function embed(text) {
    const vector = new Float32Array(384);
    for (let i = 0; i < vector.length; i++) {
      vector[i] = ((text.length + i) % 17) / 17;
    }
    return Promise.resolve(vector);
  }

  return {
    embed,
    embedBatch(texts) {
      return Promise.all(texts.map(embed));
    },
  };
}

describe('indexSession', () => {
  beforeEach(() => {
    setup();
  });

  afterEach(() => {
    teardown();
  });

  it('indexes a transcript end-to-end: chunks stored, session marked indexed', async () => {
    // Write test JSONL file
    const transcriptPath = join(tmpDir, 'session-001.jsonl');
    writeFileSync(transcriptPath, SAMPLE_JSONL, 'utf8');

    const embedder = makeFakeEmbedder();

    const result = await indexSession({
      sessionId: 'sess-001',
      transcriptPath,
      projectPath: '/home/user/project',
      sessions,
      vectors,
      embedder,
    });

    // Pipeline should report success
    expect(result.indexed).toBe(true);
    expect(result.chunkCount).toBeGreaterThan(0);

    // Chunks should be stored in the DB
    expect(vectors.chunkCount()).toBe(result.chunkCount);

    // Session should be marked as indexed
    expect(sessions.isIndexed('sess-001')).toBe(true);

    // Session record should have correct metadata
    const session = sessions.get('sess-001');
    expect(session.platform).toBe('unknown');
    expect(session.project_path).toBe('/Users/ben/Projects/helpdesk');
    expect(session.transcript_path).toBe(transcriptPath);
    expect(session.started_at).toBe('2026-03-27T07:34:38.195Z');
    expect(session.ended_at).toBe('2026-03-27T07:35:40.000Z');
    expect(session.chunk_count).toBe(result.chunkCount);
    expect(session.indexed_at).toBeTruthy();
  });

  it('skips already-indexed sessions', async () => {
    const transcriptPath = join(tmpDir, 'session-002.jsonl');
    writeFileSync(transcriptPath, SAMPLE_JSONL, 'utf8');

    const embedder = makeFakeEmbedder();

    // Index once
    const first = await indexSession({
      sessionId: 'sess-002',
      transcriptPath,
      projectPath: '/home/user/project',
      sessions,
      vectors,
      embedder,
    });
    expect(first.indexed).toBe(true);

    const chunkCountAfterFirst = vectors.chunkCount();

    // Index again — should skip
    const second = await indexSession({
      sessionId: 'sess-002',
      transcriptPath,
      projectPath: '/home/user/project',
      sessions,
      vectors,
      embedder,
    });

    expect(second.skipped).toBe(true);
    // No new chunks should be added
    expect(vectors.chunkCount()).toBe(chunkCountAfterFirst);
  });

  it('handles empty transcript (no conversational messages)', async () => {
    const transcriptPath = join(tmpDir, 'session-empty.jsonl');
    const emptyJsonl = [
      JSON.stringify({ type: 'tool_use', name: 'Read', input: { file_path: '/x' } }),
      JSON.stringify({ type: 'tool_result', content: 'stuff' }),
    ].join('\n');
    writeFileSync(transcriptPath, emptyJsonl, 'utf8');

    const embedder = makeFakeEmbedder();

    const result = await indexSession({
      sessionId: 'sess-empty',
      transcriptPath,
      projectPath: '/home/user/project',
      sessions,
      vectors,
      embedder,
    });

    expect(result.indexed).toBe(true);
    expect(result.chunkCount).toBe(0);
    expect(sessions.isIndexed('sess-empty')).toBe(true);
    expect(vectors.chunkCount()).toBe(0);
  });

  it('reindexes legacy indexed sessions that are missing metadata', async () => {
    const transcriptPath = join(tmpDir, 'session-legacy.jsonl');
    writeFileSync(transcriptPath, SAMPLE_JSONL, 'utf8');

    sessions.upsert({
      id: 'sess-legacy',
      projectPath: '/Users/ben/.claude/projects/-Users-ben-Projects-helpdesk',
      transcriptPath,
      chunkCount: 1,
      indexedAt: '2026-03-27T07:36:00.000Z',
    });

    const embedder = makeFakeEmbedder();

    const result = await indexSession({
      sessionId: 'sess-legacy',
      transcriptPath,
      projectPath: '/Users/ben/.claude/projects/-Users-ben-Projects-helpdesk',
      sessions,
      vectors,
      embedder,
    });

    expect(result.indexed).toBe(true);
    expect(result.skipped).toBeUndefined();

    const session = sessions.get('sess-legacy');
    expect(session.platform).toBe('claude');
    expect(session.project_path).toBe('/Users/ben/Projects/helpdesk');
    expect(session.started_at).toBe('2026-03-27T07:34:38.195Z');
    expect(session.ended_at).toBe('2026-03-27T07:35:40.000Z');
    expect(session.chunk_count).toBe(result.chunkCount);
  });

  it('uses canonical Codex session ids from transcript metadata', async () => {
    const transcriptPath = join(tmpDir, 'rollout-2026-03-23-sample.jsonl');
    const codexJsonl = [
      JSON.stringify({
        timestamp: '2026-03-23T08:49:27.829Z',
        type: 'session_meta',
        payload: {
          id: '019d19e1-eb2c-7d41-8d36-28a7c9d7f0d4',
          timestamp: '2026-03-23T08:48:49.453Z',
          cwd: '/Users/ben/Projects/helpdesk',
        },
      }),
      JSON.stringify({
        timestamp: '2026-03-23T08:49:27.831Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'is cortex engine online?\n' }],
        },
      }),
      JSON.stringify({
        timestamp: '2026-03-23T08:49:37.115Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Checking the cortex engine status.' }],
        },
      }),
    ].join('\n');
    writeFileSync(transcriptPath, codexJsonl, 'utf8');

    const embedder = makeFakeEmbedder();

    const result = await indexSession({
      sessionId: 'rollout-2026-03-23-sample',
      transcriptPath,
      projectPath: '/Users/ben/.codex/archived_sessions',
      sessions,
      vectors,
      embedder,
    });

    expect(result.indexed).toBe(true);
    const session = sessions.get('019d19e1-eb2c-7d41-8d36-28a7c9d7f0d4');
    expect(session).not.toBeNull();
    expect(session.project_path).toBe('/Users/ben/Projects/helpdesk');
    expect(session.started_at).toBe('2026-03-23T08:48:49.453Z');
    expect(session.ended_at).toBe('2026-03-23T08:49:37.115Z');
  });
});

describe('getEmbedder', () => {
  it('returns a singleton embedder', () => {
    const e1 = getEmbedder();
    const e2 = getEmbedder();
    expect(e1).toBe(e2);
    expect(typeof e1.embed).toBe('function');
    expect(typeof e1.embedBatch).toBe('function');
  });
});
