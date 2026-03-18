---
name: harness-init
description: Install and configure the claude-harness governance system in the current project. Sets up hooks, skills, settings.json, evidence system, and Obsidian vault integration. Use when starting a new project or adding the harness to an existing one.
---

# harness-init

Install the claude-harness governance system into the current project. Detects project type, configures hooks, copies skills, generates settings.json, and wires everything up.

## Prerequisites

The harness repo must be cloned locally. Check for it:
```
~/claude-harness/
```

If not found, tell the user to clone it first:
```bash
git clone https://github.com/<your-org>/claude-harness.git ~/claude-harness
```

## Step 1: Detect Project

Auto-detect everything about the current project. Do NOT ask the user — just detect and confirm.

**Project type** — check for:
| File | Type | Extensions | Test command | Lint command |
|------|------|-----------|-------------|-------------|
| `package.json` | Node.js | js,jsx,ts,tsx | `npm test` or `npm run test:local` if it exists | `npx eslint` |
| `pyproject.toml` / `setup.py` | Python | py | `pytest` | `ruff check` |
| `go.mod` | Go | go | `go test ./...` | `golangci-lint run` |
| `Cargo.toml` | Rust | rs | `cargo test` | `cargo clippy` |

**Project name** — from `git remote get-url origin` (strip .git suffix), or directory basename.

**Test command** — check `package.json` scripts for `test:local` (preferred) or `test`. For monorepos, check subdirectories.

**Vault path** — check these locations in order:
1. `~/Documents/Product Ideas` (if exists — common Obsidian vault location)
2. `~/Documents/Vault`
3. `~/Vault`
4. Ask the user if none found

**Existing .claude/ directory** — check if one exists. If it has settings.json, back it up.

Present what you detected:
```
Project: {name} ({type})
Source extensions: {ext}
Test command: {test_cmd}
Lint command: {lint_cmd}
Vault: {vault_path}
Existing .claude/: {yes/no, backed up if yes}
```

## Step 2: Choose Tier

Present the three tiers using AskUserQuestion:

| Tier | What it adds |
|------|-------------|
| **Lite** | Obsidian vault + TDD + evidence + lint + merge protocol + enterprise pipeline |
| **Standard** | + plan-before-edits gate + independent review gate |
| **Full** | + context injection + jcodemunch + fleet orchestration + prompt refinement + handover hooks |

Default recommendation: **Standard** for most projects.

## Step 3: Copy Hooks

Use the Bash tool to copy hooks from `~/claude-harness/hooks/` to `.claude/hooks/`.

**Lite tier hooks** (always installed):
```
protect-files.sh
require-tdd-before-source-edit.sh
require-test-evidence.sh
record-test-evidence.sh
invalidate-after-git-op.sh
pre-commit-gate.sh
require-lint-clean.sh
enforce-enterprise-pipeline.sh
enforce-merge-protocol.sh
post-merge-test-gate.sh
mark-skill-invoked.sh
auto-format.sh
require-vault-for-edits.sh
require-vault-update.sh
enforce-vault-context.sh
```

**Standard adds:**
```
require-plan-before-edits.sh
require-independent-review.sh
mark-plan-approved.sh
pre-merge-test-check.sh
```

**Full adds:**
```
context-inject.sh
context-fade.sh
refine-prompt.sh
suggest-jcodemunch.sh
jcodemunch-reindex.sh
post-compact-handover.sh
ensure-environment.sh
```

After copying, run `sed` to replace template variables:
```bash
cd .claude/hooks
for f in *.sh; do
  sed -i '' \
    -e "s|{{PROJECT_NAME}}|{detected_project_name}|g" \
    -e "s|{{TEST_COMMAND}}|{detected_test_command}|g" \
    -e "s|{{LINT_COMMAND}}|{detected_lint_command}|g" \
    -e "s|{{PROTECTED_FILES}}|.env|g" \
    -e "s|{{SOURCE_EXTENSIONS}}|{detected_extensions}|g" \
    -e "s|{{MIN_SUITES}}|10|g" \
    -e "s|{{VAULT_PATH}}|{detected_vault_path}|g" \
    -e "s|{{VAULT_EVIDENCE_PATH}}|{detected_vault_path}/_evidence|g" \
    "$f"
done
chmod +x *.sh
```

## Step 4: Copy Skills

Copy skill directories from `~/claude-harness/skills/` to `.claude/skills/`.

**Lite/Standard** — copy all skills EXCEPT `fleet-commander`.
**Full** — copy all skills INCLUDING `fleet-commander`.

```bash
for skill in $(ls ~/claude-harness/skills/); do
  # Skip fleet-commander unless Full tier
  if [ "$skill" = "fleet-commander" ] && [ "$TIER" != "full" ]; then
    continue
  fi
  cp -r ~/claude-harness/skills/$skill .claude/skills/
done
```

## Step 5: Generate settings.json

Write `.claude/settings.json` using the Write tool. Build it based on the tier.

The structure follows the pattern in `~/claude-harness/install.sh`'s `generate_settings` function. All hooks use the path prefix `"$CLAUDE_PROJECT_DIR"/.claude/hooks/`.

**IMPORTANT**: If an existing settings.json was backed up, merge any existing `enabledPlugins` or custom hooks into the new file.

## Step 6: Generate CLAUDE.md Section

If CLAUDE.md exists, append the enforcement section. If not, create one.

Include:
- The "Proof-or-STFU" header explaining that all claims require evidence
- The hook enforcement chain table (rows vary by tier)
- The "no escape hatches" footer

## Step 7: Set Up Vault Structure

Ensure the vault has the required directories:
```bash
mkdir -p "{vault_path}/_evidence"
mkdir -p "{vault_path}/00-Inbox"
mkdir -p "{vault_path}/01-Bugs"
mkdir -p "{vault_path}/02-Tasks"
mkdir -p "{vault_path}/03-Ideas"
```

Create the initial evidence note if it doesn't exist:
```markdown
---
project: {project_name}
type: evidence
---

# Test Evidence: {project_name}

Auto-updated by `record-test-evidence.sh`. Do not edit manually.
```

## Step 8: Verify Installation

Run these checks and report results:

1. **JSON valid**: `python3 -c "import json; json.load(open('.claude/settings.json'))"`
2. **Hooks executable**: `ls -la .claude/hooks/*.sh | head -5`
3. **Hooks count**: `ls .claude/hooks/*.sh | wc -l`
4. **Skills count**: `ls -d .claude/skills/*/ | wc -l`
5. **Vault exists**: `ls {vault_path}/`
6. **No template vars remaining**: `grep -r '{{' .claude/hooks/ | head -5` (should be empty)

Present the summary:
```
claude-harness installed ({tier} tier)

  Hooks:  {n} installed in .claude/hooks/
  Skills: {n} installed in .claude/skills/
  Config: .claude/settings.json generated
  Docs:   CLAUDE.md enforcement section added
  Vault:  {vault_path} verified

Run /enterprise to start your first enforced development cycle.
```

## Arguments

- `/harness-init` — full interactive setup (default)
- `/harness-init lite` — skip tier selection, install Lite
- `/harness-init standard` — skip tier selection, install Standard
- `/harness-init full` — skip tier selection, install Full
- `/harness-init --verify` — only run Step 8 verification on existing install
- `/harness-init --update` — pull latest hooks/skills from ~/claude-harness, preserve settings.json config
