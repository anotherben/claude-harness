---
name: vault-init
description: Auto-setup skill that configures a new project with the full vault+enterprise ecosystem. Checks and installs Obsidian CLI, plugins, kepano/obsidian-skills, enterprise skills, vault-index MCP, vault folder structure, standards files, project mapping, and cortex-engine indexing. Run this on first entry to any new project directory, or when the user says "init", "setup vault", "bootstrap project", or invokes /vault-init.
---

# vault-init

Full auto-setup for the vault+enterprise ecosystem in a new project. Runs a 12-point checklist, fixing what it can automatically and guiding the user on manual steps.

## Vault Path

`/Users/ben/Documents/Product Ideas`

## Execution Mode

Run all checks in order. For each check:
- **PASS**: Print `[OK] {check name}` and move on
- **FIX**: Fix it automatically, print `[FIXED] {check name} — {what was done}`
- **MANUAL**: Print `[ACTION NEEDED] {check name} — {instruction for user}`
- **SKIP**: Print `[SKIP] {check name} — {reason}` (e.g., CLI not available, non-blocking)

At the end, print a summary showing pass/fix/manual/skip counts.

## The 12-Point Checklist

### 1. Obsidian CLI Registered

Check if the Obsidian CLI is available:

```bash
which obsidian && obsidian help > /dev/null 2>&1
```

- **If found**: PASS
- **If not found**: MANUAL — "Enable Obsidian CLI: Settings → General → Command line interface → Register CLI. Free since v1.12.4."

Note: If CLI is not found, checks 2 and 3 that depend on it should SKIP gracefully. The rest of the checklist continues — CLI is an enhancement, not a hard requirement.

### 2. Obsidian Plugins Installed

**Requires**: Check 1 passed (CLI available)

```bash
obsidian plugins versions
```

Look for `dataview` and `templater` in the output.

- **Both found**: PASS
- **Missing plugins**: MANUAL — "Install missing Obsidian plugins via Settings → Community plugins → Browse: {list missing}"
- **CLI not available**: SKIP — "Install Dataview and Templater plugins manually when convenient"

### 3. kepano/obsidian-skills Installed

Check if obsidian-skills are present in the vault's `.claude/` folder:

```bash
ls "/Users/ben/Documents/Product Ideas/.claude/"
```

Look for these directories/files: `obsidian-markdown`, `obsidian-bases`, `json-canvas`, `obsidian-cli`

- **All present**: PASS
- **Missing**: FIX — Clone from https://github.com/kepano/obsidian-skills and copy the relevant skill folders to `/Users/ben/Documents/Product Ideas/.claude/`. Only copy the 4 skills listed above.

```bash
cd /tmp && git clone --depth 1 https://github.com/kepano/obsidian-skills.git obsidian-skills-repo 2>/dev/null
```

Then copy each skill folder that exists in the repo to the vault `.claude/` directory. The repo structure may vary — look for folders or files matching the skill names and copy them appropriately.

After copying, clean up:
```bash
rm -rf /tmp/obsidian-skills-repo
```

### 4. Enterprise Skills Present

Check for enterprise skills in the user's global skills directory:

```bash
ls ~/.claude/skills/enterprise/SKILL.md
```

- **Found**: PASS
- **Not found**: MANUAL — "Enterprise skills not found at ~/.claude/skills/enterprise/. These need to be installed from your skills snapshot."

Also spot-check a few other expected skills:
- `~/.claude/skills/vault-capture/SKILL.md`
- `~/.claude/skills/vault-status/SKILL.md`
- `~/.claude/skills/vault-context/SKILL.md`

If any vault skills are missing, flag as MANUAL.

### 5. vault-index MCP Registered

Read `~/.claude.json` and check for a `vault-index` entry in `mcpServers`.

- **Found**: PASS
- **Not found**: FIX — Add the vault-index MCP server entry to `~/.claude.json`:

```json
{
  "mcpServers": {
    "vault-index": {
      "command": "node",
      "args": ["/Users/ben/.vault-index/src/server.js"],
      "env": {
        "VAULT_PATH": "/Users/ben/Documents/Product Ideas"
      }
    }
  }
}
```

Merge into existing mcpServers — do NOT overwrite other entries.

### 6. vault-index Database Exists

```bash
ls ~/.vault-index/index.db
```

- **Found**: PASS
- **Not found**: FIX — Run setup:

```bash
cd ~/.vault-index && npm install
```

Then call `mcp__vault-index__index_vault(incremental=false)` to do a full index.

If `~/.vault-index/` doesn't exist at all, flag as MANUAL — "vault-index MCP server not installed. See handover docs."

### 7. Vault Folder Structure

Check that all required folders exist in the vault:

- `00-Inbox/`
- `01-Bugs/`
- `02-Tasks/`
- `03-Ideas/`
- `04-In-Progress/`
- `05-Archive/`
- `_standards/`
- `Projects/`

For each missing folder: FIX — create it with `mkdir`.

### 8. Standards Files

Check for these files in the vault:

- `_standards/coding-standards.md`
- `_standards/tech-stack.md`
- `_standards/security.md`

- **All present**: PASS
- **Missing**: MANUAL — "Standards files missing: {list}. These contain project-wide coding standards and must be written for your stack."

### 9. Project Mapping in vault-capture

Read `~/.claude/skills/vault-capture/SKILL.md` and check if the current project's CWD is present in the project inference table.

Determine the current project from the CWD:
- Look at the current working directory
- Check if it matches any existing mapping in the vault-capture skill

- **Mapped**: PASS
- **Not mapped**: FIX — Add a new row to the project inference table in vault-capture's SKILL.md. Derive the project name from the directory name (e.g., `/Users/ben/Projects/my-app` → `my-app`). Ask the user to confirm the project name before writing.

### 10. Project Folder in Vault

Check if `Projects/<project-name>/` exists in the vault.

- **Exists**: PASS
- **Missing**: FIX — Create the folder and a README.md:

```markdown
# <Project Name>

Project planning and documentation folder.

Created by /vault-init on <date>.
```

### 11. Cortex Engine MCP Registered

Check if cortex-engine is configured as an MCP server:

Read `~/.claude.json` and check for a `cortex-engine` entry in `mcpServers`.

- **Found**: PASS
- **Not found**: FIX — Add cortex-engine MCP entry to `~/.claude.json`:

```json
"cortex-engine": {
  "type": "stdio",
  "command": "node",
  "args": ["/Users/ben/claude-harness/cortex-engine/src/server.js"]
}
```

No project path needed — cortex-engine uses the working directory automatically.

Merge into existing mcpServers — do NOT overwrite other entries.

Also add to Codex if available:
```bash
codex mcp add cortex-engine -- node /Users/ben/claude-harness/cortex-engine/src/server.js
```

If `jcodemunch` is present in `mcpServers`, **remove it** — cortex-engine is the replacement. Delete the entire `jcodemunch` entry from `~/.claude.json`.

Verify the engine works by calling `mcp__cortex-engine__cortex_status()`. If it returns file/symbol counts, the index is live.

### 12. Master Dashboard

Check if `Master Dashboard.md` exists in the vault root and contains Dataview queries that reference the current folder structure (00-Inbox through 05-Archive).

- **Up to date**: PASS
- **Outdated or missing**: FIX — Create or update `Master Dashboard.md` with Dataview queries for all 6 queue folders:

```markdown
# Master Dashboard

## Inbox (Needs Triage)
```dataview
TABLE priority, project, type, created
FROM "00-Inbox"
WHERE status != "done"
SORT priority ASC, created ASC
```

## Bugs (Agent-Ready)
```dataview
TABLE priority, project, module, complexity, created
FROM "01-Bugs"
WHERE status = "open"
SORT priority ASC, created ASC
```

## Tasks (Agent-Ready)
```dataview
TABLE priority, project, module, complexity, created
FROM "02-Tasks"
WHERE status = "open"
SORT priority ASC, created ASC
```

## Ideas (Parked)
```dataview
TABLE priority, project, tags, created
FROM "03-Ideas"
SORT created DESC
```

## In-Progress
```dataview
TABLE priority, project, branch, agent, status, updated
FROM "04-In-Progress"
SORT updated DESC
```

## Recently Archived
```dataview
TABLE priority, project, type, updated
FROM "05-Archive"
SORT updated DESC
LIMIT 10
```
```

## Summary Output

After all 12 checks, print:

```
--- vault-init complete ---
[OK]     {count} checks passed
[FIXED]  {count} items auto-fixed
[ACTION] {count} items need your attention
[SKIP]   {count} items skipped

{If any ACTION items, list them here with instructions}
```

If everything passed: "Your project is fully set up. Run /vault-context {project} to start your session."

## Edge Cases

- **Not in a project directory**: If CWD is `~` or similar non-project path, ask the user which project they want to initialize. Checks 9-11 require a project context.
- **First time ever**: Many checks will FIX or MANUAL. That's expected. Guide the user through the manual items.
- **Re-running**: The skill is idempotent. Running it again on an already-set-up project should show all PASS with no changes.
