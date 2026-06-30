---
name: harness-update
description: "Pull latest skills from claude-harness repo and sync full skill directories to local agent skill homes. Run this in any project to get the latest enterprise skills. Use when the user says 'update skills', 'sync skills', 'pull latest harness', or invokes /harness-update."
---

# Harness Update

Pull latest skills from the claude-harness repo and deploy full skill directories
to Claude Code, Codex, Agents, Continue, Cursor, and the shared platform catalog.

## Rules

- Do not sync only `SKILL.md`; copy each full skill directory so scripts, evals,
  templates, references, and agents metadata stay usable.
- Do not delete unrelated local skills from any local skill home.
- Do not replace full skill directories with link-only entries.
- Do not install directories that are missing `SKILL.md`; workspace/template
  folders are not skills.
- Preserve explicitly local full-skill overlays only when they are marked as
  `.local/`, `local.*`, or `*.local.*`; delete other destination-only files so
  renamed or removed upstream skill assets cannot stay active as stale runtime
  files.
- Rebuild the skills-index compiled cache after syncing when the local
  `skills-index` package is available.
- Verify representative skills before claiming the update is complete.

## Steps

1. Pull latest from claude-harness:

```bash
cd ~/claude-harness && git pull origin main
```

2. Sync full skill directories to every local skill home:

```bash
targets=(
  "$HOME/.claude/skills"
  "$HOME/.codex/skills"
  "$HOME/.agents/skills"
  "$HOME/.agent-platform/skills"
  "$HOME/.continue/skills"
  "$HOME/.cursor/skills-cursor"
)
overlay_tmp=$(mktemp -d)
trap 'rm -rf "$overlay_tmp"' EXIT
preserve_local_overlay() {
  src="$1"
  dst="$2"
  [ -d "$src" ] || return 0
  find "$src" \
    \( -path '*/node_modules' -o -path '*/__pycache__' \) -prune -o \
    -type f \( -path '*/.local/*' -o -name 'local.*' -o -name '*.local.*' \) -print0 |
    while IFS= read -r -d '' file; do
      rel="${file#$src/}"
      mkdir -p "$dst/$(dirname "$rel")"
      cp -p "$file" "$dst/$rel"
    done
}
for skill_dir in ~/claude-harness/skills/*; do
  [ -f "$skill_dir/SKILL.md" ] || continue
  name=$(basename "$skill_dir")
  for target in "${targets[@]}"; do
    dest="$target/$name"
    overlay="$overlay_tmp/${target//\//_}__$name"
    preserve_local_overlay "$dest" "$overlay"
    mkdir -p "$dest"
    rsync -a --delete --exclude='node_modules/' --exclude='__pycache__/' "$skill_dir"/ "$dest"/
    [ -d "$overlay" ] && rsync -a "$overlay"/ "$dest"/
  done
done
```

3. Replace any remaining shim-only Codex skills from a full local source, or
   report them as blockers:

```bash
shim_re='L[i]ve Shim|lightweight live tr[i]gger|Load the canonical skill thr[o]ugh'
while IFS= read -r skill_file; do
  name=$(basename "$(dirname "$skill_file")")
  source="$HOME/.agent-platform/skills/$name"
  if [ -f "$source/SKILL.md" ] && ! rg -q "$shim_re" "$source/SKILL.md"; then
    # This branch only replaces a target whose SKILL.md was detected as a shim.
    rsync -a --delete "$source"/ "$HOME/.codex/skills/$name"/
  else
    echo "unresolved shim: $name" >&2
  fi
done < <(find "$HOME/.codex/skills" -mindepth 2 -maxdepth 2 -name SKILL.md -print0 | xargs -0 rg -l "$shim_re" 2>/dev/null)
```

4. Rebuild the skills index if available:

```bash
if [ -d ~/claude-harness/skills-index ]; then
  cd ~/claude-harness/skills-index
  npm rebuild better-sqlite3 sqlite-vec >/dev/null 2>&1 || true
  npm run index -- --repo-root "${CLAUDE_PROJECT_DIR:-$PWD}" || true
fi
```

5. Verify representative transferred skills and no shims remain:

```bash
python3 ~/.codex/skills/.system/skill-creator/scripts/quick_validate.py ~/.claude/skills/diagnose
python3 ~/.codex/skills/.system/skill-creator/scripts/quick_validate.py ~/.codex/skills/diagnostic-cohort
python3 ~/.codex/skills/.system/skill-creator/scripts/quick_validate.py ~/.codex/skills/zoom-out
tmp=$(mktemp -d)
mkdir -p "$tmp/src/sample" "$tmp/dst/sample/evals"
printf '%s\n' '---' 'name: sample' 'description: sample' '---' > "$tmp/src/sample/SKILL.md"
printf '%s\n' 'local-eval' > "$tmp/dst/sample/evals/local.json"
printf '%s\n' 'stale' > "$tmp/dst/sample/removed-script.sh"
overlay="$tmp/overlay"
find "$tmp/dst/sample" \
  \( -path '*/node_modules' -o -path '*/__pycache__' \) -prune -o \
  -type f \( -path '*/.local/*' -o -name 'local.*' -o -name '*.local.*' \) -print0 |
  while IFS= read -r -d '' file; do
    rel="${file#$tmp/dst/sample/}"
    mkdir -p "$overlay/$(dirname "$rel")"
    cp -p "$file" "$overlay/$rel"
  done
rsync -a --delete "$tmp/src/sample"/ "$tmp/dst/sample"/
[ -d "$overlay" ] && rsync -a "$overlay"/ "$tmp/dst/sample"/
test -f "$tmp/dst/sample/evals/local.json" &&
  ! test -f "$tmp/dst/sample/removed-script.sh" &&
  grep -q 'description: sample' "$tmp/dst/sample/SKILL.md" ||
  { rm -rf "$tmp"; exit 1; }
rm -rf "$tmp"
targets=(
  "$HOME/.claude/skills"
  "$HOME/.codex/skills"
  "$HOME/.agents/skills"
  "$HOME/.agent-platform/skills"
  "$HOME/.continue/skills"
  "$HOME/.cursor/skills-cursor"
)
shim_re='L[i]ve Shim|lightweight live tr[i]gger|Load the canonical skill thr[o]ugh'
shim_hits=$(mktemp)
for root in "${targets[@]}"; do
  [ -d "$root" ] || continue
  find "$root" -mindepth 2 -maxdepth 2 -name SKILL.md -exec rg -l "$shim_re" {} + >> "$shim_hits" 2>/dev/null || true
done
if [ -s "$shim_hits" ]; then
  cat "$shim_hits"
  rm -f "$shim_hits"
  exit 1
fi
rm -f "$shim_hits"
```

6. Report what was updated:

```bash
echo "Claude skills: $(ls ~/.claude/skills/*/SKILL.md 2>/dev/null | wc -l)"
echo "Codex skills: $(ls ~/.codex/skills/*/SKILL.md 2>/dev/null | wc -l)"
echo "Agent platform skills: $(ls ~/.agent-platform/skills/*/SKILL.md 2>/dev/null | wc -l)"
echo "Agents skills: $(ls ~/.agents/skills/*/SKILL.md 2>/dev/null | wc -l)"
echo "Continue skills: $(ls ~/.continue/skills/*/SKILL.md 2>/dev/null | wc -l)"
echo "Cursor skills: $(ls ~/.cursor/skills-cursor/*/SKILL.md 2>/dev/null | wc -l)"
echo "Harness version: $(cd ~/claude-harness && git describe --tags --always)"
```

Print the count and version to the user. Done.
