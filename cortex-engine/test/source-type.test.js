const Store = require('../src/store');
const fs = require('fs');
const { getSourceType } = require('../src/store');
const IndexEngine = require('../src/index');
const path = require('path');
const os = require('os');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-srctype-'));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

describe('source_type categorization', () => {

  describe('getSourceType mapping', () => {
    it('maps .ts to code', () => {
      expect(getSourceType('src/index.ts')).toBe('code');
    });
    it('maps .js to code', () => {
      expect(getSourceType('app.js')).toBe('code');
    });
    it('maps .py to code', () => {
      expect(getSourceType('main.py')).toBe('code');
    });
    it('maps .json to config', () => {
      expect(getSourceType('package.json')).toBe('config');
    });
    it('maps .yaml to config', () => {
      expect(getSourceType('config.yaml')).toBe('config');
    });
    it('maps .toml to config', () => {
      expect(getSourceType('Cargo.toml')).toBe('config');
    });
    it('maps .sql to query', () => {
      expect(getSourceType('schema.sql')).toBe('query');
    });
    it('maps .graphql to query', () => {
      expect(getSourceType('schema.graphql')).toBe('query');
    });
    it('maps .md to docs', () => {
      expect(getSourceType('README.md')).toBe('docs');
    });
    it('maps .html to markup', () => {
      expect(getSourceType('index.html')).toBe('markup');
    });
    it('maps .vue to markup', () => {
      expect(getSourceType('App.vue')).toBe('markup');
    });
    it('maps .css to style', () => {
      expect(getSourceType('main.css')).toBe('style');
    });
    it('maps .scss to style', () => {
      expect(getSourceType('theme.scss')).toBe('style');
    });
    it('defaults unknown extensions to code', () => {
      expect(getSourceType('file.xyz')).toBe('code');
    });

    it('file in __tests__/ gets source_type test', () => {
      expect(getSourceType('src/__tests__/foo.js')).toBe('test');
    });

    it('file named foo.test.ts gets source_type test', () => {
      expect(getSourceType('src/foo.test.ts')).toBe('test');
    });

    it('file named foo.spec.js gets source_type test', () => {
      expect(getSourceType('src/foo.spec.js')).toBe('test');
    });

    it('file named foo.test.tsx gets source_type test', () => {
      expect(getSourceType('components/foo.test.tsx')).toBe('test');
    });

    it('file in __mocks__/ gets source_type test', () => {
      expect(getSourceType('src/__mocks__/db.js')).toBe('test');
    });

    it('file in __fixtures__/ gets source_type test', () => {
      expect(getSourceType('test/__fixtures__/data.js')).toBe('test');
    });

    it('file in tests/ directory gets source_type test', () => {
      expect(getSourceType('tests/integration.js')).toBe('test');
    });

    it('file in src/ (not test) gets source_type code, not test', () => {
      expect(getSourceType('src/store.js')).toBe('code');
    });
  });

  describe('Store source_type column', () => {
    let store;

    beforeEach(() => {
      store = new Store(':memory:');
      store.migrate();
    });

    afterEach(() => {
      store.close();
    });

    it('schema has source_type column', () => {
      const cols = store.db.pragma('table_info(symbols)');
      const names = cols.map(c => c.name);
      expect(names).toContain('source_type');
    });

    it('stores source_type when upserting symbols', () => {
      const f = store.upsertFile({ path: 'a.ts', language: 'typescript', hash: 'a', sizeBytes: 100, lineCount: 10 });
      store.upsertSymbols(f.id, [
        { name: 'foo', kind: 'function', signature: 'function foo()', startLine: 1, endLine: 3, exported: false, async: false },
      ], 'code');
      const syms = store.getSymbolsByFile(f.id);
      expect(syms[0].sourceType).toBe('code');
    });

    it('stores config source_type for JSON symbols', () => {
      const f = store.upsertFile({ path: 'pkg.json', language: 'text', hash: 'j', sizeBytes: 50, lineCount: 5 });
      store.upsertSymbols(f.id, [
        { name: 'name', kind: 'variable', signature: 'name: test', startLine: 1, endLine: 1, exported: false, async: false },
      ], 'config');
      const syms = store.getSymbolsByFile(f.id);
      expect(syms[0].sourceType).toBe('config');
    });

    it('stores docs source_type for Markdown symbols', () => {
      const f = store.upsertFile({ path: 'README.md', language: 'text', hash: 'm', sizeBytes: 30, lineCount: 3 });
      store.upsertSymbols(f.id, [
        { name: 'Introduction', kind: 'class', signature: '# Introduction', startLine: 1, endLine: 1, exported: false, async: false },
      ], 'docs');
      const syms = store.getSymbolsByFile(f.id);
      expect(syms[0].sourceType).toBe('docs');
    });
  });

  describe('findSymbols source_type filtering', () => {
    let store;

    beforeEach(() => {
      store = new Store(':memory:');
      store.migrate();

      // Insert symbols from different source types
      const fCode = store.upsertFile({ path: 'app.ts', language: 'typescript', hash: 'c', sizeBytes: 100, lineCount: 10 });
      store.upsertSymbols(fCode.id, [
        { name: 'handleRequest', kind: 'function', signature: 'function handleRequest()', startLine: 1, endLine: 5, exported: true, async: false },
      ], 'code');

      const fConfig = store.upsertFile({ path: 'config.json', language: 'text', hash: 'j', sizeBytes: 50, lineCount: 5 });
      store.upsertSymbols(fConfig.id, [
        { name: 'apiEndpoint', kind: 'variable', signature: 'apiEndpoint: ...', startLine: 1, endLine: 1, exported: false, async: false },
      ], 'config');

      const fQuery = store.upsertFile({ path: 'schema.sql', language: 'sql', hash: 's', sizeBytes: 80, lineCount: 8 });
      store.upsertSymbols(fQuery.id, [
        { name: 'users', kind: 'class', signature: 'CREATE TABLE users', startLine: 1, endLine: 4, exported: false, async: false },
      ], 'query');

      const fDocs = store.upsertFile({ path: 'README.md', language: 'text', hash: 'd', sizeBytes: 30, lineCount: 3 });
      store.upsertSymbols(fDocs.id, [
        { name: 'API Reference', kind: 'class', signature: '# API Reference', startLine: 1, endLine: 1, exported: false, async: false },
      ], 'docs');

      const fMarkup = store.upsertFile({ path: 'index.html', language: 'text', hash: 'h', sizeBytes: 200, lineCount: 20 });
      store.upsertSymbols(fMarkup.id, [
        { name: 'script', kind: 'class', signature: '<script>', startLine: 10, endLine: 10, exported: false, async: false },
      ], 'markup');

      const fTest = store.upsertFile({ path: 'src/__tests__/api.test.js', language: 'javascript', hash: 't', sizeBytes: 90, lineCount: 9 });
      store.upsertSymbols(fTest.id, [        { name: 'testApiHelper', kind: 'function', signature: 'function testApiHelper()', startLine: 1, endLine: 4, exported: false, async: false },
      ], 'test');

      const fStyle = store.upsertFile({ path: 'main.css', language: 'css', hash: 'y', sizeBytes: 60, lineCount: 6 });
      store.upsertSymbols(fStyle.id, [
        { name: '.apiButton', kind: 'class', signature: '.apiButton', startLine: 1, endLine: 3, exported: false, async: false },
      ], 'style');
    });

    afterEach(() => {
      store.close();
    });

    it('defaults to code+query source types', () => {
      // All test symbols contain 'api' or 'user' substring - search broadly
      const results = store.findSymbols({ query: 'api' });
      const types = results.map(r => r.sourceType);
      // Should only contain code and query types by default
      expect(types.every(t => t === 'code' || t === 'query')).toBe(true);
    });

    it('findSymbol with source_types=[config] returns JSON symbols', () => {
      const results = store.findSymbols({ query: 'api', sourceTypes: ['config'] });
      expect(results.length).toBe(1);
      expect(results[0].name).toBe('apiEndpoint');
      expect(results[0].sourceType).toBe('config');
    });

    it('findSymbol with all source types returns everything', () => {
      const allTypes = ['code', 'config', 'docs', 'markup', 'style', 'query'];
      const results = store.findSymbols({ query: 'api', sourceTypes: allTypes });
      // Should find: handleRequest (code - no 'api'), apiEndpoint (config), API Reference (docs), .apiButton (style)
      const names = results.map(r => r.name);
      expect(names).toContain('apiEndpoint');
      expect(names).toContain('API Reference');
      expect(names).toContain('.apiButton');
    });

    it('findSymbol with source_types=[docs] returns only docs', () => {
      const results = store.findSymbols({ query: 'API', sourceTypes: ['docs'] });
      expect(results.length).toBe(1);
      expect(results[0].sourceType).toBe('docs');
    });

    it('findSymbol with source_types=[style] returns only style', () => {
      const results = store.findSymbols({ query: 'api', sourceTypes: ['style'] });
      expect(results.length).toBe(1);
      expect(results[0].sourceType).toBe('style');
    });

    it('default findSymbols excludes test files', () => {
      // Default is ['code', 'query'] — test files should not appear
      const results = store.findSymbols({ query: 'api' });
      const types = results.map(r => r.sourceType);
      expect(types).not.toContain('test');
    });

    it('findSymbols with sourceTypes=[test] returns only test files', () => {
      const results = store.findSymbols({ query: 'api', sourceTypes: ['test'] });
      expect(results.length).toBe(1);
      expect(results[0].name).toBe('testApiHelper');
      expect(results[0].sourceType).toBe('test');
    });

    it('findSymbols with sourceTypes=[code,test,query] includes test files', () => {
      const results = store.findSymbols({ query: 'api', sourceTypes: ['code', 'test', 'query'] });
      const types = results.map(r => r.sourceType);
      expect(types).toContain('test');
    });
  });

  describe('IndexEngine source_type integration', () => {
    let engine;
    let dir;

    afterEach(async () => {
      if (engine) await engine.close();
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    });

    it('symbol from .ts file has source_type code', async () => {
      dir = tmpDir();
      fs.writeFileSync(path.join(dir, 'app.ts'), 'function hello() { return 1; }');
      engine = new IndexEngine(dir, { extensions: ['.ts'] });
      await engine.ready();
      await sleep(300);

      const outline = engine.getOutline('app.ts');
      expect(outline.length).toBeGreaterThan(0);
      expect(outline[0].sourceType).toBe('code');
    });

    it('symbol from .json file has source_type config', async () => {
      dir = tmpDir();
      fs.writeFileSync(path.join(dir, 'pkg.json'), JSON.stringify({ name: 'test' }, null, 2));
      engine = new IndexEngine(dir, { extensions: ['.json'] });
      await engine.ready();
      await sleep(300);

      const outline = engine.getOutline('pkg.json');
      expect(outline.length).toBeGreaterThan(0);
      expect(outline[0].sourceType).toBe('config');
    });

    it('symbol from .md file has source_type docs', async () => {
      dir = tmpDir();
      fs.writeFileSync(path.join(dir, 'README.md'), '# Hello World\n\nSome text.');
      engine = new IndexEngine(dir, { extensions: ['.md'] });
      await engine.ready();
      await sleep(300);

      const outline = engine.getOutline('README.md');
      expect(outline.length).toBeGreaterThan(0);
      expect(outline[0].sourceType).toBe('docs');
    });

    it('symbol from .sql file has source_type query', async () => {
      dir = tmpDir();
      fs.writeFileSync(path.join(dir, 'schema.sql'), 'CREATE TABLE users (id INT);');
      engine = new IndexEngine(dir, { extensions: ['.sql'] });
      await engine.ready();
      await sleep(300);

      const outline = engine.getOutline('schema.sql');
      expect(outline.length).toBeGreaterThan(0);
      expect(outline[0].sourceType).toBe('query');
    });

    it('symbol from .css file has source_type style', async () => {
      dir = tmpDir();
      fs.writeFileSync(path.join(dir, 'main.css'), '.header {\n  color: red;\n}');
      engine = new IndexEngine(dir, { extensions: ['.css'] });
      await engine.ready();
      await sleep(300);

      const outline = engine.getOutline('main.css');
      expect(outline.length).toBeGreaterThan(0);
      expect(outline[0].sourceType).toBe('style');
    });

    it('symbol from .html file has source_type markup', async () => {
      dir = tmpDir();
      fs.writeFileSync(path.join(dir, 'page.html'), '<html><script>var x = 1;</script></html>');
      engine = new IndexEngine(dir, { extensions: ['.html'] });
      await engine.ready();
      await sleep(300);

      const outline = engine.getOutline('page.html');
      expect(outline.length).toBeGreaterThan(0);
      expect(outline[0].sourceType).toBe('markup');
    });

    it('findSymbol defaults to code+query, excludes config/docs/markup/style', async () => {
      dir = tmpDir();
      fs.writeFileSync(path.join(dir, 'handler.js'), 'function requestHandler() {}');
      fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ requestTimeout: 5000 }, null, 2));
      engine = new IndexEngine(dir, { extensions: ['.js', '.json'] });
      await engine.ready();
      await sleep(300);

      const results = engine.findSymbol('request');
      const names = results.map(r => r.name);
      expect(names).toContain('requestHandler');
      // Config symbols excluded by default
      expect(names).not.toContain('requestTimeout');
    });

    it('findSymbol with sourceTypes includes config symbols', async () => {
      dir = tmpDir();
      fs.writeFileSync(path.join(dir, 'handler.js'), 'function requestHandler() {}');
      fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ requestTimeout: 5000 }, null, 2));
      engine = new IndexEngine(dir, { extensions: ['.js', '.json'] });
      await engine.ready();
      await sleep(300);

      const results = engine.findSymbol('request', { sourceTypes: ['code', 'config'] });
      const names = results.map(r => r.name);
      expect(names).toContain('requestHandler');
      expect(names).toContain('requestTimeout');
    });

    it('symbol from __tests__/ file has source_type test', async () => {
      dir = tmpDir();
      const testsDir = path.join(dir, '__tests__');
      fs.mkdirSync(testsDir, { recursive: true });
      fs.writeFileSync(path.join(testsDir, 'helper.js'), 'function testHelper() { return true; }');
      engine = new IndexEngine(dir, { extensions: ['.js'] });
      await engine.ready();
      await sleep(300);

      const outline = engine.getOutline('__tests__/helper.js');
      expect(outline.length).toBeGreaterThan(0);
      expect(outline[0].sourceType).toBe('test');
    });

    it('symbol from foo.test.ts file has source_type test', async () => {
      dir = tmpDir();
      fs.writeFileSync(path.join(dir, 'app.test.ts'), 'function testAppBoot() { return true; }');
      engine = new IndexEngine(dir, { extensions: ['.ts'] });
      await engine.ready();
      await sleep(300);

      const outline = engine.getOutline('app.test.ts');
      expect(outline.length).toBeGreaterThan(0);
      expect(outline[0].sourceType).toBe('test');
    });

    it('symbol from foo.spec.js file has source_type test', async () => {
      dir = tmpDir();
      fs.writeFileSync(path.join(dir, 'util.spec.js'), 'function describeUtil() { return true; }');
      engine = new IndexEngine(dir, { extensions: ['.js'] });
      await engine.ready();
      await sleep(300);

      const outline = engine.getOutline('util.spec.js');
      expect(outline.length).toBeGreaterThan(0);
      expect(outline[0].sourceType).toBe('test');
    });

    it('default findSymbols excludes test files', async () => {
      dir = tmpDir();
      const testsDir = path.join(dir, '__tests__');
      fs.mkdirSync(testsDir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'helper.js'), 'function prodHelper() {}');
      fs.writeFileSync(path.join(testsDir, 'helper.test.js'), 'function testHelper() {}');
      engine = new IndexEngine(dir, { extensions: ['.js'] });
      await engine.ready();
      await sleep(300);

      const results = engine.findSymbol('Helper');
      const names = results.map(r => r.name);
      expect(names).toContain('prodHelper');
      expect(names).not.toContain('testHelper');
    });

    it('findSymbol with sourceTypes=[test] returns only test files', async () => {
      dir = tmpDir();
      const testsDir = path.join(dir, '__tests__');
      fs.mkdirSync(testsDir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'helper.js'), 'function prodHelper() {}');
      fs.writeFileSync(path.join(testsDir, 'helper.test.js'), 'function testHelper() {}');
      engine = new IndexEngine(dir, { extensions: ['.js'] });
      await engine.ready();
      await sleep(300);

      const results = engine.findSymbol('Helper', { sourceTypes: ['test'] });
      const names = results.map(r => r.name);
      expect(names).not.toContain('prodHelper');
      expect(names).toContain('testHelper');
    });
  });
});
