---
name: vault-process
description: Autonomous agent queue processor that picks up bugs and tasks from the vault and feeds them through the pipeline. Low-complexity items are processed autonomously. Medium/high-complexity items pause for human approval. Use when the user says "process the queue", "work on bugs", or invokes /vault-process. Can be run on a loop with /loop 10m /vault-process for continuous processing.
---

# Vault Process — superseded by /go queue

This skill is superseded by `/go queue` (see [skills/go/SKILL.md](../go/SKILL.md)). It survives
only as the vault-specific queue adapter: pull items, map complexity to a /go depth, hand off.

## Procedure

1. **Pull the queue.** Try `mcp__vault-index__list_vault(folder="01-Bugs", status="open")` and
   `mcp__vault-index__list_vault(folder="02-Tasks", status="open")`. If the vault-index MCP is
   unavailable, fall back to filesystem: `Glob`/`Grep` the `01-Bugs/` and `02-Tasks/` folders under
   `{{VAULT_PATH}}` directly and parse frontmatter with Read — same fields, best-effort dedupe/sort.
2. **Filter blocked items.** Skip any item whose `blocked-by` item is not `done`/`archived`.
3. **Sort.** Priority (critical > high > medium > low) descending, then age (oldest first).
4. **Map complexity → /go depth:**
   - `low` (or unset, assessed low) → **QUICK**, runs fully autonomous.
   - `medium` → **STANDARD**, pause once for plan approval before proceeding.
   - `high` → **DEEP**, pause once for plan approval before proceeding.
   Medium/high always pause for human approval — never silently autonomous.
5. **Hand off.** For each item (loop mode: one item per invocation), invoke `/go` with the item's
   description and the mapped depth. Let /go run its full stage pipeline through SHIP.
6. **On completion**, update the item's vault status (`done`, PR URL in frontmatter) if vault-index
   is available; otherwise leave a note for manual reconciliation.
7. **Report** processed / awaiting-approval / blocked / failed counts.

Loop mode (`/loop 10m /vault-process`): process one item per invocation; if the top item needs
approval, present it and stop rather than skipping ahead.
