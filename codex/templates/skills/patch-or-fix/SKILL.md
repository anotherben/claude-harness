---
name: patch-or-fix
description: "Explicit $patch-or-fix review of whether a bug fix addresses the root cause. Invoke only when the user or repository instructions name $patch-or-fix."
---

# patch-or-fix Live Shim

This is a lightweight live trigger so `$patch-or-fix` remains available without front-loading the full local skill body.

When invoked:

1. Load the canonical skill through `skills-index` with `get_skill_bundle` for `patch-or-fix`.
2. Follow the canonical instructions from `__AGENT_PLATFORM_HOME__/skills/patch-or-fix/SKILL.md`.
3. If `skills-index` is unavailable, read only the needed sections from that canonical path.

Do not treat this shim as the complete skill body.
