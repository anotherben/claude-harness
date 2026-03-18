const { watch } = require('chokidar');
const path = require('path');
const EventEmitter = require('events');

const DEFAULT_IGNORE_DIRS = [
  'node_modules',
  '.git',
  '.cortex',
  'dist',
  'build',
  'coverage',
  '.worktrees',
  '.claude',
];

class Watcher extends EventEmitter {
  constructor(rootPath, config = {}) {
    super();
    this.rootPath = path.resolve(rootPath);
    this.config = config;

    const extensions = config.extensions || ['.js', '.jsx', '.cjs', '.mjs', '.ts', '.tsx'];
    const extGlob = extensions.length === 1
      ? `**/*${extensions[0]}`
      : `**/*{${extensions.join(',')}}`;

    // Build ignore set: default dirs + custom dirs
    const ignoreDirs = new Set(DEFAULT_IGNORE_DIRS);
    for (const p of (config.ignorePaths || [])) {
      // Extract dir name from glob patterns like '**/node_modules/**'
      const match = p.match(/\*\*\/([^/*]+)\/?\*?\*?/);
      if (match) ignoreDirs.add(match[1]);
      else ignoreDirs.add(p);
    }

    // Function-based ignore is more reliable than glob patterns in chokidar
    const ignoreFn = (filePath) => {
      const parts = filePath.split(path.sep);
      return parts.some((part) => ignoreDirs.has(part));
    };

    this.watcher = watch(extGlob, {
      cwd: this.rootPath,
      ignored: ignoreFn,
      persistent: true,
      ignoreInitial: false,
    });

    this.watcher.on('add', (relPath) => {
      this.emit('add', path.join(this.rootPath, relPath));
    });

    this.watcher.on('change', (relPath) => {
      this.emit('change', path.join(this.rootPath, relPath));
    });

    this.watcher.on('unlink', (relPath) => {
      this.emit('unlink', path.join(this.rootPath, relPath));
    });

    this._readyPromise = new Promise((resolve) => {
      this.watcher.on('ready', resolve);
    });
  }

  ready() {
    return this._readyPromise;
  }

  async close() {
    await this.watcher.close();
  }
}

module.exports = Watcher;
