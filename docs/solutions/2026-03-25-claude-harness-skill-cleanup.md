# Solution: claude-harness-skill-cleanup

**Date**: 2026-03-25

## Summary

Fixed the full-tier installer so it emits valid command strings, removed the retired `fleet-commander` and `full-cycle*` skill packages from the repo, and updated the shipped manifests/docs so `claude-harness` now exposes only the current skill surface.

Also added a project-level [cortex.config.js](/Users/ben/claude-harness/.Codex/worktrees/skills-index-20260325/cortex.config.js) so `cortex-engine` ignores:

- `.codex`
- `.agents`
- `.runs`
- `.playwright-cli`

## Verification

- `bash -n hooks/suggest-cortex.sh hooks/suggest-skill.sh hooks/ensure-environment.sh hooks/mark-skill-invoked.sh install.sh`
- `python3 -m json.tool tiers/full.json`
- `python3 -m json.tool tiers/lite.json`
- `python3 -m json.tool harness.json`
- `cd skills-index && npm test`
- temp-project installer simulation:
  - `settings.json` valid
  - `suggest-skill.sh` copied
  - `.mcp.json` contains `skills-index`
  - installed skill count = `40`
- fresh watcher proof:
  - `file_count = 208`
  - `.codex`, `.agents`, and `.runs` absent from watched paths
