const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Store = require('./store');
const Parser = require('./parser');
const Watcher = require('./watcher');
const Tagger = require('./tagger');

const DEFAULT_EXTENSIONS = [
  '.js', '.jsx', '.cjs', '.mjs', '.ts', '.tsx',
  '.json', '.yaml', '.yml', '.graphql', '.gql',
  '.md', '.toml', '.xml', '.html', '.css', '.scss', '.less',
  '.vue', '.svelte',
];

class IndexEngine {
  constructor(projectRoot, config = {}) {
    this.projectRoot = path.resolve(projectRoot);
    this.config = config;

    // Store in .cortex/index.db or in-memory for tests
    const dbPath = config.dbPath
      ? path.join(this.projectRoot, config.dbPath)
      : ':memory:';

    // Ensure .cortex dir exists if using file-based DB
    if (dbPath !== ':memory:') {
      const dbDir = path.dirname(dbPath);
      if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
    }

    this.store = new Store(dbPath);
    this.store.migrate();
    this.parser = new Parser();

    this.tagger = new Tagger(config.tagRules || {});

    this.watcher = new Watcher(this.projectRoot, {
      extensions: config.extensions || DEFAULT_EXTENSIONS,
      ignorePaths: config.ignorePaths || [],
    });

    // File content cache for readSymbol
    this._contentCache = new Map();

    this.watcher.on('add', (absPath) => this._indexFile(absPath));
    this.watcher.on('change', (absPath) => this._indexFile(absPath));
    this.watcher.on('unlink', (absPath) => this._removeFile(absPath));
  }

  ready() {
    return this.watcher.ready();
  }

  _relPath(absPath) {
    return path.relative(this.projectRoot, absPath);
  }

  _indexFile(absPath) {
    const relPath = this._relPath(absPath);
    let content;
    try {
      content = fs.readFileSync(absPath, 'utf-8');
    } catch {
      return; // File may have been deleted between event and read
    }

    const hash = crypto.createHash('md5').update(content).digest('hex');
    const lines = content.split('\n');

    // Check if file has changed
    const existing = this.store.getFile(relPath);
    if (existing && existing.hash === hash) return; // No change

    const language = this.parser.detectLanguage(relPath) || 'unknown';
    const file = this.store.upsertFile({
      path: relPath,
      language,
      hash,
      sizeBytes: Buffer.byteLength(content),
      lineCount: lines.length,
    });

    const result = this.parser.parse(relPath, content);
    this.store.upsertSymbols(file.id, result.symbols);
    this.store.upsertImports(file.id, result.imports);

    // Semantic tagging
    const symbolTags = this.tagger.tagSymbols(result.symbols, content);
    this.store.upsertTags(file.id, symbolTags);

    // Cache content for readSymbol
    this._contentCache.set(relPath, content);
  }

  _removeFile(absPath) {
    const relPath = this._relPath(absPath);
    this.store.deleteFile(relPath);
    this._contentCache.delete(relPath);
  }

  // --- Query API ---

  getOutline(filePath) {
    const file = this.store.getFile(filePath);
    if (!file) return [];
    return this.store.getSymbolsByFile(file.id);
  }

  readSymbol(filePath, symbolName) {
    const file = this.store.getFile(filePath);
    if (!file) return null;

    const symbols = this.store.getSymbolsByFile(file.id);
    const sym = symbols.find((s) => s.name === symbolName);
    if (!sym) return null;

    // Read from cache or disk
    let content = this._contentCache.get(filePath);
    if (!content) {
      const absPath = path.join(this.projectRoot, filePath);
      try {
        content = fs.readFileSync(absPath, 'utf-8');
        this._contentCache.set(filePath, content);
      } catch {
        return null;
      }
    }

    const lines = content.split('\n');
    return lines.slice(sym.startLine - 1, sym.endLine).join('\n');
  }

  readSymbols(specs) {
    return specs.map(({ filePath, symbolName }) => ({
      filePath,
      symbolName,
      source: this.readSymbol(filePath, symbolName),
    }));
  }

  readRange(filePath, startLine, endLine) {
    let content = this._contentCache.get(filePath);
    if (!content) {
      const absPath = path.join(this.projectRoot, filePath);
      try {
        content = fs.readFileSync(absPath, 'utf-8');
      } catch {
        return null;
      }
    }
    const lines = content.split('\n');
    return lines.slice(startLine - 1, endLine).join('\n');
  }

  getContext(filePath, symbolName) {
    const file = this.store.getFile(filePath);
    if (!file) return null;

    const symbol = this.readSymbol(filePath, symbolName);
    const imports = this.store.getImportsByFile(file.id);
    const outline = this.store.getSymbolsByFile(file.id);

    return { symbol, imports, outline };
  }

  findByTag(tag, limit) {
    return this.store.findByTag(tag, limit);
  }

  findSymbol(query, opts = {}) {
    return this.store.findSymbols({ query, ...opts });
  }

  findText(pattern, opts = {}) {
    // Simple grep-like search across cached files
    const results = [];
    const regex = new RegExp(pattern, opts.caseSensitive ? '' : 'i');

    for (const [filePath, content] of this._contentCache) {
      const lines = content.split('\n');
      lines.forEach((line, i) => {
        if (regex.test(line)) {
          results.push({
            filePath,
            line: i + 1,
            content: line.trim(),
          });
        }
      });
    }
    return results;
  }

  findReferences(identifier) {
    // Search across all cached files for the identifier
    const results = [];
    const regex = new RegExp(`\\b${identifier}\\b`);

    for (const [filePath, content] of this._contentCache) {
      const lines = content.split('\n');
      lines.forEach((line, i) => {
        if (regex.test(line)) {
          results.push({ filePath, line: i + 1, content: line.trim() });
        }
      });
    }
    return results;
  }

  findImporters(filePath) {
    return this.store.findImporters(filePath);
  }

  getTree(pathPrefix, depth, glob) {
    // Simple file tree from store
    const stats = this.store.getStats();
    // Return stored file paths filtered by prefix
    const allFiles = this.store.db
      .prepare('SELECT path FROM files ORDER BY path')
      .pluck()
      .all();

    if (!pathPrefix) return allFiles;
    return allFiles.filter((p) => p.startsWith(pathPrefix));
  }

  getStatus() {
    return this.store.getStats();
  }

  reindex(filePath) {
    if (filePath) {
      const absPath = path.join(this.projectRoot, filePath);
      this._indexFile(absPath);
    } else {
      // Force reindex all cached files
      for (const [relPath] of this._contentCache) {
        const absPath = path.join(this.projectRoot, relPath);
        // Clear the hash to force re-parse
        this.store.deleteFile(relPath);
        this._indexFile(absPath);
      }
    }
  }

  async close() {
    await this.watcher.close();
    this.store.close();
    this._contentCache.clear();
  }
}

module.exports = IndexEngine;
