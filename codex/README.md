# Codex Overhead-Savings Bundle

This bundle ports the local Codex startup and workflow-overhead reductions into
the harness repo so they can be installed on other servers.

It installs:

- `codex/hooks/enterprise-context-hook.cjs`
- `codex/hooks/codex-write-guard.cjs`
- `codex/templates/AGENTS.md`
- `codex/templates/ignore`
- Codex `config.toml` reasoning defaults:
  - `model_reasoning_effort = "medium"`
  - `plan_mode_reasoning_effort = "high"`
- Codex `hooks.json` registrations for session, prompt, tool, and compaction
  events.

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
and `hooks.json`.

Optional environment overrides:

- `HELPDESK_ROOTS`: colon-separated guarded Helpdesk checkout roots.
- `CODEX_DEFAULT_REPO`: default repo for the context hook when no cwd is present.
- `VAULT_ROOT`: optional vault root for evidence-note writes.
- `CODEX_PROJECT_SLUG`: project slug used in optional evidence-note filenames.

The installer backs up any changed target file with a UTC `.bak.<timestamp>`
suffix before replacing or patching it.
