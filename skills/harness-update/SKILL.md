---
name: harness-update
description: "Pull latest skills from claude-harness repo and sync to ~/.claude/skills/ and ~/.codex/skills/. Run this in any project to get the latest enterprise skills. Use when the user says 'update skills', 'sync skills', 'pull latest harness', or invokes /harness-update."
---

# Harness Update

Pull latest skills from the claude-harness repo and deploy to both Claude Code and Codex.

## Steps

1. Pull latest from claude-harness:

```bash
cd ~/claude-harness && git pull origin main
```

2. Sync to Claude Code (`~/.claude/skills/`):

```bash
for skill in ~/claude-harness/skills/*/SKILL.md; do
  name=$(basename $(dirname "$skill"))
  mkdir -p ~/.claude/skills/$name
  cp "$skill" ~/.claude/skills/$name/SKILL.md
done
```

3. Sync to Codex (`~/.codex/skills/`):

```bash
for skill in ~/claude-harness/skills/*/SKILL.md; do
  name=$(basename $(dirname "$skill"))
  mkdir -p ~/.codex/skills/$name
  cp "$skill" ~/.codex/skills/$name/SKILL.md
done
```

4. Report what was updated:

```bash
echo "Claude skills: $(ls ~/.claude/skills/*/SKILL.md 2>/dev/null | wc -l)"
echo "Codex skills: $(ls ~/.codex/skills/*/SKILL.md 2>/dev/null | wc -l)"
echo "Harness version: $(cd ~/claude-harness && git describe --tags --always)"
```

Print the count and version to the user. Done.
