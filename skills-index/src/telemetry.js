const COST_MODELS = {
  claude_opus_4_6: 15 / 1_000_000,
  claude_sonnet_4_6: 3 / 1_000_000,
  claude_haiku_4_5: 0.8 / 1_000_000,
};

export function estimateTokens(value) {
  if (!value) {
    return 0;
  }
  return Math.ceil(Buffer.byteLength(String(value), 'utf8') / 4);
}

export function calcCostAvoided(tokensSaved) {
  return Object.fromEntries(
    Object.entries(COST_MODELS).map(([name, rate]) => [name, Number((tokensSaved * rate).toFixed(4))]),
  );
}

export function buildMeta({ timingMs, fileTokens = 0, responseTokens = 0, report = null }) {
  const tokensSaved = Math.max(0, fileTokens - responseTokens);
  return {
    timing_ms: Number(timingMs.toFixed(1)),
    tokens_saved: tokensSaved,
    total_tokens_saved: report?.total_tokens_saved ?? tokensSaved,
    estimate_method: 'byte_approx',
    cost_avoided: calcCostAvoided(tokensSaved),
    total_cost_avoided: report?.total_cost_avoided ?? calcCostAvoided(tokensSaved),
  };
}

export function injectMeta(payload, meta) {
  return {
    ...payload,
    _meta: meta,
  };
}

export function makeTextResult(payload, meta = null) {
  const data = meta ? injectMeta(payload, meta) : payload;
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}
