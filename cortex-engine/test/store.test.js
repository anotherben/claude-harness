const Store = require('../src/store');

describe('Store', () => {
  let store;

  beforeEach(() => {
    store = new Store(':memory:');
    store.migrate();
  });

  afterEach(() => {
    store.close();
  });

  // PC-1: Store creates and migrates SQLite database
  describe('database creation and migration', () => {
    it('creates database with WAL mode', () => {
      const os = require('os');
      const path = require('path');
      const tmpDb = path.join(os.tmpdir(), 'cortex-test-wal-' + Date.now() + '.db');
      const s = new Store(tmpDb);
      const mode = s.db.pragma('journal_mode', { simple: true });
      expect(mode).toBe('wal');
      s.close();
      require('fs').unlinkSync(tmpDb);
      // Cleanup WAL/SHM files if they exist
      try { require('fs').unlinkSync(tmpDb + '-wal'); } catch {}
      try { require('fs').unlinkSync(tmpDb + '-shm'); } catch {}
    });

    it('migrates idempotently', () => {
      // migrate() was called in beforeEach; calling again should not throw
      expect(() => store.migrate()).not.toThrow();
    });

    it('creates files, symbols, imports tables', () => {
      const tables = store.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .pluck()
        .all();
      expect(tables).toContain('files');
      expect(tables).toContain('symbols');
      expect(tables).toContain('imports');
    });
  });

  // PC-2: Store CRUD for files
  describe('file CRUD', () => {
    it('upserts and gets a file', () => {
      const file = store.upsertFile({
        path: 'a.js',
        language: 'javascript',
        hash: 'abc123',
        sizeBytes: 100,
        lineCount: 10,
      });
      expect(file).toHaveProperty('id');
      expect(file.path).toBe('a.js');

      const fetched = store.getFile('a.js');
      expect(fetched.path).toBe('a.js');
      expect(fetched.language).toBe('javascript');
      expect(fetched.hash).toBe('abc123');
    });

    it('returns null for missing file', () => {
      expect(store.getFile('nonexistent.js')).toBeNull();
    });

    it('upsert updates existing file (no duplicate)', () => {
      store.upsertFile({ path: 'a.js', language: 'javascript', hash: 'v1', sizeBytes: 100, lineCount: 10 });
      store.upsertFile({ path: 'a.js', language: 'javascript', hash: 'v2', sizeBytes: 200, lineCount: 20 });
      const file = store.getFile('a.js');
      expect(file.hash).toBe('v2');
      expect(file.sizeBytes).toBe(200);

      // Should be only one record
      const count = store.db.prepare('SELECT COUNT(*) as c FROM files').get().c;
      expect(count).toBe(1);
    });

    it('deletes a file', () => {
      store.upsertFile({ path: 'a.js', language: 'javascript', hash: 'abc', sizeBytes: 100, lineCount: 10 });
      store.deleteFile('a.js');
      expect(store.getFile('a.js')).toBeNull();
    });
  });

  // PC-3: Store CRUD for symbols
  describe('symbol CRUD', () => {
    let fileId;

    beforeEach(() => {
      const file = store.upsertFile({ path: 'a.js', language: 'javascript', hash: 'abc', sizeBytes: 100, lineCount: 10 });
      fileId = file.id;
    });

    it('stores and retrieves symbols', () => {
      store.upsertSymbols(fileId, [
        { name: 'foo', kind: 'function', signature: 'function foo(x)', startLine: 1, endLine: 5, exported: true, async: false },
      ]);
      const symbols = store.getSymbolsByFile(fileId);
      expect(symbols).toHaveLength(1);
      expect(symbols[0].name).toBe('foo');
      expect(symbols[0].kind).toBe('function');
      expect(symbols[0].exported).toBe(1); // SQLite stores booleans as integers
    });

    it('replaces symbols on re-upsert', () => {
      store.upsertSymbols(fileId, [
        { name: 'foo', kind: 'function', signature: 'function foo(x)', startLine: 1, endLine: 5, exported: false, async: false },
      ]);
      store.upsertSymbols(fileId, [
        { name: 'bar', kind: 'function', signature: 'function bar(y)', startLine: 1, endLine: 3, exported: true, async: true },
      ]);
      const symbols = store.getSymbolsByFile(fileId);
      expect(symbols).toHaveLength(1);
      expect(symbols[0].name).toBe('bar');
    });

    it('cascades delete — symbols removed when file deleted', () => {
      store.upsertSymbols(fileId, [
        { name: 'foo', kind: 'function', signature: 'function foo(x)', startLine: 1, endLine: 5, exported: false, async: false },
      ]);
      store.deleteFile('a.js');
      const symbols = store.getSymbolsByFile(fileId);
      expect(symbols).toHaveLength(0);
    });
  });

  // PC-4: Store CRUD for imports
  describe('import CRUD', () => {
    let fileId;

    beforeEach(() => {
      const file = store.upsertFile({ path: 'a.js', language: 'javascript', hash: 'abc', sizeBytes: 100, lineCount: 10 });
      fileId = file.id;
    });

    it('stores and retrieves imports', () => {
      store.upsertImports(fileId, [
        { source: '../db', identifiers: ['pool'], line: 1 },
      ]);
      const imports = store.getImportsByFile(fileId);
      expect(imports).toHaveLength(1);
      expect(imports[0].source).toBe('../db');
      expect(JSON.parse(imports[0].identifiers)).toEqual(['pool']);
    });

    it('replaces imports on re-upsert', () => {
      store.upsertImports(fileId, [{ source: '../db', identifiers: ['pool'], line: 1 }]);
      store.upsertImports(fileId, [{ source: '../logger', identifiers: ['log'], line: 2 }]);
      const imports = store.getImportsByFile(fileId);
      expect(imports).toHaveLength(1);
      expect(imports[0].source).toBe('../logger');
    });
  });

  // PC-5: Store search — findSymbols
  describe('findSymbols', () => {
    beforeEach(() => {
      const f1 = store.upsertFile({ path: 'a.js', language: 'javascript', hash: 'a', sizeBytes: 100, lineCount: 10 });
      const f2 = store.upsertFile({ path: 'b.js', language: 'javascript', hash: 'b', sizeBytes: 100, lineCount: 10 });

      store.upsertSymbols(f1.id, [
        { name: 'foo', kind: 'function', signature: 'function foo()', startLine: 1, endLine: 3, exported: true, async: false },
        { name: 'fooBar', kind: 'function', signature: 'function fooBar()', startLine: 5, endLine: 7, exported: false, async: false },
        { name: 'unrelated', kind: 'variable', signature: 'const unrelated', startLine: 9, endLine: 9, exported: false, async: false },
      ]);
      store.upsertSymbols(f2.id, [
        { name: 'bazFoo', kind: 'function', signature: 'function bazFoo()', startLine: 1, endLine: 3, exported: true, async: true },
      ]);
    });

    it('finds symbols by name (contains match)', () => {
      const results = store.findSymbols({ query: 'foo' });
      const names = results.map((r) => r.name);
      expect(names).toContain('foo');
      expect(names).toContain('fooBar');
      expect(names).toContain('bazFoo');
      expect(names).not.toContain('unrelated');
    });

    it('filters by kind', () => {
      const results = store.findSymbols({ query: 'foo', kind: 'function' });
      expect(results.length).toBeGreaterThanOrEqual(3);
      results.forEach((r) => expect(r.kind).toBe('function'));
    });

    it('filters exported only', () => {
      const results = store.findSymbols({ query: 'foo', exportedOnly: true });
      const names = results.map((r) => r.name);
      expect(names).toContain('foo');
      expect(names).toContain('bazFoo');
      expect(names).not.toContain('fooBar');
    });

    it('limits results', () => {
      const results = store.findSymbols({ query: 'foo', limit: 1 });
      expect(results).toHaveLength(1);
    });
  });

  // PC-6: Store search — findImporters
  describe('findImporters', () => {
    it('finds files importing a given file', () => {
      const fA = store.upsertFile({ path: 'a.js', language: 'javascript', hash: 'a', sizeBytes: 100, lineCount: 10 });
      const fB = store.upsertFile({ path: 'b.js', language: 'javascript', hash: 'b', sizeBytes: 100, lineCount: 10 });
      const fC = store.upsertFile({ path: 'c.js', language: 'javascript', hash: 'c', sizeBytes: 100, lineCount: 10 });

      store.upsertImports(fA.id, [{ source: './b', identifiers: ['x'], line: 1 }]);
      store.upsertImports(fC.id, [{ source: './b', identifiers: ['y'], line: 1 }]);

      const importers = store.findImporters('b.js');
      const paths = importers.map((r) => r.path);
      expect(paths).toContain('a.js');
      expect(paths).toContain('c.js');
      expect(paths).not.toContain('b.js');
    });

    it('finds importers of a .ts file when imports use .js extension', () => {
      // TypeScript ESM: import { foo } from './auth.js' while actual file is auth.ts
      const fAuth = store.upsertFile({ path: 'src/services/auth.ts', language: 'typescript', hash: 'auth', sizeBytes: 200, lineCount: 20 });
      const fUser = store.upsertFile({ path: 'src/routes/user.ts', language: 'typescript', hash: 'user', sizeBytes: 150, lineCount: 15 });
      const fAdmin = store.upsertFile({ path: 'src/routes/admin.ts', language: 'typescript', hash: 'admin', sizeBytes: 120, lineCount: 12 });

      // user.ts imports auth using .js extension (TypeScript ESM convention)
      store.upsertImports(fUser.id, [{ source: '../services/auth.js', identifiers: ['authenticate'], line: 1 }]);
      // admin.ts imports auth without extension
      store.upsertImports(fAdmin.id, [{ source: '../services/auth', identifiers: ['authenticate'], line: 1 }]);

      const importers = store.findImporters('src/services/auth.ts');
      const paths = importers.map((r) => r.path);
      expect(paths).toContain('src/routes/user.ts');   // .js extension cross-import
      expect(paths).toContain('src/routes/admin.ts');  // extensionless import
      expect(paths).not.toContain('src/services/auth.ts');
    });

    it('finds importers of an index.ts barrel export', () => {
      // services/auth/index.ts is a barrel — consumers import from "services/auth"
      const fIndex = store.upsertFile({ path: 'src/services/auth/index.ts', language: 'typescript', hash: 'idx', sizeBytes: 50, lineCount: 5 });
      const fApp   = store.upsertFile({ path: 'src/app.ts', language: 'typescript', hash: 'app', sizeBytes: 300, lineCount: 30 });
      const fTest  = store.upsertFile({ path: 'test/auth.test.ts', language: 'typescript', hash: 'tst', sizeBytes: 100, lineCount: 10 });
      const fOther = store.upsertFile({ path: 'src/other.ts', language: 'typescript', hash: 'oth', sizeBytes: 80, lineCount: 8 });

      // app.ts imports from the barrel directory (no /index)
      store.upsertImports(fApp.id, [{ source: './services/auth', identifiers: ['AuthService'], line: 1 }]);
      // test imports with relative path going up
      store.upsertImports(fTest.id, [{ source: '../src/services/auth', identifiers: ['AuthService'], line: 1 }]);
      // other.ts imports the index file explicitly
      store.upsertImports(fOther.id, [{ source: './services/auth/index', identifiers: ['AuthService'], line: 1 }]);

      const importers = store.findImporters('src/services/auth/index.ts');
      const paths = importers.map((r) => r.path);
      expect(paths).toContain('src/app.ts');            // bare directory import
      expect(paths).toContain('test/auth.test.ts');     // relative path from test dir
      expect(paths).toContain('src/other.ts');          // explicit /index import
      expect(paths).not.toContain('src/services/auth/index.ts');
    });

    it('finds importers with relative paths at different depths', () => {
      // This test covers imports where the source path contains enough segments
      // to uniquely identify the target file from its full path.
      // Note: same-directory imports (e.g. "./format") cannot be resolved without
      // knowing the importer's directory — those require parser-level resolution.
      const fUtil = store.upsertFile({ path: 'src/utils/format.ts', language: 'typescript', hash: 'fmt', sizeBytes: 60, lineCount: 6 });
      const fUp1  = store.upsertFile({ path: 'src/controller.ts', language: 'typescript', hash: 'c1',  sizeBytes: 60, lineCount: 6 });
      const fUp2  = store.upsertFile({ path: 'root.ts', language: 'typescript', hash: 'r1', sizeBytes: 60, lineCount: 6 });
      const fDeep = store.upsertFile({ path: 'other/deep/module.ts', language: 'typescript', hash: 'd1', sizeBytes: 60, lineCount: 6 });

      // one level up: import includes the utils/format suffix
      store.upsertImports(fUp1.id, [{ source: './utils/format', identifiers: ['fmt'], line: 1 }]);
      // two levels up: import includes src/utils/format suffix with .ts extension
      store.upsertImports(fUp2.id, [{ source: './src/utils/format.ts', identifiers: ['fmt'], line: 1 }]);
      // from a completely different subtree, using the full relative path
      store.upsertImports(fDeep.id, [{ source: '../../src/utils/format', identifiers: ['fmt'], line: 1 }]);

      const importers = store.findImporters('src/utils/format.ts');
      const paths = importers.map((r) => r.path);
      expect(paths).toContain('src/controller.ts');    // one-up relative (./utils/format)
      expect(paths).toContain('root.ts');              // two-up relative with .ts ext
      expect(paths).toContain('other/deep/module.ts'); // cross-subtree relative path
      expect(paths).not.toContain('src/utils/format.ts');
    });
  });

  // Stats
  describe('getStats', () => {
    it('returns correct counts', () => {
      const f = store.upsertFile({ path: 'a.js', language: 'javascript', hash: 'a', sizeBytes: 100, lineCount: 10 });
      store.upsertSymbols(f.id, [
        { name: 'foo', kind: 'function', signature: 'foo()', startLine: 1, endLine: 3, exported: false, async: false },
      ]);
      store.upsertImports(f.id, [{ source: './b', identifiers: ['x'], line: 1 }]);

      const stats = store.getStats();
      expect(stats.fileCount).toBe(1);
      expect(stats.symbolCount).toBe(1);
      expect(stats.importCount).toBe(1);
    });
  });
});
