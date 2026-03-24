# Solution: claude-harness-skills-index

**Date**: 2026-03-25

## Summary

Ported the indexed `skills-index` MCP package into `claude-harness` and wired it through the full-tier runtime surfaces so the harness now ships three MCP servers: `cortex-engine`, `skills-index`, and `vault-index`.

## What Changed

- Added `skills-index/` as a first-class package with source, tests, CLI, and MCP server entrypoint.
- Adapted package defaults so `skills-index` indexes:
  - project `.claude/skills`
  - project `.codex/repo-skills`
  - harness repo `skills/`
  - user-level `~/.claude/skills`
  - user-level `~/.codex/skills`
- Updated full-tier hook wiring to include `suggest-skill.sh` and modernized `suggest-cortex.sh`.
- Updated `ensure-environment.sh` and `mark-skill-invoked.sh` to compile bundles and log telemetry.
- Updated installer, tier metadata, root docs, and setup skills to install and register `skills-index`.

## Verification

- `cd skills-index && npm test`
- `bash -n hooks/suggest-cortex.sh hooks/suggest-skill.sh hooks/ensure-environment.sh hooks/mark-skill-invoked.sh install.sh`
- `python3 -m json.tool tiers/full.json`
- `python3 -m json.tool harness.json`
- `node skills-index/src/cli.js compile`
- `node skills-index/src/cli.js search --text "sql migration tenant query"`
- `node skills-index/src/cli.js status`
