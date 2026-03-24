---
name: vault-sweep
description: Weekly accountability check for the Obsidian vault. Detects stale items, dead git branches, orphaned files, and auto-escalates priority on aging bugs/tasks. Use when the user says "sweep the vault", "what's stale", "clean up", or invokes /vault-sweep. Also suggested by session-heartbeat when sweep is >7 days overdue. This is the scatter-brain detector — it surfaces everything you started but haven't finished.
---

# Vault Sweep — Weekly Accountability Check

## Trigger
User says "sweep the vault", "what's stale", "clean up", or invokes `/vault-sweep`.
Also suggested by `session-heartbeat` when sweep is >7 days overdue.

## Procedure

### Step 1: Load All Active Items

Fetch all open and in-progress vault items:

```
mcp__vault-index__list_vault(status="open")
mcp__vault-index__list_vault(status="in-progress")
```

### Step 2: Classify by Age

For each item, calculate age from its `created` frontmatter field relative to today's date:

| Category   | Age        |
|------------|------------|
| Fresh      | < 7 days   |
| Aging      | 7–14 days  |
| Stale      | 14–30 days |
| Abandoned  | 30+ days   |

### Step 3: Priority Auto-Escalation

For items in `01-Bugs/` or `02-Tasks/` that have been open for **more than 7 days**, bump priority up one level:

- `low` → `medium`
- `medium` → `high`
- `high` stays `high`
- `critical` stays `critical`

Update the file's frontmatter `priority` field using the **Edit** tool. Do NOT touch items in other folders (03-Ideas, 00-Inbox, etc.).

### Step 4: Dead Branch Detection

For each item in `04-In-Progress/` that has a `branch` field in its frontmatter:

1. Determine the project repo path from the `project` field:
   - `helpdesk` → `/Users/ben/helpdesk`
   - `firearm-systems` → `/Users/ben/Projects/firearm-systems`
   - `flexible-deposits` → `/Users/ben/Projects/flexible-deposits`
2. Run `git branch --list <branch>` in that repo directory
3. If the branch does not exist locally, flag it as a **dead branch** (work was likely merged or abandoned)

### Step 5: Unresolved Blocker Check

For items with a `blocked-by` field:

1. Use `mcp__vault-index__get_vault_item` to fetch the blocking item
2. If the blocker's `status` is `done` or `archived`, the block is resolved
3. Update the blocked item's frontmatter: remove the resolved blocker from `blocked-by` using the **Edit** tool
4. If all blockers are resolved, note the item as **unblocked** in the report

### Step 6: Inbox Backlog

Flag any items in `00-Inbox/` that are older than **48 hours** based on their `created` field. These should have been triaged by now.

### Step 7: Orphan Detection

Use `mcp__vault-index__list_vault` to find items that:
- Sit in root-level folders (not in the standard 00–05 or _standards folders)
- Have no frontmatter at all

Flag these as **orphans** needing classification.

### Step 8: Present Sweep Report

Output a structured report with these sections:

```
## Vault Sweep Report — [DATE]

### Stale Items (14-30d)
| Item | Age | Folder | Priority | Project |
...

### Abandoned Items (30d+)
| Item | Age | Folder | Priority | Project |
...

### Dead Branches
| Item | Branch | Project | Status |
...

### Unresolved Blockers
| Item | Blocked By | Blocker Status |
...

### Inbox Backlog (>48h untriaged)
| Item | Age | Created |
...

### Orphans (no frontmatter / wrong folder)
| Item | Location |
...

### Priority Escalations Applied
| Item | Old Priority | New Priority |
...
```

### Step 9: Offer Batch Operations

After presenting the report, ask the user:

> "Batch operations available:
> - Archive N abandoned items?
> - Escalate M priorities? (already applied above — confirm or revert)
> - Unblock K items with resolved blockers?
> - Move L inbox items to 03-Ideas?
>
> Which would you like to proceed with?"

### Step 10: Re-index

After any file updates (priority escalations, blocker removals, archival moves), re-index the vault:

```
mcp__vault-index__index_vault(incremental=true)
```

### Step 11: Record Sweep Timestamp

Write the current ISO 8601 timestamp to `/tmp/claude-vault-last-sweep` so that `session-heartbeat` can detect when the next sweep is due.

```bash
date -u +"%Y-%m-%dT%H:%M:%SZ" > /tmp/claude-vault-last-sweep
```

## Notes

- This skill is read-heavy. Priority escalations in Step 3 are applied immediately but can be reverted if the user declines in Step 9.
- The vault path is `/Users/ben/Documents/Product Ideas`.
- Standard folders: `00-Inbox`, `01-Bugs`, `02-Tasks`, `03-Ideas`, `04-In-Progress`, `05-Archive`, `_standards`.
- Project repos: helpdesk (`/Users/ben/helpdesk`), firearm-systems (`/Users/ben/Projects/firearm-systems`), flexible-deposits (`/Users/ben/Projects/flexible-deposits`).

## Obsidian CLI Enhancement (optional)

If Obsidian CLI is available (check: `which obsidian`), use these enhanced detection methods:

```bash
# Find orphaned files (no incoming links) — catches vault items nothing references
obsidian orphans total

# Find dead-end files (no outgoing links) — may indicate stale notes
obsidian deadends total

# Find unresolved links — broken wikilinks that point to deleted/moved items
obsidian unresolved counts verbose
```

Add an "Orphaned Files" and "Unresolved Links" section to the sweep report when CLI is available. These catch structural vault issues that the frontmatter-based staleness check misses. Fall back to the standard approach above if CLI is not available.
