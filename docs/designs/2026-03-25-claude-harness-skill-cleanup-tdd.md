# TDD: claude-harness-skill-cleanup

**Date**: 2026-03-25

## Summary

Clean the `claude-harness` distribution so the shipped installer, manifests, and docs only expose current skills and MCP servers, while fixing the invalid full-tier `settings.json` regression introduced during the `skills-index` port.

## Required Outcomes

- Full-tier installer emits valid `.claude/settings.json`
- `fleet-commander` and all `full-cycle*` skills are removed from the repo
- Tier manifests, installer lists, and README counts match the reduced skill set
- `skills-index` integration still verifies after the cleanup
