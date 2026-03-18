# Contract: Cortex Engine Phase 1

**Plan:** docs/plans/2026-03-18-cortex-engine-plan.md
**Status:** LOCKED
**Date:** 2026-03-18

---

## Postconditions

### PC-1: Store creates and migrates SQLite database
- `new Store(':memory:')` succeeds without error
- After `store.migrate()`, tables `files`, `symbols`, `imports` exist
- `PRAGMA journal_mode` returns `wal`
- Calling `migrate()` twice is idempotent (no error)
- **Test:** `store.test.js` → "creates database with WAL mode", "migrates idempotently"
- **Code:** `store.js` → `constructor()`, `migrate()`

### PC-2: Store CRUD for files
- `store.upsertFile({path:'a.js', language:'javascript', hash:'abc', sizeBytes:100, lineCount:10})` returns file with id
- `store.getFile('a.js')` returns the record
- `store.getFile('nonexistent.js')` returns null
- Upserting same path updates (not duplicates) the record
- `store.deleteFile('a.js')` removes it; subsequent `getFile` returns null
- **Test:** `store.test.js` → "upserts file", "gets file", "returns null for missing", "deletes file"
- **Code:** `store.js` → `upsertFile()`, `getFile()`, `deleteFile()`

### PC-3: Store CRUD for symbols
- `store.upsertSymbols(fileId, [{name:'foo', kind:'function', signature:'function foo(x)', startLine:1, endLine:5, exported:true, async:false}])` stores symbols
- `store.getSymbolsByFile(fileId)` returns the stored symbols
- Calling `upsertSymbols` again replaces (not appends) symbols for that file
- `store.deleteFile(path)` cascades — symbols for that file are gone
- **Test:** `store.test.js` → "stores symbols", "replaces symbols on re-upsert", "cascades delete"
- **Code:** `store.js` → `upsertSymbols()`, `getSymbolsByFile()`

### PC-4: Store CRUD for imports
- `store.upsertImports(fileId, [{source:'../db', identifiers:['pool'], line:1}])` stores imports
- `store.getImportsByFile(fileId)` returns stored imports
- Calling `upsertImports` again replaces imports for that file
- **Test:** `store.test.js` → "stores imports", "replaces imports on re-upsert"
- **Code:** `store.js` → `upsertImports()`, `getImportsByFile()`

### PC-5: Store search — findSymbols
- Given symbols: `foo`, `fooBar`, `bazFoo`, `unrelated`
- `store.findSymbols({query:'foo'})` returns `foo`, `fooBar`, `bazFoo` (contains match)
- `store.findSymbols({query:'foo', kind:'function'})` filters by kind
- `store.findSymbols({query:'foo', exportedOnly:true})` filters exported
- `store.findSymbols({query:'foo', limit:1})` returns max 1 result
- **Test:** `store.test.js` → "finds symbols by name", "filters by kind", "filters exported", "limits results"
- **Code:** `store.js` → `findSymbols()`

### PC-6: Store search — findImporters
- Given file A imports from './b', file C imports from './b'
- `store.findImporters('b.js')` returns file A and file C
- **Test:** `store.test.js` → "finds files importing a given file"
- **Code:** `store.js` → `findImporters()`

### PC-7: Parser extracts functions
- Given `test/fixtures/simple.js` containing: `function foo(x) { return x; }` and `const bar = (y) => y * 2;` and `async function baz() {}`
- `parser.parse('simple.js', content)` returns symbols with:
  - `{name:'foo', kind:'function', async:false}`
  - `{name:'bar', kind:'function', async:false}` (arrow function)
  - `{name:'baz', kind:'function', async:true}`
- Each symbol has correct `startLine` and `endLine`
- **Test:** `parser.test.js` → "extracts function declarations", "extracts arrow functions", "detects async"
- **Code:** `parser.js` → `parse()`

### PC-8: Parser extracts classes
- Given fixture with `class MyClass { constructor() {} method() {} }`
- Parser returns `{name:'MyClass', kind:'class'}` with methods as separate symbols `{name:'constructor', kind:'method'}`, `{name:'method', kind:'method'}`
- **Test:** `parser.test.js` → "extracts classes", "extracts methods"
- **Code:** `parser.js` → `parse()` class handling

### PC-9: Parser extracts imports
- Given fixture with `const { pool } = require('../db');` and `const express = require('express');`
- Parser returns imports: `{source:'../db', identifiers:['pool']}`, `{source:'express', identifiers:['express']}`
- **Test:** `parser.test.js` → "extracts require calls", "extracts destructured imports"
- **Code:** `parser.js` → `parse()` import handling

### PC-10: Parser handles .cjs files
- Given `test/fixtures/simple.cjs` with same content as simple.js
- `parser.parse('simple.cjs', content)` returns identical symbols
- **Test:** `parser.test.js` → "handles .cjs files"
- **Code:** `parser.js` → language detection

### PC-11: Parser returns empty for unparseable files
- Given a file with invalid syntax
- `parser.parse('bad.js', '}{}{')` returns `{symbols:[], imports:[]}` (not throws)
- **Test:** `parser.test.js` → "returns empty for invalid syntax"
- **Code:** `parser.js` → error handling

### PC-12: Watcher detects file changes
- Create a temp directory with a .js file
- Start watcher → receives 'add' event for existing file
- Modify the file → receives 'change' event
- Delete the file → receives 'unlink' event
- **Test:** `watcher.test.js` → "emits add on startup", "emits change on modify", "emits unlink on delete"
- **Code:** `watcher.js` → `Watcher` class

### PC-13: Watcher respects ignore patterns
- Watcher ignores `node_modules/`, `.git/`, `.cortex/`
- Creating a file in `node_modules/` does NOT emit 'add'
- **Test:** `watcher.test.js` → "ignores node_modules"
- **Code:** `watcher.js` → ignore config

### PC-14: IndexEngine coordinates parse + store
- Create IndexEngine with a temp directory containing fixture files
- After ready, `engine.getOutline('simple.js')` returns symbols
- `engine.readSymbol('simple.js', 'foo')` returns the function source
- `engine.findSymbol('foo')` returns matching symbols
- **Test:** `index.test.js` → "indexes files on startup", "serves outline queries", "serves symbol reads"
- **Code:** `index.js` → `IndexEngine` class

### PC-15: IndexEngine updates on file change
- Start engine → modify a fixture file (add a new function)
- After debounce, `engine.getOutline(file)` includes the new function
- **Test:** `index.test.js` → "re-indexes on file change"
- **Code:** `index.js` → watcher integration

### PC-16: IndexEngine handles file deletion
- Start engine → delete a fixture file
- `engine.getOutline(deletedFile)` returns null/empty
- **Test:** `index.test.js` → "removes deleted files from index"
- **Code:** `index.js` → watcher 'unlink' handler

### PC-17: MCP server registers all 12 tools
- Start server → list tools → all 12 cortex_* tools present with correct schemas
- **Test:** `server.test.js` → "registers all tools"
- **Code:** `server.js` → tool registration

### PC-18: MCP cortex_outline returns correct data
- Start server with fixture directory
- Call `cortex_outline({file_path: 'simple.js'})`
- Returns symbols matching fixture content
- **Test:** `server.test.js` → "cortex_outline returns symbols"
- **Code:** `tools/file-tools.js` → cortex_outline handler

### PC-19: MCP cortex_read_symbol returns function source
- Call `cortex_read_symbol({file_path: 'simple.js', symbol_name: 'foo'})`
- Returns the exact source code of function foo
- **Test:** `server.test.js` → "cortex_read_symbol returns source"
- **Code:** `tools/file-tools.js` → cortex_read_symbol handler

### PC-20: MCP cortex_find_symbol searches across files
- Call `cortex_find_symbol({query: 'foo'})`
- Returns symbols from multiple files matching the query
- **Test:** `server.test.js` → "cortex_find_symbol searches"
- **Code:** `tools/search-tools.js` → cortex_find_symbol handler

---

## Invariants

1. **Index freshness:** After a file change, the index reflects the change within 200ms (debounce + parse + store)
2. **No data loss on crash:** SQLite WAL mode ensures ACID writes. Restart = re-scan and catch up.
3. **No truncation:** SQLite has no row limit. 100K files is fine.
4. **Idempotent reindex:** Running reindex on an already-indexed file produces same result.
5. **Clean shutdown:** `engine.close()` stops watcher and closes database without data corruption.

## Error Cases

1. **File read fails** (permission, symlink loop) → log warning, skip file, continue
2. **Parse fails** (invalid syntax) → store file record but zero symbols
3. **Database locked** → WAL mode prevents this for read; write timeout at 5s
4. **Watcher event flood** (git checkout changes 1000 files) → debounce batches, process sequentially
5. **Tool called before index ready** → return partial results with `indexing: true` flag

## Consumer Map

| Consumer | Uses |
|----------|------|
| suggest-cortex.sh hook | Blocks Read, suggests cortex_outline/cortex_read_symbol |
| Claude Code agents | All 12 tools for code exploration |
| conductor workers | Same tools via MCP config |
| Future: semantic tagger (Phase 3) | Reads symbol AST for classification |
| Future: knowledge store (Phase 4) | Annotates files/symbols |

## Blast Radius

- **Replaces:** jcodemunch MCP server
- **Modifies:** suggest-jcodemunch.sh hook (rename + retarget)
- **Modifies:** install.sh (add cortex-engine to MCP config)
- **No impact on:** helpdesk source code, vault-index, context-mode, any other MCP server
