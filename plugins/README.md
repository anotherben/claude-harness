# Plugins

Domain-specific skills that extend the harness for particular integrations or technologies.

## Available Plugins

| Plugin | What it covers |
|--------|---------------|
| `sql-guard/` | Multi-tenant scoping, parameterized queries, type-safe joins |
| `shopify/` | Webhook verification, idempotency, inventory sync, fulfillment state machine |
| `rex-soap/` | Dual SOAP protocol detection, three-endpoint architecture, Base64-gzipped XML responses |

## Installing a Plugin

```bash
cp -r ~/claude-harness/plugins/my-plugin/skills/* .claude/skills/
```

## Writing a Plugin

Create a directory under `plugins/` with a `skills/` subdirectory containing one or more Claude Code skills:

```
plugins/my-plugin/
├── skills/
│   └── my-skill/
│       └── SKILL.md    # Standard Claude Code skill format
└── README.md           # What the plugin covers, when to use it
```

Skill format:

```markdown
---
name: my-skill
description: One-line description for skill matching
---

# My Skill

Instructions Claude follows when this skill is invoked...
```

The skill will be available as `/my-skill` in Claude Code after copying to `.claude/skills/`.
