---
name: vault-context
description: Pre-session project briefing that loads targeted context from the Obsidian vault before starting work. Use when the user says "context for [project]", "brief me on [project]", or invokes /vault-context. Also auto-suggested before /enterprise runs (enforced by hook). Pulls vault items, code repo structure via cortex-engine, and coding standards from _standards/ — giving the agent a complete picture before any work begins.
---

# Vault Context Briefing

## Prerequisites

A project name is **required**. If the user does not provide one, ask: "Which project do you want a briefing on?"

## Steps

### 0. Check for stale vault index

Before querying, check if evidence hooks have written to the vault since the last reindex:

```bash
cat ~/Documents/Product\ Ideas/_evidence/.needs-reindex 2>/dev/null
```

If the file exists, call `mcp__vault-index__index_vault(incremental=true)` first to pick up recent evidence writes, then delete the marker:

```bash
rm -f ~/Documents/Product\ Ideas/_evidence/.needs-reindex
```

### 1. Fetch vault items for the project

Call `mcp__vault-index__list_vault` with `project="<name>"` to retrieve all items for the specified project. This returns compact JSON — no individual file reading needed.

Filter out any items in `05-Archive`. Keep everything else grouped by queue.

### 1b. Load live claim ownership state

For each item returned, call `mcp__vault-index__get_claim(item_id="<id>")` to check ownership. Also call `mcp__vault-index__list_claims(project="<project>")` for a project-wide view.

In the briefing output, show the claim owner and lease expiry alongside each item:
```
- [priority] Title — owner: <owner_instance> | lease: <lease_expires_at>
- [priority] Title — unclaimed
```

### 1c. Record session identity

Write a session context file for downstream gates:
```bash
echo "item_id=<target_item_id>" > /tmp/claude-vault-context-${SESSION_ID}
echo "project=<project>" >> /tmp/claude-vault-context-${SESSION_ID}
echo "owner_instance=claude:${SESSION_ID}" >> /tmp/claude-vault-context-${SESSION_ID}
```

Where `SESSION_ID` comes from the conversation context. If the user specified a concrete item to work on, record its `id` field from frontmatter. If this is a project-level briefing with no specific item, record only the project.

**Do NOT claim the item inside vault-context.** This matches the shared coordination contract — context is read-only.

### 2. Load code repo outline

Use cortex-engine MCP to get the project's code structure:

1. `mcp__cortex-engine__cortex_status()` — verify index is live and get file/symbol counts
2. `mcp__cortex-engine__cortex_tree(depth=2)` — top-level directory structure
3. For key modules referenced in vault items, use `mcp__cortex-engine__cortex_outline(file_path="...")` to get symbol-level detail

If cortex-engine is not available, fall back to jcodemunch:
- `helpdesk` -> `local/helpdesk-fde14943`
- `firearm-systems` -> `local/firearm-systems-9d6506f0`
- `flexible-deposits` -> `local/flexible-deposits-591a3e89`

If neither MCP is available, skip the code outline step and note: "No code intelligence MCP available for this project."

### 3. Load standards and project config

Read these files from the vault at `/Users/ben/Documents/Product Ideas`:
- `_standards/coding-standards.md`
- `_standards/tech-stack.md`
- `_standards/security.md`

Also attempt to load the project's `CLAUDE.md` via `mcp__cortex-engine__cortex_read_range(file_path="CLAUDE.md")` or Read tool. If it does not exist, skip silently.

### 4. Compile the briefing

Present the briefing with these sections in order:

#### Standards Snapshot
Summarize the key rules from the three standards files in bullet form. Keep it concise — no more than 10 bullets total. If a project CLAUDE.md was found, append its key directives here.

#### Inbox (Needs Human Decision)
List items from `00-Inbox` for this project. These require human triage before an agent can act. Format:
```
- [priority] Title — created <date>
```

#### Queued Bugs (Ready for Agent Processing)
List items from `01-Bugs`. Include:
- Priority and complexity from frontmatter
- `blocked-by` field if present (flag cross-project dependencies clearly)
- `related` items if any
```
- [priority] [complexity] Title — blocked-by: <item> | related: <items>
```

#### Queued Tasks
List items from `02-Tasks` in the same format as bugs.

#### In-Progress Work
List items from `04-In-Progress`. Include:
- Branch name from `branch` frontmatter field
- Agent assignment from `agent` field
- Status from `status` field
```
- [priority] Title — branch: <branch> | agent: <agent> | status: <status>
```

#### Parked Ideas
List items from `03-Ideas` briefly — just title and tags.

#### Code Repo Structure
If the repo outline was loaded, present the top-level directory structure and key modules. Keep it to ~15 lines maximum. Highlight any modules referenced in the vault items' `module` frontmatter field.

### 5. Closing prompt

End the briefing with an actionable summary:

```
I see X bugs, Y tasks, Z ideas for [project]. The bugs are [complexity]-complexity. Want me to process them, or tackle something else?
```

Where:
- X = count of items in `01-Bugs`
- Y = count of items in `02-Tasks`
- Z = count of items in `03-Ideas`
- complexity = the most common complexity value among the bugs, or "mixed" if they vary

If there are no bugs, adjust: "I see Y tasks and Z ideas for [project]. Want me to start on the highest-priority task?"
If there is nothing at all: "No open items for [project]. Want to create something or check another project?"

## Obsidian CLI Enhancement (optional)

If Obsidian CLI is available (check: `which obsidian`), supplement the briefing with richer search:

```bash
# Search vault for project-specific content beyond what vault-index returns
obsidian search query="<project name>" path="<relevant folder>" format=json limit=10
```

Use this to find references across the vault that may not have the `project` frontmatter set but still mention the project by name. Merge any additional findings into the appropriate briefing section. Fall back to the standard approach above if CLI is not available.
