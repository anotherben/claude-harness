# Claude Harness Skills Index Port - Plan

**Date**: 2026-03-25
**Status**: DRAFT
**Tier**: Large

## Workstream A: Port package

Add the `skills-index/` package from the validated Helpdesk worktree implementation:

- `package.json`
- `src/config.js`
- `src/frontmatter.js`
- `src/markdown.js`
- `src/tagger.js`
- `src/store.js`
- `src/embedder.js`
- `src/telemetry.js`
- `src/indexer.js`
- `src/platform.js`
- `src/server.js`
- `src/cli.js`
- tests
- `README.md`

## Workstream B: Wire root metadata and docs

Update:

- `README.md`
  - intro summary
  - architecture tree
  - quick start install commands
  - MCP registration examples
  - hook table
- `harness.json`
  - add `skills-index`
  - update counts as needed

## Workstream C: Hook/runtime distribution

Update:

- `hooks/suggest-cortex.sh`
  - compiled-policy aware read gate
- add `hooks/suggest-skill.sh`
  - compiled skill-hint reminders
- `hooks/mark-skill-invoked.sh`
  - telemetry + runtime markers
- `hooks/ensure-environment.sh`
  - warn about missing `skills-index` registration / compiled artifacts
- `install.sh`
  - full-tier hook list includes `suggest-skill.sh`
  - generated settings wire `suggest-skill.sh`
- `tiers/full.json`
  - replace stale jcodemunch hook names with current ones

## Workstream D: Setup skills and verification docs

Update:

- `skills/harness-init/SKILL.md`
- `skills/vault-init/SKILL.md`

Both must:

- register `skills-index`
- show compile/verify command
- treat it as a standard harness server

## Verification

1. `cd skills-index && npm install`
2. `cd skills-index && npm test`
3. `node skills-index/src/cli.js compile`
4. `node skills-index/src/cli.js search --text "sql migration tenant query"`
5. `node skills-index/src/cli.js status`
6. sanity-check root README/harness metadata references
