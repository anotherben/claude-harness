# Repo Overlay Layout

Generate the repo-local overlay family under `.codex/repo-skills/`.

Naming rules:

- family prefix: `<repo-slug>-enterprise`
- stage wrappers: `<repo-slug>-enterprise`, `<repo-slug>-enterprise-discover`, `<repo-slug>-enterprise-plan`, and so on
- keep the generic `enterprise-*` source family separate in `tools/enterprise-skills/`

The generated wrappers should:

- read committed repo profile and trap files first
- read `local-machine.json` only when command availability or this computer matters
- use the current agent's gitignored session file under `.codex/enterprise-state/agent-sessions/` for stage gates
- invoke the matching generic `enterprise-*` skill
- keep new repo-specific learnings in committed `.codex/enterprise-state/` files
- stage and commit the portable discover outputs before declaring setup complete
- never commit live agent-session files
