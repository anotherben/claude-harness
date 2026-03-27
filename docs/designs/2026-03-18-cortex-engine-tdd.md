# Technical Design Document: Cortex Engine — Phase 1

**Slug:** cortex-engine
**Tier:** Large
**Path:** FULL
**Date:** 2026-03-18
**Design:** docs/cortex-engine-design.md

---

## 1. Problem Statement

AI agents waste tokens reading entire files when they need one function. jcodemunch solves this with AST-based symbol extraction but has structural limitations: 2000-file truncation, manual reindexing, no .cjs support, flaky MCP availability, zero git awareness, and it's third-party code we can't evolve.

## 2. Solution: Cortex Engine Phase 1

A Node.js MCP server that replaces jcodemunch's core functionality (symbol indexing + querying) with real-time file watching, SQLite storage, and tree-sitter parsing. Phase 1 is a 1:1 functional replacement — same capabilities, better architecture.

## 3. Architecture

```
MCP Server (stdio)
  ↓
Query Engine (resolves tool calls)
  ↓
Index Engine (maintains freshness)
  ├─ tree-sitter parser (AST → symbols)
  ├─ chokidar watcher (file changes → reparse)
  └─ better-sqlite3 store (files, symbols, imports)
```

### Data Model

**files table:**
| Column | Type | Purpose |
|--------|------|---------|
| id | INTEGER PK | Auto-increment |
| path | TEXT UNIQUE | Relative to project root |
| language | TEXT | js, ts, jsx, tsx |
| size_bytes | INTEGER | File size |
| hash | TEXT | Content hash (SHA-256, for staleness detection) |
| line_count | INTEGER | Total lines |
| indexed_at | TEXT | ISO timestamp |

**symbols table:**
| Column | Type | Purpose |
|--------|------|---------|
| id | INTEGER PK | Auto-increment |
| file_id | INTEGER FK | → files.id |
| name | TEXT | Symbol name |
| kind | TEXT | function, class, method, constant, export |
| signature | TEXT | Full signature line |
| start_line | INTEGER | Start of symbol |
| end_line | INTEGER | End of symbol |
| exported | BOOLEAN | In module.exports or export? |
| async | BOOLEAN | Uses async/await? |

**imports table:**
| Column | Type | Purpose |
|--------|------|---------|
| id | INTEGER PK | Auto-increment |
| file_id | INTEGER FK | → files.id |
| source | TEXT | Import source (e.g., '../db', 'express') |
| identifiers | TEXT | JSON array of imported names |
| line | INTEGER | Line number |

### Indexes
- `files(path)` — unique, for lookup by path
- `symbols(file_id)` — for outline queries
- `symbols(name)` — for symbol search
- `symbols(kind)` — for filtering by type
- `imports(file_id)` — for context bundle
- `imports(source)` — for find_importers

## 4. MCP Tools (Phase 1 — jcodemunch parity)

### File & Structure
| Tool | Params | Returns |
|------|--------|---------|
| `cortex_tree` | `path_prefix?`, `depth?`, `glob?` | File tree with counts |
| `cortex_outline` | `file_path` | Symbols in file: name, kind, signature, lines, exported |
| `cortex_read_symbol` | `file_path`, `symbol_name` | Full source code of the symbol |
| `cortex_read_symbols` | `symbols[]` (array of {file_path, symbol_name}) | Batch read |
| `cortex_read_range` | `file_path`, `start_line`, `end_line` | Raw lines from file |
| `cortex_context` | `file_path`, `symbol_name` | Symbol source + all imports from same file |

### Search
| Tool | Params | Returns |
|------|--------|---------|
| `cortex_find_symbol` | `query`, `kind?`, `exported_only?`, `limit?` | Matching symbols with file path and signature |
| `cortex_find_text` | `pattern`, `glob?`, `is_regex?`, `context_lines?`, `limit?` | Text search results with line numbers |
| `cortex_find_references` | `identifier` | Files and lines where identifier appears |
| `cortex_find_importers` | `file_path` | Files that import from this file |

### Admin
| Tool | Params | Returns |
|------|--------|---------|
| `cortex_status` | none | File count, symbol count, index age, watcher status |
| `cortex_reindex` | `path?` | Force reindex (normally automatic) |

## 5. File Watcher Behavior

- Watch project root recursively
- Ignore: `node_modules/`, `.git/`, `dist/`, `build/`, `.cortex/`, patterns from `.gitignore`
- On file change/add: hash file → compare to stored hash → if different, re-parse and update symbols
- On file delete: remove file and symbols from index
- Debounce: 100ms (batch rapid saves)
- Initial scan: index all tracked files on server startup

## 6. Parser Behavior

For each file:
1. Read content
2. Parse with tree-sitter (language detected from extension)
3. Walk AST to extract:
   - Function declarations and expressions
   - Arrow functions assigned to variables
   - Class declarations with methods
   - module.exports / export statements
   - require() / import statements
4. Store symbols and imports in SQLite
5. Update file hash and timestamp

### Language Support (Phase 1)
| Extension | tree-sitter grammar | Priority |
|-----------|-------------------|----------|
| .js | tree-sitter-javascript | P0 |
| .jsx | tree-sitter-javascript | P0 |
| .cjs | tree-sitter-javascript | P0 (native — no bridge needed!) |
| .mjs | tree-sitter-javascript | P1 |
| .ts | tree-sitter-typescript | P1 |
| .tsx | tree-sitter-typescript | P1 |

## 7. Startup Sequence

1. Create `.cortex/` directory if missing
2. Open/create SQLite database at `.cortex/index.db`
3. Run migrations (create tables if not exist)
4. Start MCP server on stdio
5. Start file watcher
6. Initial index: scan all git-tracked files, parse new/changed ones
7. Ready — accept tool queries

## 8. Key Design Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| SQLite not JSON files | better-sqlite3 | Fast queries, proper indexes, ACID, WAL mode for concurrent reads |
| tree-sitter not regex | tree-sitter native | Accurate AST, handles edge cases (nested functions, destructuring), incremental parsing |
| File watcher not manual reindex | chokidar | Always-fresh index, no correctness gap |
| Relative paths not absolute | Relative to project root | Portable, works across worktrees |
| `cortex_` prefix on tools | Namespace | Prevents collision with other MCP servers |
| No AI summaries | Rule-based only | Deterministic, free, fast, no API key dependency |
| Symbol lookup by name not ID | file_path + name | More intuitive than opaque IDs, works across reindexes |

## 9. Workstreams

| # | Workstream | Files | Independence |
|---|-----------|-------|-------------|
| WS-1 | SQLite store layer | store.js, queries/*.sql | Fully independent |
| WS-2 | tree-sitter parser | parser.js | Depends on store schema |
| WS-3 | File watcher | watcher.js | Depends on parser + store |
| WS-4 | MCP server + tools | server.js, tools/*.js | Depends on store + parser |
| WS-5 | Integration + CLI | index.js, package.json | Depends on all above |

**Recommended mode: Solo** — workstreams are sequential (each depends on the prior). Subagent dispatch doesn't help here.

## 10. Testing Strategy

- **Unit tests**: parser extracts correct symbols from fixture files
- **Unit tests**: store CRUD operations work correctly
- **Unit tests**: watcher detects file changes and triggers reparse
- **Integration tests**: end-to-end MCP tool calls return correct results
- **Fixture files**: small JS/TS files with known symbols for deterministic testing

## 11. Risk Register

| Risk | Mitigation |
|------|-----------|
| tree-sitter native bindings fail on macOS | Use web-tree-sitter as fallback (WASM, slower but portable) |
| SQLite WAL mode issues with concurrent access | Single writer (watcher), multiple readers (queries) — WAL handles this |
| Large repos slow to initial index | Incremental: hash-based skip, only parse changed files |
| chokidar misses events on macOS | Use FSEvents (default on macOS), poll as fallback |
| Symbol extraction misses edge cases | Fixture-driven testing, iterate on real codebase |

## 12. Success Criteria (Phase 1)

- [ ] Indexes my-project codebase (5000+ files) without truncation
- [ ] Handles .cjs files natively (no staging bridge)
- [ ] File changes reflected in index within 200ms
- [ ] All 12 MCP tools return correct results on fixture files
- [ ] Can replace jcodemunch in my-project project (update hooks + settings)
- [ ] Startup time < 5s on warm cache, < 30s on cold (full reindex)
- [ ] Zero external API dependencies (no Anthropic/Google keys needed)
