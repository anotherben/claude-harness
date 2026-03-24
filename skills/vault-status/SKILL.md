---
name: vault-status
description: Cross-project visibility dashboard showing all vault queues at a glance. Use when the user says "what's open", "vault status", "show my dashboard", "what am I working on", or invokes /vault-status. Also use when the user seems unsure what to work on next or needs a project overview. Shows items grouped by queue (Inbox, Bugs, Tasks, Ideas, In-Progress, Archive) with staleness flags and scatter-brain scoring.
---

# Vault Status Dashboard

## Steps

### 1. Fetch all vault items

Call `mcp__vault-index__list_vault` multiple times with different status filters to retrieve every item across all queues. Use compact JSON output — do not read individual files.

Queues to fetch:
- `00-Inbox`
- `01-Bugs`
- `02-Tasks`
- `03-Ideas`
- `04-In-Progress`
- `05-Archive`

### 2. Group and sort

Group returned items by their queue folder. Within each group, sort by priority descending: critical > high > medium > low.

### 3. Compute staleness flags

For every item **not** in `03-Ideas`, check the `updated` (or `created` if no update) date in frontmatter. If the item is older than 14 days from today, mark it with a stale flag (prefix with `[STALE]` in output).

### 4. Compute scatter-brain score

- Count the number of **distinct projects** that have at least one open item (anything outside `05-Archive`).
- Count the number of distinct projects with **recent activity** (updated within the last 7 days).
- Report: `Scatter-brain score: X open projects, Y recently active`
- If X > Y * 2, add a warning: "You have too many plates spinning. Consider archiving or parking stale projects."

### 5. Render summary table

Present a markdown table:

```
| Queue          | Count | Critical | High | Med | Low | Stale |
|----------------|-------|----------|------|-----|-----|-------|
| 00-Inbox       |       |          |      |     |     |       |
| 01-Bugs        |       |          |      |     |     |       |
| 02-Tasks       |       |          |      |     |     |       |
| 03-Ideas       |       |          |      |     |     |   -   |
| 04-In-Progress |       |          |      |     |     |       |
| 05-Archive     |       |          |      |     |     |   -   |
```

Ideas and Archive never show stale counts (use `-`).

### 6. List items per queue

Below the table, list each non-empty queue with its items in brief format:

```
## 01-Bugs (3 items)
- [STALE] [critical] project-name: Title of item
- [high] project-name: Another item
- [med] project-name: Third item
```

Include the stale flag, priority in brackets, project name, and item title.

### 7. Project filtering (optional)

If the user provides a project name as an argument (e.g., `/vault-status helpdesk`), filter all results to only show items where the `project` frontmatter field matches. Adjust all counts, the table, and the scatter-brain score accordingly. State clearly at the top: "Filtered to project: <name>".

### 8. Closing recommendation

End with a short recommendation:
- If there are critical bugs, say: "You have N critical bugs. Recommend triaging those first."
- If inbox is non-empty, say: "N items in inbox need triage."
- If scatter-brain warning triggered, repeat it here.
- Otherwise: "All clear. Pick up the highest-priority task or review parked ideas."

## Obsidian CLI Enhancement (optional)

If Obsidian CLI is available (check: `which obsidian`), supplement the dashboard with:

```bash
# Tag analytics — shows which tags are most used across the vault
obsidian tags counts sort=count

# Task overview — shows incomplete tasks across the vault
obsidian tasks todo total
```

Add a "Tag Cloud" section after the scatter-brain score showing the top 10 tags by count. Add an "Open Tasks" count to the summary table. Fall back to the standard approach above if CLI is not available.
