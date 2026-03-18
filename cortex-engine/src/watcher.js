const { watch } = require('chokidar');
const path = require('path');
const EventEmitter = require('events');

const DEFAULT_IGNORE = [
  '**/node_modules/**',
  '**/.git/**',
  '**/.cortex/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
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

    this.watcher = watch(extGlob, {
      cwd: this.rootPath,
      ignored: DEFAULT_IGNORE.concat(config.ignorePaths || []),
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
