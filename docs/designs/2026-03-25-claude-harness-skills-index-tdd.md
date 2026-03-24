# Claude Harness Skills Index Port - TDD

**Date**: 2026-03-25
**Status**: DRAFT
**Tier**: Large
**Mode**: Solo
**Slug**: `claude-harness-skills-index`

## Problem

`claude-harness` ships `cortex-engine`, `vault-index`, hooks, and skills, but it does not yet ship the indexed skill/policy retrieval engine that was already proven in Helpdesk.

Current repo gaps:

1. No `skills-index/` package exists
2. Root docs/metadata still describe only two MCP servers
3. `tiers/full.json` still points at stale `jcodemunch` hook names
4. No full-tier skill suggestion hook exists
5. Setup skills only register `cortex-engine` and `vault-index`

## Outcome

Port the indexed `skills-index` engine into `claude-harness` as a first-class package and wire it into the repo distribution surfaces:

- package source + tests
- root docs and metadata
- installer and full-tier hook wiring
- setup skills that register MCP servers

## Architecture

### New top-level package

Add:

```text
skills-index/
  package.json
  src/
  tests/
  README.md
```

The package provides:

- SQLite-backed section index
- FTS search
- optional embeddings
- compiled runtime artifacts for hooks/adapters
- MCP + CLI access

### Existing surfaces that must change

#### Root metadata / docs

- `README.md`
- `harness.json`

#### Installer/runtime

- `install.sh`
- `tiers/full.json`
- `hooks/suggest-cortex.sh`
- new `hooks/suggest-skill.sh`
- `hooks/mark-skill-invoked.sh`
- `hooks/ensure-environment.sh`

#### Setup skills

- `skills/harness-init/SKILL.md`
- `skills/vault-init/SKILL.md`

## Integration Rules

1. `skills-index` must be documented and registered as a third MCP server.
2. Existing `suggest-cortex.sh` remains the read-gate hook name for compatibility, but its internals should consume compiled policy if present.
3. A new non-blocking `suggest-skill.sh` should be available in full tier to surface skill hints from compiled artifacts.
4. Hook-facing compiled artifact shapes must remain:
   - `compiled/policies.json`
   - `compiled/skill-hints.json`
   - `compiled/adapters/*.json`
   - `compiled/skills-registry.json`
5. Full-tier config must use current hook names, not stale `jcodemunch` names.

## Success Criteria

1. `claude-harness` contains the working `skills-index` package with passing tests
2. Root docs and metadata expose it as a first-class harness component
3. Full-tier wiring uses current hook names and includes skill suggestions
4. Setup skills teach users to register and verify the new server
