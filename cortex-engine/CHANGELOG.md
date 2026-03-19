# Changelog

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
