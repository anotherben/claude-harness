# Contract Review: claude-harness-skills-index

**Date**: 2026-03-25
**Source**: `docs/plans/2026-03-25-claude-harness-skills-index-plan.md`
**Status**: LOCKED

## Summary

Port the indexed skill engine into `claude-harness` as a first-class package and update the harness distribution surfaces so the engine is installable, documented, and wired into the full tier.

## Live Verifications

| Fact | Verified Against | Result | Timestamp |
| --- | --- | --- | --- |
| Local target repo exists at `/Users/ben/claude-harness` | shell | CONFIRMED | 2026-03-25 |
| Main checkout is dirty and unsuitable for direct edits | `git status --short --branch` | CONFIRMED | 2026-03-25 |
| Clean worktree exists at `.Codex/worktrees/skills-index-20260325` on `feat/skills-index-20260325` | `git worktree add` | CONFIRMED | 2026-03-25 |
| Root repo currently lists only `cortex-engine` and `vault-index` as MCP servers | `README.md`, `harness.json` | CONFIRMED | 2026-03-25 |
| Full tier config still references `suggest-jcodemunch.sh` and `jcodemunch-reindex.sh` | `tiers/full.json` | CONFIRMED | 2026-03-25 |
| No `hooks/suggest-skill.sh` exists | file tree | CONFIRMED | 2026-03-25 |

## Postconditions

### PC-B1: Package ported

`skills-index/` exists in the repo with working source and tests.

Verification:

- `skills-index/package.json`
- `skills-index/src/*`
- `skills-index/tests/*`
- `cd skills-index && npm test`

### PC-B2: Root docs and metadata updated

`README.md` and `harness.json` describe `skills-index` as a third harness MCP server.

### PC-B3: Full-tier hook wiring updated

`install.sh` and `tiers/full.json` must use current hook names and include `suggest-skill.sh` for full tier.

### PC-B4: Hook implementations updated

The repo ships:

- updated `hooks/suggest-cortex.sh`
- new `hooks/suggest-skill.sh`
- updated `hooks/mark-skill-invoked.sh`
- updated `hooks/ensure-environment.sh`

Verification:

- `bash -n` on modified hooks

### PC-B5: Setup skills updated

`skills/harness-init/SKILL.md` and `skills/vault-init/SKILL.md` register and verify `skills-index`.

### PC-B6: Live smoke works in repo

Using the repo-local package:

- `node skills-index/src/cli.js compile`
- `node skills-index/src/cli.js search --text "sql migration tenant query"`
- `node skills-index/src/cli.js status`

must all succeed after install.

## Invariants

1. Existing hook-facing compiled artifact keys stay stable.
2. The new engine is additive to `cortex-engine` and `vault-index`, not a replacement.
3. The repo’s main dirty checkout is untouched.
