function registerFleetTools(server, fleet) {
  server.tool('cortex_ingest_handover', {
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
    const count = fleet.ingestHandover(params.markdown, params.worker_id);
    return { content: [{ type: 'text', text: `Ingested ${count} lessons from ${params.worker_id}` }] };
  });

  server.tool('cortex_learning_report', {
    description: 'Fleet-wide learning report: annotations, lessons, patterns by author and target',
    inputSchema: { type: 'object', properties: {} },
  }, async () => {
    const report = fleet.learningReport();
    return { content: [{ type: 'text', text: JSON.stringify(report, null, 2) }] };
  });

  server.tool('cortex_fleet_mcp_config', {
    description: 'Get MCP server config for cortex-engine (for conductor dispatch)',
    inputSchema: {
      type: 'object',
      properties: {
        project_root: { type: 'string', description: 'Project root path' },
      },
      required: ['project_root'],
    },
  }, async (params) => {
    const config = fleet.getMcpConfig(params.project_root);
    return { content: [{ type: 'text', text: JSON.stringify(config, null, 2) }] };
  });
}

module.exports = { registerFleetTools };
