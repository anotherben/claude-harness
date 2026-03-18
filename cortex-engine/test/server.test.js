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
const { registerFileTools } = require('../src/tools/file-tools');
const { registerSearchTools } = require('../src/tools/search-tools');
const { registerAdminTools } = require('../src/tools/admin-tools');

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
      tool: (name, schema, handler) => {
        tools[name] = { schema, handler };
      },
    };

    registerFileTools(mockServer, engine);
    registerSearchTools(mockServer, engine);
    registerAdminTools(mockServer, engine);
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
    ];
    for (const name of expected) {
      expect(toolNames).toContain(name);
    }
    expect(toolNames.length).toBe(12);
  });

  // PC-18: cortex_outline returns correct data
  it('cortex_outline returns symbols', async () => {
    const result = await tools.cortex_outline.handler({ file_path: 'simple.js' });
    expect(result.content).toBeDefined();
    const data = JSON.parse(result.content[0].text);
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
    const data = JSON.parse(result.content[0].text);
    // Should find 'foo' in simple.js and 'useFoo' in helper.js
    const names = data.map((s) => s.name);
    expect(names).toContain('foo');
    expect(names).toContain('useFoo');
  });
});
