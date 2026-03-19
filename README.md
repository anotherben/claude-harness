# claude-harness

**Vibe prompt in, enterprise quality out.**

A governance harness for [Claude Code](https://docs.anthropic.com/en/docs/build-with-claude/claude-code) and [Codex CLI](https://github.com/openai/codex) that enforces planning, TDD, evidence-based verification, independent review, and institutional knowledge capture — through hooks that can't be bypassed.

Two built-in MCP servers. An Obsidian vault as the shared brain. 30 code intelligence tools. 29 enterprise skills. 30 quality gate hooks. Zero escape hatches.

---

## Why This Exists

AI coding tools are powerful but undisciplined. Left to defaults, they:
- Write code without tests, skip planning, claim "tests pass" without running them
- Review their own work and approve it, commit without tracking what changed
- Read entire files when they need one function, burning tokens and money

**claude-harness** makes it physically impossible to cut corners — and makes agents 100x more efficient at understanding code.

---

## The Three Pillars

### 1. Cortex Engine — Code Intelligence MCP

Your agent reads a 400-line file (3,300 tokens) to find one function (380 tokens). **89% waste.**

Cortex Engine indexes your entire codebase into a real-time SQLite store with AST parsing, semantic tags, and token-savings telemetry. Agents query specific symbols instead of reading files.

```
cortex_outline("src/routes/orders.js")
→ [function] createOrderRoutes      L1-200
    [route] POST /orders             L45-80
    [route] GET /orders/:id          L82-95
    [route] DELETE /orders/:id       L97-120

cortex_read_symbol("src/routes/orders.js", "POST /orders")
→ 380 tokens (vs 3,300 for full file — 89% saved, $0.04 saved on Opus)
```

**30 MCP tools** | **8 tree-sitter languages** (JS, TS, TSX, Python, Go, Rust, Java, C#) | **22 file types** | **7 source categories** | **11 semantic tags** | **333 tests**

[Full Cortex Engine documentation →](cortex-engine/README.md)

### 2. Obsidian Vault — The Shared Brain

Every bug, task, idea, and decision lives in an [Obsidian](https://obsidian.md/) vault. Two MCP servers connect agents to this brain:

**vault-index** — Query engine for the vault:
- `list_vault(project)` — all items for a project, grouped by queue
- `search_vault(query)` — full-text search across all vault items
- `claim_item(id)` — lock a work item so two agents don't collide
- `complete_item(id)` — mark done and archive

**cortex-engine** — Persistent knowledge that compounds:
- `cortex_annotate(target, note, tags)` — annotate any file or symbol
- `cortex_recall(target)` — retrieve annotations (agents learn from each other)
- `cortex_sync_knowledge(vault_path)` — sync annotations to Obsidian as markdown
- Auto-syncs every 5 minutes when `OBSIDIAN_VAULT_PATH` is set

```
Obsidian Vault
├── 00-Inbox/          # Needs human triage
├── 01-Bugs/           # Agent-ready bugs with context
├── 02-Tasks/          # Agent-ready tasks with acceptance criteria
├── 03-Ideas/          # Parked for future consideration
├── 04-In-Progress/    # Claimed by an agent, with branch + status
├── 05-Archive/        # Completed work with audit trail
├── _standards/        # Coding standards, security rules
├── _cortex/           # Auto-synced knowledge annotations
└── Projects/          # Per-project planning docs
```

**The flow:**
```
Human captures idea → vault-capture routes to correct queue
                                    ↓
Agent claims item → vault-index locks it → enterprise pipeline executes
                                    ↓
Agent annotates learnings → cortex knowledge store → syncs to Obsidian
                                    ↓
Next agent reads vault + knowledge → starts with full context
```

### 3. Quality Gate Hooks — Can't Be Bypassed

28 shell hooks intercept every action. Exit code 2 = hard block. The agent cannot proceed until the requirement is met.

```
You: "Just push the fix"

Hook chain:
  ✗ require-tdd-before-source-edit.sh    → "No tests. Write tests first."
  ✗ require-plan-before-edits.sh         → "No plan approved. Create a plan first."
  ✗ require-test-evidence.sh             → "No fresh evidence. Run tests first."
  ✗ require-lint-clean.sh                → "ESLint errors. Fix them first."
  ✗ require-vault-update.sh              → "Vault not updated. Log this work first."
  ✓ All gates pass                       → Commit allowed
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Your Project                          │
│               (any language, any stack)                   │
└──────────────────────┬──────────────────────────────────┘
                       │
         ┌─────────────┼─────────────┐
         │             │             │
┌────────▼──────┐ ┌────▼─────┐ ┌────▼──────┐
│ Cortex Engine │ │ 28 Hooks │ │ 29 Skills │
│  (30 tools)   │ │  (gates) │ │(workflow) │
│  MCP server   │ │  shell   │ │ markdown  │
└────────┬──────┘ └────┬─────┘ └────┬──────┘
         │             │             │
         │    ┌────────┴────────┐    │
         │    │  Obsidian Vault  │    │
         │    │  + vault-index   │    │
         │    │  MCP server      │    │
         │    └─────────────────┘    │
         │                           │
         └──────────┬────────────────┘
                    │
           ┌────────▼────────┐
           │    Conductor    │
           │  Fleet dispatch │
           │  Multi-agent    │
           │  Merge coord    │
           └─────────────────┘
```

```
claude-harness/
├── cortex-engine/        # Code intelligence MCP (30 tools, 8 languages)
├── hooks/                # 30 shell hooks — quality gates
├── skills/               # 29 Claude Code skills — enterprise workflow
├── conductor/            # Fleet orchestration — multi-agent dispatch
├── plugins/              # Domain guards (Shopify, REX SOAP, SQL safety)
├── templates/            # Review lenses, prompt templates
├── tiers/                # Enforcement level configs (lite/standard/full)
└── install.sh            # One-command project setup
```

---

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/your-org/claude-harness.git ~/claude-harness
cd ~/claude-harness/cortex-engine && npm install
```

### 2. Register MCP servers

**Claude Code** — add to `~/.claude.json`:
```json
{
  "mcpServers": {
    "cortex-engine": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/claude-harness/cortex-engine/src/server.js"]
    },
    "vault-index": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/.vault-index/src/server.js"]
    }
  }
}
```

**Codex CLI:**
```bash
codex mcp add cortex-engine -- node ~/claude-harness/cortex-engine/src/server.js
codex mcp add vault-index -- node ~/.vault-index/src/server.js
```

No project path needed — Cortex uses the working directory automatically. For multi-repo: `node src/server.js /path/to/repo1 /path/to/repo2`

### 3. Install harness into your project

```bash
cd your-project
~/claude-harness/install.sh
```

The installer detects your stack, asks you to choose a tier, copies hooks + skills, and wires up `settings.json`.

### 4. Set up Obsidian vault

```bash
# Create vault structure
mkdir -p ~/Documents/YourVault/{00-Inbox,01-Bugs,02-Tasks,03-Ideas,04-In-Progress,05-Archive,_standards,Projects}

# Enable knowledge auto-sync (optional)
export OBSIDIAN_VAULT_PATH=~/Documents/YourVault
```

### 5. Start working

```
You: "Add retry logic to the payment webhook"
Claude: [enterprise pipeline activates → discover → plan → contract → TDD → review → verify]
```

---

## Cortex Engine — 30 MCP Tools

### File & Structure (6 tools)
| Tool | What It Does | Token Savings |
|------|-------------|:---:|
| `cortex_tree` | File tree with path prefix filter and depth | - |
| `cortex_outline` | All symbols in a file — functions, classes, routes, types | ~90% |
| `cortex_read_symbol` | Full source of one function/class/route by name | ~89% |
| `cortex_read_symbols` | Batch read multiple symbols in one call | ~85% |
| `cortex_read_range` | Read specific line range from a file | ~70% |
| `cortex_context` | Symbol + imports + outline in one call | ~80% |

### Search (5 tools)
| Tool | What It Does |
|------|-------------|
| `cortex_find_symbol` | Fuzzy search with word-overlap scoring. "createPO" finds "createPurchaseOrder" |
| `cortex_find_text` | Regex search across all indexed file contents |
| `cortex_find_references` | Find all references to an identifier |
| `cortex_find_importers` | Who imports this file? Cross-extension (.js→.ts), barrel-aware |
| `cortex_find_by_tag` | Find symbols by semantic tag (`db_write`, `unscoped_query`, etc.) |

### Git Context (5 tools)
| Tool | What It Does |
|------|-------------|
| `cortex_git_status` | Branch, uncommitted changes, staged files |
| `cortex_git_diff` | Diff vs branch/commit |
| `cortex_git_blame` | Who last changed each line and why |
| `cortex_git_log` | Recent commits, optionally filtered by file |
| `cortex_git_hotspots` | Files with most edits/bug fixes — churn detection |

### Knowledge Store (5 tools)
| Tool | What It Does |
|------|-------------|
| `cortex_annotate` | Add a persistent note to a file, symbol, or pattern |
| `cortex_recall` | Get all annotations for a file or symbol |
| `cortex_patterns` | Get pattern annotations for a directory |
| `cortex_lessons` | Get lessons learned, filterable by tag |
| `cortex_sync_knowledge` | Sync all annotations to Obsidian vault as markdown |

### Fleet & Multi-Repo (5 tools)
| Tool | What It Does |
|------|-------------|
| `cortex_ingest_handover` | Extract lessons from agent handovers |
| `cortex_learning_report` | Fleet-wide report: what did all agents learn? |
| `cortex_fleet_mcp_config` | MCP config template for dispatching workers |
| `cortex_add_repo` | Dynamically add another repo at runtime |
| `cortex_list_repos` | All indexed repos with file/symbol counts |

### Admin (4 tools)
| Tool | What It Does |
|------|-------------|
| `cortex_status` | Index health — file count, symbol count, staleness |
| `cortex_reindex` | Force reindex of specific file or all files |
| `cortex_telemetry` | Cumulative token savings: queries, tokens saved, cost avoided |
| `cortex_diagnostic` | 7-check health report for index validation |

### Semantic Tags (configurable)
| Tag | Detects | Example |
|-----|---------|---------|
| `db_read` | SELECT queries (pool, prisma, knex, drizzle) | `prisma.user.findMany()` |
| `db_write` | INSERT/UPDATE/DELETE (any ORM) | `prisma.user.create()` |
| `tenant_scoped` | Query includes tenant_id | Multi-tenant safe |
| `unscoped_query` | DB query WITHOUT tenant_id | **Security risk** |
| `route_handler` | Express router + decorator routes | `router.post()`, `@Post()` |
| `auth` | Authentication decorators/middleware | `@Auth()`, `requireAuth` |
| `validated` | Input validation | `@Body()`, `schema.parse()` |
| `async` | Async functions | `async function` |
| `error_handler` | Has try/catch | Error handling present |
| `no_error_handling` | DB/API call without try/catch | Missing error handling |
| `exported` | In module.exports or export | Public API |

Custom tags via `cortex.config.js`:
```js
module.exports = {
  tagRules: {
    customRules: [
      { tag: 'stripe_api', pattern: /stripe\./ },
      { tag: 'cache_hit', pattern: /redis\.get|cache\.get/ },
    ],
  },
};
```

### Symbol Categories
| Category | File Types | Default Search |
|----------|-----------|:-:|
| `code` | .ts, .tsx, .js, .jsx, .py, .go, .rs, .java, .cs, .sh | Yes |
| `test` | *.test.*, *.spec.*, __tests__/, __mocks__/ | No |
| `query` | .sql, .graphql | Yes |
| `config` | .json, .yaml, .toml | No |
| `docs` | .md | No |
| `markup` | .html, .xml, .vue, .svelte | No |
| `style` | .css, .scss, .less | No |

Search all: `cortex_find_symbol("auth", source_types=["code","test","config","docs","markup","style","query"])`

### Token Savings Telemetry

Every response includes `_meta`:
```json
{
  "_meta": {
    "timing_ms": 0.42,
    "tokens_saved": 2933,
    "cost_avoided": {
      "claude_opus_4_6": 0.044,
      "claude_sonnet_4_6": 0.009,
      "claude_haiku_4_5": 0.002
    }
  }
}
```

At scale: 100 reads/session = ~200K tokens saved = **$3/session on Opus**.

---

## Skills — 29 Enterprise Workflows

### The Enterprise Pipeline (9 stages + auto-bootstrap)

Every `/enterprise` invocation first runs a **HARNESS CHECK** — verifies hooks, settings, evidence dir, Cortex MCP, and Vault MCP are all installed. If anything is missing, it auto-runs `/harness-init` + `/vault-init` before proceeding. No more silent advisory-only mode in new repos.

```
/enterprise-discover  →  Learn codebase (stack profile, traps, best practices)
/enterprise-brainstorm → Design (Technical Design Document)
/enterprise-plan      →  Steps (exact file paths, exact code, exact test commands)
/enterprise-contract  →  Spec (every postcondition traceable to a test + code line)
/enterprise-build     →  TDD (write test, fail, write code, pass — for every postcondition)
/enterprise-review    →  Review (spec compliance → code quality, separate concerns)
/enterprise-forge     →  Adversarial (5 attack lenses, bugs recycle to contract)
/enterprise-verify    →  Evidence (7-check sequence, fresh test output or don't claim done)
/enterprise-compound  →  Capture (institutional knowledge → searchable, tagged, persistent)
```

Run **`/enterprise`** to orchestrate the full pipeline with automatic mode selection (Solo/Subagent/Swarm).

### Quick-Start Workflows
| Skill | What | When |
|-------|------|------|
| `/full-cycle` | Interactive plan → autonomous execution + review | Features, bug fixes |
| `/full-cycle-tdd` | TDD-first — every task starts with a failing test | Correctness-critical |
| `/full-cycle-fast` | Lightweight — analyze, plan, build, verify | Small features, config |
| `/full-cycle-research` | 8+ research agents before any code | New territory |

### Vault Management
| Skill | What |
|-------|------|
| `/vault-context` | Pre-session briefing from vault — loads items, code structure, standards |
| `/vault-capture` | Quick-capture bugs, tasks, ideas to the right queue |
| `/vault-update` | Move items through lifecycle — close, block, archive |
| `/vault-status` | Cross-project dashboard — all queues at a glance |
| `/vault-triage` | Walk through inbox items one-by-one |
| `/vault-sweep` | Weekly accountability — stale items, dead branches |
| `/vault-init` | Bootstrap new project with full ecosystem |
| `/vault-process` | Autonomous queue processor — picks up and works items |

### Code Quality
| Skill | What |
|-------|------|
| `/enterprise-debug` | 4-phase systematic debugging with blast radius scan |
| `/scope-check` | Verify no scope creep before commit |
| `/contract-manager` | Mechanical spec before any implementation |
| `/patch-or-fix` | Is this a root cause fix or just a patch? |
| `/run-verification` | Full verification pipeline |

### Architecture & Analysis
| Skill | What |
|-------|------|
| `/senior-architect` | System design, tech decisions, architecture diagrams |
| `/but-why` | Drill to root causes before acting |
| `/enterprise-harness` | 10-check quality gate before merge |

### Session Management
| Skill | What |
|-------|------|
| `/session-heartbeat` | Progress review, scope drift detection |
| `/handover-writer` | Save state when context is getting full |
| `/fleet-commander` | Multi-agent dispatch with model routing |
| `/conductor-resume` | Resume a fleet dispatch from checkpoint |

### Domain Guards (Plugins)
| Plugin | What It Guards |
|--------|---------------|
| `/sql-guard` | Multi-tenant scoping, parameterized queries, type-safe joins |
| `/shopify-integration` | HMAC verification, idempotency, rate limits, fulfillment state machine |
| `/rex-soap-protocol` | Dual SOAP protocol detection, three-endpoint architecture |
| `/deploy-checklist` | Migrations, env vars, rollback plan |
| `/create-migration` | Numbered SQL migration following conventions |

---

## Hooks — 30 Quality Gates

### Source File Protection
| Hook | When | Enforces |
|------|------|----------|
| `require-tdd-before-source-edit.sh` | Edit/Write source | Tests must exist or be staged |
| `require-plan-before-edits.sh` | Edit/Write source | Plan must be approved |
| `require-vault-for-edits.sh` | Edit/Write source | Vault context loaded |
| `protect-files.sh` | Edit/Write any | .env, auth.js, evidence files blocked |
| `suggest-cortex.sh` | Read source >50 lines | Use cortex-engine, not raw Read |

### Git Commit Gates
| Hook | When | Enforces |
|------|------|----------|
| `require-test-evidence.sh` | git commit | Fresh JSON evidence matching HEAD |
| `require-lint-clean.sh` | git commit | Linter passes on staged files |
| `pre-commit-gate.sh` | git commit (3+ files) | Test files or evidence required |
| `require-vault-update.sh` | git commit/push | Vault updated for source changes |
| `validate-test-relevance.sh` | git commit | Tests must reference changed source symbols |
| `validate-test-quality.sh` | git commit | No tautological tests (`expect(true)`), no empty test bodies, no placeholder names |

### Git Merge Gates
| Hook | When | Enforces |
|------|------|----------|
| `enforce-merge-protocol.sh` | git merge | Must read both sides of conflicts |
| `pre-merge-test-check.sh` | git merge | Must test between merges |
| `post-merge-test-gate.sh` | After merge | Flags merge-pending-test state |

### Pipeline Enforcement
| Hook | When | Enforces |
|------|------|----------|
| `enforce-enterprise-pipeline.sh` | Invoke enterprise-* | Stages cannot be skipped |
| `enforce-vault-context.sh` | Invoke enterprise-* | Must load vault context first |
| `require-independent-review.sh` | Invoke enterprise-review | Builder cannot review own work |

### Automation
| Hook | When | What |
|------|------|------|
| `record-test-evidence.sh` | After test commands | Auto-records JSON evidence |
| `invalidate-after-git-op.sh` | After git operations | Auto-marks evidence stale |
| `mark-plan-approved.sh` | After ExitPlanMode | Unlocks source edits |
| `mark-skill-invoked.sh` | After Skill | Tracks skill usage |
| `cortex-reindex.sh` | After Edit/Write source | Notes cortex has real-time watcher |
| `auto-format.sh` | After Edit/Write | Auto-formats changed files |
| `context-inject.sh` | Before Bash commands | Injects relevant context |
| `context-fade.sh` | After any tool use | Manages context window |
| `refine-prompt.sh` | User prompt submit | LLM-driven clarity check |
| `post-compact-handover.sh` | After compaction | Escalates handover urgency |
| `ensure-environment.sh` | Session start | Validates environment |
| `pre-agent-dispatch.sh` | Before agent dispatch | Validates parameters |
| `post-agent-checklist.sh` | After agent completes | Validates output |

---

## Tiers

Choose your enforcement level:

| Feature | Lite | Standard | Full |
|---------|:---:|:---:|:---:|
| Obsidian vault integration | * | * | * |
| TDD enforcement | * | * | * |
| Evidence system (JSON proof, auto-staleness) | * | * | * |
| Lint gate before commit | * | * | * |
| Merge protocol (no blind conflicts) | * | * | * |
| Protected files | * | * | * |
| Enterprise pipeline (9-stage skill chain) | * | * | * |
| Plan-before-edits gate | | * | * |
| Independent review (builder != reviewer) | | * | * |
| Context management (inject + fade + handover) | | | * |
| **Cortex Engine** (30 tools, 8 languages) | | | * |
| Fleet orchestration (multi-agent dispatch) | | | * |
| Prompt refinement (clarity check) | | | * |

---

## E2E Use Case: "Add retry logic to the payment webhook"

```
Step 1 — Agent loads context
  /vault-context payment-service
  → 2 bugs, 3 tasks, 1 idea. "Payment webhook times out on slow networks."

Step 2 — Agent finds the code
  cortex_find_symbol("payment webhook")
  → 3 results, <1ms, 200 tokens (vs grep + read 8 files = 26,000 tokens)

Step 3 — Agent reads the handler
  cortex_read_symbol("handlePaymentWebhook")
  → 380 tokens (vs 3,300 for full file — 89% saved)

Step 4 — Agent checks blast radius
  cortex_find_importers("webhooks/payment.js")
  → 2 files, 150 tokens (vs grep + read = 15,000 tokens)

Step 5 — Agent checks for patterns
  cortex_find_by_tag("error_handler")
  → 12 symbols with existing retry patterns

Step 6 — Agent checks git history
  cortex_git_hotspots()
  → payment.js: 14 edits in 30 days — churn flag

Step 7 — Enterprise pipeline runs
  contract → TDD (RED→GREEN) → independent review → verify → commit

Step 8 — Agent captures knowledge
  cortex_annotate("webhooks/payment.js", "Added 3-retry with exponential backoff")
  → Syncs to Obsidian at _cortex/webhooks/payment.js.md

Step 9 — Next agent benefits
  cortex_recall("webhooks/payment.js")
  → "Added 3-retry with exponential backoff" — instant context

Total tokens: ~1,930 (vs ~57,300 without Cortex) — 97% reduction, $0.83 saved per feature on Opus
```

---

## Conductor — Fleet Orchestration

Dispatch multiple agents on isolated worktrees:

```
/fleet-commander
→ Analyze tasks → assign models → create worktrees → dispatch

  Agent 1 (Opus)     Agent 2 (Sonnet)    Agent 3 (Haiku)
  feat/auth          feat/api            feat/tests
       │                  │                   │
       └──────────────────┼───────────────────┘
                          │
                   Merge coordinator
```

Each agent gets: isolated worktree, cortex-engine MCP, vault claim, full skill set, knowledge store access.

```bash
# Fleet scripts
conductor/dispatch.sh   # Launch agents with model routing
conductor/collect.sh    # Gather results from all agents
conductor/persist.sh    # Save fleet state for resume
conductor/resume.sh     # Resume interrupted fleet
```

---

## Evidence System

The harness doesn't trust claims. It verifies them mechanically.

```
run tests
   │
   ▼
record-test-evidence.sh → .claude/evidence/last-test-run.json
   {suite_count, pass_count, git_head, mode, timestamp}
   │
   ▼
edit source file
   │
   ▼
evidence auto-staled (file mtime > evidence time)
   │
   ▼
try to commit
   │
   ▼
require-test-evidence.sh reads JSON:
   Stale? → BLOCKED
   Wrong HEAD? → BLOCKED
   Not enough suites? → BLOCKED
   ✓ All green → ALLOWED
```

---

## Requirements

| Requirement | Why |
|---|---|
| [Claude Code](https://docs.anthropic.com/en/docs/build-with-claude/claude-code) or [Codex CLI](https://github.com/openai/codex) | Host environment |
| Node.js 20+ | Cortex Engine |
| [Obsidian](https://obsidian.md/) | Shared brain — work items, knowledge, standards |
| `python3` | Hooks use it for JSON parsing |
| `git` | Version control, worktrees |
| Your project's test runner + linter | Evidence system hooks into whatever you use |

---

## Stats

| Component | Count |
|-----------|-------|
| MCP tools (Cortex Engine) | 30 |
| Skills (enterprise workflows) | 29 |
| Hooks (quality gates) | 30 |
| Tree-sitter languages | 8 |
| File types indexed | 22 |
| Source categories | 7 |
| Semantic tags | 11 |
| Tests | 333 |
| Tiers | 3 |
| Domain guard plugins | 3 |

## License

MIT
