# Machine State Schema

Write gitignored `.codex/enterprise-state/local-machine.json` with facts that are true only on the current computer.

```json
{
  "generated_at": "ISO-8601",
  "hostname": "optional",
  "available_commands": {
    "node": "node",
    "npm": "npm",
    "python3": "python3"
  },
  "missing_commands": [],
  "notes": []
}
```

Rules:

- no secrets
- no tokens
- no credentials
- no portable repo facts that belong in `repo-profile.json`
- no agent-lane progress; that belongs in `.codex/enterprise-state/agent-sessions/`
