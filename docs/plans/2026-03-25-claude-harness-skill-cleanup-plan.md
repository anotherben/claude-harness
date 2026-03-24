# Plan: claude-harness-skill-cleanup

1. Fix `install.sh` settings generation so hook commands reference `$CLAUDE_PROJECT_DIR` without invalid JSON quoting.
2. Remove retired skill directories:
   - `skills/fleet-commander`
   - `skills/full-cycle`
   - `skills/full-cycle-fast`
   - `skills/full-cycle-research`
   - `skills/full-cycle-tdd`
3. Remove or update installer, tier, and documentation references to those retired skills.
4. Re-run shell syntax, JSON validation, package tests, and a temp-project full-tier installer simulation.
