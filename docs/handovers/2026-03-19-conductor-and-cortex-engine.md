# Handover: Conductor Dispatch + Cortex Engine

**Date**: 2026-03-19
**Branch**: `main`
**Worktree**: N/A
**Last Commit**: `05fc045` — docs: cortex engine enterprise pipeline artifacts
**Completion**: Conductor 100%, Cortex Engine 30% (pipeline through CONTRACT, BUILD not started)

## What Was Done

### Conductor — CLI-Session-Based Agent Dispatch (COMPLETE)

Replaced Agent tool dispatch with `claude -p` sessions that get full governance.

**Files created:**
- `conductor/dispatch.sh` — launches governed CLI worker sessions with hooks, MCP, skills
- `conductor/collect.sh` — aggregates results from dispatch waves
- `conductor/persist.sh` — copies handovers + fleet state to Obsidian vault
- `conductor/resume.sh` — next-day resume from fleet state
- `skills/conductor-resume/SKILL.md` — `/conductor-resume` slash command

**Files modified:**
- `skills/fleet-commander/SKILL.md` — PHASE 5 now uses conductor dispatch
- `install.sh` — conductor-resume added to full-tier skill list

**Worker prompt A/B tested:** 46 runs across 23 adversarial categories. Final v2 prompt scored 100% on all assertions. Results documented in `docs/conductor-ab-results.md`.

### Cortex Engine — Code Intelligence MCP Server (PIPELINE IN PROGRESS)

Enterprise pipeline run: DISCOVER → BRAINSTORM → PLAN → CONTRACT complete.

**Artifacts produced:**
- `docs/cortex-engine-design.md` — full architecture design (brainstorm output)
- `docs/designs/2026-03-18-cortex-engine-tdd.md` — Technical Design Document
- `docs/plans/2026-03-18-cortex-engine-plan.md` — 8-step implementation plan
- `docs/contracts/2026-03-18-cortex-engine-contract.md` — 20 postconditions, LOCKED

**Vault item:** `02-Tasks/20260318-213500-task-build-cortex-engine-mcp.md`

## What Remains

### Cortex Engine BUILD → COMPLETE

1. **Step 0: Project Scaffold** — create `cortex-engine/` directory, package.json, install deps
   ```bash
   cd ~/claude-harness
   mkdir -p cortex-engine/src/tools cortex-engine/src/queries cortex-engine/test/fixtures
   cd cortex-engine && npm init -y
   npm install better-sqlite3 tree-sitter tree-sitter-javascript tree-sitter-typescript chokidar @modelcontextprotocol/sdk simple-git
   npm install --save-dev jest
   ```

2. **Step 1: SQLite Store** — `src/store.js` + `test/store.test.js` — 13 postconditions (PC-1 through PC-6)
3. **Step 2: tree-sitter Parser** — `src/parser.js` + `test/parser.test.js` — 5 postconditions (PC-7 through PC-11)
4. **Step 3: File Watcher** — `src/watcher.js` + `test/watcher.test.js` — 2 postconditions (PC-12, PC-13)
5. **Step 4: Index Engine** — `src/index.js` + `test/index.test.js` — 3 postconditions (PC-14 through PC-16)
6. **Step 5: MCP Server + Tools** — `src/server.js` + `src/tools/*.js` + `test/server.test.js` — 4 postconditions (PC-17 through PC-20)
7. **Step 6: CLI Entry Point** — `bin/cortex.js` + config
8. **Step 7: Integration Test** — test against real my-project codebase
9. **Step 8: Hook Migration** — update suggest-jcodemunch.sh → suggest-cortex.sh

After BUILD: REVIEW → FORGE → VERIFY → COMPOUND → COMPLETE

## Critical Context

### Conductor Design Decisions
- Workers get `--disallowed-tools "Agent Skill(enterprise-verify) Skill(enterprise-review) Skill(enterprise-forge) Skill(enterprise-harness)"` — builders can't verify own work
- Handover path injected via system prompt so persist.sh can find it
- Fleet state accumulates in Obsidian `_evidence/conductor/` for cross-day continuity
- V2 worker prompt includes "verify FILES exist" step — fixes the impossible-task failure both v0 and v1 had

### Cortex Engine Design Decisions
- **tree-sitter native bindings** (not web-tree-sitter WASM) — faster for CLI
- **better-sqlite3** (not async sqlite3) — synchronous reads are faster for single-threaded MCP server
- **chokidar file watcher** — eliminates manual reindex workflow entirely
- **Symbol lookup by file_path + name** (not opaque IDs) — more intuitive, works across reindexes
- **No AI summaries** — rule-based only, deterministic, free, no API key dependency
- **`cortex_` prefix** on all tool names — prevents collision with other MCP servers
- **.cjs support native** — tree-sitter handles it, no staging bridge needed (unlike jcodemunch)
- **Solo mode** — workstreams are sequential, subagent dispatch doesn't help for Phase 1

### A/B Test Infrastructure
- Synthetic test project at `/tmp/conductor-ab-test/project/` (git repo with Node/Express fixtures)
- 23 adversarial eval categories designed to break worker prompts
- Grading script at `/tmp/conductor-ab-test/results/` (mechanical assertions + JSON output)
- This infrastructure can be reused for future prompt A/B testing

## Test Status

- Conductor: all scripts pass `bash -n` syntax check, `collect.sh` tested with synthetic data
- Cortex Engine: no code written yet (pipeline at CONTRACT stage)

## How to Continue

1. Read this handover
2. Read the contract: `~/claude-harness/docs/contracts/2026-03-18-cortex-engine-contract.md`
3. Read the plan: `~/claude-harness/docs/plans/2026-03-18-cortex-engine-plan.md`
4. Resume enterprise pipeline at BUILD stage:
   ```
   /enterprise --continue cortex-engine
   ```
   Pipeline state: CONTRACT LOCKED → next stage is BUILD
5. Follow the plan step-by-step: scaffold → store → parser → watcher → index → server → CLI → integration → migration
6. Each step has a test command — RED→GREEN TDD per the contract
