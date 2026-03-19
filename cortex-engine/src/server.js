const fs = require('fs');
const path = require('path');
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
const { Telemetry } = require('./telemetry');

function resolveConfig(projectRoot, config = {}) {
  const resolved = {
    dbPath: '.cortex/index.db',
    ...config,
  };

  const projectConfigPath = path.join(projectRoot, 'cortex.config.js');
  if (fs.existsSync(projectConfigPath)) {
    Object.assign(resolved, require(projectConfigPath));
    Object.assign(resolved, config);
  }

  return resolved;
}

function resolveProjectRoot(projectRoot, env = process.env, cwd = process.cwd()) {
  return projectRoot || env.PWD || env.INIT_CWD || cwd;
}

async function createServer(projectRoot, config = {}) {
  const resolvedConfig = resolveConfig(projectRoot, config);
  const server = new McpServer({
    name: 'cortex-engine',
    version: '1.2.0',
  });

  const engine = new IndexEngine(projectRoot, resolvedConfig);
  // Don't await ready() here — let the MCP connection establish first.
  // engine.ready() is called in the startup sequence below.

  const git = new GitIntegration(projectRoot);
  const knowledge = new Knowledge(projectRoot, resolvedConfig);
  const fleet = new Fleet(knowledge);
  const telemetry = new Telemetry(projectRoot);

  registerFileTools(server, engine, telemetry);
  registerSearchTools(server, engine, telemetry);
  registerGitTools(server, git, telemetry);
  registerKnowledgeTools(server, knowledge, telemetry);
  registerFleetTools(server, fleet, telemetry);
  registerAdminTools(server, engine, telemetry);

  // Clean shutdown
  const cleanup = async () => {
    await engine.close();
    process.exit(0);
  };

  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);

  return { server, engine, git, knowledge, fleet, telemetry };
}

// Run as MCP stdio server if invoked directly
if (require.main === module) {
  const projectRoot = resolveProjectRoot(process.argv[2]);
  createServer(projectRoot).then(async ({ server, engine }) => {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    // Index AFTER MCP handshake so we don't timeout
    await engine.ready();
  }).catch((err) => {
    console.error('Failed to start cortex-engine:', err);
    process.exit(1);
  });
}

module.exports = { createServer, resolveConfig, resolveProjectRoot };
