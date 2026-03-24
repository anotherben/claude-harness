# Contract Review: claude-harness-skill-cleanup

**Date**: 2026-03-25
**Status**: LOCKED

## Postconditions

### PC-C1: Full-tier installer output is valid

`install.sh` must generate valid `.claude/settings.json` for a temp-project full-tier install.

### PC-C2: Retired skill directories removed

The repo must no longer ship:

- `skills/fleet-commander`
- `skills/full-cycle`
- `skills/full-cycle-fast`
- `skills/full-cycle-research`
- `skills/full-cycle-tdd`

### PC-C3: Distribution manifests and docs updated

`install.sh`, `tiers/*.json`, `README.md`, `harness.json`, and `skills/harness-init/SKILL.md` must no longer advertise the retired skills.

### PC-C4: skills-index integration still holds

`skills-index` package tests must still pass and installer simulation must still register `skills-index` plus copy `suggest-skill.sh`.
