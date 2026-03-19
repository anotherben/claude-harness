const { performance } = require('../telemetry');

function registerAdminTools(server, engine, telemetry) {
  server.tool('cortex_status', {
    description: 'Index health: file count, symbol count, staleness',
    inputSchema: { type: 'object', properties: {} },
  }, async () => {
    const t0 = performance.now();
    const stats = engine.getStatus();
    const result = { content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }] };
    const elapsed = performance.now() - t0;
    if (!telemetry) return result;
    return telemetry.wrapTimingOnly(result, elapsed);
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
    const t0 = performance.now();
    engine.reindex(params.file_path);
    const result = { content: [{ type: 'text', text: 'Reindex complete' }] };
    const elapsed = performance.now() - t0;
    if (!telemetry) return result;
    return telemetry.wrapTimingOnly(result, elapsed);
  });

  server.tool('cortex_telemetry', {
    description: 'Cumulative token-savings telemetry: queries, tokens saved, cost avoided',
    inputSchema: { type: 'object', properties: {} },
  }, async () => {
    const t0 = performance.now();
    if (!telemetry) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'Telemetry not initialized' }, null, 2) }] };
    }
    const report = telemetry.getReport();
    const result = { content: [{ type: 'text', text: JSON.stringify(report, null, 2) }] };
    const elapsed = performance.now() - t0;
    return telemetry.wrapTimingOnly(result, elapsed);
  });
}

module.exports = { registerAdminTools };
