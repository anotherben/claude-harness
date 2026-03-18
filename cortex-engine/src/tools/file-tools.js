function registerFileTools(server, engine) {
  server.tool('cortex_tree', {
    description: 'File tree with optional path prefix filter',
    inputSchema: {
      type: 'object',
      properties: {
        path_prefix: { type: 'string', description: 'Filter by path prefix' },
        depth: { type: 'number', description: 'Max depth' },
      },
    },
  }, async (params) => {
    const files = engine.getTree(params.path_prefix, params.depth);
    return { content: [{ type: 'text', text: JSON.stringify(files, null, 2) }] };
  });

  server.tool('cortex_outline', {
    description: 'List symbols in a file with kind, signature, line range',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Relative file path' },
      },
      required: ['file_path'],
    },
  }, async (params) => {
    const outline = engine.getOutline(params.file_path);
    return { content: [{ type: 'text', text: JSON.stringify(outline, null, 2) }] };
  });

  server.tool('cortex_read_symbol', {
    description: 'Read the full source code of a single symbol',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Relative file path' },
        symbol_name: { type: 'string', description: 'Symbol name' },
      },
      required: ['file_path', 'symbol_name'],
    },
  }, async (params) => {
    const source = engine.readSymbol(params.file_path, params.symbol_name);
    if (!source) {
      return { content: [{ type: 'text', text: 'Symbol not found' }], isError: true };
    }
    return { content: [{ type: 'text', text: source }] };
  });

  server.tool('cortex_read_symbols', {
    description: 'Batch read multiple symbols',
    inputSchema: {
      type: 'object',
      properties: {
        specs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              filePath: { type: 'string' },
              symbolName: { type: 'string' },
            },
          },
          description: 'Array of {filePath, symbolName} to read',
        },
      },
      required: ['specs'],
    },
  }, async (params) => {
    const results = engine.readSymbols(params.specs);
    return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
  });

  server.tool('cortex_read_range', {
    description: 'Read a specific line range from a file',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string' },
        start_line: { type: 'number' },
        end_line: { type: 'number' },
      },
      required: ['file_path', 'start_line', 'end_line'],
    },
  }, async (params) => {
    const text = engine.readRange(params.file_path, params.start_line, params.end_line);
    if (text === null) {
      return { content: [{ type: 'text', text: 'File not found' }], isError: true };
    }
    return { content: [{ type: 'text', text }] };
  });

  server.tool('cortex_context', {
    description: 'Get a symbol with its imports and file outline',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string' },
        symbol_name: { type: 'string' },
      },
      required: ['file_path', 'symbol_name'],
    },
  }, async (params) => {
    const ctx = engine.getContext(params.file_path, params.symbol_name);
    if (!ctx) {
      return { content: [{ type: 'text', text: 'Not found' }], isError: true };
    }
    return { content: [{ type: 'text', text: JSON.stringify(ctx, null, 2) }] };
  });
}

module.exports = { registerFileTools };
