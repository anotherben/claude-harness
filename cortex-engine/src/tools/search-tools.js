function registerSearchTools(server, engine) {
  server.tool('cortex_find_symbol', {
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
    const results = engine.findSymbol(params.query, {
      kind: params.kind,
      exportedOnly: params.exported_only,
      limit: params.limit,
      sourceTypes: params.source_types,
    });
    return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
  });

  server.tool('cortex_find_text', {
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
    const results = engine.findText(params.pattern, {
      caseSensitive: params.case_sensitive,
    });
    return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
  });

  server.tool('cortex_find_references', {
    description: 'Find all references to an identifier across files',
    inputSchema: {
      type: 'object',
      properties: {
        identifier: { type: 'string', description: 'Identifier to search for' },
      },
      required: ['identifier'],
    },
  }, async (params) => {
    const results = engine.findReferences(params.identifier);
    return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
  });

  server.tool('cortex_find_importers', {
    description: 'Find files that import a given file',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'File path to find importers of' },
      },
      required: ['file_path'],
    },
  }, async (params) => {
    const results = engine.findImporters(params.file_path);
    return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
  });
  server.tool('cortex_find_by_tag', {
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
    const results = engine.findByTag(params.tag, params.limit);
    return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
  });
}

module.exports = { registerSearchTools };
