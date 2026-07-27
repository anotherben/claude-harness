#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/codex-overhead-test.XXXXXX")"
trap 'rm -rf "$TMP_ROOT"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_file() {
  [[ -f "$1" ]] || fail "missing file: $1"
}

assert_contains() {
  grep -Fq "$2" "$1" || fail "$1 does not contain: $2"
}

tree_digest() {
  python3 - "$1" <<'PY'
from hashlib import sha256
from pathlib import Path
import sys

root = Path(sys.argv[1])
digest = sha256()
for path in sorted(item for item in root.rglob("*") if item.is_file()):
    digest.update(str(path.relative_to(root)).encode())
    digest.update(b"\0")
    digest.update(path.read_bytes())
    digest.update(b"\0")
print(digest.hexdigest())
PY
}

USER_HOME="$TMP_ROOT/user"
CODEX_HOME="$USER_HOME/.codex"
mkdir -p "$CODEX_HOME" "$USER_HOME/.agents/skills"

for skill in blast-radius diagnose patch-or-fix; do
  mkdir -p "$USER_HOME/.agents/skills/$skill"
  printf '%s\n' "legacy duplicate $skill" > "$USER_HOME/.agents/skills/$skill/SKILL.md"
done

cat > "$CODEX_HOME/AGENTS.md" <<'EOF'
# Existing broad global instructions

Always inspect every adjacent file.
EOF

cat > "$CODEX_HOME/config.toml" <<EOF
model = "legacy-model"
service_tier = "default"
notify = ["""
[features]
apps = false
hooks = false
"""]

[agents]
max_threads = 6
max_depth = 3

[features]
apps = false
chronicle = false

[projects."$TMP_ROOT/project"]
trust_level = "trusted"

[[skills.config]]
path = '$USER_HOME/.agents/skills/diagnose/SKILL.md' # valid alternate TOML quoting
enabled = true # legacy duplicate remains active until installation

[[skills.config]]
path = "$USER_HOME/.agents/skills/diagnose/SKILL.md"
enabled = false # a prior partial alignment must not hide an earlier true entry
EOF

cat > "$CODEX_HOME/hooks.json" <<'EOF'
{
  "hooks": {
    "CustomEvent": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "true",
            "timeout": 1
          }
        ]
      }
    ]
  }
}
EOF

printf '%s\n' 'custom-ignore-entry' > "$CODEX_HOME/.ignore"

before_dry_run="$(tree_digest "$USER_HOME")"
HOME="$USER_HOME" "$ROOT_DIR/scripts/install-codex-overhead-savings.sh" \
  --codex-home "$CODEX_HOME" \
  --dry-run > "$TMP_ROOT/dry-run.out"
after_dry_run="$(tree_digest "$USER_HOME")"
[[ "$before_dry_run" == "$after_dry_run" ]] || fail "--dry-run mutated the target home"
assert_contains "$TMP_ROOT/dry-run.out" "would patch: $CODEX_HOME/config.toml"

HOME="$USER_HOME" "$ROOT_DIR/scripts/install-codex-overhead-savings.sh" \
  --codex-home "$CODEX_HOME" > "$TMP_ROOT/install.out"

assert_contains "$CODEX_HOME/AGENTS.md" "For explicitly self-contained tasks"
assert_contains "$CODEX_HOME/AGENTS.md" 'Ordinary verbs such as "diagnose", "review", or "fix"'

for wrapper in codex-github-lib.sh git-push-codex codex-pr-create; do
  assert_file "$CODEX_HOME/bin/$wrapper"
  [[ -x "$CODEX_HOME/bin/$wrapper" ]] || fail "wrapper is not executable: $CODEX_HOME/bin/$wrapper"
  bash -n "$CODEX_HOME/bin/$wrapper"
done
"$CODEX_HOME/bin/codex-pr-create" --help > "$TMP_ROOT/codex-pr-create-help.out"
"$CODEX_HOME/bin/git-push-codex" --help > "$TMP_ROOT/git-push-codex-help.out"
assert_contains "$TMP_ROOT/codex-pr-create-help.out" "Usage: codex-pr-create"
assert_contains "$TMP_ROOT/git-push-codex-help.out" "Usage: git-push-codex"

MOCK_BIN="$TMP_ROOT/mock-bin"
MOCK_REPO="$TMP_ROOT/mock-repo"
MOCK_GIT_LOG="$TMP_ROOT/mock-git.log"
MOCK_GH_LOG="$TMP_ROOT/mock-gh.log"
mkdir -p "$MOCK_BIN" "$MOCK_REPO"
cat > "$MOCK_BIN/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$MOCK_GH_LOG"
case "${1:-} ${2:-}" in
  "api user")
    printf '%s\n' "codex-test-bot"
    ;;
  "pr create")
    printf '%s\n' "https://github.example/pr/123"
    ;;
  "pr view")
    printf '%s\n' "codex-test-bot"
    ;;
  *)
    echo "unexpected mocked gh command: $*" >&2
    exit 70
    ;;
esac
EOF
cat > "$MOCK_BIN/git" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == "symbolic-ref" ]]; then
  printf '%s\n' "codex/test-wrapper-install"
  exit 0
fi
if [[ "${1:-}" == "-c" && "${3:-}" == "push" ]]; then
  printf '%s\n' "$*" >> "$MOCK_GIT_LOG"
  exit 0
fi
echo "unexpected mocked git command: $*" >&2
exit 70
EOF
chmod 0755 "$MOCK_BIN/gh" "$MOCK_BIN/git"
(
  cd "$MOCK_REPO"
  PATH="$MOCK_BIN:$PATH" \
    MOCK_GIT_LOG="$MOCK_GIT_LOG" \
    MOCK_GH_LOG="$MOCK_GH_LOG" \
    CODEX_PR_GITHUB_TOKEN="test-token" \
    CODEX_GITHUB_LOGIN="codex-test-bot" \
    CODEX_REVIEW_GATEKIT_ROOT="$TMP_ROOT/missing-gatekit" \
    "$CODEX_HOME/bin/codex-pr-create" \
      --base dev \
      --title "test portable PR wrapper" > "$TMP_ROOT/mock-pr.out"
)
assert_contains "$TMP_ROOT/mock-pr.out" "https://github.example/pr/123"
assert_contains "$MOCK_GIT_LOG" "push -u origin HEAD:codex/test-wrapper-install"
assert_contains "$MOCK_GH_LOG" "pr create --base dev --title test portable PR wrapper --head codex/test-wrapper-install"
assert_contains "$MOCK_GH_LOG" "pr view https://github.example/pr/123 --json author --jq .author.login"

for agent in bounded_builder critical_reviewer diagnostic_scout research_scout runtime_prover; do
  assert_file "$CODEX_HOME/agents/$agent.toml"
done
assert_contains "$CODEX_HOME/agents/critical_reviewer.toml" 'model = "gpt-5.6-sol"'
assert_contains "$CODEX_HOME/agents/runtime_prover.toml" 'model = "gpt-5.6-terra"'

assert_file "$USER_HOME/.agent-platform/skills/diagnose/SKILL.md"
assert_file "$USER_HOME/.agent-platform/skills/patch-or-fix/SKILL.md"
assert_file "$CODEX_HOME/skills/blast-radius/SKILL.md"
assert_file "$CODEX_HOME/skills/diagnostic-cohort/SKILL.md"
assert_file "$CODEX_HOME/skills/nested-agent-control/SKILL.md"
assert_contains "$CODEX_HOME/skills/diagnose/SKILL.md" "Explicit \$diagnose workflow"
assert_contains "$CODEX_HOME/skills/diagnose/SKILL.md" "$USER_HOME/.agent-platform/skills/diagnose/SKILL.md"
assert_contains "$CODEX_HOME/skills/patch-or-fix/SKILL.md" "Explicit \$patch-or-fix review"
if grep -R -Fq '/Users/ben/' "$CODEX_HOME/AGENTS.md" "$CODEX_HOME/agents" "$CODEX_HOME/bin" "$CODEX_HOME/skills" "$USER_HOME/.agent-platform/skills"; then
  fail "installed portable surfaces contain a source-machine home path"
fi
assert_contains "$CODEX_HOME/skills/diagnostic-cohort/SKILL.md" "$CODEX_HOME/skills/nested-agent-control/SKILL.md"

python3 - "$CODEX_HOME/config.toml" "$USER_HOME" "$TMP_ROOT/project" <<'PY'
from pathlib import Path
import sys
import tomllib

config_path = Path(sys.argv[1])
home = Path(sys.argv[2])
project = sys.argv[3]
data = tomllib.loads(config_path.read_text(encoding="utf-8"))

assert data["model"] == "gpt-5.6-sol"
assert data["model_reasoning_effort"] == "high"
assert data["plan_mode_reasoning_effort"] == "xhigh"
assert data["sandbox_mode"] == "workspace-write"
assert data["approval_policy"] == "on-request"
assert data["tool_output_token_limit"] == 2500
assert data["service_tier"] == "default"
assert "[features]" in data["notify"][0]
assert data["agents"]["max_depth"] == 1
assert data["agents"]["max_concurrent_threads_per_session"] == 4
assert "max_threads" not in data["agents"]
for feature in ("apps", "hooks", "multi_agent", "memories", "goals", "plugins"):
    assert data["features"][feature] is True
assert data["features"]["chronicle"] is False
assert data["projects"][project]["trust_level"] == "trusted"

entries = data["skills"]["config"]
for name in ("blast-radius", "diagnose", "patch-or-fix"):
    path = str((home / ".agents" / "skills" / name / "SKILL.md").resolve())
    matches = [
        entry["enabled"]
        for entry in entries
        if str(Path(entry["path"]).resolve()) == path
    ]
    assert matches and all(value is False for value in matches), (path, matches)
PY

python3 - "$CODEX_HOME/hooks.json" <<'PY'
import json
from pathlib import Path
import sys

data = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
hooks = data["hooks"]
assert "CustomEvent" in hooks
for event in ("SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PreCompact", "PostCompact"):
    assert event in hooks
PY

compgen -G "$CODEX_HOME/AGENTS.md.bak.*" >/dev/null || fail "AGENTS.md backup missing"
compgen -G "$CODEX_HOME/config.toml.bak.*" >/dev/null || fail "config.toml backup missing"
compgen -G "$CODEX_HOME/hooks.json.bak.*" >/dev/null || fail "hooks.json backup missing"
assert_contains "$CODEX_HOME/.ignore" "custom-ignore-entry"

before_second_run="$(tree_digest "$USER_HOME")"
HOME="$USER_HOME" "$ROOT_DIR/scripts/install-codex-overhead-savings.sh" \
  --codex-home "$CODEX_HOME" > "$TMP_ROOT/second-run.out"
after_second_run="$(tree_digest "$USER_HOME")"
[[ "$before_second_run" == "$after_second_run" ]] || fail "second install was not byte-idempotent"
assert_contains "$TMP_ROOT/second-run.out" "unchanged: $CODEX_HOME/config.toml"
assert_contains "$TMP_ROOT/second-run.out" "unchanged: $CODEX_HOME/hooks.json"

SYMLINK_HOME="$TMP_ROOT/symlink-user"
SYMLINK_EXTERNAL="$TMP_ROOT/symlink-external"
mkdir -p "$SYMLINK_HOME/.codex" "$SYMLINK_EXTERNAL"
for target in .ignore config.toml hooks.json; do
  printf '%s\n' "external $target" > "$SYMLINK_EXTERNAL/$target"
  ln -s "$SYMLINK_EXTERNAL/$target" "$SYMLINK_HOME/.codex/$target"
done
symlink_before="$(tree_digest "$SYMLINK_EXTERNAL")"
if HOME="$SYMLINK_HOME" "$ROOT_DIR/scripts/install-codex-overhead-savings.sh" > "$TMP_ROOT/symlink.out" 2>&1; then
  fail "installer accepted a symlinked patch target"
fi
symlink_after="$(tree_digest "$SYMLINK_EXTERNAL")"
[[ "$symlink_before" == "$symlink_after" ]] || fail "installer modified a symlink target"
[[ ! -e "$SYMLINK_HOME/.codex/hooks" ]] || fail "symlink preflight allowed a partial install"
assert_contains "$TMP_ROOT/symlink.out" "Refusing to patch symlink target"

BIN_SYMLINK_HOME="$TMP_ROOT/bin-symlink-user"
BIN_SYMLINK_EXTERNAL="$TMP_ROOT/bin-symlink-external"
mkdir -p "$BIN_SYMLINK_HOME/.codex/bin" "$BIN_SYMLINK_EXTERNAL"
printf '%s\n' "external wrapper" > "$BIN_SYMLINK_EXTERNAL/codex-pr-create"
ln -s "$BIN_SYMLINK_EXTERNAL/codex-pr-create" "$BIN_SYMLINK_HOME/.codex/bin/codex-pr-create"
bin_symlink_before="$(tree_digest "$BIN_SYMLINK_EXTERNAL")"
if HOME="$BIN_SYMLINK_HOME" "$ROOT_DIR/scripts/install-codex-overhead-savings.sh" > "$TMP_ROOT/bin-symlink.out" 2>&1; then
  fail "installer accepted a symlinked PR wrapper target"
fi
bin_symlink_after="$(tree_digest "$BIN_SYMLINK_EXTERNAL")"
[[ "$bin_symlink_before" == "$bin_symlink_after" ]] || fail "installer modified a symlinked PR wrapper target"
[[ ! -e "$BIN_SYMLINK_HOME/.codex/hooks" ]] || fail "wrapper symlink preflight allowed a partial install"
assert_contains "$TMP_ROOT/bin-symlink.out" "Refusing to patch symlink target"

SPACE_HOME="$TMP_ROOT/Test User"
HOME="$SPACE_HOME" "$ROOT_DIR/scripts/install-codex-overhead-savings.sh" > "$TMP_ROOT/space-install.out"
python3 - "$SPACE_HOME/.codex/hooks.json" "$SPACE_HOME/.codex/hooks/enterprise-context-hook.cjs" <<'PY'
from pathlib import Path
import json
import shlex
import subprocess
import sys

hooks_path = Path(sys.argv[1])
expected_hook = Path(sys.argv[2])
data = json.loads(hooks_path.read_text(encoding="utf-8"))
command = data["hooks"]["SessionStart"][0]["hooks"][0]["command"]
tokens = shlex.split(command)
assert tokens[:2] == ["node", str(expected_hook)]
result = subprocess.run(command, shell=True, input="{}", text=True, capture_output=True)
assert result.returncode == 0, (result.returncode, result.stdout, result.stderr)
PY

PRESERVE_HOME="$TMP_ROOT/preserve-user"
mkdir -p "$PRESERVE_HOME/.codex"
printf '%s\n' "keep this global card" > "$PRESERVE_HOME/.codex/AGENTS.md"
HOME="$PRESERVE_HOME" "$ROOT_DIR/scripts/install-codex-overhead-savings.sh" \
  --preserve-agents > "$TMP_ROOT/preserve.out"
assert_contains "$PRESERVE_HOME/.codex/AGENTS.md" "keep this global card"

if command -v codex >/dev/null 2>&1; then
  HOME="$USER_HOME" CODEX_HOME="$CODEX_HOME" \
    codex features list > "$TMP_ROOT/features.out"
  HOME="$USER_HOME" CODEX_HOME="$CODEX_HOME" \
    codex --strict-config exec --help > "$TMP_ROOT/strict-config.out"

  mkdir -p "$TMP_ROOT/smoke-repo"
  (
    cd "$TMP_ROOT/smoke-repo"
    HOME="$USER_HOME" CODEX_HOME="$CODEX_HOME" \
      codex debug prompt-input "post-install routing smoke" > "$TMP_ROOT/prompt-input.json"
  )
  assert_contains "$TMP_ROOT/prompt-input.json" "For explicitly self-contained tasks"
  assert_contains "$TMP_ROOT/prompt-input.json" "Explicit \$diagnose workflow"
  if grep -Fq "A discipline for hard bugs." "$TMP_ROOT/prompt-input.json"; then
    fail "full canonical diagnose body leaked into ordinary prompt input"
  fi
fi

echo "PASS: portable GPT-5.6 Codex installer"
