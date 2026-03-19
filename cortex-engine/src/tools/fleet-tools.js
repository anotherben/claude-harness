const { performance } = require('../telemetry');

function registerFleetTools(server, fleet, telemetry) {
  server.registerTool('cortex_ingest_handover', {
    description: 'Extract lessons from a worker handover and add to knowledge store',
    inputSchema: {
      type: 'object',
      properties: {
        markdown: { type: 'string', description: 'Handover markdown content' },
        worker_id: { type: 'string', description: 'ID of the worker that produced the handover' },
      },
      required: ['markdown', 'worker_id'],
    },
  }, async (params) => {
    const t0 = performance.now();
    const count = fleet.ingestHandover(params.markdown, params.worker_id);
    const result = { content: [{ type: 'text', text: `Ingested ${count} lessons from ${params.worker_id}` }] };
    const elapsed = performance.now() - t0;
    if (!telemetry) return result;
    return telemetry.wrapTimingOnly(result, elapsed);
  });

  server.registerTool('cortex_learning_report', {
    description: 'Fleet-wide learning report: annotations, lessons, patterns by author and target',
    inputSchema: { type: 'object', properties: {} },
  }, async () => {
    const t0 = performance.now();
    const report = fleet.learningReport();
    const result = { content: [{ type: 'text', text: JSON.stringify(report, null, 2) }] };
    const elapsed = performance.now() - t0;
    if (!telemetry) return result;
    return telemetry.wrapTimingOnly(result, elapsed);
  });

  server.registerTool('cortex_fleet_mcp_config', {
    description: 'Get MCP server config for cortex-engine (for conductor dispatch)',
    inputSchema: {
      type: 'object',
      properties: {
        project_root: { type: 'string', description: 'Project root path' },
      },
      required: ['project_root'],
    },
  }, async (params) => {
    const t0 = performance.now();
    const config = fleet.getMcpConfig(params.project_root);
    const result = { content: [{ type: 'text', text: JSON.stringify(config, null, 2) }] };
    const elapsed = performance.now() - t0;
    if (!telemetry) return result;
    return telemetry.wrapTimingOnly(result, elapsed);
  });
}

module.exports = { registerFleetTools };
