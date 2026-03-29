# Changelog

All notable changes to this project will be documented in this file.

## v2.2.1 - 2026-03-29

### Added
- Bundled `cortex-memory/` as a first-class MCP package in the harness distribution.
- Added root `.gitignore` coverage for local runtime caches, SQLite files, and package installs.

### Changed
- `install.sh --global` now installs shared runtimes to stable global paths:
  - `~/.claude-harness/cortex-engine`
  - `~/.claude-harness/skills-index`
  - `~/.vault-index`
  - `~/.cortex-memory`
- The installer now updates global Claude MCP registration in `~/.claude.json`.
- The installer now reconciles Codex global MCP registration with the same runtime paths.
- Updated `README.md`, `harness.json`, setup skills, and runtime checks to document the four bundled MCP servers and the global install flow.

### Verified
- `install.sh --global` completed successfully and updated both Claude and Codex MCP registries.
- `npm test -- --run` passed in `cortex-memory` with `53/53` tests green.
- `node ~/.cortex-memory/cli.js status` returned the live multi-platform index.

## v2.2.0 - 2026-03-29

### Added
- Added bundled `cortex-memory` support as the fourth harness MCP server.
- Added cross-platform transcript recall defaults for Claude and Codex session archives.

### Changed
- Updated the root docs, installer surfaces, and setup skills to advertise shared transcript memory as a recall layer instead of a source of truth.
