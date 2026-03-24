let pipelinePromise = null;

async function getLocalPipeline() {
  if (!pipelinePromise) {
    pipelinePromise = import('@huggingface/transformers')
      .then(async ({ env, pipeline }) => {
        env.allowLocalModels = true;
        env.useBrowserCache = false;
        return pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
          quantized: true,
        });
      })
      .catch((error) => {
        pipelinePromise = null;
        throw error;
      });
  }
  return pipelinePromise;
}

function normalizeVector(data) {
  const values = Array.from(data || []);
  const length = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0)) || 1;
  return values.map((value) => Number((value / length).toFixed(8)));
}

export async function embedLocal(text) {
  const extractor = await getLocalPipeline();
  const output = await extractor(String(text || ''), {
    pooling: 'mean',
    normalize: true,
  });
  return normalizeVector(output?.data);
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
    },
  };
}

export async function preWarmModel() {
  await getLocalPipeline();
}
