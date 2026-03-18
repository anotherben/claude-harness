const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const IndexEngine = require('./index');
const GitIntegration = require('./git');
const { registerFileTools } = require('./tools/file-tools');
const { registerSearchTools } = require('./tools/search-tools');
const { registerGitTools } = require('./tools/git-tools');
const { registerAdminTools } = require('./tools/admin-tools');
const { registerKnowledgeTools } = require('./tools/knowledge-tools');
const Knowledge = require('./knowledge');
const Fleet = require('./fleet');
const { registerFleetTools } = require('./tools/fleet-tools');

async function createServer(projectRoot, config = {}) {
  const server = new McpServer({
    name: 'cortex-engine',
    version: '1.0.0',
  });

  const engine = new IndexEngine(projectRoot, config);
  await engine.ready();

  const git = new GitIntegration(projectRoot);
  const knowledge = new Knowledge(projectRoot, config);
  const fleet = new Fleet(knowledge);

  registerFileTools(server, engine);
  registerSearchTools(server, engine);
  registerGitTools(server, git);
  registerKnowledgeTools(server, knowledge);
  registerFleetTools(server, fleet);
  registerAdminTools(server, engine);

  // Clean shutdown
  const cleanup = async () => {
    await engine.close();
    process.exit(0);
  };

  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);

  return { server, engine, git, knowledge, fleet };
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
