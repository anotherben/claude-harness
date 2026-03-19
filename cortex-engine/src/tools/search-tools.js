const { estimateTokens, performance } = require('../telemetry');

function registerSearchTools(server, engine, telemetry) {
  server.registerTool('cortex_find_symbol', {
    description: 'Search symbols by name across all indexed files',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (substring match)' },
        kind: { type: 'string', description: 'Filter by kind: function, class, method, variable' },
        exported_only: { type: 'boolean', description: 'Only exported symbols' },
        limit: { type: 'number', description: 'Max results' },
        source_types: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by source type: code, config, query, docs, markup, style. Defaults to [code, query].',
        },
      },
      required: ['query'],
    },
  }, async (params) => {
    const t0 = performance.now();
    const results = engine.findSymbol(params.query, {
      kind: params.kind,
      exportedOnly: params.exported_only,
      limit: params.limit,
      sourceTypes: params.source_types,
    });
    const responseText = JSON.stringify(results, null, 2);
    const result = { content: [{ type: 'text', text: responseText }] };
    const elapsed = performance.now() - t0;
    if (!telemetry) return result;

    // tokens saved = sum of all matching file tokens - search result tokens
    let totalFileTokens = 0;
    const seenFiles = new Set();
    for (const r of results) {
      if (r.filePath && !seenFiles.has(r.filePath)) {
        seenFiles.add(r.filePath);
        const file = engine.store.getFile(r.filePath);
        if (file) totalFileTokens += Math.ceil(file.sizeBytes / 4);
      }
    }
    const responseTokens = estimateTokens(responseText);
    return telemetry.wrapResult(result, totalFileTokens, responseTokens, elapsed);
  });

  server.registerTool('cortex_find_text', {
    description: 'Regex/literal search across indexed file contents',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Search pattern (regex)' },
        case_sensitive: { type: 'boolean' },
      },
      required: ['pattern'],
    },
  }, async (params) => {
    const t0 = performance.now();
    const results = engine.findText(params.pattern, {
      caseSensitive: params.case_sensitive,
    });
    const responseText = JSON.stringify(results, null, 2);
    const result = { content: [{ type: 'text', text: responseText }] };
    const elapsed = performance.now() - t0;
    if (!telemetry) return result;

    // tokens saved = sum of matching file tokens - result tokens
    let totalFileTokens = 0;
    const seenFiles = new Set();
    for (const r of results) {
      if (r.filePath && !seenFiles.has(r.filePath)) {
        seenFiles.add(r.filePath);
        const file = engine.store.getFile(r.filePath);
        if (file) totalFileTokens += Math.ceil(file.sizeBytes / 4);
      }
    }
    const responseTokens = estimateTokens(responseText);
    return telemetry.wrapResult(result, totalFileTokens, responseTokens, elapsed);
  });

  server.registerTool('cortex_find_references', {
    description: 'Find all references to an identifier across files',
    inputSchema: {
      type: 'object',
      properties: {
        identifier: { type: 'string', description: 'Identifier to search for' },
      },
      required: ['identifier'],
    },
  }, async (params) => {
    const t0 = performance.now();
    const results = engine.findReferences(params.identifier);
    const responseText = JSON.stringify(results, null, 2);
    const result = { content: [{ type: 'text', text: responseText }] };
    const elapsed = performance.now() - t0;
    if (!telemetry) return result;

    let totalFileTokens = 0;
    const seenFiles = new Set();
    for (const r of results) {
      if (r.filePath && !seenFiles.has(r.filePath)) {
        seenFiles.add(r.filePath);
        const file = engine.store.getFile(r.filePath);
        if (file) totalFileTokens += Math.ceil(file.sizeBytes / 4);
      }
    }
    const responseTokens = estimateTokens(responseText);
    return telemetry.wrapResult(result, totalFileTokens, responseTokens, elapsed);
  });

  server.registerTool('cortex_find_importers', {
    description: 'Find files that import a given file',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'File path to find importers of' },
      },
      required: ['file_path'],
    },
  }, async (params) => {
    const t0 = performance.now();
    const results = engine.findImporters(params.file_path);
    const responseText = JSON.stringify(results, null, 2);
    const result = { content: [{ type: 'text', text: responseText }] };
    const elapsed = performance.now() - t0;
    if (!telemetry) return result;

    let totalFileTokens = 0;
    for (const r of results) {
      if (r.path) {
        const file = engine.store.getFile(r.path);
        if (file) totalFileTokens += Math.ceil(file.sizeBytes / 4);
      }
    }
    const responseTokens = estimateTokens(responseText);
    return telemetry.wrapResult(result, totalFileTokens, responseTokens, elapsed);
  });

  server.registerTool('cortex_find_by_tag', {
    description: 'Find symbols by semantic tag (db_read, db_write, unscoped_query, route_handler, etc.)',
    inputSchema: {
      type: 'object',
      properties: {
        tag: { type: 'string', description: 'Semantic tag to search for' },
        limit: { type: 'number', description: 'Max results' },
      },
      required: ['tag'],
    },
  }, async (params) => {
    const t0 = performance.now();
    const results = engine.findByTag(params.tag, params.limit);
    const responseText = JSON.stringify(results, null, 2);
    const result = { content: [{ type: 'text', text: responseText }] };
    const elapsed = performance.now() - t0;
    if (!telemetry) return result;

    let totalFileTokens = 0;
    const seenFiles = new Set();
    for (const r of results) {
      if (r.filePath && !seenFiles.has(r.filePath)) {
        seenFiles.add(r.filePath);
        const file = engine.store.getFile(r.filePath);
        if (file) totalFileTokens += Math.ceil(file.sizeBytes / 4);
      }
    }
    const responseTokens = estimateTokens(responseText);
    return telemetry.wrapResult(result, totalFileTokens, responseTokens, elapsed);
  });
}

module.exports = { registerSearchTools };
