import { describe, it, expect, beforeAll } from 'vitest';
import { createEmbedder } from '../src/indexer/embedder.js';

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

describe('embedder (local provider)', () => {
  let embedder;

  beforeAll(() => {
    embedder = createEmbedder();
  });

  it('embeds text to 384-dim Float32Array', async () => {
    const result = await embedder.embed('hello world');
    expect(result).toBeInstanceOf(Float32Array);
    expect(result.length).toBe(384);
    let norm = 0;
    for (let i = 0; i < result.length; i++) norm += result[i] * result[i];
    expect(Math.sqrt(norm)).toBeCloseTo(1.0, 1);
  }, 60_000);

  it('embeds batch of texts returning array of Float32Arrays', async () => {
    const texts = ['cats are fluffy', 'dogs are playful', 'quantum mechanics theory'];
    const results = await embedder.embedBatch(texts);
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r).toBeInstanceOf(Float32Array);
      expect(r.length).toBe(384);
    }
  }, 60_000);

  it('similar texts have higher cosine similarity than unrelated texts', async () => {
    const [catEmb, dogEmb, quantumEmb] = await embedder.embedBatch([
      'cats are fluffy',
      'dogs are playful',
      'quantum mechanics theory',
    ]);

    const simCatDog = cosineSimilarity(catEmb, dogEmb);
    const simCatQuantum = cosineSimilarity(catEmb, quantumEmb);

    expect(simCatDog).toBeGreaterThan(simCatQuantum);
    expect(simCatDog).toBeGreaterThan(0);
    expect(simCatDog).toBeLessThanOrEqual(1);
  }, 60_000);
});
