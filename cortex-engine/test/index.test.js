const IndexEngine = require('../src/index');
const fs = require('fs');
const path = require('path');
const os = require('os');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-index-'));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

describe('IndexEngine', () => {
  let engine;
  let dir;

  afterEach(async () => {
    if (engine) await engine.close();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  // PC-14: IndexEngine coordinates parse + store
  describe('indexing on startup', () => {
    it('indexes files on startup and serves outline queries', async () => {
      dir = tmpDir();
      fs.writeFileSync(path.join(dir, 'simple.js'), `
function foo(x) {
  return x;
}

const bar = (y) => y * 2;
`.trim());

      engine = new IndexEngine(dir);
      await engine.ready();
      await sleep(300);

      const outline = engine.getOutline('simple.js');
      expect(outline).toBeDefined();
      const names = outline.map((s) => s.name);
      expect(names).toContain('foo');
      expect(names).toContain('bar');
    });

    it('serves symbol reads', async () => {
      dir = tmpDir();
      fs.writeFileSync(path.join(dir, 'funcs.js'), `function hello() {
  return 'world';
}

function goodbye() {
  return 'farewell';
}
`);

      engine = new IndexEngine(dir);
      await engine.ready();
      await sleep(300);

      const source = engine.readSymbol('funcs.js', 'hello');
      expect(source).toBeDefined();
      expect(source).toContain('hello');
      expect(source).toContain('world');
    });

    it('serves findSymbol queries', async () => {
      dir = tmpDir();
      fs.writeFileSync(path.join(dir, 'a.js'), 'function fooHandler() {}');
      fs.writeFileSync(path.join(dir, 'b.js'), 'function barHandler() {}');

      engine = new IndexEngine(dir);
      await engine.ready();
      await sleep(300);

      const results = engine.findSymbol('Handler');
      expect(results.length).toBeGreaterThanOrEqual(2);
    });
  });

  // PC-15: IndexEngine updates on file change
  describe('re-indexing on change', () => {
    it('re-indexes on file change', async () => {
      dir = tmpDir();
      fs.writeFileSync(path.join(dir, 'evolve.js'), 'function alpha() {}');

      engine = new IndexEngine(dir);
      await engine.ready();
      await sleep(300);

      let outline = engine.getOutline('evolve.js');
      expect(outline.map((s) => s.name)).toContain('alpha');

      // Modify the file — add a new function
      fs.writeFileSync(path.join(dir, 'evolve.js'), 'function alpha() {}\nfunction beta() {}');
      await sleep(800);

      outline = engine.getOutline('evolve.js');
      const names = outline.map((s) => s.name);
      expect(names).toContain('alpha');
      expect(names).toContain('beta');
    });
  });

  // PC-16: IndexEngine handles file deletion
  describe('file deletion', () => {
    it('removes deleted files from index', async () => {
      dir = tmpDir();
      fs.writeFileSync(path.join(dir, 'temp.js'), 'function temp() {}');

      engine = new IndexEngine(dir);
      await engine.ready();
      await sleep(300);

      expect(engine.getOutline('temp.js').length).toBeGreaterThan(0);

      fs.unlinkSync(path.join(dir, 'temp.js'));
      await sleep(800);

      const outline = engine.getOutline('temp.js');
      expect(outline).toHaveLength(0);
    });
  });

  // New file type support
  describe('extended file type indexing', () => {
    it('indexes .json files and extracts top-level keys as symbols', async () => {
      dir = tmpDir();
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
        name: 'my-project',
        version: '1.0.0',
        description: 'A test project',
      }, null, 2));

      engine = new IndexEngine(dir, {
        extensions: ['.json'],
      });
      await engine.ready();
      await sleep(300);

      const outline = engine.getOutline('package.json');
      expect(outline).toBeDefined();
      const names = outline.map((s) => s.name);
      expect(names).toContain('name');
      expect(names).toContain('version');
    });

    it('indexes .yaml files and extracts top-level keys as symbols', async () => {
      dir = tmpDir();
      fs.writeFileSync(path.join(dir, 'config.yaml'),
        'name: my-service\nversion: 2\nport: 3000\n');

      engine = new IndexEngine(dir, {
        extensions: ['.yaml'],
      });
      await engine.ready();
      await sleep(300);

      const outline = engine.getOutline('config.yaml');
      expect(outline).toBeDefined();
      const names = outline.map((s) => s.name);
      expect(names).toContain('name');
      expect(names).toContain('version');
      expect(names).toContain('port');
    });

    it('indexes .yml files the same as .yaml', async () => {
      dir = tmpDir();
      fs.writeFileSync(path.join(dir, 'docker-compose.yml'),
        'version: "3"\nservices:\n  web:\n    image: nginx\n');

      engine = new IndexEngine(dir, {
        extensions: ['.yml'],
      });
      await engine.ready();
      await sleep(300);

      const file = engine.store.getFile('docker-compose.yml');
      expect(file).toBeTruthy();
      expect(file.language).toBe('text');
    });

    it('indexes .md files and extracts headings as symbols', async () => {
      dir = tmpDir();
      fs.writeFileSync(path.join(dir, 'README.md'),
        '# Introduction\n\nSome text.\n\n## Installation\n\nMore text.\n');

      engine = new IndexEngine(dir, {
        extensions: ['.md'],
      });
      await engine.ready();
      await sleep(300);

      const outline = engine.getOutline('README.md');
      const names = outline.map((s) => s.name);
      expect(names).toContain('Introduction');
      expect(names).toContain('Installation');
    });

    it('default config includes .json and .yaml extensions', () => {
      // Verify DEFAULT_EXTENSIONS in index.js covers these types
      dir = tmpDir();
      // Instantiate with no extensions config — uses defaults
      engine = new IndexEngine(dir);
      // The watcher was set up with defaults. Check by inspecting the watcher's config.
      const watcherConfig = engine.watcher.config;
      expect(watcherConfig.extensions).toContain('.json');
      expect(watcherConfig.extensions).toContain('.yaml');
      expect(watcherConfig.extensions).toContain('.yml');
      expect(watcherConfig.extensions).toContain('.md');
    });

    it('config.extensions flows through to the watcher', () => {
      dir = tmpDir();
      const customExtensions = ['.js', '.json', '.yaml'];
      engine = new IndexEngine(dir, { extensions: customExtensions });
      expect(engine.watcher.config.extensions).toEqual(customExtensions);
    });
  });
});
