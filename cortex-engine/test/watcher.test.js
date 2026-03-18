const Watcher = require('../src/watcher');
const fs = require('fs');
const path = require('path');
const os = require('os');

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
  });
});
