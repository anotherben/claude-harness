# GPT-5.6 Codex Scope-Alignment Bundle

This bundle ports the verified Codex startup, workflow-overhead, and scope
alignment into the harness repo so the same behavior can be installed on other
desktops without copying authentication, sessions, caches, or machine paths.

Prerequisites are Bash, Node.js, Python 3.11 or newer, and Codex CLI 0.145.0 or
newer. Sign into Codex normally on the destination desktop; credentials are not
part of this bundle.

It installs:

- `codex/hooks/enterprise-context-hook.cjs`
- `codex/hooks/codex-write-guard.cjs`
- A lean global `AGENTS.md` that keeps self-contained tasks bounded and makes
  heavyweight workflows explicit-only
- `codex/templates/ignore`
- Five bounded GPT-5.6 custom agents under `~/.codex/agents/`
- Lightweight explicit-only `$diagnose` and `$patch-or-fix` shims
- Canonical full workflow bodies under `~/.agent-platform/skills/`
- Native `blast-radius`, `diagnostic-cohort`, and `nested-agent-control` skills
  under `~/.codex/skills/`
- A merge-preserving `config.toml` patch:
  - `model = "gpt-5.6-sol"`
  - `model_reasoning_effort = "high"`
  - `plan_mode_reasoning_effort = "xhigh"`
  - `[agents] max_depth = 1`
  - `[agents] max_concurrent_threads_per_session = 4`
  - disables duplicate `.agents` registrations for `blast-radius`, `diagnose`,
    and `patch-or-fix` when those copies exist
- Codex `hooks.json` registrations for session, prompt, tool, and compaction
  events.

The installer intentionally does not copy `auth.json`, sessions, memories,
SQLite databases, logs, plugin caches, Computer Use bundles, provider secrets,
MCP credentials, or other device-specific state.

Install globally:

```bash
./scripts/install-codex-overhead-savings.sh
```

Preview without writes:

```bash
./scripts/install-codex-overhead-savings.sh --dry-run
```

Install into a non-default Codex home:

```bash
./scripts/install-codex-overhead-savings.sh --codex-home /srv/codex/.codex
```

Use `--preserve-agents` when a server already has a hand-maintained
`AGENTS.md`; the installer will still update hooks, `.ignore`, `config.toml`,
custom agents, scoped skills, and `hooks.json`. This option preserves existing
behavior and therefore does not guarantee the anti-drift global boundary.

When `--codex-home` does not end in `.codex`, also pass `--user-home` so the
installer can render portable absolute paths correctly. Use
`--agent-platform-home` only when canonical full skills live somewhere other
than `<user-home>/.agent-platform`.

Optional environment overrides:

- `HELPDESK_ROOTS`: colon-separated guarded Helpdesk checkout roots.
- `CODEX_DEFAULT_REPO`: default repo for the context hook when no cwd is present.
- `VAULT_ROOT`: optional vault root for evidence-note writes.
- `CODEX_PROJECT_SLUG`: project slug used in optional evidence-note filenames.

The installer backs up every changed target file with a UTC `.bak.<timestamp>`
suffix, preserves unrelated TOML and JSON settings, refuses to replace symlink
targets, and is byte-idempotent after a successful run.

Run the portable acceptance test before deployment:

```bash
./scripts/test-install-codex-overhead-savings.sh
```

When a Codex binary is available, the test also runs strict config parsing and
proves that an ordinary prompt sees the explicit `$diagnose` metadata but not
the full canonical diagnose workflow body.
