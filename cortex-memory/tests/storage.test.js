import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initDb } from '../src/storage/db.js';
import { SessionStore } from '../src/storage/sessions.js';
import { VectorStore } from '../src/storage/vectors.js';

let db;
let tmpDir;

function makeTmpDb() {
  tmpDir = mkdtempSync(join(tmpdir(), 'cortex-mem-test-'));
  const dbPath = join(tmpDir, 'test.db');
  db = initDb(dbPath);
  return db;
}

afterEach(() => {
  if (db) {
    db.close();
    db = null;
  }
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  }
});

describe('db initialization', () => {
  it('creates all required tables', () => {
    makeTmpDb();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => r.name);

    expect(tables).toContain('sessions');
    expect(tables).toContain('chunks');
    // vec0 virtual tables show up differently
    const allObjects = db
      .prepare("SELECT name FROM sqlite_master ORDER BY name")
      .all()
      .map((r) => r.name);
    expect(allObjects.some((n) => n.startsWith('chunk_embeddings'))).toBe(true);
  });

  it('creates indexes', () => {
    makeTmpDb();
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' ORDER BY name")
      .all()
      .map((r) => r.name);

    expect(indexes).toContain('idx_chunks_session');
    expect(indexes).toContain('idx_chunks_session_index');
    expect(indexes).toContain('idx_sessions_project');
    expect(indexes).toContain('idx_sessions_ended');
  });
});

describe('SessionStore', () => {
  let store;

  beforeEach(() => {
    makeTmpDb();
    store = new SessionStore(db);
  });

  it('creates and retrieves a session', () => {
    store.upsert({
      id: 'sess-001',
      projectPath: '/home/user/project',
      transcriptPath: '/home/user/.claude/sessions/sess-001.jsonl',
      startedAt: '2026-02-24T10:00:00Z',
      endedAt: '2026-02-24T11:00:00Z',
      chunkCount: 5,
      summary: 'Worked on storage layer',
    });

    const session = store.get('sess-001');
    expect(session).not.toBeNull();
    expect(session.id).toBe('sess-001');
    expect(session.platform).toBe('claude');
    expect(session.project_path).toBe('/home/user/project');
    expect(session.transcript_path).toBe('/home/user/.claude/sessions/sess-001.jsonl');
    expect(session.started_at).toBe('2026-02-24T10:00:00Z');
    expect(session.ended_at).toBe('2026-02-24T11:00:00Z');
    expect(session.chunk_count).toBe(5);
    expect(session.summary).toBe('Worked on storage layer');
  });

  it('returns null for non-existent session', () => {
    expect(store.get('does-not-exist')).toBeNull();
  });

  it('upserts (updates) an existing session', () => {
    store.upsert({
      id: 'sess-001',
      platform: 'claude',
      projectPath: '/home/user/project',
      transcriptPath: '/path/to/transcript',
      startedAt: '2026-02-24T10:00:00Z',
    });
    store.upsert({
      id: 'sess-001',
      platform: 'codex',
      projectPath: '/home/user/project',
      transcriptPath: '/path/to/transcript',
      startedAt: '2026-02-24T10:00:00Z',
      endedAt: '2026-02-24T12:00:00Z',
      chunkCount: 10,
      summary: 'Updated summary',
    });

    const session = store.get('sess-001');
    expect(session.platform).toBe('codex');
    expect(session.chunk_count).toBe(10);
    expect(session.summary).toBe('Updated summary');
  });

  it('lists sessions by project path', () => {
    store.upsert({ id: 's1', projectPath: '/proj/a', transcriptPath: '/t1', endedAt: '2026-02-24T09:00:00Z' });
    store.upsert({ id: 's2', projectPath: '/proj/a', transcriptPath: '/t2', endedAt: '2026-02-24T10:00:00Z' });
    store.upsert({ id: 's3', projectPath: '/proj/b', transcriptPath: '/t3', endedAt: '2026-02-24T11:00:00Z' });

    const results = store.listByProject('/proj/a');
    expect(results).toHaveLength(2);
    // Ordered by ended_at DESC
    expect(results[0].id).toBe('s2');
    expect(results[1].id).toBe('s1');
  });

  it('lists recent sessions across all projects', () => {
    store.upsert({ id: 's1', projectPath: '/proj/a', transcriptPath: '/t1', endedAt: '2026-02-24T09:00:00Z' });
    store.upsert({ id: 's2', projectPath: '/proj/b', transcriptPath: '/t2', endedAt: '2026-02-24T10:00:00Z' });
    store.upsert({ id: 's3', projectPath: '/proj/a', transcriptPath: '/t3', endedAt: '2026-02-24T11:00:00Z' });

    const results = store.listRecent(2);
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe('s3');
    expect(results[1].id).toBe('s2');
  });

  it('counts total sessions', () => {
    expect(store.count()).toBe(0);
    store.upsert({ id: 's1', projectPath: '/p', transcriptPath: '/t1' });
    store.upsert({ id: 's2', projectPath: '/p', transcriptPath: '/t2' });
    expect(store.count()).toBe(2);
  });

  it('isIndexed returns false for new session', () => {
    store.upsert({ id: 's1', projectPath: '/p', transcriptPath: '/t1' });
    expect(store.isIndexed('s1')).toBe(false);
  });

  it('isIndexed returns true after indexed_at is set', () => {
    store.upsert({ id: 's1', projectPath: '/p', transcriptPath: '/t1' });
    db.prepare("UPDATE sessions SET indexed_at = '2026-02-24T12:00:00Z' WHERE id = ?").run('s1');
    expect(store.isIndexed('s1')).toBe(true);
  });
});

describe('VectorStore', () => {
  let vectorStore;
  let sessionStore;

  function makeEmbedding(seed) {
    // Create a deterministic 384-dim embedding from a seed value
    const arr = new Float32Array(384);
    for (let i = 0; i < 384; i++) {
      arr[i] = Math.sin(seed * (i + 1) * 0.01);
    }
    // Normalize to unit vector for cosine similarity
    let norm = 0;
    for (let i = 0; i < 384; i++) norm += arr[i] * arr[i];
    norm = Math.sqrt(norm);
    for (let i = 0; i < 384; i++) arr[i] /= norm;
    return arr;
  }

  beforeEach(() => {
    makeTmpDb();
    sessionStore = new SessionStore(db);
    vectorStore = new VectorStore(db);
  });

  it('inserts a chunk and increments count', () => {
    sessionStore.upsert({ id: 'sess-1', projectPath: '/proj', transcriptPath: '/t' });

    vectorStore.insertChunk({
      sessionId: 'sess-1',
      content: 'Hello world',
      chunkIndex: 0,
      timestamp: '2026-02-24T10:00:00Z',
      tokenCount: 5,
      embedding: makeEmbedding(1),
    });

    expect(vectorStore.chunkCount()).toBe(1);
  });

  it('searches by vector similarity', () => {
    sessionStore.upsert({ id: 'sess-1', projectPath: '/proj', transcriptPath: '/t', endedAt: '2026-02-24T10:00:00Z' });

    // Insert chunks with different embeddings
    vectorStore.insertChunk({
      sessionId: 'sess-1',
      content: 'About cats and dogs',
      chunkIndex: 0,
      embedding: makeEmbedding(1),
    });
    vectorStore.insertChunk({
      sessionId: 'sess-1',
      content: 'About programming',
      chunkIndex: 1,
      embedding: makeEmbedding(100),
    });

    // Search with embedding close to seed=1
    const results = vectorStore.search(makeEmbedding(1.01), { limit: 5 });
    expect(results.length).toBeGreaterThanOrEqual(1);
    // Closest match should be the first chunk (seed=1)
    expect(results[0].content).toBe('About cats and dogs');
    expect(results[0].sessionId).toBe('sess-1');
    expect(results[0].chunkId).toBeDefined();
    expect(results[0].distance).toBeDefined();
    expect(results[0].projectPath).toBe('/proj');
  });

  it('filters search results by project', () => {
    sessionStore.upsert({ id: 'sess-a', projectPath: '/proj/a', transcriptPath: '/ta', endedAt: '2026-02-24T10:00:00Z' });
    sessionStore.upsert({ id: 'sess-b', projectPath: '/proj/b', transcriptPath: '/tb', endedAt: '2026-02-24T10:00:00Z' });

    vectorStore.insertChunk({
      sessionId: 'sess-a',
      content: 'Chunk from project A',
      chunkIndex: 0,
      embedding: makeEmbedding(1),
    });
    vectorStore.insertChunk({
      sessionId: 'sess-b',
      content: 'Chunk from project B',
      chunkIndex: 0,
      embedding: makeEmbedding(1.01),
    });

    const results = vectorStore.search(makeEmbedding(1), { project: '/proj/a', limit: 10 });
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe('Chunk from project A');
    expect(results[0].projectPath).toBe('/proj/a');
  });

  it('returns results ordered by distance (closest first)', () => {
    sessionStore.upsert({ id: 'sess-1', projectPath: '/proj', transcriptPath: '/t', endedAt: '2026-02-24T10:00:00Z' });

    vectorStore.insertChunk({ sessionId: 'sess-1', content: 'Far', chunkIndex: 0, embedding: makeEmbedding(100) });
    vectorStore.insertChunk({ sessionId: 'sess-1', content: 'Close', chunkIndex: 1, embedding: makeEmbedding(2) });
    vectorStore.insertChunk({ sessionId: 'sess-1', content: 'Closest', chunkIndex: 2, embedding: makeEmbedding(1.001) });

    const results = vectorStore.search(makeEmbedding(1), { limit: 3 });
    expect(results[0].content).toBe('Closest');
    // Distances should be ascending
    for (let i = 1; i < results.length; i++) {
      expect(results[i].distance).toBeGreaterThanOrEqual(results[i - 1].distance);
    }
  });

  it('chunk count works across multiple sessions', () => {
    sessionStore.upsert({ id: 's1', projectPath: '/p', transcriptPath: '/t1' });
    sessionStore.upsert({ id: 's2', projectPath: '/p', transcriptPath: '/t2' });

    vectorStore.insertChunk({ sessionId: 's1', content: 'a', chunkIndex: 0, embedding: makeEmbedding(1) });
    vectorStore.insertChunk({ sessionId: 's1', content: 'b', chunkIndex: 1, embedding: makeEmbedding(2) });
    vectorStore.insertChunk({ sessionId: 's2', content: 'c', chunkIndex: 0, embedding: makeEmbedding(3) });

    expect(vectorStore.chunkCount()).toBe(3);
  });

  it('deleteBySession removes all chunks and embeddings for a session', () => {
    sessionStore.upsert({ id: 's1', projectPath: '/p', transcriptPath: '/t1', endedAt: '2026-02-24T10:00:00Z' });
    sessionStore.upsert({ id: 's2', projectPath: '/p', transcriptPath: '/t2', endedAt: '2026-02-24T10:00:00Z' });

    vectorStore.insertChunk({ sessionId: 's1', content: 'a', chunkIndex: 0, embedding: makeEmbedding(1) });
    vectorStore.insertChunk({ sessionId: 's1', content: 'b', chunkIndex: 1, embedding: makeEmbedding(2) });
    vectorStore.insertChunk({ sessionId: 's2', content: 'c', chunkIndex: 0, embedding: makeEmbedding(3) });

    expect(vectorStore.chunkCount()).toBe(3);

    vectorStore.deleteBySession('s1');
    expect(vectorStore.chunkCount()).toBe(1);

    // Only s2 chunks should remain in search
    const results = vectorStore.search(makeEmbedding(3), { limit: 10 });
    expect(results).toHaveLength(1);
    expect(results[0].sessionId).toBe('s2');
  });
});
