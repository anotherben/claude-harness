function registerAdminTools(server, engine) {
  server.tool('cortex_status', {
    description: 'Index health: file count, symbol count, staleness',
    inputSchema: { type: 'object', properties: {} },
  }, async () => {
    const stats = engine.getStatus();
    return { content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }] };
  });

  server.tool('cortex_reindex', {
    description: 'Force reindex of a specific file or all files',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Specific file to reindex (optional — omit for all)' },
      },
    },
  }, async (params) => {
    engine.reindex(params.file_path);
    return { content: [{ type: 'text', text: 'Reindex complete' }] };
  });
}

module.exports = { registerAdminTools };
