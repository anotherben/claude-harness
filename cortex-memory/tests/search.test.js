import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SearchEngine } from '../src/search/engine.js';

describe('SearchEngine', () => {
  let engine;

  beforeEach(() => {
    engine = new SearchEngine(null, null);
  });

  // --- recencyScore ---

  describe('recencyScore', () => {
    it('returns 1.0 for sessions < 1 day old', () => {
      const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
      expect(engine.recencyScore(sixHoursAgo)).toBe(1.0);
    });

    it('returns 0.7 for sessions ~3 days old', () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      expect(engine.recencyScore(threeDaysAgo)).toBe(0.7);
    });

    it('returns 0.4 for sessions ~15 days old', () => {
      const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
      expect(engine.recencyScore(fifteenDaysAgo)).toBe(0.4);
    });

    it('returns 0.2 for sessions ~60 days old', () => {
      const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
      expect(engine.recencyScore(sixtyDaysAgo)).toBe(0.2);
    });

    it('returns 0.1 for sessions > 90 days old', () => {
      const hundredDaysAgo = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
      expect(engine.recencyScore(hundredDaysAgo)).toBe(0.1);
    });

    it('returns 0.1 for null/undefined endedAt', () => {
      expect(engine.recencyScore(null)).toBe(0.1);
      expect(engine.recencyScore(undefined)).toBe(0.1);
    });
  });

  // --- groupAndScore (cosine distance: range [0, 2], similarity = 1 - distance/2) ---

  describe('groupAndScore', () => {
    it('groups chunks by session and computes composite score', () => {
      const now = new Date().toISOString();
      // Cosine distances: 0 = identical, 2 = opposite
      const rawResults = [
        { chunkId: 1, sessionId: 'sess-a', content: 'chunk 1', distance: 0.2, platform: 'claude', projectPath: '/p', endedAt: now, chunkIndex: 0 },
        { chunkId: 2, sessionId: 'sess-a', content: 'chunk 2', distance: 0.4, platform: 'claude', projectPath: '/p', endedAt: now, chunkIndex: 1 },
        { chunkId: 3, sessionId: 'sess-b', content: 'chunk 3', distance: 0.3, platform: 'codex', projectPath: '/p', endedAt: now, chunkIndex: 0 },
      ];

      const results = engine.groupAndScore(rawResults);
      expect(results).toHaveLength(2);
      expect(results[0]).toHaveProperty('sessionId');
      expect(results[0]).toHaveProperty('score');
      expect(results[0]).toHaveProperty('similarity');
      expect(results[0]).toHaveProperty('recency');
      expect(results[0]).toHaveProperty('breadth');
      expect(results[0]).toHaveProperty('excerpts');

      const sessA = results.find((r) => r.sessionId === 'sess-a');
      expect(sessA.platform).toBe('claude');
      expect(sessA.excerpts).toHaveLength(2);
      // sess-a best distance=0.2, similarity = 1 - 0.2/2 = 0.9
      expect(sessA.similarity).toBeCloseTo(0.9, 2);
    });

    it('ranks sessions by composite score with cosine distance', () => {
      const now = new Date().toISOString();
      const ninetyDaysAgo = new Date(Date.now() - 95 * 24 * 60 * 60 * 1000).toISOString();

      // Session A: very similar (distance 0.1) but very old
      // similarity = 1 - 0.1/2 = 0.95, recency = 0.1, breadth = 1/4 = 0.25
      // composite = 0.5*0.95 + 0.3*0.1 + 0.2*0.25 = 0.475 + 0.03 + 0.05 = 0.555
      //
      // Session B: moderately similar (distance 0.5) but very recent, more chunks
      // similarity = 1 - 0.5/2 = 0.75, recency = 1.0, breadth = 3/4 = 0.75
      // composite = 0.5*0.75 + 0.3*1.0 + 0.2*0.75 = 0.375 + 0.30 + 0.15 = 0.825
      const rawResults = [
        { chunkId: 1, sessionId: 'sess-a', content: 'old close', distance: 0.1, platform: 'claude', projectPath: '/p', endedAt: ninetyDaysAgo, chunkIndex: 0 },
        { chunkId: 2, sessionId: 'sess-b', content: 'new far 1', distance: 0.5, platform: 'codex', projectPath: '/p', endedAt: now, chunkIndex: 0 },
        { chunkId: 3, sessionId: 'sess-b', content: 'new far 2', distance: 0.6, platform: 'codex', projectPath: '/p', endedAt: now, chunkIndex: 1 },
        { chunkId: 4, sessionId: 'sess-b', content: 'new far 3', distance: 0.7, platform: 'codex', projectPath: '/p', endedAt: now, chunkIndex: 2 },
      ];

      const results = engine.groupAndScore(rawResults);
      expect(results[0].sessionId).toBe('sess-b');
      expect(results[1].sessionId).toBe('sess-a');

      expect(results[0].score).toBeCloseTo(0.825, 1);
      expect(results[1].score).toBeCloseTo(0.555, 1);
    });
  });

  // --- search ---

  describe('search', () => {
    it('calls vectorStore.search and returns grouped results', () => {
      const now = new Date().toISOString();
      const mockVectorStore = {
        search: vi.fn().mockReturnValue([
          { chunkId: 1, sessionId: 's1', content: 'hello', distance: 0.1, platform: 'claude', projectPath: '/p', endedAt: now, chunkIndex: 0 },
          { chunkId: 2, sessionId: 's1', content: 'world', distance: 0.2, platform: 'claude', projectPath: '/p', endedAt: now, chunkIndex: 1 },
        ]),
      };
      const eng = new SearchEngine(mockVectorStore, null);
      const fakeEmbedding = new Float32Array(384);

      const results = eng.search(fakeEmbedding, { project: '/p', limit: 5 });

      expect(mockVectorStore.search).toHaveBeenCalledWith(fakeEmbedding, { project: '/p', limit: 200 });
      expect(results).toHaveLength(1);
      expect(results[0].sessionId).toBe('s1');
      expect(results[0].platform).toBe('claude');
      expect(results[0].excerpts).toHaveLength(2);
    });
  });
});
