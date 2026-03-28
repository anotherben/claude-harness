# Changelog

## [1.4.1] - 2026-03-29

### Fixed
- **`cortex_tree` depth parameter** — the `depth` parameter was accepted but never applied, causing the full file list to be returned regardless. On large monorepos this exceeded MCP response limits (579K+ chars). Depth is now enforced relative to `path_prefix` (or root if no prefix).

### Changed
- Removed unused `stats` variable from `getTree()`

## [1.4.0] - 2026-03-20

### Added
- **Route handler symbol extraction** — `router.post('/path', handler)` now appears in `cortex_outline` as `[route] POST /path` with line ranges and parent scope
- **Test quality validation hooks** — `validate-test-relevance.sh` (tests must reference changed symbols) and `validate-test-quality.sh` (no tautological tests, no placeholder names, no empty bodies). 26/26 hook tests pass.
- **Enterprise brainstorm Phase 2.5: Product Design** — user personas, UI/UX design, workflow/business logic, platform context detection (Shopify/SaaS/mobile/API/CLI), integration ecosystem mapping
- **Harness-init Step 5b: MCP server registration** — auto-registers cortex-engine + vault-index in both Claude Code and Codex CLI. Removes jcodemunch if present.
- **Enterprise HARNESS CHECK** — `/enterprise` now auto-detects if hooks, settings, evidence dir, cortex MCP, and vault MCP are installed. Auto-runs `/harness-init` + `/vault-init` if missing.

### Fixed
- **Stale vault-context markers** — `/tmp/claude-vault-context-*` files older than 2 hours are auto-deleted before gate checks. Prevents old sessions from satisfying new session gates.
- **Mode selection timing** — Solo/Subagent/Swarm selection moved from after BRAINSTORM to after PLAN. The plan reveals task dependencies; the brainstorm doesn't.

### Changed
- **30 hooks** (was 28) — added validate-test-relevance.sh, validate-test-quality.sh
- **333 tests** in cortex-engine (was 320) — added route extraction tests
- **Enterprise brainstorm** now 4 phases (was 3): EXTRACT → DISCOVER → PRODUCT DESIGN → ENGINEER

## [1.3.0] - 2026-03-19

### Added
- **tree-sitter Java** — full AST: classes, methods, constructors, interfaces, enums, annotations, fields
- **tree-sitter C#** — full AST: namespaces, classes, methods, constructors, interfaces, enums, structs, properties
- **`test` source_type** — test/spec/mock/fixture files auto-categorized, excluded from default search. Query with `source_types=['test']`
- **Stale index detection** — on cold start, samples file mtimes vs index timestamps. Auto-reindexes stale/new files
- **Obsidian knowledge sync** — `cortex_sync_knowledge` tool + auto-sync every 5 min when `OBSIDIAN_VAULT_PATH` set. Writes grouped markdown files to `{vault}/_cortex/`
- **Multi-repo MCP** — `cortex_add_repo` and `cortex_list_repos` tools. Pass multiple roots via CLI. Search tools accept optional `repo` filter
- Swift tree-sitter skipped (no compatible binding for tree-sitter@0.21.1)

### Changed
- **8 tree-sitter languages** (was 6) — JS, TS, TSX, Python, Go, Rust, Java, C#
- **30 MCP tools** (was 27) — added cortex_sync_knowledge, cortex_add_repo, cortex_list_repos
- **7 source_type categories** (was 6) — code, test, config, docs, markup, style, query
- **320 tests** across 18 suites (was 262 across 17)

## [1.2.0] - 2026-03-19

### Added
- **tree-sitter Python** — full AST parsing: classes, methods, decorators, async functions, imports (tree-sitter-python@0.21.0)
- **tree-sitter Go** — full AST parsing: structs, methods, interfaces, functions, constants, type declarations (tree-sitter-go@0.21.2)
- **tree-sitter Rust** — full AST parsing: impl blocks, structs, enums, traits, type aliases, macros, use declarations (tree-sitter-rust@0.21.0)
- **Fuzzy word-overlap scoring** — "createPO" now finds "createPurchaseOrder" via camelCase/snake_case word splitting with +25 per matching word
- **Module-level route_handler** — JS files with `router.post()` at module scope now get tagged by scanning source lines and attributing to enclosing symbols

### Changed
- **6 tree-sitter languages** (was 3) — JS, TS, TSX, Python, Go, Rust all get full AST with nested symbol extraction
- **262 tests** across 17 suites (was 211 across 16)
- Python removed from regex fallback — now uses tree-sitter for full symbol depth

## [1.1.0] - 2026-03-19

### Added
- **TypeScript parity** — nested symbol extraction (factory methods, local helpers, inner types, interface members) with parent-child relationships
- **20 file types** — expanded from 6 to 20: JSON, YAML, GraphQL, Markdown, TOML, XML, HTML, Vue, Svelte, SCSS, LESS + configurable
- **Symbol categorization** — 6 categories (code, config, docs, markup, style, query) with search filtering. Defaults to code + query; opt-in for all
- **TS-aware semantic tagger** — broadened patterns: Prisma/knex/drizzle DB calls, @Get/@Post decorator routes, @Auth/@Guard tags, @Body/@Param validation tags
- **Token-savings telemetry** — every tool response includes `_meta` with timing_ms, tokens_saved, cost_avoided (Opus/Sonnet/Haiku pricing). Cumulative stats persist across sessions
- **`cortex_telemetry` tool** — cumulative session report: total queries, tokens saved, cost avoided
- **`cortex_diagnostic` tool** — 7-check health report for index validation (files, symbols, source_type column, tags, imports)
- **Route handler body detection** — tagger checks function body (not just signature) for `router.post()` patterns inside factory functions

### Fixed
- **findImporters precision** — require minimum 2 path segments for disambiguation. Eliminates false positives where single-segment suffix (e.g., "auth") matched unrelated imports
- **Deferred indexing** — MCP server connects in ~10ms, indexes in background (~3s). Eliminates handshake timeout on large repos (7K+ files)
- **Zod schemas for all tools** — switched from JSON Schema config objects to Zod positional args in `server.tool()`. Fixes tools appearing parameterless to MCP clients
- **MCP SDK compatibility** — downgraded to SDK 1.12.1 (protocol 2025-03-26) for Codex CLI compatibility. Pinned zod@3 to match SDK's zod-to-json-schema requirement
- **Null guards** — findSymbols, findImporters, readRange all return gracefully on null/undefined input instead of crashing

### Changed
- **27 MCP tools** (was 25) — added cortex_telemetry and cortex_diagnostic
- **211 tests** across 16 suites (was 97 across 14)
- **Import graph** — multi-suffix path resolution with .js→.ts cross-extension support, barrel export (index.ts) resolution, and relative path normalization

## [1.0.0] - 2026-03-18

### Added
- Core index engine with SQLite storage (WAL mode), tree-sitter JS/TS/TSX parser, regex fallback for Python/Bash/SQL/CSS
- Real-time file watcher (chokidar v3) with function-based ignore
- 25 MCP tools: file reading, symbol search, git integration, semantic tags, knowledge store, fleet coordination
- Multi-repo support via MultiRepoEngine
- Git integration: blame, hotspots, diff, log via simple-git
- Semantic tagger: db_read, db_write, tenant_scoped, unscoped_query, route_handler, async, error_handler, exported
- Knowledge store: persistent JSONL annotations with Obsidian vault sync
- Fleet integration: handover ingestion, learning reports, MCP config generation
- 97 tests across 14 suites
