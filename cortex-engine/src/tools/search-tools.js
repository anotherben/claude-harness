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
      },
      required: ['query'],
    },
  }, async (params) => {
    const results = engine.findSymbol(params.query, {
      kind: params.kind,
      exportedOnly: params.exported_only,
      limit: params.limit,
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
}

module.exports = { registerSearchTools };
