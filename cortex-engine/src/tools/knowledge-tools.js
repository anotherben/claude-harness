const { performance } = require('../telemetry');

function registerKnowledgeTools(server, knowledge, telemetry) {
  server.registerTool('cortex_annotate', {
    description: 'Add a note to a file, symbol, or pattern. Persists across sessions.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'File path, file:symbol, directory prefix, or "global"' },
        note: { type: 'string', description: 'The annotation text' },
        author: { type: 'string', description: 'Who is adding this (e.g., "claude", "ben")' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags: lesson, pattern, warning, decision, etc.' },
      },
      required: ['target', 'note'],
    },
  }, async (params) => {
    const t0 = performance.now();
    knowledge.annotate(params);
    const result = { content: [{ type: 'text', text: `Annotation saved for ${params.target}` }] };
    const elapsed = performance.now() - t0;
    if (!telemetry) return result;
    return telemetry.wrapTimingOnly(result, elapsed);
  });

  server.registerTool('cortex_recall', {
    description: 'Get all annotations for a file or symbol',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'File path or file:symbol' },
      },
      required: ['target'],
    },
  }, async (params) => {
    const t0 = performance.now();
    const entries = knowledge.recall(params.target);
    const result = { content: [{ type: 'text', text: JSON.stringify(entries, null, 2) }] };
    const elapsed = performance.now() - t0;
    if (!telemetry) return result;
    return telemetry.wrapTimingOnly(result, elapsed);
  });

  server.registerTool('cortex_patterns', {
    description: 'Get pattern annotations for a directory',
    inputSchema: {
      type: 'object',
      properties: {
        directory: { type: 'string', description: 'Directory prefix to search' },
      },
      required: ['directory'],
    },
  }, async (params) => {
    const t0 = performance.now();
    const patterns = knowledge.patterns(params.directory);
    const result = { content: [{ type: 'text', text: JSON.stringify(patterns, null, 2) }] };
    const elapsed = performance.now() - t0;
    if (!telemetry) return result;
    return telemetry.wrapTimingOnly(result, elapsed);
  });

  server.registerTool('cortex_lessons', {
    description: 'Get lessons learned, optionally filtered by tag',
    inputSchema: {
      type: 'object',
      properties: {
        tag: { type: 'string', description: 'Filter by tag (e.g., "rex", "shopify", "tenant_id")' },
      },
    },
  }, async (params) => {
    const t0 = performance.now();
    const lessons = knowledge.lessons(params.tag);
    const result = { content: [{ type: 'text', text: JSON.stringify(lessons, null, 2) }] };
    const elapsed = performance.now() - t0;
    if (!telemetry) return result;
    return telemetry.wrapTimingOnly(result, elapsed);
  });
}

module.exports = { registerKnowledgeTools };
