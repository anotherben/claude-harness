# Workflow Routing

## Path Matrix

| Path | Use When | Required Stages | Completion Standard |
|------|----------|-----------------|---------------------|
| `NO_ENTERPRISE` | local agent, skill, hook, Codex config, or agent-platform maintenance outside the target repo | none | local verification only; do not create target-repo enterprise artifacts |
| `DISCOVER_ONLY` | new repo, new computer, missing repo profile, or portability refresh is the task | discover | committed repo profile plus generated repo-local overlay |
| `QUICK` | 1-2 file changes, low ambiguity, low blast radius | inline contract -> build -> verify | verified local proof only |
| `STANDARD` | clear feature or bugfix with a moderate blast radius | plan -> plan-360-audit -> contract-manager -> contract -> build -> review -> forge -> verify -> pr-readiness -> compound | verified slice-level or domain-level proof plus adversarial recycle proof |
| `FULL` | architecture-bearing work, enterprise hardening, or ambiguous multi-layer changes | discover -> brainstorm -> plan -> plan-360-audit -> contract-manager -> contract -> build -> review -> forge -> verify -> pr-readiness -> compound | explicit proof scope plus current artifacts |
| `DEBUG` | failing tests, regressions, or unexplained behavior | discover if needed -> debug -> plan -> plan-360-audit -> contract-manager -> contract -> build -> review -> forge -> verify -> pr-readiness -> compound | root cause, adversarial recycle, and regression proof |
| `STAGE_ONLY` | upstream artifacts already exist and the task is entering a specific stage mid-pipeline | the named stage only, then normal downstream continuation | inherits the broader program path; do not re-triage from scratch |

## Artifact Gates

| Stage | Requires |
|------|----------|
| `discover` | none |
| `brainstorm` | repo context, repo profile if unfamiliar |
| `plan` | approved design |
| `plan-360-audit` | current agent session has a written plan recorded |
| `contract-manager` | current agent session has a written plan and Plan 360 audit recorded when the lane has a plan |
| `contract` | current agent session has a written plan and Plan 360 audit recorded when the lane has a plan |
| `build` | current agent session has a locked contract and recorded contract-manager review |
| `review` | current agent session has implemented build work recorded |
| `forge` | current agent session has a completed review artifact recorded |
| `verify` | current agent session has completed the required build/review path |
| `pr-readiness` | current agent session has review, forge, and verify recorded in order against the current code state |
| `merge` | same as `pr-readiness`; use this before any actual merge command |
| `compound` | current agent session has completed verify |

## Proof Scope Labels

| Label | Meaning |
|------|---------|
| `function-level` | one function or one local behavior proven |
| `slice-level` | one end-to-end slice proven inside a bounded path |
| `domain-level` | a coherent domain or subsystem proven |
| `full-system` | all required paths, return legs, and downstream consumers proven |

Never upgrade the label by implication. If a leg is missing, name the smaller label.

## Mid-Pipeline Entry

If design, plan, or contract artifacts already exist and the user asks what to do next, prefer `STAGE_ONLY` over re-running top-level triage. Examples:

- skill-only or global-agent maintenance outside the target repo -> `NO_ENTERPRISE`
- repo bootstrap or portability refresh is the task -> `DISCOVER_ONLY`
- approved design exists -> `plan`
- written plan exists but no Plan 360 audit is recorded -> `plan-360-audit`
- Plan 360 audit exists but no contract-manager review is recorded -> `contract-manager`
- locked contract exists -> `build`
- build is done -> `review`
- review is done -> `forge`
- forge is done -> `verify`
- verify is done and a PR/merge claim is needed -> `pr-readiness` or `merge`
- verified work exists -> `compound`

Upstream stage checks are always per-agent. Another agent working in the same repo does not satisfy your gate.

Prefer the hook-generated route card over prose triage when it exists:
`.codex/enterprise-state/hook-ledger/latest-route-card.json` names the startup
route, edit boundary, clean-worktree requirement, and PR/merge gates. Prefer
`NO_ENTERPRISE` over opening or continuing an enterprise lane when the card says
`LOCAL_AGENT_MAINTENANCE` and every target path is outside the target repo.
