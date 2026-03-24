---
name: vault-update
description: Move vault items through the lifecycle — close bugs, mark tasks done, block items, promote from inbox, archive completed work. Use when the user says "close that bug", "mark it done", "this is blocked", "archive that", or invokes /vault-update. Also required before enterprise-verify/enterprise-compound (enforced by hook). Handles file moves between vault folders and frontmatter updates.
---

# vault-update

Update the status of a vault item and move it to the correct folder.

Vault path: `/Users/ben/Documents/Product Ideas`
Vault folders: 00-Inbox, 01-Bugs, 02-Tasks, 03-Ideas, 04-In-Progress, 05-Archive
Frontmatter schema: type, priority, project, module, agent, status, branch, complexity, blocked-by, related, tags, created, updated

## Steps

### 1. Find the item

Use `mcp__vault-index__search_vault(query="<search term>")` to find matching items. If the search returns multiple results and the correct item is ambiguous, present the options to the user and ask them to choose before proceeding.

### 2. Read the item (if needed)

Use `mcp__vault-index__get_vault_item(path="<path>")` to read the full item content when you need more context about the item before making changes.

### 3. Apply the frontmatter update

Use the Edit tool on the item's markdown file to update the frontmatter fields. Always set `updated` to the current ISO timestamp (e.g. `2026-03-17T12:00:00Z`).

Update the `status` field and any other relevant fields (e.g. `branch`, `blocked-by`, `complexity`).

Also update coordination frontmatter when ownership changes:
- `owner_family`: `claude` or `codex`
- `owner_instance`: e.g. `claude:<session_id>` or `codex:<agent-id>`
- `branch`, `worktree_path`, `claimed_at`, `completed_at`, `handoff_from`, `handoff_note`

### 4. Call the matching coordination tool

After updating frontmatter, call the vault-index coordination tool that matches the transition:

| Transition    | Coordination tool call                                                                 |
|--------------|----------------------------------------------------------------------------------------|
| **in-progress** | `mcp__vault-index__claim_item(item_id, owner_family="claude", owner_instance="claude:<session_id>", repo_path=<repo>, branch=<branch>, worktree_path=<worktree>)` |
| **done**        | `mcp__vault-index__complete_item(item_id, owner_instance="claude:<session_id>", note=<summary>)` |
| **released/paused** | `mcp__vault-index__release_item(item_id, owner_instance="claude:<session_id>", note=<reason>)` |
| **handoff**    | `mcp__vault-index__reassign_item(item_id, from_owner_instance="claude:<session_id>", to_owner_family=<target>, to_owner_instance=<target_id>, note=<handoff note>)` |

All ownership-changing operations require the caller to be the current owner. If the claim fails, stop and report the error — do not proceed with file moves.

Also update the session context file when claiming:
```bash
echo "item_id=<item_id>" > /tmp/claude-vault-context-${SESSION_ID}
echo "project=<project>" >> /tmp/claude-vault-context-${SESSION_ID}
echo "owner_instance=claude:${SESSION_ID}" >> /tmp/claude-vault-context-${SESSION_ID}
```

### 5. Move the file to the appropriate folder

Based on the new status, determine the target folder:

| New status   | Target folder     | Additional actions                          |
|-------------|-------------------|---------------------------------------------|
| in-progress | `04-In-Progress/` | Set `branch` field if a branch name is provided |
| done        | `05-Archive/`     |                                             |
| wont-do     | `05-Archive/`     |                                             |
| blocked     | *(stays in current folder)* | Add the blocked reason to the body of the note |

For **promoting from inbox** (moving out of `00-Inbox/`):
- Route to `01-Bugs/` if the item type is bug
- Route to `02-Tasks/` if the item type is task
- Set the `complexity` field (low, medium, or high)

### 6. Move the file

To move a file between folders:
1. Write the updated file content to the new path using the Write tool
2. Delete the old file using Bash: `rm "<old path>"`

Do NOT use `mv` -- write then delete to ensure content is correct at the new location before removing the original.

### 7. Refresh the index

Call `mcp__vault-index__index_vault(incremental=true)` to update the vault index after the change.

### 8. Confirm

Print a single confirmation line showing the transition and coordination state:

```
Bug #42 "Login timeout": open (01-Bugs) -> done (05-Archive) | claim: completed by claude:<session_id>
```

### Fail-closed rule

If the live claim update succeeds but the note update fails, repair the note before continuing. If the claim update fails (wrong owner, already claimed), stop and report — do not modify the vault note.
