/**
 * Local embedding module — Xenova/all-MiniLM-L6-v2 via @huggingface/transformers.
 * Returns Float32Array of 384 dimensions.
 */

// Singleton pipeline Promise — caches the loading Promise to prevent double-load
let _pipelinePromise = null;

async function getLocalPipeline() {
  if (!_pipelinePromise) {
    _pipelinePromise = import('@huggingface/transformers').then(({ pipeline }) =>
      pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')
    );
  }
  return _pipelinePromise;
}

async function embedLocal(text) {
  const extractor = await getLocalPipeline();
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  const data = output.data ?? output.ort_tensor?.data;
  if (data instanceof Float32Array && data.length === 384) {
    return data;
  }
  if (data instanceof Float32Array && data.length >= 384) {
    return data.slice(0, 384);
  }
  throw new Error(`Unexpected embedding output: length=${data?.length}, type=${typeof data}`);
}

/**
 * Create an embedder using local Transformers.js model.
 * @returns {{ embed(text: string): Promise<Float32Array>, embedBatch(texts: string[]): Promise<Float32Array[]> }}
 */
export function createEmbedder() {
  async function embed(text) {
    return embedLocal(text);
  }

  async function embedBatch(texts) {
    const results = [];
    for (const text of texts) {
      results.push(await embed(text));
    }
    return results;
  }

  return { embed, embedBatch };
}

/**
 * Pre-warm the embedding model. Call at startup (non-blocking).
 */
export async function preWarmModel() {
  await getLocalPipeline();
}
