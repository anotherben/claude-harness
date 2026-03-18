---
name: harness-init
description: Install and configure the claude-harness governance system in the current project. Sets up hooks, skills, settings.json, evidence system, Obsidian vault integration, and runs enterprise-discover to produce a stack profile. After this, /enterprise is ready to go. Use when starting a new project or adding the harness to an existing one.
---

# harness-init

Install the claude-harness governance system into the current project and get it fully ready for `/enterprise`. After this skill completes, the next command should be `/enterprise <your task>` — no further setup needed.

## Step 0: Preflight — Hard Requirements

Check these before anything else. If any fail, STOP and tell the user how to fix it.

### Obsidian

Obsidian is the backbone of the harness — every work item, evidence record, and institutional learning lives there. Check in this order:

1. **Check if Obsidian app is installed:**
   ```bash
   # macOS
   ls /Applications/Obsidian.app 2>/dev/null || ls ~/Applications/Obsidian.app 2>/dev/null
   # Linux
   which obsidian 2>/dev/null
   ```

2. **If not installed:**
   ```
   BLOCKED: Obsidian is required but not installed.

   Install it:
     macOS:  brew install --cask obsidian
     Linux:  snap install obsidian --classic
     Manual: https://obsidian.md/download

   Then run /harness-init again.
   ```
   EXIT HERE. Do not continue without Obsidian.

3. **Check if Obsidian CLI is available** (optional but useful):
   ```bash
   which obsidian 2>/dev/null
   ```
   If not available, that's fine — we use the Write tool for vault files.

### Harness repo

Check if `~/claude-harness/` exists:
```bash
ls ~/claude-harness/hooks/ 2>/dev/null | head -3
```

If not found:
```
BLOCKED: claude-harness repo not found at ~/claude-harness/

Clone it:
  git clone https://github.com/<your-org>/claude-harness.git ~/claude-harness

Then run /harness-init again.
```
EXIT HERE.

### Python 3

```bash
python3 --version 2>/dev/null
```

If not found, tell the user to install it. Hooks depend on it for JSON parsing.

## Step 1: Detect Project

Auto-detect everything. Do NOT ask the user — detect and confirm.

**Project type** — check for:
| File | Type | Extensions | Test command | Lint command |
|------|------|-----------|-------------|-------------|
| `package.json` | Node.js | js,jsx,ts,tsx | `npm test` or `npm run test:local` if it exists | `npx eslint` |
| `pyproject.toml` / `setup.py` | Python | py | `pytest` | `ruff check` |
| `go.mod` | Go | go | `go test ./...` | `golangci-lint run` |
| `Cargo.toml` | Rust | rs | `cargo test` | `cargo clippy` |

**Project name** — from `git remote get-url origin` (strip .git suffix), or directory basename.

**Test command** — check `package.json` scripts for `test:local` (preferred) or `test`. For monorepos, check subdirectories (`apps/*/package.json`).

**Vault path** — check these locations in order:
1. `~/Documents/Product Ideas` (if exists)
2. `~/Documents/Vault`
3. `~/Vault`
4. `~/Documents/Obsidian`
5. Find any `.obsidian` directory: `find ~/Documents -maxdepth 3 -name ".obsidian" -type d 2>/dev/null | head -1` and use its parent
6. Ask the user if none found

**Existing .claude/ directory** — check if one exists. If it has settings.json, back it up to settings.json.bak.

Present what you detected:
```
Preflight:
  Obsidian:     ✓ installed
  Harness repo: ✓ ~/claude-harness (26 hooks, 27 skills)
  Python 3:     ✓ {version}

Project:
  Name:         {name}
  Type:         {type}
  Extensions:   {ext}
  Test command:  {test_cmd}
  Lint command:  {lint_cmd}
  Vault:        {vault_path}
  Existing .claude/: {yes (backed up) / no}
```

## Step 2: Choose Tier

Present the three tiers using AskUserQuestion:

| Tier | What you get | Best for |
|------|-------------|----------|
| **Lite** | Vault + TDD + evidence + lint + merge protocol + enterprise pipeline | Small projects, solo dev |
| **Standard** (recommended) | + plan-before-edits + independent review | Team projects, production code |
| **Full** | + context injection + jcodemunch + fleet + prompt refinement + handover | Large codebases, multi-agent workflows |

If the user passed a tier as an argument (`/harness-init standard`), skip this step.

## Step 3: Copy Hooks

Copy hooks from `~/claude-harness/hooks/` to `.claude/hooks/` based on tier.

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

After copying, templatize:
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

Copy all skill directories from `~/claude-harness/skills/` to `.claude/skills/`.

- **Lite/Standard**: skip `fleet-commander`
- **Full**: copy everything

## Step 5: Generate settings.json

Write `.claude/settings.json` using the Write tool. Build it based on the tier — follow the structure in `~/claude-harness/install.sh`'s `generate_settings` function.

All hook paths use: `"$CLAUDE_PROJECT_DIR"/.claude/hooks/`

**IMPORTANT**: If an existing settings.json was backed up, merge its `enabledPlugins` and any custom hooks into the new file.

## Step 6: Generate CLAUDE.md Section

If CLAUDE.md exists, append the enforcement section (wrapped in `<!-- claude-harness -->` comments). If not, create a new CLAUDE.md.

Include:
- "Proof-or-STFU" header
- Hook enforcement chain table (rows vary by tier)
- "No escape hatches" footer

## Step 7: Set Up Vault Structure

```bash
mkdir -p "{vault_path}/_evidence"
mkdir -p "{vault_path}/00-Inbox"
mkdir -p "{vault_path}/01-Bugs"
mkdir -p "{vault_path}/02-Tasks"
mkdir -p "{vault_path}/03-Ideas"
mkdir -p "{vault_path}/_standards"
```

Create the evidence note for this project:
```markdown
---
project: {project_name}
type: evidence
---

# Test Evidence: {project_name}

Auto-updated by `record-test-evidence.sh`. Do not edit manually.
```

## Step 8: Run enterprise-discover

This is what makes `/enterprise` ready to go immediately. Run the discover phase:

1. **Invoke the enterprise-discover skill** — this produces:
   - `.claude/enterprise-state/stack-profile.json` — project structure, commands, conventions
   - `.claude/enterprise-state/stack-traps.json` — known pitfalls
   - `.claude/enterprise-state/stack-best-practices.json` — patterns to follow

2. If enterprise-discover is not available as a skill (e.g., skill copy failed), do a manual discovery:
   - Scan project structure (`find . -maxdepth 3 -type f | head -50`)
   - Read key config files (package.json, tsconfig.json, etc.)
   - Identify test framework, build tool, deployment target
   - Write a minimal `stack-profile.json` with the detected info

The goal: after this step, `/enterprise` can start at the brainstorm phase — no "let me learn your codebase" delay.

## Step 8b: Generate Review Lenses

After enterprise-discover completes and `stack-profile.json` exists, generate stack-specific review lens skills that enterprise-review will dispatch during code review.

1. **Read the stack profile:**
   ```bash
   cat .claude/enterprise-state/stack-profile.json
   ```

2. **Determine which lenses to generate** using this detection table:

   | Condition | Lens template | Lens ID |
   |-----------|--------------|---------|
   | Language is JavaScript AND framework is Express/Fastify/Koa/Nest | `api-node.md` | `api-node` |
   | Frontend source directory exists | `frontend-react.md` | `frontend-react` |
   | Frontend source directory exists | `component.md` | `component` |
   | Database is PostgreSQL | `sql-pg.md` | `sql-pg` |
   | Database is any SQL (not PostgreSQL) | `sql-general.md` | `sql-general` |
   | Test framework is Jest/Vitest/Mocha | `test-js.md` | `test-js` |
   | Test framework is pytest | `test-python.md` | `test-python` |
   | Language is Python AND framework is Django/FastAPI/Flask | `api-python.md` | `api-python` |
   | Language is Go | `api-go.md` | `api-go` |
   | Language is Go AND database exists | `sql-go.md` | `sql-go` |
   | **Always** | `security.md` | `security` |
   | **Always** | `architecture.md` | `architecture` |

3. **For each matched lens:**
   ```bash
   mkdir -p .claude/skills/review-lens-{id}
   cp ~/claude-harness/templates/review-lenses/{template}.md .claude/skills/review-lens-{id}/SKILL.md
   ```

   Then templatize with values from the stack profile:
   - `{{SOURCE_DIR}}` — backend source directory
   - `{{FRONTEND_DIR}}` — frontend source directory
   - `{{AUTH_MIDDLEWARE}}` — auth middleware name (e.g., `authenticateStaff`)
   - `{{TENANT_FIELD}}` — multi-tenancy field (e.g., `tenant_id`)
   - `{{TENANT_ENABLED}}` — `true` or `false`
   - `{{MIGRATION_DIR}}` — migration directory path
   - `{{FILE_SIZE_SOFT_LIMIT}}` — default `400`
   - `{{DB_TYPE}}` — database type

4. **Write the lens registry** at `.claude/enterprise-state/review-lenses.json`:
   ```json
   {
     "generated_at": "ISO-8601",
     "lenses": [
       {
         "id": "api-node",
         "skill_path": ".claude/skills/review-lens-api-node/SKILL.md",
         "applies_to": "route files, controllers, middleware",
         "stack_key": "node-express"
       }
     ]
   }
   ```

5. **Verify** no template variables remain:
   ```bash
   grep -r '{{' .claude/skills/review-lens-*/ 2>/dev/null | head -5
   ```

## Step 9: Readiness Verification

Run ALL of these checks:

| Check | Command | Expected |
|-------|---------|----------|
| Settings JSON valid | `python3 -c "import json; json.load(open('.claude/settings.json'))"` | No error |
| Hooks executable | `ls -la .claude/hooks/*.sh \| head -3` | `-rwxr-xr-x` |
| Hook count | `ls .claude/hooks/*.sh \| wc -l` | 15+ (Lite), 19+ (Standard), 26+ (Full) |
| Skill count | `ls -d .claude/skills/*/ \| wc -l` | 26+ |
| No template vars | `grep -r '{{' .claude/hooks/ \| head -5` | Empty |
| Vault exists | `ls {vault_path}/00-Inbox` | Exists |
| Evidence dir | `ls {vault_path}/_evidence/` | Exists |
| Stack profile | `ls .claude/enterprise-state/stack-profile.json` | Exists |
| Review lenses | `ls -d .claude/skills/review-lens-*/ \| wc -l` | 2+ (security + architecture always) |
| Lens registry | `cat .claude/enterprise-state/review-lenses.json` | Valid JSON |
| No lens template vars | `grep -r '{{' .claude/skills/review-lens-*/ \| head -5` | Empty |
| Obsidian running | `pgrep -x Obsidian` | PID (warn if not running) |

### Readiness Report

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
claude-harness installed ({tier} tier) — READY

  Hooks:    {n} installed, all executable
  Skills:   {n} installed
  Config:   .claude/settings.json ✓
  Docs:     CLAUDE.md enforcement section ✓
  Vault:    {vault_path} ✓
  Profile:  stack-profile.json ✓
  Lenses:   {n} review lenses generated
  Obsidian: {running/not running — start it for live sync}

  READY: Run /enterprise <your task> to start.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

If any check fails, report it clearly with fix instructions and do NOT print the READY line.

## Arguments

- `/harness-init` — full interactive setup (default)
- `/harness-init lite` — skip tier selection, install Lite
- `/harness-init standard` — skip tier selection, install Standard
- `/harness-init full` — skip tier selection, install Full
- `/harness-init --verify` — only run Step 9 verification on existing install
- `/harness-init --update` — pull latest hooks/skills from ~/claude-harness, re-templatize, preserve settings.json
