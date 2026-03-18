# claude-harness

**Vibe prompt in, enterprise quality out.**

A governance harness for [Claude Code](https://docs.anthropic.com/en/docs/build-with-claude/claude-code) that enforces planning, TDD, evidence-based verification, independent review, and institutional knowledge capture — through hooks that can't be bypassed.

## The Problem

AI coding tools are powerful but undisciplined. Left to their defaults, they will:

- Write code without tests
- Skip planning and jump straight to implementation
- Claim "tests pass" without running them
- Review their own work and approve it
- Commit without tracking what changed or why
- Fix symptoms instead of root causes

## The Solution

`claude-harness` installs a system of shell hooks and skills into your Claude Code project that make it **physically impossible** to cut corners. Every hook exits with code 2 (hard block) — Claude cannot proceed until the requirement is met.

```
You: "Add invoice PDF export"

claude-harness enforces:
discover → brainstorm → plan → contract → build → review → verify → compound
    ↑           ↑          ↑        ↑         ↑        ↑         ↑         ↑
    │           │          │        │         │        │         │         │
  learn      design     steps   test spec   TDD    separate   evidence  capture
  codebase   the idea   + files  first      red→    agent     50+ suites learning
                                 green      reviews  passing
```

## Tiers

Choose how much enforcement you want:

| | Lite | Standard | Full |
|---|:---:|:---:|:---:|
| **TDD enforcement** — can't edit source without tests | ✓ | ✓ | ✓ |
| **Evidence system** — JSON proof, auto-staleness | ✓ | ✓ | ✓ |
| **Lint gate** — ESLint/ruff/clippy before commit | ✓ | ✓ | ✓ |
| **Merge protocol** — no blind conflict resolution | ✓ | ✓ | ✓ |
| **Protected files** — .env untouchable | ✓ | ✓ | ✓ |
| **Enterprise pipeline** — 9-stage skill chain | ✓ | ✓ | ✓ |
| **Plan-before-edits** — no code without a plan | | ✓ | ✓ |
| **Vault integration** — Obsidian project tracking | | ✓ | ✓ |
| **Independent review** — builder ≠ reviewer | | ✓ | ✓ |
| **Context management** — injection + fade + handover | | | ✓ |
| **Code indexing** — jcodemunch enforcement | | | ✓ |
| **Fleet orchestration** — multi-agent dispatch | | | ✓ |
| **Prompt refinement** — LLM-driven clarity check | | | ✓ |

## Quick Start

```bash
# Clone the harness
git clone https://github.com/anotherben/claude-harness.git ~/claude-harness

# Install into your project
cd your-project
~/claude-harness/install.sh
```

The installer will:
1. Detect your project type (Node, Python, Go, Rust)
2. Ask you to choose a tier
3. Prompt for configuration (test command, protected files, etc.)
4. Copy hooks and skills to `.claude/`
5. Generate `settings.json` and update `CLAUDE.md`

## What Gets Installed

```
your-project/
└── .claude/
    ├── hooks/              # Shell scripts that enforce quality gates
    │   ├── require-tdd-before-source-edit.sh
    │   ├── require-test-evidence.sh
    │   ├── require-lint-clean.sh
    │   ├── protect-files.sh
    │   ├── enforce-merge-protocol.sh
    │   ├── record-test-evidence.sh
    │   └── ... (12-26 hooks depending on tier)
    ├── skills/             # Claude Code skills for enterprise workflow
    │   ├── enterprise/     # orchestrator
    │   ├── enterprise-build/
    │   ├── enterprise-review/
    │   └── ... (26-27 skills depending on tier)
    ├── evidence/           # JSON test evidence (auto-populated)
    ├── enterprise-state/   # Pipeline state machine
    └── settings.json       # Hook wiring
```

## The Enforcement Chain

Every action Claude takes passes through the hook chain. If a hook returns exit code 2, the action is blocked.

| When | Hook | What it enforces |
|------|------|-----------------|
| Edit source file | `require-tdd-before-source-edit.sh` | Tests must exist or be staged |
| Edit source file | `require-plan-before-edits.sh` | Plan must be approved first |
| Edit protected file | `protect-files.sh` | .env and auth files are untouchable |
| git commit | `require-test-evidence.sh` | Fresh evidence, matching HEAD, not stale |
| git commit | `require-lint-clean.sh` | Linter must pass on staged files |
| git commit | `pre-commit-gate.sh` | Test files or evidence required |
| git merge | `enforce-merge-protocol.sh` | Must read both sides of conflicts |
| git merge | `pre-merge-test-check.sh` | Must test between merges |
| Invoke enterprise-review | `require-independent-review.sh` | Builder cannot review own work |
| Invoke enterprise-* | `enforce-enterprise-pipeline.sh` | Stages cannot be skipped |
| After tests run | `record-test-evidence.sh` | Auto-records JSON evidence |
| After git operations | `invalidate-after-git-op.sh` | Auto-marks evidence stale |

## The Enterprise Pipeline

The harness includes 9 enterprise skills that form a complete development pipeline:

1. **`/enterprise-discover`** — Learn the codebase (produces stack profile)
2. **`/enterprise-brainstorm`** — Turn vague ideas into Technical Design Documents
3. **`/enterprise-plan`** — Create granular implementation steps with exact file paths
4. **`/enterprise-contract`** — Write mechanical contracts with postconditions and invariants
5. **`/enterprise-build`** — Strict TDD: write test, watch it fail, write code to pass
6. **`/enterprise-review`** — Two-stage review: spec compliance then code quality
7. **`/enterprise-forge`** — Adversarial review with 5 attack lenses
8. **`/enterprise-verify`** — Evidence-based verification (7-check sequence)
9. **`/enterprise-compound`** — Capture institutional knowledge for future sessions

Or use **`/enterprise`** to run the full pipeline orchestrated.

Quick alternatives:
- **`/full-cycle`** — Structured workflow with review checkpoints
- **`/full-cycle-tdd`** — TDD-first, every task starts with a failing test
- **`/full-cycle-fast`** — Lightweight: analyze, plan, build, verify

## How the Evidence System Works

The harness doesn't trust claims. It verifies them mechanically.

```
Developer runs tests
       ↓
record-test-evidence.sh captures:
  - Suite count, pass/fail counts
  - Git HEAD commit hash
  - Test mode (runInBand vs parallel)
  - Timestamp
       ↓
Writes to .claude/evidence/last-test-run.json
       ↓
Developer edits source file
       ↓
Evidence auto-marked stale (file mod time > evidence time)
       ↓
Developer tries to commit
       ↓
require-test-evidence.sh reads JSON:
  - Is evidence stale? → BLOCKED
  - Does commit hash match HEAD? → BLOCKED
  - Enough suites? → BLOCKED
  - All green? → ALLOWED
```

No markdown. No `/tmp` markers. No claims without proof. The hooks parse JSON — they can't be fooled by natural language.

## Configuration

All configuration happens at install time. The installer replaces template variables in the hooks:

| Variable | What it configures |
|----------|-------------------|
| Project name | Evidence file naming, vault integration |
| Test command | What `record-test-evidence.sh` looks for |
| Lint command | What `require-lint-clean.sh` runs |
| Protected files | What `protect-files.sh` blocks |
| Source extensions | Which files trigger TDD/plan gates |
| Min suites | Evidence threshold for commit gate |
| Vault path | Obsidian vault location (Standard+) |

## Writing Custom Hooks

Hooks are shell scripts that receive JSON on stdin:

```bash
#!/bin/bash
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('session_id',''))")
TOOL_INPUT=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_input',{}).get('file_path',''))")

# Your logic here
if [ some_condition ]; then
  echo "BLOCKED: reason"
  exit 2  # hard block
fi

exit 0  # allow
```

Add to `.claude/settings.json` under the appropriate lifecycle event and matcher.

## Writing Plugins

Plugins add domain-specific skills (e.g., Shopify webhooks, SOAP APIs, SQL safety):

```
plugins/my-plugin/
├── skills/
│   └── my-skill/
│       └── SKILL.md
└── README.md
```

Install by copying to `.claude/skills/`.

## Requirements

- Claude Code CLI
- `python3` (hooks use it for JSON parsing)
- `jq` (optional, some hooks use it)
- `git`
- Your project's test runner and linter

## License

MIT
