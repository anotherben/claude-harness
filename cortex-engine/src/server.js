const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const IndexEngine = require('./index');
const { registerFileTools } = require('./tools/file-tools');
const { registerSearchTools } = require('./tools/search-tools');
const { registerAdminTools } = require('./tools/admin-tools');

async function createServer(projectRoot, config = {}) {
  const server = new McpServer({
    name: 'cortex-engine',
    version: '0.1.0',
  });

  const engine = new IndexEngine(projectRoot, config);
  await engine.ready();

  registerFileTools(server, engine);
  registerSearchTools(server, engine);
  registerAdminTools(server, engine);

  // Clean shutdown
  const cleanup = async () => {
    await engine.close();
    process.exit(0);
  };

  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);

  return { server, engine };
}

// Run as MCP stdio server if invoked directly
if (require.main === module) {
  const projectRoot = process.argv[2] || process.cwd();
  createServer(projectRoot).then(async ({ server }) => {
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }).catch((err) => {
    console.error('Failed to start cortex-engine:', err);
    process.exit(1);
  });
}

module.exports = { createServer };
