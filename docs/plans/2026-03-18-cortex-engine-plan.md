# Implementation Plan: Cortex Engine Phase 1

**TDD:** docs/designs/2026-03-18-cortex-engine-tdd.md
**Mode:** Solo (sequential workstreams)

---

## Step 0: Project Scaffold

**Files:**
- `cortex-engine/package.json` — dependencies, scripts, bin entry
- `cortex-engine/.gitignore` — node_modules, .cortex/
- `cortex-engine/cortex.config.js` — default config (watch paths, ignore patterns, languages)

**Actions:**
```bash
mkdir -p ~/claude-harness/cortex-engine/src/tools ~/claude-harness/cortex-engine/src/queries ~/claude-harness/cortex-engine/test/fixtures
cd ~/claude-harness/cortex-engine
npm init -y
npm install better-sqlite3 tree-sitter tree-sitter-javascript tree-sitter-typescript chokidar @modelcontextprotocol/sdk simple-git
npm install --save-dev jest
```

**Test:** `npm test` runs (even if 0 tests)

---

## Step 1: SQLite Store Layer

**Files:**
- `cortex-engine/src/store.js` — Database class: open, migrate, CRUD for files/symbols/imports
- `cortex-engine/src/queries/schema.sql` — CREATE TABLE statements
- `cortex-engine/test/store.test.js` — unit tests

**Postconditions:**
1. `new Store(dbPath)` creates SQLite database with WAL mode
2. `store.migrate()` creates files, symbols, imports tables idempotently
3. `store.upsertFile({path, language, hash, size, lineCount})` inserts or updates
4. `store.deleteFile(path)` removes file + cascades to symbols and imports
5. `store.getFile(path)` returns file record or null
6. `store.upsertSymbols(fileId, symbols[])` replaces all symbols for a file
7. `store.upsertImports(fileId, imports[])` replaces all imports for a file
8. `store.findSymbols({query, kind, exportedOnly, limit})` searches by name
9. `store.getSymbolsByFile(fileId)` returns all symbols for a file
10. `store.getImportsByFile(fileId)` returns all imports for a file
11. `store.findImporters(filePath)` returns files that import the given path
12. `store.findReferences(identifier)` returns files+lines containing identifier
13. `store.getStats()` returns {fileCount, symbolCount, importCount, indexedAt}

**Test command:** `cd cortex-engine && npx jest --no-coverage store`

---

## Step 2: tree-sitter Parser

**Files:**
- `cortex-engine/src/parser.js` — Parser class: parse file, extract symbols and imports
- `cortex-engine/test/parser.test.js` — unit tests
- `cortex-engine/test/fixtures/simple.js` — fixture: functions, classes, exports
- `cortex-engine/test/fixtures/complex.js` — fixture: arrow functions, destructuring, async
- `cortex-engine/test/fixtures/imports.js` — fixture: require, import, re-export
- `cortex-engine/test/fixtures/simple.cjs` — fixture: CommonJS .cjs file

**Postconditions:**
1. `parser.parse(filePath, content)` returns `{symbols: [], imports: []}`
2. Extracts function declarations with name, signature, start/end line
3. Extracts arrow functions assigned to const/let/var
4. Extracts class declarations with methods
5. Identifies exported symbols (module.exports, exports.X, export)
6. Identifies async functions
7. Extracts require() calls with source and identifiers
8. Extracts import statements with source and identifiers
9. Handles .cjs files identically to .js
10. Detects language from file extension
11. Returns empty arrays (not errors) for unparseable files

**Test command:** `cd cortex-engine && npx jest --no-coverage parser`

---

## Step 3: File Watcher

**Files:**
- `cortex-engine/src/watcher.js` — Watcher class: watch directory, emit parse events
- `cortex-engine/test/watcher.test.js` — unit tests (using temp directories)

**Postconditions:**
1. `new Watcher(rootPath, config)` creates chokidar watcher with ignore patterns
2. Ignores node_modules, .git, .cortex, dist, build by default
3. Only watches files matching configured extensions (.js, .jsx, .cjs, .ts, .tsx)
4. Emits 'add' with file path on new file detected
5. Emits 'change' with file path on file modification
6. Emits 'unlink' with file path on file deletion
7. Debounces rapid changes (100ms)
8. `watcher.close()` cleanly shuts down
9. Initial scan emits 'add' for all existing matching files

**Test command:** `cd cortex-engine && npx jest --no-coverage watcher`

---

## Step 4: Index Engine (Coordinator)

**Files:**
- `cortex-engine/src/index.js` — IndexEngine class: coordinates store, parser, watcher
- `cortex-engine/test/index.test.js` — integration tests

**Postconditions:**
1. `new IndexEngine(projectRoot, config)` creates store + parser + watcher
2. On watcher 'add'/'change': read file → hash → skip if unchanged → parse → store
3. On watcher 'unlink': delete file from store (cascades symbols/imports)
4. `engine.getOutline(filePath)` returns symbols for file
5. `engine.readSymbol(filePath, symbolName)` returns source code of symbol
6. `engine.readSymbols(specs[])` batch reads multiple symbols
7. `engine.readRange(filePath, startLine, endLine)` returns raw lines
8. `engine.getContext(filePath, symbolName)` returns symbol + imports
9. `engine.findSymbol(query, opts)` searches symbols
10. `engine.findText(pattern, opts)` searches file contents
11. `engine.findReferences(identifier)` finds usages
12. `engine.findImporters(filePath)` finds import consumers
13. `engine.getTree(pathPrefix, depth, glob)` returns file tree
14. `engine.getStatus()` returns index health
15. `engine.reindex(path?)` forces reindex
16. `engine.close()` shuts down watcher and closes store

**Test command:** `cd cortex-engine && npx jest --no-coverage index`

---

## Step 5: MCP Server + Tools

**Files:**
- `cortex-engine/src/server.js` — MCP server entry point, tool registration
- `cortex-engine/src/tools/file-tools.js` — cortex_tree, cortex_outline, cortex_read_symbol, cortex_read_symbols, cortex_read_range, cortex_context
- `cortex-engine/src/tools/search-tools.js` — cortex_find_symbol, cortex_find_text, cortex_find_references, cortex_find_importers
- `cortex-engine/src/tools/admin-tools.js` — cortex_status, cortex_reindex
- `cortex-engine/test/server.test.js` — integration tests (spawn server, send MCP messages)

**Postconditions:**
1. `node src/server.js /path/to/project` starts MCP server on stdio
2. All 12 tools registered with correct input schemas
3. Each tool validates input and returns structured JSON
4. Error responses include descriptive messages (not stack traces)
5. Server shuts down cleanly on SIGTERM/SIGINT
6. Startup completes within 5s on warm cache

**Test command:** `cd cortex-engine && npx jest --no-coverage server`

---

## Step 6: CLI Entry Point + Configuration

**Files:**
- `cortex-engine/bin/cortex.js` — CLI entry: parse args, start server
- `cortex-engine/cortex.config.js` — default config
- Update `cortex-engine/package.json` — bin entry

**Postconditions:**
1. `npx cortex-engine /path/to/project` starts the MCP server
2. Reads `cortex.config.js` from project root if present
3. Config supports: `watchPaths`, `ignorePaths`, `extensions`, `dbPath`
4. Falls back to sensible defaults (watch cwd, ignore node_modules/.git, .js/.ts extensions)
5. `npx cortex-engine --version` prints version
6. `npx cortex-engine --help` prints usage

**Test command:** `cd cortex-engine && npx jest --no-coverage`

---

## Step 7: Integration Test Against Real Codebase

**Files:**
- `cortex-engine/test/integration.test.js` — test against my-project codebase

**Postconditions:**
1. Indexes ~/my-project (5000+ files) without truncation or error
2. `cortex_outline` returns symbols for `apps/api/src/services/orderService.js`
3. `cortex_find_symbol` finds `listOrders` by name
4. `cortex_read_symbol` returns the function source
5. `cortex_find_importers` finds files that import orderService
6. `cortex_find_text` finds string literals
7. Handles .cjs files without staging bridge
8. Full index time < 30s, symbol query time < 50ms

**Test command:** `cd cortex-engine && npx jest --no-coverage integration --testTimeout=60000`

---

## Step 8: Hook + Settings Migration

**Files:**
- Update `~/claude-harness/hooks/suggest-jcodemunch.sh` → suggest cortex tools instead
- Update harness `install.sh` → configure cortex-engine MCP server
- Document migration path in README

**Postconditions:**
1. suggest-jcodemunch.sh (or renamed suggest-cortex.sh) points to cortex_ tools
2. install.sh adds cortex-engine to MCP server config
3. Projects can switch from jcodemunch to cortex with one config change

**Test command:** Manual verification — start a Claude session with cortex-engine configured, verify tools are available

---

## Merge Order

Sequential: Step 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8

Each step depends on the prior. No parallel dispatch needed for Phase 1.

## Total Estimated Files

| Category | Count |
|----------|-------|
| Source | 10 |
| Tests | 6 |
| Fixtures | 4 |
| Config | 3 |
| **Total** | **23** |
