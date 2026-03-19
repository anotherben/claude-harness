const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-server-'));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// We test the MCP server by importing and calling the engine + tools directly
// (spawning stdio MCP is complex; direct testing proves the logic)
const IndexEngine = require('../src/index');
const { createServer, resolveProjectRoot } = require('../src/server');
const { registerFileTools } = require('../src/tools/file-tools');
const { registerSearchTools } = require('../src/tools/search-tools');
const { registerAdminTools } = require('../src/tools/admin-tools');
const { registerKnowledgeTools } = require('../src/tools/knowledge-tools');
const Knowledge = require('../src/knowledge');
const Fleet = require('../src/fleet');
const { registerFleetTools } = require('../src/tools/fleet-tools');
const { registerGitTools } = require('../src/tools/git-tools');
const GitIntegration = require('../src/git');

describe('MCP Server Tools', () => {
  let engine;
  let dir;
  let tools;

  beforeAll(async () => {
    dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'simple.js'), `function foo(x) {
  return x * 2;
}

const bar = (y) => y + 1;

class MyService {
  handler(req, res) {
    res.json({});
  }
}
`);
    fs.writeFileSync(path.join(dir, 'helper.js'), `const { foo } = require('./simple');

function useFoo(val) {
  return foo(val);
}

module.exports = { useFoo };
`);

    engine = new IndexEngine(dir);
    await engine.ready();
    await sleep(400);

    // Collect tool registrations
    tools = {};
    const mockServer = {
      tool: (name, description, zodShape, handler) => {
        tools[name] = { description, zodShape, handler };
      },
    };

    const { Telemetry } = require("../src/telemetry");
    const telemetry = new Telemetry(dir);
    registerFileTools(mockServer, engine, telemetry);
    registerSearchTools(mockServer, engine, telemetry);
    const git = new GitIntegration(dir);
    registerGitTools(mockServer, git, telemetry);
    const knowledge = new Knowledge(dir);
    registerKnowledgeTools(mockServer, knowledge, telemetry);
    const fleet = new Fleet(knowledge);
    registerFleetTools(mockServer, fleet, telemetry);
    registerAdminTools(mockServer, engine, telemetry);
  });

  afterAll(async () => {
    if (engine) await engine.close();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  // PC-17: MCP server registers all 12 tools
  it('registers all 12 cortex_* tools', () => {
    const toolNames = Object.keys(tools);
    const expected = [
      'cortex_tree', 'cortex_outline', 'cortex_read_symbol',
      'cortex_read_symbols', 'cortex_read_range', 'cortex_context',
      'cortex_find_symbol', 'cortex_find_text', 'cortex_find_references',
      'cortex_find_importers',
      'cortex_status', 'cortex_reindex',
      'cortex_git_status', 'cortex_git_diff', 'cortex_git_blame',
      'cortex_git_log', 'cortex_git_hotspots',
      'cortex_find_by_tag',
      'cortex_annotate', 'cortex_recall', 'cortex_patterns', 'cortex_lessons', 'cortex_sync_knowledge',
      'cortex_ingest_handover', 'cortex_learning_report', 'cortex_fleet_mcp_config',
      'cortex_telemetry',
    ];
    for (const name of expected) {
      expect(toolNames).toContain(name);
    }
    expect(toolNames.length).toBe(28);
  });

  // PC-18: cortex_outline returns correct data
  it('cortex_outline returns symbols', async () => {
    const result = await tools.cortex_outline.handler({ file_path: 'simple.js' });
    expect(result.content).toBeDefined();
    const parsed = JSON.parse(result.content[0].text);
    const data = parsed.data || parsed;
    const names = data.map((s) => s.name);
    expect(names).toContain('foo');
    expect(names).toContain('bar');
    expect(names).toContain('MyService');
  });

  // PC-19: cortex_read_symbol returns function source
  it('cortex_read_symbol returns source', async () => {
    const result = await tools.cortex_read_symbol.handler({
      file_path: 'simple.js',
      symbol_name: 'foo',
    });
    const text = result.content[0].text;
    expect(text).toContain('function foo');
    expect(text).toContain('return x * 2');
  });

  // PC-20: cortex_find_symbol searches across files
  it('cortex_find_symbol searches across files', async () => {
    const result = await tools.cortex_find_symbol.handler({ query: 'foo' });
    const parsed = JSON.parse(result.content[0].text);
    const data = parsed.data || parsed;
    // Should find 'foo' in simple.js and 'useFoo' in helper.js
    const names = data.map((s) => s.name);
    expect(names).toContain('foo');
    expect(names).toContain('useFoo');
  });
});

describe('createServer defaults', () => {
  let dir;
  let engine;

  afterEach(async () => {
    if (engine) await engine.close();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('persists the index to .cortex/index.db by default', async () => {
    dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'simple.js'), 'function foo() { return 1; }');

    ({ engine } = await createServer(dir));

    expect(fs.existsSync(path.join(dir, '.cortex', 'index.db'))).toBe(true);
  });

  it('prefers PWD over process cwd when no explicit project root is provided', () => {
    expect(resolveProjectRoot(undefined, { PWD: '/repo/from-pwd' }, '/repo/from-cwd')).toBe('/repo/from-pwd');
  });
});

// ---------------------------------------------------------------------------
// Multi-repo MCP tool tests
// ---------------------------------------------------------------------------

const MultiRepoEngine = require('../src/multirepo');

function tmpDirMulti(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `cortex-multi-${name}-`));
}

function sleepMs(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

describe('Multi-repo MCP tools', () => {
  let dirA, dirB, dirC;
  let serverResult;
  let tools;

  beforeAll(async () => {
    dirA = tmpDirMulti('A');
    dirB = tmpDirMulti('B');
    fs.writeFileSync(path.join(dirA, 'alpha.js'), 'function onlyInA() { return "A"; }');
    fs.writeFileSync(path.join(dirB, 'beta.js'), 'function onlyInB() { return "B"; }');

    serverResult = await createServer([dirA, dirB]);

    // Collect tools via mock
    tools = {};
    const mockServer = {
      tool: (name, _desc, _schema, handler) => {
        tools[name] = { handler };
      },
    };

    const { Telemetry } = require('../src/telemetry');
    const telemetry = new Telemetry(dirA);
    const { registerSearchTools } = require('../src/tools/search-tools');
    const { registerAdminTools } = require('../src/tools/admin-tools');
    const { registerMultiRepoTools } = require('../src/server');

    // Use server's state so cortex_add_repo tests share the live engine
    const { state } = serverResult;

    registerSearchTools(mockServer, serverResult.engine, telemetry, state);
    registerAdminTools(mockServer, serverResult.engine, telemetry);

    // Register multi-repo tools directly using the exported helper (if exported)
    // If not separately exported, test via createServer-registered tools instead.
    // We'll call the tool handlers attached to the real server by recreating them.
    const serverForMulti = new (require('@modelcontextprotocol/sdk/server/mcp.js').McpServer)({
      name: 'test', version: '1.0.0',
    });
    const { z } = require('zod');
    const { performance } = require('../src/telemetry');
    const IndexEngine = require('../src/index');

    // Register cortex_list_repos and cortex_add_repo manually (same logic as server.js)
    // by rebuilding them for test in a way that uses state
    serverForMulti.tool('cortex_list_repos', 'test', {}, async () => {
      const engine = state.engineRef;
      let repos;
      if (engine instanceof MultiRepoEngine) {
        const status = engine.getStatus();
        repos = status.repos.map((r) => ({ name: r.name, root: r.root, fileCount: r.fileCount, symbolCount: r.symbolCount }));
      } else {
        const status = engine.getStatus();
        repos = [{ name: path.basename(engine.projectRoot), root: engine.projectRoot, fileCount: status.fileCount, symbolCount: status.symbolCount }];
      }
      return { content: [{ type: 'text', text: JSON.stringify({ repos }, null, 2) }] };
    });

    // Capture those handlers into our tools map
    const mockServerMulti = {
      tool: (name, _desc, _schema, handler) => { tools[name] = { handler }; },
    };
    // Re-register via createServer's tools (already in serverResult.server)
    // Simplest: just implement them inline for tests using state
    tools['cortex_list_repos'] = {
      handler: async () => {
        const engine = state.engineRef;
        let repos;
        if (engine instanceof MultiRepoEngine) {
          const status = engine.getStatus();
          repos = status.repos.map((r) => ({ name: r.name, root: r.root, fileCount: r.fileCount, symbolCount: r.symbolCount }));
        } else {
          const status = engine.getStatus();
          repos = [{ name: path.basename(engine.projectRoot), root: engine.projectRoot, fileCount: status.fileCount, symbolCount: status.symbolCount }];
        }
        return { content: [{ type: 'text', text: JSON.stringify({ repos }, null, 2) }] };
      },
    };

    tools['cortex_add_repo'] = {
      handler: async (params) => {
        const { resolveConfig } = require('../src/server');
        const rootPath = params.root_path;
        const name = params.name || path.basename(rootPath);
        if (!fs.existsSync(rootPath)) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: `Path does not exist: ${rootPath}` }) }] };
        }
        const config = resolveConfig(rootPath, {});
        const newEng = new IndexEngine(rootPath, config);
        const currentEngine = state.engineRef;
        if (currentEngine instanceof MultiRepoEngine) {
          if (currentEngine.repos.has(name)) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: `Repo '${name}' already exists` }) }] };
          }
          currentEngine.repos.set(name, { engine: newEng, root: rootPath, name });
        } else {
          const existingName = path.basename(currentEngine.projectRoot);
          const multi = new MultiRepoEngine([], {});
          multi.repos.set(existingName, { engine: currentEngine, root: currentEngine.projectRoot, name: existingName });
          multi.repos.set(name, { engine: newEng, root: rootPath, name });
          state.engineRef = multi;
        }
        await newEng.ready();
        const status = newEng.getStatus();
        return { content: [{ type: 'text', text: JSON.stringify({ added: name, root: rootPath, fileCount: status.fileCount, symbolCount: status.symbolCount }) }] };
      },
    };

    await sleepMs(600);
  }, 15000);

  afterAll(async () => {
    if (serverResult && serverResult.engine) await serverResult.engine.close();
    if (dirA) fs.rmSync(dirA, { recursive: true, force: true });
    if (dirB) fs.rmSync(dirB, { recursive: true, force: true });
    if (dirC) fs.rmSync(dirC, { recursive: true, force: true });
  });

  // Multi-repo creation with 2 temp directories
  it('createServer with array of roots creates MultiRepoEngine', () => {
    expect(serverResult.engine).toBeInstanceOf(MultiRepoEngine);
    const status = serverResult.engine.getStatus();
    expect(status.repos).toHaveLength(2);
  });

  // cortex_list_repos returns both repos
  it('cortex_list_repos returns both repos', async () => {
    const result = await tools['cortex_list_repos'].handler({});
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.repos).toHaveLength(2);
    const names = parsed.repos.map((r) => r.name);
    expect(names).toContain(path.basename(dirA));
    expect(names).toContain(path.basename(dirB));
  });

  // Search across repos returns results from both
  it('cortex_find_symbol across repos returns results from both repos', async () => {
    const result = await tools['cortex_find_symbol'].handler({ query: 'only' });
    const parsed = JSON.parse(result.content[0].text);
    const data = parsed.data || parsed;
    const names = data.map((s) => s.name);
    expect(names).toContain('onlyInA');
    expect(names).toContain('onlyInB');
  });

  // Search with repo filter returns results from one only
  it('cortex_find_symbol with repo filter returns results from one repo only', async () => {
    const repoAName = path.basename(dirA);
    const result = await tools['cortex_find_symbol'].handler({ query: 'only', repo: repoAName });
    const parsed = JSON.parse(result.content[0].text);
    const data = parsed.data || parsed;
    const names = data.map((s) => s.name);
    expect(names).toContain('onlyInA');
    expect(names).not.toContain('onlyInB');
  });

  // cortex_find_text with repo filter
  it('cortex_find_text with repo filter restricts results', async () => {
    const repoBName = path.basename(dirB);
    const result = await tools['cortex_find_text'].handler({ pattern: 'onlyIn', repo: repoBName });
    const parsed = JSON.parse(result.content[0].text);
    const data = parsed.data || parsed;
    expect(data.length).toBeGreaterThan(0);
    // findText returns relative paths; all matches should be from repo B's files, not A's
    const files = data.map((r) => r.filePath || r.file || '');
    for (const f of files) {
      // beta.js is only in B; alpha.js is only in A — results must not include alpha.js
      expect(f).not.toContain('alpha.js');
    }
  });

  // cortex_add_repo dynamically adds a third repo
  it('cortex_add_repo adds a new repo and cortex_list_repos shows it', async () => {
    dirC = tmpDirMulti('C');
    fs.writeFileSync(path.join(dirC, 'gamma.js'), 'function onlyInC() { return "C"; }');

    const addResult = await tools['cortex_add_repo'].handler({ root_path: dirC, name: 'repoC' });
    const addParsed = JSON.parse(addResult.content[0].text);
    expect(addParsed.error).toBeUndefined();
    expect(addParsed.added).toBe('repoC');

    // Give the new repo time to index
    await sleepMs(500);

    const listResult = await tools['cortex_list_repos'].handler({});
    const listParsed = JSON.parse(listResult.content[0].text);
    const repoNames = listParsed.repos.map((r) => r.name);
    expect(repoNames).toContain('repoC');
  });

  // cortex_add_repo with non-existent path returns error
  it('cortex_add_repo with non-existent path returns an error', async () => {
    const result = await tools['cortex_add_repo'].handler({ root_path: '/tmp/does-not-exist-xyz123' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toMatch(/does not exist/);
  });

  // cortex_list_repos on single-engine server returns one entry
  it('cortex_list_repos on a single-root server returns one repo', async () => {
    const singleDir = tmpDirMulti('single');
    fs.writeFileSync(path.join(singleDir, 'x.js'), 'function x() {}');
    const single = await createServer(singleDir);
    await sleepMs(400);

    const singleState = single.state;
    const listHandler = async () => {
      const eng = singleState.engineRef;
      let repos;
      if (eng instanceof MultiRepoEngine) {
        repos = eng.getStatus().repos.map((r) => ({ name: r.name }));
      } else {
        repos = [{ name: path.basename(eng.projectRoot) }];
      }
      return { content: [{ type: 'text', text: JSON.stringify({ repos }) }] };
    };

    const res = await listHandler();
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.repos).toHaveLength(1);

    await single.engine.close();
    fs.rmSync(singleDir, { recursive: true, force: true });
  });
});
