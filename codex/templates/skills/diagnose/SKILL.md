---
name: diagnose
description: "Explicit $diagnose workflow for hard bugs and performance regressions. Invoke only when the user names $diagnose; do not auto-trigger from ordinary diagnose or debug wording."
---

# diagnose Live Shim

This is a lightweight live trigger so `$diagnose` remains available without front-loading the full local skill body.

When invoked:

1. Load the canonical skill through `skills-index` with `get_skill_bundle` for `diagnose`.
2. Follow the canonical instructions from `__AGENT_PLATFORM_HOME__/skills/diagnose/SKILL.md`.
3. If `skills-index` is unavailable, read only the needed sections from that canonical path.

Do not treat this shim as the complete skill body.
