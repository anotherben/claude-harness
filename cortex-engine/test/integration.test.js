const IndexEngine = require('../src/index');
const path = require('path');
const fs = require('fs');

const HELPDESK_ROOT = path.resolve(process.env.HOME, 'helpdesk');
const API_SRC = path.join(HELPDESK_ROOT, 'apps', 'api', 'src');

describe('Integration: helpdesk codebase', () => {
  let engine;

  beforeAll(async () => {
    // Index just apps/api/src for speed — still 100s of files
    engine = new IndexEngine(API_SRC, {
      extensions: ['.js', '.cjs'],
    });
    await engine.ready();
    // Wait for initial index
    await new Promise((r) => setTimeout(r, 8000));
  }, 60000);

  afterAll(async () => {
    if (engine) await engine.close();
  });

  it('indexes files without error', () => {
    const stats = engine.getStatus();
    expect(stats.fileCount).toBeGreaterThan(50);
    console.log(`Indexed ${stats.fileCount} files, ${stats.symbolCount} symbols`);
  });

  it('cortex_outline returns symbols for orderService.js', () => {
    const outline = engine.getOutline('services/orderCommandService.js');
    expect(outline).toBeDefined();
    expect(outline.length).toBeGreaterThan(0);
    console.log(`orderCommandService.js has ${outline.length} symbols`);
  });

  it('cortex_find_symbol finds functions by name', () => {
    const results = engine.findSymbol('order');
    expect(results.length).toBeGreaterThanOrEqual(1);
    console.log(`Found ${results.length} symbols matching 'order'`);
  });

  it('cortex_read_symbol returns function source', () => {
    const outline = engine.getOutline('services/orderCommandService.js');
    if (outline.length > 0) {
      const firstName = outline[0].name;
      const source = engine.readSymbol('services/orderCommandService.js', firstName);
      expect(source).toBeDefined();
      expect(source.length).toBeGreaterThan(0);
    }
  });

  it('cortex_find_text finds string literals', () => {
    const results = engine.findText('tenant_id');
    expect(results.length).toBeGreaterThan(0);
    console.log(`Found ${results.length} references to 'tenant_id'`);
  });

  it('handles .cjs files without crash', () => {
    const tree = engine.getTree('');
    const cjsFiles = tree.filter((f) => f.endsWith('.cjs'));
    console.log(`Found ${cjsFiles.length} .cjs files`);
    // No crash = pass
  });

  it('symbol query time is fast (<50ms)', () => {
    const start = Date.now();
    engine.findSymbol('order');
    const elapsed = Date.now() - start;
    console.log(`Symbol query took ${elapsed}ms`);
    expect(elapsed).toBeLessThan(50);
  });
});
