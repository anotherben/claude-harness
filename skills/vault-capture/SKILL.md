---
name: vault-capture
description: Instant smart-routing capture of bugs, ideas, tasks, and notes into the Obsidian vault without leaving your current work context. Use this skill whenever the user says "log a bug", "capture this", "note this", "vault:", "add a task", "I had an idea", or any variation of wanting to record something for later. Also use when enterprise-debug finds sibling bugs or enterprise-brainstorm surfaces deferred implications. Even if the user doesn't say "vault", if they mention wanting to remember something or track an issue, use this skill.
---

# vault-capture

Quick-capture items into the Obsidian vault with smart routing. Items go to the right queue immediately -- bugs and tasks with enough context go to agent-ready queues, ambiguous items go to the inbox for human triage.

## Vault Path

`/Users/ben/Documents/Product Ideas`

## Step 1: Parse the Input

Extract from the user's message:
- **type**: bug, task, idea, feature, decision, note
- **project**: infer from cwd if not stated (see mapping below)
- **priority**: default `medium` unless stated or obvious (errors/crashes = high, wishes = low)
- **module**: specific area if mentioned
- **description**: the core content
- **blocked-by / related**: if user mentions dependencies on other items

### Project Inference from CWD

| CWD contains | Project |
|---|---|
| `/Users/ben/helpdesk` | helpdesk |
| `/Users/ben/Projects/firearm-systems` | firearm-systems |
| `/Users/ben/Projects/flexible-deposits` | flexible-deposits |
| `/Users/ben/Projects/flexi-addons` | flexi-addons |
| `/Users/ben/Projects/shopify-banners` | shopify-banners |
| `/Users/ben/bundle-deals` | bundle-deals |
| `gundesk` or `gun-desk` | gundesk |
| `cortex` | cortex |
| Otherwise | ask the user or use `general` |

## Step 2: Duplicate Detection

Before creating, search for similar existing items using the vault-index MCP server:

```
mcp__vault-index__search_vault(query="{key terms from description}", project="{project}")
```

Then check if any matches share the same type AND project AND have similar content. If a potential duplicate is found, warn the user:

> "Found a similar item: [filename]. Create anyway, or merge into existing?"

Only block on clear duplicates (same type + project + overlapping key terms). Don't block on vague matches.

## Step 3: Smart Routing

Determine the destination folder based on completeness and type:

| Condition | Folder | Why |
|---|---|---|
| type=bug + has project + has description + has module | `01-Bugs/` | Agent-ready: enough context to plan a fix |
| type=bug + has project + has description (no module) | `01-Bugs/` | Agent-ready: can infer module from description |
| type=task + has project + clear actionable scope | `02-Tasks/` | Agent-ready: clear what needs doing |
| type=idea | `03-Ideas/` | Parked for future consideration |
| type=feature | `00-Inbox/` | Needs design decisions from human |
| type=decision + has context + has chosen + has rationale | `00-Inbox/` | Decision log — always needs human review |
| type=note | `00-Inbox/` | Human review needed |
| Missing project or vague description | `00-Inbox/` | Not enough context for agent |

## Step 4: Assess Complexity (for agent-ready items only)

For items routed to `01-Bugs/` or `02-Tasks/`:

- **low**: Single file fix, isolated module, clear error message, typo, config change
- **medium**: Multi-file within one service, requires understanding of one subsystem
- **high**: Cross-module, schema/migration changes, design decisions, affects multiple services

## Step 5: Write the File

**Filename**: `YYYYMMDD-HHmmss-{type}-{slug}.md` where slug is a kebab-case summary (max 6 words)

**Frontmatter**:
```yaml
---
type: {type}
priority: {priority}
project: {project}
module: {module or empty string}
agent: {human or claude, based on who captured it}
status: open
branch: n/a
created: {ISO 8601 timestamp}
updated: {ISO 8601 timestamp}
complexity: {low|medium|high, only for 01-Bugs/ and 02-Tasks/}
blocked-by: {list or empty}
related: {list or empty}
tags: {list or empty}
---
```

**Decision-specific frontmatter** (add these fields when `type: decision`):
```yaml
---
type: decision
context: "{what problem or situation prompted this decision}"
alternatives:
  - "{alternative A — rejected because reason}"
  - "{alternative B — rejected because reason}"
chosen: "{what was chosen}"
rationale: "{why this was chosen over alternatives}"
tags:
  - decision
  - {domain tags}
---
```

**Decision body template**:
```markdown
## Decision
{what was chosen}

## Context
{what problem or situation prompted this decision}

## Alternatives Considered
{list alternatives with rejection reasons}

## Rationale
{why this approach was chosen}

## Consequences
{what this means going forward — tradeoffs accepted, follow-up work needed}
```

**Body**: The description, written clearly enough for another agent to understand and act on. Include error messages, reproduction steps, or context as available.

Write to the determined folder using the Write tool. Then re-index the vault:

```
mcp__vault-index__index_vault(incremental=true)
```

## Step 6: Confirm

Print a single-line confirmation. Do NOT interrupt current work flow.

Format: `{emoji} {Type} → {folder} | {project}/{module} | complexity: {level} | "{short description}"`

Emoji map: bug=`[BUG]`, task=`[TASK]`, idea=`[IDEA]`, feature=`[FEAT]`, decision=`[DECISION]`, note=`[NOTE]`

Example: `[BUG] → 01-Bugs/ | helpdesk/purchasing | complexity: low | "PO approve fails on spend_approved status"`

If routed to 00-Inbox, add: `(needs your input to triage)`

## Obsidian CLI Enhancement (optional)

If Obsidian CLI is available (check: `which obsidian`), use it instead of the Write tool for file creation:

```bash
obsidian create path="{folder}/{filename}" content="{frontmatter + body}"
```

This ensures Obsidian immediately indexes the new file and updates backlinks/tags without waiting for a vault reload. Fall back to the Write tool if CLI is not available or the command fails.
