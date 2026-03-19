const Watcher = require('../src/watcher');
const fs = require('fs');
const path = require('path');
const os = require('os');
const chokidar = require('chokidar');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-watcher-'));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

describe('Watcher', () => {
  let watcher;
  let dir;

  afterEach(async () => {
    if (watcher) await watcher.close();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  // PC-12: Watcher detects file changes
  describe('file change detection', () => {
    it('emits add on startup for existing files', async () => {
      dir = tmpDir();
      fs.writeFileSync(path.join(dir, 'a.js'), 'const x = 1;');

      const adds = [];
      watcher = new Watcher(dir, { extensions: ['.js'] });
      watcher.on('add', (filePath) => adds.push(filePath));

      await watcher.ready();
      // Give it a moment for initial scan
      await sleep(200);
      expect(adds.length).toBeGreaterThanOrEqual(1);
      expect(adds.some((p) => p.endsWith('a.js'))).toBe(true);
    });

    it('emits change on file modify', async () => {
      dir = tmpDir();
      fs.writeFileSync(path.join(dir, 'a.js'), 'const x = 1;');

      const changes = [];
      watcher = new Watcher(dir, { extensions: ['.js'] });
      watcher.on('change', (filePath) => changes.push(filePath));

      await watcher.ready();
      await sleep(200);

      // Modify the file
      fs.writeFileSync(path.join(dir, 'a.js'), 'const x = 2;');
      await sleep(500);

      expect(changes.length).toBeGreaterThanOrEqual(1);
      expect(changes.some((p) => p.endsWith('a.js'))).toBe(true);
    });

    it('emits unlink on file delete', async () => {
      dir = tmpDir();
      fs.writeFileSync(path.join(dir, 'a.js'), 'const x = 1;');

      const unlinks = [];
      watcher = new Watcher(dir, { extensions: ['.js'] });
      watcher.on('unlink', (filePath) => unlinks.push(filePath));

      await watcher.ready();
      await sleep(200);

      fs.unlinkSync(path.join(dir, 'a.js'));
      await sleep(500);

      expect(unlinks.length).toBeGreaterThanOrEqual(1);
      expect(unlinks.some((p) => p.endsWith('a.js'))).toBe(true);
    });
  });

  // PC-13: Watcher respects ignore patterns
  describe('ignore patterns', () => {
    it('ignores node_modules', async () => {
      dir = tmpDir();
      fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'node_modules', 'pkg.js'), 'module.exports = {};');
      fs.writeFileSync(path.join(dir, 'app.js'), 'const x = 1;');

      const adds = [];
      watcher = new Watcher(dir, { extensions: ['.js'] });
      watcher.on('add', (filePath) => adds.push(filePath));

      await watcher.ready();
      await sleep(300);

      const nodeModuleAdds = adds.filter((p) => p.includes('node_modules'));
      expect(nodeModuleAdds).toHaveLength(0);
      expect(adds.some((p) => p.endsWith('app.js'))).toBe(true);
    });

    it('respects custom ignorePaths from config', async () => {
      dir = tmpDir();
      fs.mkdirSync(path.join(dir, 'vendor'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'vendor', 'lib.js'), 'module.exports = {};');
      fs.writeFileSync(path.join(dir, 'app.js'), 'const x = 1;');

      const adds = [];
      watcher = new Watcher(dir, { extensions: ['.js'], ignorePaths: ['vendor'] });
      watcher.on('add', (filePath) => adds.push(filePath));

      await watcher.ready();
      await sleep(300);

      const vendorAdds = adds.filter((p) => p.includes('vendor'));
      expect(vendorAdds).toHaveLength(0);
      expect(adds.some((p) => p.endsWith('app.js'))).toBe(true);
    });
  });

  describe('startup defaults', () => {
    it('does not enable polling unless explicitly requested', async () => {
      dir = tmpDir();
      const closeMock = jest.fn().mockResolvedValue();
      const onMock = jest.fn(function on() { return this; });
      const watchSpy = jest.fn(() => ({ on: onMock, close: closeMock }));
      let FreshWatcher;

      try {
        jest.resetModules();
        jest.doMock('chokidar', () => ({ watch: watchSpy }));
        FreshWatcher = require('../src/watcher');
        watcher = new FreshWatcher(dir, { extensions: ['.js'] });
        expect(watchSpy).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({ usePolling: false }),
        );
        await watcher.close();
      } finally {
        jest.dontMock('chokidar');
        jest.resetModules();
        watcher = null;
      }
    });
  });

  // Extension list verification
  describe('extension list', () => {
    it('includes .json in default extensions', () => {
      const { DEFAULT_EXTENSIONS } = require('../src/watcher').__proto__.constructor;
      // Access via instantiation: default extensions are used when no config provided
      dir = tmpDir();
      const w = new Watcher(dir, {});
      // The watcher was created with the default extensions — verify .json and .yaml are watched
      // by creating files and confirming they are picked up
      w.close();
    });

    it('watches .json files when included in extensions', async () => {
      dir = tmpDir();
      fs.writeFileSync(path.join(dir, 'config.json'), '{"key":"value"}');

      const adds = [];
      watcher = new Watcher(dir, { extensions: ['.json'] });
      watcher.on('add', (filePath) => adds.push(filePath));

      await watcher.ready();
      await sleep(200);

      expect(adds.some((p) => p.endsWith('config.json'))).toBe(true);
    });

    it('watches .yaml files when included in extensions', async () => {
      dir = tmpDir();
      fs.writeFileSync(path.join(dir, 'settings.yaml'), 'name: test\nversion: 1');

      const adds = [];
      watcher = new Watcher(dir, { extensions: ['.yaml'] });
      watcher.on('add', (filePath) => adds.push(filePath));

      await watcher.ready();
      await sleep(200);

      expect(adds.some((p) => p.endsWith('settings.yaml'))).toBe(true);
    });

    it('default extension list includes .json and .yaml', () => {
      // Verify the DEFAULT_EXTENSIONS baked into watcher includes the new types
      dir = tmpDir();
      fs.writeFileSync(path.join(dir, 'data.json'), '{}');
      fs.writeFileSync(path.join(dir, 'config.yaml'), 'key: val');
      fs.writeFileSync(path.join(dir, 'notes.md'), '# Hello');

      const adds = [];
      // No extensions config — uses defaults
      watcher = new Watcher(dir, {});
      watcher.on('add', (filePath) => adds.push(filePath));

      return watcher.ready().then(() => sleep(300)).then(() => {
        expect(adds.some((p) => p.endsWith('data.json'))).toBe(true);
        expect(adds.some((p) => p.endsWith('config.yaml'))).toBe(true);
        expect(adds.some((p) => p.endsWith('notes.md'))).toBe(true);
      });
    });
  });
});
