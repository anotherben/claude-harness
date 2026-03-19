const { z } = require('zod');
const { estimateTokens, performance } = require('../telemetry');

function registerSearchTools(server, engine, telemetry) {
  server.tool('cortex_find_symbol', 'Search symbols by name across all indexed files', {
    query: z.string().describe('Search query (substring match)'),
    kind: z.string().optional().describe('Filter by kind: function, class, method, variable'),
    exported_only: z.boolean().optional().describe('Only exported symbols'),
    limit: z.number().optional().describe('Max results'),
    source_types: z.array(z.string()).optional().describe('Filter by source type: code, config, query, docs, markup, style. Defaults to [code, query].'),
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

  server.tool('cortex_find_text', 'Regex/literal search across indexed file contents', {
    pattern: z.string().describe('Search pattern (regex)'),
    case_sensitive: z.boolean().optional().describe('Case sensitive search'),
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

  server.tool('cortex_find_references', 'Find all references to an identifier across files', {
    identifier: z.string().describe('Identifier to search for'),
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

  server.tool('cortex_find_importers', 'Find files that import a given file', {
    file_path: z.string().describe('File path to find importers of'),
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

  server.tool('cortex_find_by_tag', 'Find symbols by semantic tag (db_read, db_write, unscoped_query, route_handler, etc.)', {
    tag: z.string().describe('Semantic tag to search for'),
    limit: z.number().optional().describe('Max results'),
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
