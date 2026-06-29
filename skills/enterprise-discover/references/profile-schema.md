# Profile Schema

Write committed `.codex/enterprise-state/repo-profile.json` with at least these sections:

```json
{
  "profile_version": 1,
  "generated_at": "ISO-8601",
  "profiled_commit": "git sha",
  "repo_slug": "repo-slug",
  "repo_display_name": "Repo Name",
  "workspace": {
    "monorepo": false,
    "workspace_manager": "",
    "packages": []
  },
  "paths": {
    "source_roots": [],
    "test_roots": [],
    "migration_roots": [],
    "docs_roots": ["docs"],
    "repo_skill_root": ".codex/repo-skills",
    "agent_session_root": ".codex/enterprise-state/agent-sessions"
  },
  "commands": {
    "test_all": "unknown",
    "test_single": "unknown",
    "build": "unknown",
    "lint": "unknown",
    "repo_gate_matrix": [
      {
        "name": "example-gate",
        "command": "unknown",
        "when": "required before PR"
      }
    ]
  },
  "conventions": {
    "languages": [],
    "module_style": "",
    "file_extensions": [],
    "test_framework": "unknown"
  },
  "auth": {
    "middleware_name": "unknown",
    "middleware_path": "unknown"
  },
  "multi_tenancy": {
    "enabled": false,
    "field": "",
    "exceptions": []
  },
  "domains": {
    "high_risk": [],
    "source_of_truth_docs": []
  },
  "overlay_family": {
    "prefix": "repo-slug-enterprise",
    "generated_at": "ISO-8601"
  },
  "notes": []
}
```

Rules:

- use relative paths only
- use `unknown` instead of invented commands
- put repo-specific PR/local gate commands in `commands.repo_gate_matrix`; generic overlay generators must read this field instead of hard-coding one repository's scripts
- keep machine-only details out of this file
- include the gitignored agent-session root so generated wrappers know where live lane state belongs

Write committed `repo-traps.json` as a list of concrete, preventable traps with `pattern`, `category`, `description`, `detection`, and `prevention`.
