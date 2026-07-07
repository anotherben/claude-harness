[codex] Starting Codex task thread.
[codex] Thread ready (019f2a53-426d-7d41-b8e8-847d40f30a57).
[codex] Turn started (019f2a53-446c-7ef1-bbf9-9c8f928160ab).
[codex] Turn completed.
# Codex Adversarial Review

Target: working tree diff
Verdict: needs-attention

No ship: the dispatcher/gate refactor still leaves active skills with stale gate mechanics and dangling proof routes.

Findings:
- [high] Bug-factory still tells agents to create a PR body that GATES says will fail (skills/bug-factory/SKILL.md:74-82)
  `skills/go/GATES.md` requires a 6-section PR body including `## AI / Copilot review routing`, and `/go` routes all SHIP work through bug-factory. But bug-factory's active SHIP step still instructs a "correct 5-header body" and omits that required section. A bug-factory-driven PR can therefore be created with a body that the canonical gate rejects, or agents will follow conflicting instructions depending on which file they read last.
  Recommendation: Remove embedded PR-body mechanics from bug-factory or update this step to point only to `skills/go/GATES.md` and use the exact 6-section template.
- [high] GATES presents the merge command without the human authorization guard kept elsewhere (skills/go/GATES.md:21-24)
  The new canonical gate file lists the terminal merge as `gh pr merge <n> --rebase` with "0 human approvals required" but does not distinguish GitHub review approvals from Ben's explicit merge authorization. Active bug-factory text still says the main merge is human-gated, but `/go` says GATES is the only gate source. Inference: once GATES becomes authoritative, an autonomous SHIP path can treat merge as a mechanical final gate and run it without the operator authorization that other active skills still require.
  Recommendation: Add an explicit pre-merge authorization rule to GATES, e.g. GitHub approvals may be zero but `gh pr merge` is forbidden unless Ben authorizes that specific PR in the current conversation.
- [high] Required proof routes still point at archived skills (skills/proof-chain/SKILL.md:17-23)
  `proof-chain` requires running `patch-or-fix` for any changed code and says unavailable proof skills cap the result at BLOCKED/PARTIALLY_PROVED. The diff moves `skills/patch-or-fix/SKILL.md` under `skills/.archive`, while `diagnose` now contains the absorbed mode. Because this file was not updated to route to diagnose's post-fix verification mode or a compatibility wrapper, completion/merge-ready proof either dead-ends or agents skip a mandatory root-cause gate.
  Recommendation: Replace active `patch-or-fix` requirements with the exact new invocation path, such as `/diagnose` post-fix verification mode, or restore a thin `patch-or-fix` wrapper skill that delegates to diagnose.

Next steps:
- Align bug-factory SHIP text with GATES or delete duplicated gate details.
- Patch GATES to preserve explicit operator merge authorization.
- Update active references to archived skills or add compatibility wrappers before shipping the refactor.
