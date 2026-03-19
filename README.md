# claude-harness

**Vibe prompt in, enterprise quality out.**

A governance harness for [Claude Code](https://docs.anthropic.com/en/docs/build-with-claude/claude-code) and [Codex CLI](https://github.com/openai/codex) that enforces planning, TDD, evidence-based verification, independent review, and institutional knowledge capture — through hooks that can't be bypassed.

Built-in **Cortex Engine** — a code intelligence MCP server that makes agents 100x faster at understanding any codebase, in any language.

---

## Architecture

```
claude-harness/
├── cortex-engine/        # Code intelligence MCP server (26 tools, real-time index)
├── hooks/                # 29 shell hooks — quality gates that block bad actions
├── skills/               # 30 Claude Code skills — enterprise dev pipeline
├── conductor/            # Fleet orchestration — multi-agent dispatch + merge
├── plugins/              # Domain-specific guard skills (Shopify, REX SOAP, SQL)
├── templates/            # Review lenses, prompt templates
├── tiers/                # Enforcement level configs (lite, standard, full)
├── install.sh            # One-command project setup
└── harness.json          # Harness metadata
```

### How It All Fits Together

```
                    ┌─────────────────────────────┐
                    │       Your Project           │
                    │  (any language, any stack)    │
                    └──────────┬──────────────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
     ┌────────▼──────┐ ┌──────▼───────┐ ┌──────▼──────┐
     │  Cortex Engine │ │   29 Hooks   │ │  30 Skills  │
     │  (MCP server)  │ │ (shell gates)│ │ (workflow)  │
     └────────┬──────┘ └──────┬───────┘ └──────┬──────┘
              │                │                │
              │    ┌───────────┼────────────┐   │
              │    │     Obsidian Vault      │   │
              │    │  (work items, evidence, │   │
              │    │   knowledge, standards) │   │
              │    └────────────────────────┘   │
              │                                 │
              └──────────┬──────────────────────┘
                         │
                ┌────────▼────────┐
                │    Conductor    │
                │ (fleet dispatch │
                │  multi-agent)   │
                └─────────────────┘
```

---

## Cortex Engine

**The Problem:** AI agents waste 96% of tokens reading entire files when they need one function.

**The Solution:** A real-time code intelligence index. Agents query specific symbols instead of reading files. <1ms per query.

| Feature | What It Does |
|---------|-------------|
| **26 MCP tools** | File reading, symbol search, git context, semantic tags, knowledge store, fleet coordination |
| **Real-time watcher** | Index updates in milliseconds after edits — no manual reindex |
| **20 file types** | JS, TS, TSX, JSX, Python, Bash, SQL, CSS, JSON, YAML, GraphQL, Markdown, TOML, XML, HTML, Vue, Svelte, SCSS, LESS + configurable |
| **Nested symbols** | Factory methods, local helpers, inner types, interface members — not just top-level exports |
| **Semantic tags** | `route_handler`, `db_write`, `db_read`, `unscoped_query`, `auth`, `validated` — deterministic, free, configurable |
| **Symbol categories** | `code`, `config`, `docs`, `markup`, `style`, `query` — search filters by type |
| **Import graph** | Who imports this file? Cross-extension resolution (.js→.ts), barrel exports |
| **Git integration** | Blame, hotspots, diff, log — "who changed this and why?" |
| **Knowledge store** | Persistent annotations that survive across sessions — agents learn from each other |
| **Fleet support** | Handover ingestion, learning reports, MCP config generation for worker agents |

### Quick Start

```bash
npm install   # in cortex-engine/
```

**Claude Code** — add to `~/.claude.json`:
```json
{
  "mcpServers": {
    "cortex-engine": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/claude-harness/cortex-engine/src/server.js"]
    }
  }
}
```

**Codex CLI:**
```bash
codex mcp add cortex-engine -- node /path/to/claude-harness/cortex-engine/src/server.js
```

No project path needed — Cortex uses the working directory automatically.

### Dependencies

| Package | Version | Why |
|---------|---------|-----|
| `@modelcontextprotocol/sdk` | ^1.27.1 | MCP protocol (stdio transport) |
| `better-sqlite3` | ^12.8.0 | Embedded DB, WAL mode, synchronous reads |
| `chokidar` | ^3.6.0 | Real-time file watcher (pinned v3 — v5 is ESM-only) |
| `simple-git` | ^3.33.0 | Git blame, log, diff, status |
| `tree-sitter` | ^0.21.1 | AST parsing for JS/TS/TSX (pinned — peer deps) |
| `tree-sitter-javascript` | ^0.21.4 | JS grammar |
| `tree-sitter-typescript` | ^0.23.2 | TS + TSX grammars |
| `jest` | ^30.3.0 | Test runner (dev only, maxWorkers=14 for tree-sitter isolation) |

Full details: [`cortex-engine/README.md`](cortex-engine/README.md)

### Token Savings Telemetry

Every Cortex response includes `_meta` with measured savings:

```
cortex_read_symbol("handlePaymentWebhook")
→ 380 tokens returned (vs 3,300 to read the full file)
→ 2,920 tokens saved (89%), $0.04 saved on Opus per call
```

At scale: 100 symbol reads/session = ~200K tokens saved = $3.00/session on Opus.

Use `cortex_telemetry()` for cumulative stats across the session.

### Benchmarks

Tested on JS and TypeScript repos:

| Metric | Cortex Engine | Traditional |
|--------|:---:|:---:|
| **Query speed** | <1ms | 10-160ms |
| **Token savings per read** | 89% average | 0% |
| **Index freshness** | Real-time watcher | Manual reindex |
| **Semantic tags** | 11 tag types, configurable | None |
| **Knowledge persistence** | Annotations + Obsidian sync | None |
| **Git awareness** | Blame, hotspots, diff, log | None |
| **File types** | 20 | 5-7 |
| **Symbol categories** | 6 (code, config, docs, markup, style, query) | 1 |
| **Import graph** | Cross-extension (.js→.ts), barrel-aware | Basic or none |
| **Nested symbols** | Factory methods, inner types, interface members | Top-level only |
| **Languages (tree-sitter)** | JS, TS, TSX | Varies |
| **Languages (regex)** | Python, Bash, SQL, CSS, JSON, YAML, GraphQL, MD, TOML, XML, HTML, Vue, Svelte | N/A |

---

## Hooks (29 Shell Scripts)

Every action passes through hooks. Exit code 2 = hard block. No exceptions.

### Lifecycle Hooks

| Hook | Trigger | What It Enforces |
|------|---------|-----------------|
| `require-tdd-before-source-edit.sh` | Edit/Write source file | Tests must exist or be staged |
| `require-plan-before-edits.sh` | Edit/Write source file | Plan must be approved first |
| `require-vault-for-edits.sh` | Edit/Write source file | Vault context must be loaded |
| `protect-files.sh` | Edit/Write any file | .env, auth.js, evidence files blocked |
| `require-test-evidence.sh` | git commit | Fresh JSON evidence, matching HEAD |
| `require-lint-clean.sh` | git commit | Linter must pass on staged files |
| `pre-commit-gate.sh` | git commit (3+ files) | Test files or evidence required |
| `require-vault-update.sh` | git commit/push | Vault must be updated for source changes |
| `enforce-merge-protocol.sh` | git merge | Must read both sides of conflicts |
| `pre-merge-test-check.sh` | git merge | Must test between merges |
| `post-merge-test-gate.sh` | After git merge | Flags merge-pending-test state |
| `require-independent-review.sh` | Invoke enterprise-review | Builder cannot review own work |
| `enforce-enterprise-pipeline.sh` | Invoke enterprise-* skill | Pipeline stages cannot be skipped |
| `enforce-vault-context.sh` | Invoke enterprise-* skill | Must run /vault-context first |
| `suggest-cortex.sh` | Read source file >50 lines | Suggests cortex-engine MCP instead |
| `cortex-reindex.sh` | After Edit/Write source file | Notes cortex has real-time watcher |
| `record-test-evidence.sh` | After test commands | Auto-records JSON evidence |
| `invalidate-after-git-op.sh` | After git operations | Auto-marks evidence stale |
| `mark-plan-approved.sh` | After ExitPlanMode | Sets plan-approved marker |
| `mark-skill-invoked.sh` | After Skill invocation | Tracks skill usage |
| `context-inject.sh` | Before Bash commands | Injects relevant context |
| `context-fade.sh` | After any tool use | Manages context window |
| `refine-prompt.sh` | User prompt submit | LLM-driven clarity check |
| `auto-format.sh` | After Edit/Write | Auto-formats changed files |
| `post-compact-handover.sh` | After context compaction | Escalates handover urgency |
| `ensure-environment.sh` | Session start | Validates environment setup |
| `pre-agent-dispatch.sh` | Before agent dispatch | Validates dispatch parameters |
| `post-agent-checklist.sh` | After agent completes | Validates agent output |

### Fleet Hooks (in `hooks/fleet/`)

Multi-agent orchestration hooks for the conductor system.

---

## Skills (30 Claude Code Skills)

### Enterprise Pipeline (9 stages)

The core development workflow — from vague idea to shipped, tested, reviewed code:

```
/enterprise-discover  →  Learn codebase (stack profile)
/enterprise-brainstorm → Design (Technical Design Document)
/enterprise-plan      →  Implementation steps (exact file paths + code)
/enterprise-contract  →  Mechanical spec (every postcondition traceable)
/enterprise-build     →  Strict TDD (RED → GREEN for every postcondition)
/enterprise-review    →  Two-stage review (spec compliance → code quality)
/enterprise-forge     →  Adversarial review (5 attack lenses)
/enterprise-verify    →  Evidence-based verification (7-check sequence)
/enterprise-compound  →  Capture institutional knowledge
```

Or just run **`/enterprise`** — the orchestrator handles routing, mode selection (Solo/Subagent/Swarm), and stage transitions.

### Quick-Start Workflows

| Skill | What It Does |
|-------|-------------|
| `/full-cycle` | Interactive planning → autonomous execution with review checkpoints |
| `/full-cycle-tdd` | TDD-first — every task starts with a failing test |
| `/full-cycle-fast` | Lightweight — analyze, plan, build, verify. No ceremony. |
| `/full-cycle-research` | 8+ parallel research agents before writing any code |

### Vault Management

| Skill | What It Does |
|-------|-------------|
| `/vault-context` | Pre-session project briefing from Obsidian vault |
| `/vault-capture` | Quick-capture bugs, tasks, ideas into the right queue |
| `/vault-update` | Move items through lifecycle (close, block, archive) |
| `/vault-status` | Cross-project dashboard — all queues at a glance |
| `/vault-triage` | Walk through inbox items one-by-one |
| `/vault-sweep` | Weekly accountability — stale items, dead branches |
| `/vault-init` | Bootstrap new project with full vault+enterprise ecosystem |
| `/vault-process` | Autonomous queue processor — picks up and works items |

### Code Quality

| Skill | What It Does |
|-------|-------------|
| `/enterprise-debug` | 4-phase systematic debugging with blast radius scan |
| `/scope-check` | Verify no scope creep before commit |
| `/contract-manager` | Produce mechanical spec before any implementation |
| `/patch-or-fix` | Evaluate if a fix addresses root cause or just patches |
| `/run-verification` | Full verification pipeline (lint, tests, E2E) |

### Architecture & Planning

| Skill | What It Does |
|-------|-------------|
| `/senior-architect` | System design, tech stack decisions, architecture diagrams |
| `/but-why` | Drill down to root causes before acting |
| `/enterprise-harness` | Orchestrator-facing 10-check quality gate |

### Domain Guards (Plugins)

| Skill | What It Does |
|-------|-------------|
| `/sql-guard` | Multi-tenant scoping, parameterized queries, type-safe joins |
| `/shopify-integration` | HMAC verification, idempotency, rate limits, fulfillment state machine |
| `/rex-soap-protocol` | Dual SOAP protocol detection, three-endpoint architecture |
| `/deploy-checklist` | Migrations, env vars, rollback plan |
| `/create-migration` | Numbered SQL migration following project conventions |

### Session Management

| Skill | What It Does |
|-------|-------------|
| `/session-heartbeat` | Progress review, scope drift detection, task switching |
| `/handover-writer` | Save state when approaching context limits |
| `/fleet-commander` | Multi-agent dispatch with model routing and merge coordination |
| `/cortex-index` | Index or reindex current project with cortex-engine |

---

## Tiers

| Feature | Lite | Standard | Full |
|---------|:---:|:---:|:---:|
| Obsidian vault integration | * | * | * |
| TDD enforcement | * | * | * |
| Evidence system (JSON proof, auto-staleness) | * | * | * |
| Lint gate before commit | * | * | * |
| Merge protocol (no blind conflicts) | * | * | * |
| Protected files (.env untouchable) | * | * | * |
| Enterprise pipeline (9-stage skill chain) | * | * | * |
| Plan-before-edits gate | | * | * |
| Independent review (builder != reviewer) | | * | * |
| Context management (injection + fade + handover) | | | * |
| **Cortex Engine** (code intelligence MCP) | | | * |
| Fleet orchestration (multi-agent dispatch) | | | * |
| Prompt refinement (clarity check) | | | * |

---

## Evidence System

The harness doesn't trust claims. It verifies them mechanically.

```
Developer runs tests
       │
       ▼
record-test-evidence.sh captures JSON:
  suite count, pass/fail, git HEAD, test mode, timestamp
       │
       ▼
Writes to .claude/evidence/last-test-run.json
       │
       ▼
Developer edits source file
       │
       ▼
Evidence auto-marked stale (file mod time > evidence time)
       │
       ▼
Developer tries to commit
       │
       ▼
require-test-evidence.sh reads JSON:
  Stale? → BLOCKED
  Wrong HEAD? → BLOCKED
  Not enough suites? → BLOCKED
  All green? → ALLOWED
```

---

## Conductor (Fleet Orchestration)

Dispatch multiple agents working in parallel on isolated worktrees:

```
/fleet-commander → analyze tasks → assign models → create worktrees → dispatch agents
                                                                           │
                                                           ┌───────────────┼───────────────┐
                                                           │               │               │
                                                      Agent 1         Agent 2         Agent 3
                                                      (Opus)         (Sonnet)         (Haiku)
                                                    feat/auth      feat/api        feat/tests
                                                           │               │               │
                                                           └───────────────┼───────────────┘
                                                                           │
                                                                    merge coordinator
```

Each agent gets: isolated git worktree, cortex-engine MCP, vault claim, skill set.

---

## Quick Start

```bash
# Clone
git clone https://github.com/your-org/claude-harness.git ~/claude-harness

# Install cortex-engine
cd ~/claude-harness/cortex-engine && npm install

# Install harness into your project
cd your-project
~/claude-harness/install.sh
```

## Requirements

| Requirement | Why |
|---|---|
| [Claude Code](https://docs.anthropic.com/en/docs/build-with-claude/claude-code) or [Codex CLI](https://github.com/openai/codex) | Host environment |
| [Obsidian](https://obsidian.md/) | Work item tracking + knowledge capture |
| Node.js 20+ | Cortex Engine runtime |
| `python3` | Hooks use it for JSON parsing |
| `git` | Version control, worktrees |
| Your project's test runner + linter | Evidence system hooks into whatever you use |

## License

MIT
