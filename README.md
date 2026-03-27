# claude-harness

**Vibe prompt in, enterprise quality out.**

A governance harness for [Claude Code](https://docs.anthropic.com/en/docs/build-with-claude/claude-code) and [Codex CLI](https://github.com/openai/codex) that enforces planning, TDD, evidence-based verification, independent review, and institutional knowledge capture — through hooks that can't be bypassed.

**Current release:** `v2.1.0`

> **v2.1.0 — `claude-unlock` 2FA elevation + zero-friction `/enterprise`.** Protected infrastructure (hooks, settings, evidence) now requires a one-time 6-digit code from `claude-unlock` before agents can write to them. The `/enterprise` orchestrator auto-handles vault context and capture — just run `/enterprise` and the full pipeline executes start to finish. Resume by running `/enterprise` again.

Three built-in MCP servers. An Obsidian vault as the shared brain. 57 MCP tools across code, vault, and skill retrieval. 64 enterprise skills. 45 quality gate hooks. 11 slash commands. Zero escape hatches.

---

## What's New in v2.0.0

### Global-First Architecture
- **Before (v1.x):** Hooks and skills were copied into each project's `.claude/` directory. They drifted out of sync, and agents exploited stale copies that lacked newer security gates.
- **After (v2.0):** Everything installs to `~/.claude/` once. All projects share the same hooks and skills. Updates apply everywhere instantly. Per-project setup only creates `.mcp.json` and `CLAUDE.md`.

### Anti-Bypass Protections
| Attack Vector | Protection |
|---|---|
| Agent `touch`es plan-approval marker | HMAC-signed markers — unsigned markers rejected |
| Agent `touch`es vault-context marker | HMAC-signed markers — unsigned markers rejected |
| Agent writes source files via Bash scripts | `audit-bash-file-writes.sh` detects and reverts |
| Agent `echo`s fake test summary to inflate counts | Output parser strips non-ANSI lines, uses last match |
| Agent hand-writes evidence JSON | HMAC integrity signature on evidence files |
| Agent `cp`/`sed -i` to modify hooks | `block-bash-file-writes.sh` blocks write verbs on protected paths |
| Agent uses Edit/Write on hooks or settings | `protect-files.sh` blocks unless `claude-unlock` code provided |
| Agent reads hook source to find exploit patterns | HMAC salts are in the hooks themselves — forging requires the agent to deliberately commit fraud visible in the session transcript |

### `claude-unlock` — 2FA for Infrastructure Edits

When the agent legitimately needs to modify protected files (hook updates, settings changes), the user provides a one-time elevation code:

```bash
$ claude-unlock

  Elevation code: 847291
  Expires: 10 minutes
  Single use — burned after one write operation
```

The agent includes `ELEVATE=847291` in its command or edit. The hook verifies the code, allows the write, and burns the code. Marker forgery (`/tmp/claude-plan-approved-*`) is **never elevatable** — no code can unlock it.

Install: `cp ~/claude-harness/hooks/claude-unlock.sh /usr/local/bin/claude-unlock`

### Updated Counts
| Component | v1.9.0 | v2.0.0 |
|---|---|---|
| Hooks | 37 | 44 |
| Skills | 42 | 64 |
| Commands | 0 | 11 |
| Install modes | 1 (per-project) | 4 (full, global, project, update) |

---

## Why This Exists

AI coding tools are powerful but undisciplined. Left to defaults, they:
- Write code without tests, skip planning, claim "tests pass" without running them
- Review their own work and approve it, commit without tracking what changed
- Read entire files when they need one function, burning tokens and money
- Route around enforcement hooks by writing source files via Bash scripts instead of Edit/Write tools
- Forge gate markers by `touch`ing files that hooks check for existence

**claude-harness** makes it physically impossible to cut corners.

---

## The Four Pillars

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

### 2. Skills Index — Token-Optimized Skill Retrieval

**skills-index** indexes skills and policy notes into typed markdown sections so agents can:
- search skills without injecting the full catalog
- read only `Workflow`, `Checklist`, or `Template` sections
- compile fast local policy bundles for hook decisions
- track token savings from section reads and blocked full-file reads

**7 MCP tools** | section-level retrieval | compiled policy bundles | telemetry-aware

### 3. Obsidian Vault — The Shared Brain

Every bug, task, idea, and decision lives in an [Obsidian](https://obsidian.md/) vault. Two MCP servers connect agents to this brain:

**vault-index** — Query engine (20 MCP tools): list, search, claim, complete, coordinate
**cortex-engine** — Knowledge store: annotate, recall, sync to Obsidian

```
Human captures idea → vault-capture routes to correct queue
                                ↓
Agent claims item → vault-index locks it → enterprise pipeline executes
                                ↓
Agent annotates learnings → cortex knowledge store → syncs to Obsidian
                                ↓
Next agent reads vault + knowledge → starts with full context
```

### 4. Quality Gate Hooks — Can't Be Bypassed

44 shell hooks intercept every action. Exit code 2 = hard block. The agent cannot proceed until the requirement is met. Markers are HMAC-signed — agents cannot forge them.

```
You: "Just push the fix"

Hook chain:
  ✗ block-bash-file-writes.sh          → "Write detected — use Edit/Write tools"
  ✗ require-vault-for-edits.sh         → "No HMAC-signed vault context"
  ✗ require-plan-before-edits.sh       → "No HMAC-signed plan approval"
  ✗ require-tdd-before-source-edit.sh  → "No tests. Write tests first."
  ✗ require-test-evidence.sh           → "No fresh HMAC-signed evidence"
  ✗ require-lint-clean.sh              → "ESLint errors. Fix them first."
  ✗ require-vault-update.sh            → "Vault not updated. Log this work first."
  ✓ All gates pass                     → Commit allowed
```

---

## Architecture

```
~/.claude/                              # GLOBAL — single source of truth
├── hooks/          44 shell scripts    # Quality gates (HMAC-signed markers)
├── skills/         64 skill dirs       # Enterprise workflows
├── commands/       11 slash commands   # Quick actions
└── settings.json                       # Hook wiring → $HOME/.claude/hooks/

~/claude-harness/                       # SOURCE REPO
├── cortex-engine/  Code intelligence MCP (30 tools, 8 languages)
├── skills-index/   Skill retrieval MCP (7 tools, section-aware)
├── vault-index/    Vault query MCP (20 tools, claim coordination)
├── hooks/          Source of truth for hooks
├── skills/         Source of truth for skills
├── commands/       Source of truth for commands
├── conductor/      Fleet dispatch scripts
├── templates/      Review lenses
├── tiers/          Enforcement configs (lite/standard/full)
└── install.sh      Global + project installer

your-project/                           # PER-PROJECT — minimal footprint
├── .mcp.json       MCP server registration (cortex, vault, skills)
├── CLAUDE.md       Enforcement chain docs
└── .claude/
    └── evidence/   Test evidence JSON (HMAC-signed)
```

---

## Quick Start

### 1. Clone and install globally

```bash
git clone https://github.com/<your-org>/claude-harness.git ~/claude-harness
cd ~/claude-harness && ./install.sh --global
```

This installs hooks, skills, commands, and settings to `~/.claude/`, and sets up the three MCP servers.

### 2. Set up a project

```bash
cd your-project
~/claude-harness/install.sh --project .
```

This creates `.mcp.json` (MCP server registration) and appends the enforcement section to `CLAUDE.md`. No hooks or skills are copied — they're global.

### 3. Update everything

```bash
cd ~/claude-harness && git pull && ./install.sh --update
```

All projects pick up the update immediately.

### 4. Register MCP servers (manual alternative)

**Claude Code** — add to your project's `.mcp.json`:
```json
{
  "mcpServers": {
    "cortex-engine": {
      "type": "stdio",
      "command": "node",
      "args": ["/Users/you/claude-harness/cortex-engine/src/server.js"]
    },
    "skills-index": {
      "type": "stdio",
      "command": "node",
      "args": ["/Users/you/claude-harness/skills-index/src/server.js"]
    },
    "vault-index": {
      "type": "stdio",
      "command": "node",
      "args": ["/Users/you/.vault-index/src/server.js"]
    }
  }
}
```

**Codex CLI:**
```bash
codex mcp add cortex-engine -- node ~/claude-harness/cortex-engine/src/server.js
codex mcp add skills-index -- node ~/claude-harness/skills-index/src/server.js
codex mcp add vault-index -- node ~/.vault-index/src/server.js
```

### 5. Set up Obsidian vault

```bash
mkdir -p ~/Documents/YourVault/{00-Inbox,01-Bugs,02-Tasks,03-Ideas,04-In-Progress,05-Archive,_standards,Projects}
export OBSIDIAN_VAULT_PATH=~/Documents/YourVault
```

### 6. Start working

```
You: "Add retry logic to the payment webhook"
Claude: [enterprise pipeline activates → discover → plan → contract → TDD → review → verify]
```

---

## Skills — 64 Enterprise Workflows

### The Enterprise Pipeline (9 stages + auto-bootstrap)

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

Run **`/enterprise`** to orchestrate the full pipeline.

### Full-Cycle Variants
| Skill | Focus |
|-------|-------|
| `/full-cycle` | Complete structured workflow (Agent Harness + Superpowers + Compound) |
| `/full-cycle-tdd` | TDD-first — every task starts with a failing test |
| `/full-cycle-research` | Research-heavy — 8+ parallel research agents before code |
| `/full-cycle-fast` | Lightweight — minimal ceremony for small changes |

### Vault Management
| Skill | What |
|-------|------|
| `/vault-context` | Pre-session briefing from vault |
| `/vault-capture` | Quick-capture bugs, tasks, ideas |
| `/vault-update` | Move items through lifecycle |
| `/vault-status` | Cross-project dashboard |
| `/vault-triage` | Walk through inbox items |
| `/vault-sweep` | Weekly accountability check |
| `/vault-init` | Bootstrap new project |
| `/vault-process` | Autonomous queue processor |

### Code Quality
| Skill | What |
|-------|------|
| `/enterprise-debug` | 4-phase systematic debugging with blast radius scan |
| `/scope-check` | Verify no scope creep before commit |
| `/contract-manager` | Mechanical spec before any implementation |
| `/patch-or-fix` | Root cause fix or just a patch? |
| `/run-verification` | Full verification pipeline |
| `/plan-360-audit` | Review plans before passing a planning gate |

### Deep Debug Variants
| Skill | What |
|-------|------|
| `/b-deep-debug` | 5 Whys root-cause analysis (read-only, never changes code) |
| `/b-deep-debug-api` | API endpoint crashes and frontend display bugs |
| `/b-deep-debug-sync` | Data sync bugs (REX SOAP, Shopify, pipeline) |
| `/b-deep-debug-concurrency` | Race conditions, duplicate processing, idempotency |

### Fleet & Multi-Agent
| Skill | What |
|-------|------|
| `/fleet-commander` | Multi-orchestrator dispatch with model routing |
| `/conductor-resume` | Resume interrupted fleet from checkpoint |

### Architecture & Analysis
| Skill | What |
|-------|------|
| `/senior-architect` | System design, tech decisions |
| `/but-why` | Drill to root causes before acting |
| `/enterprise-harness` | 10-check quality gate before merge |

### Session & Productivity
| Skill | What |
|-------|------|
| `/session-heartbeat` | Progress review, scope drift detection |
| `/handover-writer` | Save state when context is getting full |
| `/morning-briefing` | Start-of-day briefing across all life domains |
| `/brain-dump` | Stream-of-consciousness capture for ADHD minds |
| `/park` | Guilt-free shelving with optional reminder date |

### Domain Guards
| Skill | What It Guards |
|-------|---------------|
| `/sql-guard` | Multi-tenant scoping, parameterized queries |
| `/shopify-integration` | HMAC verification, idempotency, rate limits |
| `/rex-soap-protocol` | Dual SOAP protocol detection |
| `/integration-guard` | Pre-code checklist for any external integration |
| `/sync-worker` | Atomic queue claims, checkpoint persistence |
| `/deploy-checklist` | Migrations, env vars, rollback plan |
| `/create-migration` | Numbered SQL migration following conventions |

### Setup & Maintenance
| Skill | What |
|-------|------|
| `/harness-init` | Install harness into a new project |
| `/harness-update` | Pull latest from harness repo |
| `/cortex-index` | Index or reindex with cortex-engine |
| `/worktree-cleanup` | Clean stale git worktrees |
| `/prompt-intelligence` | Load learned behaviors at session start |

---

## Hooks — 44 Quality Gates

### Infrastructure Protection (v2.0 — new)
| Hook | When | Enforces |
|------|------|----------|
| `block-bash-file-writes.sh` | Before Bash | Blocks write verbs targeting hooks, settings, evidence, markers |
| `audit-bash-file-writes.sh` | After Bash | Detects + reverts source files modified via Bash (bypasses Edit hooks) |
| `protect-files.sh` | Edit/Write | Blocks .env, .git/hooks/, .claude/hooks/, settings.json, evidence |

### Source File Protection
| Hook | When | Enforces |
|------|------|----------|
| `require-tdd-before-source-edit.sh` | Edit/Write source | Tests must exist or be staged |
| `require-plan-before-edits.sh` | Edit/Write source | HMAC-signed plan approval required |
| `require-vault-for-edits.sh` | Edit/Write source | HMAC-signed vault context required |
| `suggest-cortex-engine.sh` | Read source >50 lines | Use cortex-engine, not raw Read |

### Git Commit Gates
| Hook | When | Enforces |
|------|------|----------|
| `require-test-evidence.sh` | git commit | HMAC-signed evidence, fresh, matching HEAD |
| `require-lint-clean.sh` | git commit | Linter passes on staged files |
| `pre-commit-gate.sh` | git commit | Test files or evidence required |
| `require-vault-update.sh` | git commit/push | Vault updated for source changes |

### Pipeline Enforcement
| Hook | When | Enforces |
|------|------|----------|
| `enforce-enterprise-pipeline.sh` | Invoke enterprise-* | Stages cannot be skipped |
| `enforce-vault-context.sh` | Invoke enterprise-* | Must load vault context first |
| `require-independent-review.sh` | Invoke enterprise-review | Builder cannot review own work |

### Marker & Evidence Integrity (v2.0 — new)
| Hook | When | What |
|------|------|------|
| `mark-plan-approved.sh` | ExitPlanMode | HMAC-signed plan marker (unsigned `touch` rejected) |
| `record-test-evidence.sh` | After tests | HMAC-signed evidence, vitest + jest parsing, anti-echo-injection |
| `invalidate-after-git-op.sh` | After git ops | Auto-marks evidence stale |

---

## Evidence System

The harness doesn't trust claims. It verifies them mechanically.

```
run tests
   │
   ▼
record-test-evidence.sh → .claude/evidence/last-test-run.json
   { HMAC-signed, suite_count, pass_count, git_head, mode, tier }
   │
   ▼
edit source file → evidence auto-staled
   │
   ▼
try to commit
   │
   ▼
require-test-evidence.sh reads JSON:
   HMAC invalid? → BLOCKED (tampered or hand-written)
   Stale? → BLOCKED
   Wrong HEAD? → BLOCKED
   Not enough suites? → BLOCKED
   Output missing framework markers? → BLOCKED
   ✓ All green → ALLOWED
```

---

## Requirements

| Requirement | Why |
|---|---|
| [Claude Code](https://docs.anthropic.com/en/docs/build-with-claude/claude-code) or [Codex CLI](https://github.com/openai/codex) | Host environment |
| Node.js 20+ | MCP servers |
| [Obsidian](https://obsidian.md/) | Shared brain |
| `python3` | Hooks use it for JSON parsing |
| `git` | Version control |

---

## Stats

| Component | Count |
|-----------|-------|
| MCP servers | 3 (cortex-engine + skills-index + vault-index) |
| MCP tools | 57 (30 + 7 + 20) |
| Skills | 64 |
| Hooks | 44 |
| Slash commands | 11 |
| Tree-sitter languages | 8 |
| Install modes | 4 (full, global, project, update) |
| Anti-bypass protections | 8 |

## License

MIT
