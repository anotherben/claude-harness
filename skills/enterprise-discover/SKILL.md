---
name: enterprise-discover
description: Use when starting enterprise work in a new repo, new worktree, or unfamiliar package, or whenever commands, paths, conventions, or project traps are not yet known
---

# Enterprise Discover

Profile the repository before the rest of the pipeline starts guessing. Read first; state
unknowns instead of inventing them.

## Required approach

1. Start with an indexed repo lookup if one exists (`cortex-engine` or equivalent); otherwise
   say so and fall back to direct filesystem search.
2. Read the real source — layout, entry points, package manifests, test/build/lint config,
   migrations, and the source-of-truth docs for any high-risk domain in scope.
3. Spawn parallel read-only Explore subagents for independent areas; synthesize the findings.
4. If a command, path, or convention cannot be verified, mark it **unknown** rather than
   guessing. Do not invent commands.

## Minimum outputs

- repo slug and display name
- workspace layout and relative source roots
- test, build, and lint commands (only when verified)
- migration locations if relevant
- auth, tenancy, and high-risk-domain conventions
- dominant file conventions
- known structural traps
- source-of-truth docs for risky domains

Write the profile to `docs/designs/YYYY-MM-DD-<slug>-discover.md` and report the highlights
back to the orchestrator — plan reads that file, not this conversation. Real CI merge
gates for this repo live in `skills/go/GATES.md` — reference that, do not restate it here.

## Rules

- Use relative paths and portable command names; never bake in usernames, absolute home
  paths, secrets, or machine-specific install locations.
- Web research, when needed, prefers official documentation and current primary sources.
- Refresh the profile whenever the repo materially changes.
