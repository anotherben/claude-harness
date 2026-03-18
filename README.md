# claude-harness

**Vibe prompt in, enterprise quality out.**

A governance harness for [Claude Code](https://docs.anthropic.com/en/docs/build-with-claude/claude-code) that enforces planning, TDD, evidence-based verification, independent review, and institutional knowledge capture — through hooks that can't be bypassed.

Now with **Cortex Engine** — a code intelligence MCP server that makes agents 100x faster at understanding your codebase.

```
You: "Add invoice PDF export"

claude-harness enforces:
discover → brainstorm → plan → contract → build → review → verify → compound
    |           |          |        |         |        |         |         |
  learn      design     steps   test spec   TDD    separate   evidence  capture
  codebase   the idea   + files  first      red→    agent     50+ suites learning
                                 green      reviews  passing
```

---

## What's Inside

### Cortex Engine — Code Intelligence MCP

Your AI agent reads a 400-line file. That's ~4,000 tokens. It needed one 15-line function — 150 tokens. **96% waste on every read.**

Cortex Engine indexes your entire codebase into a SQLite store with AST parsing, semantic tags, and a real-time file watcher. Agents query specific symbols instead of reading files.

| | Without Cortex | With Cortex |
|---|---|---|
| **Read a function** | `Read` entire file (4,000 tokens) | `cortex_read_symbol` (150 tokens) |
| **Find a handler** | Grep + read 5 files (~20,000 tokens) | `cortex_find_symbol` (<1ms, 200 tokens) |
| **Check data safety** | Manual code review | `cortex_find_by_tag("unscoped_query")` |
| **After editing** | Manual reindex | Real-time watcher updates in milliseconds |
| **Cross-session memory** | Gone on restart | `cortex_annotate` persists knowledge forever |

**25 MCP tools** across 6 categories — file reading, symbol search, git context, semantic tags, knowledge persistence, and fleet coordination. Full details in [`cortex-engine/README.md`](cortex-engine/README.md).

### Enforcement Hooks — Quality Gates That Can't Be Skipped

Every action Claude takes passes through shell hooks. Exit code 2 = hard block. No exceptions.

| When | What's Enforced |
|------|----------------|
| Edit source file | Tests must exist. Plan must be approved. |
| `git commit` | Fresh test evidence. Lint clean. Matching HEAD. |
| `git merge` | Must read both sides of conflicts. Must test between merges. |
| Invoke review skill | Builder cannot review their own work. |
| Invoke enterprise skill | Pipeline stages cannot be skipped. |

12-26 hooks depending on your tier. All shell scripts, all auditable, all customizable.

### Enterprise Pipeline — 9 Stages from Idea to Shipped

| Stage | Skill | What It Does |
|-------|-------|-------------|
| 1 | `/enterprise-discover` | Learn the codebase — produces stack profile |
| 2 | `/enterprise-brainstorm` | Turn vague ideas into Technical Design Documents |
| 3 | `/enterprise-plan` | Granular steps with exact file paths and code |
| 4 | `/enterprise-contract` | Mechanical spec — every postcondition traceable to a test |
| 5 | `/enterprise-build` | Strict TDD: write test, fail, write code, pass |
| 6 | `/enterprise-review` | Two-stage: spec compliance then code quality |
| 7 | `/enterprise-forge` | Adversarial review with 5 attack lenses |
| 8 | `/enterprise-verify` | Evidence-based verification (7-check sequence) |
| 9 | `/enterprise-compound` | Capture institutional knowledge for future sessions |

Or just run **`/enterprise`** and the orchestrator handles routing.

### Evidence System — Proof, Not Claims

```
run tests → auto-capture JSON evidence → edit source → evidence auto-stales
  → try to commit → hook reads JSON → stale? BLOCKED. Wrong HEAD? BLOCKED.
```

No markdown. No `/tmp` markers. Hooks parse JSON — they can't be fooled by natural language.

---

## Tiers

| | Lite | Standard | Full |
|---|:---:|:---:|:---:|
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
| Prompt refinement (LLM-driven clarity check) | | | * |

---

## Quick Start

```bash
# Clone
git clone https://github.com/anotherben/claude-harness.git ~/claude-harness

# Install into your project
cd your-project
~/claude-harness/install.sh

# The installer:
# 1. Detects your project type (Node, Python, Go, Rust)
# 2. Asks you to choose a tier
# 3. Copies hooks and skills to .claude/
# 4. Generates settings.json
# 5. Updates CLAUDE.md
```

### Add Cortex Engine

```json
// ~/.claude.json → mcpServers
{
  "cortex-engine": {
    "type": "stdio",
    "command": "node",
    "args": ["~/claude-harness/cortex-engine/src/server.js", "/path/to/your/project"]
  }
}
```

---

## What Gets Installed

```
your-project/
└── .claude/
    ├── hooks/              # Shell hooks that enforce quality gates
    ├── skills/             # Claude Code skills for enterprise workflow
    ├── evidence/           # JSON test evidence (auto-populated by hooks)
    ├── enterprise-state/   # Pipeline state machine
    └── settings.json       # Hook wiring
```

## Writing Custom Hooks

Hooks are shell scripts that receive JSON on stdin:

```bash
#!/bin/bash
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | python3 -c "
  import sys,json
  print(json.load(sys.stdin).get('tool_input',{}).get('file_path',''))
")

if [ some_condition ]; then
  echo "BLOCKED: reason"
  exit 2  # hard block — Claude cannot proceed
fi

exit 0  # allow
```

## Requirements

- [Claude Code](https://docs.anthropic.com/en/docs/build-with-claude/claude-code) CLI
- [Obsidian](https://obsidian.md/) (work item tracking + knowledge capture)
- `python3` (hooks use it for JSON parsing)
- `git`
- Your project's test runner and linter
- Node.js 20+ (for Cortex Engine)

## License

MIT
