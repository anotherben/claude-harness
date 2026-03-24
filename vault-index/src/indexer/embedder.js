/**
 * Local embedding module — Xenova/all-MiniLM-L6-v2 via @huggingface/transformers.
 * Returns Float32Array of 384 dimensions.
 * Forked from cortex-memory.
 */

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

export function createEmbedder() {
  return {
    embed: embedLocal,
    async embedBatch(texts) {
      const results = [];
      for (const text of texts) {
        results.push(await embedLocal(text));
      }
      return results;
    }
  };
}

export async function preWarmModel() {
  await getLocalPipeline();
}
