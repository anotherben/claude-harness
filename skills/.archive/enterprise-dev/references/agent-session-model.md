# Agent Session Model

Use a gitignored agent-session file for in-flight workflow state:

- path: `.codex/enterprise-state/agent-sessions/<agent-id>.json`
- owner: one Codex agent lane only
- purpose: path selection, upstream stage history, artifact handoffs, proof target, and final verification linkage

State split:

- committed repo facts: `.codex/enterprise-state/repo-profile.json`, `repo-traps.json`, `repo-best-practices.json`
- machine-only facts: `.codex/enterprise-state/local-machine.json`
- agent-only workflow state: `.codex/enterprise-state/agent-sessions/`

Rules:

- never use repo-global in-progress state as a gate source
- never read another agent's session file to decide your own stage entry
- if Codex does not expose a stable session id, mint one once with `agent_session.py ensure` and reuse it for the rest of that lane
- keep artifact paths repo-relative where possible

Minimum loop:

```bash
enterprise-agent-session ensure --repo-root "$PWD" --agent-id <agent-id>
enterprise-agent-session record-stage --repo-root "$PWD" --agent-id <agent-id> --stage plan --artifact design=docs/designs/... --artifact plan=docs/plans/...
enterprise-agent-session check-stage --repo-root "$PWD" --agent-id <agent-id> --stage contract
```
