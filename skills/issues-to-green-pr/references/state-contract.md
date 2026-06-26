# Issues To Green PR State Contract

Use JSON handoffs so automation can resume, audit, and pass work between agents
without relying on chat transcript memory.

## Storage

Default:

```text
~/.codex/runs/issues-to-green-pr/<run-id>/
```

Optional repo mirror when the active route allows it:

```text
.codex/issues-to-green-pr/<run-id>/
```

## Required Files

```text
run.json
issues/<issue>/issue-intake.json
issues/<issue>/diagnose-packet.json
issues/<issue>/blast-radius-summary.json
issues/<issue>/build-plan.json
issues/<issue>/build-output.json
issues/<issue>/proof.json
issues/<issue>/independent-review.json
issues/<issue>/patch-or-fix.json
issues/<issue>/pr-readiness.json
issues/<issue>/pr.json
issues/<issue>/issue-close.json
```

Create only files that match phases reached by the issue. Keep every file
append-safe by writing a new `updated_at` and preserving previous evidence paths.

## Common Envelope

Every JSON file uses this envelope:

```json
{
  "schema_version": "issues_to_green_pr.v1",
  "run_id": "2026-06-13T00-00-00Z-example",
  "repo": "owner/name",
  "issue": 1234,
  "phase": "diagnose",
  "agent_role": "diagnosis-agent",
  "agent_instance_id": "subagent-or-session-id",
  "subagent_session_id": "optional-session-id",
  "job": "one sentence, one job",
  "input_paths": [],
  "output_paths": [],
  "head_sha": "unknown",
  "base_ref": "origin/dev",
  "environment": {
    "worktree": "",
    "database": "",
    "services": []
  },
  "status": "blocked",
  "evidence": [],
  "assumptions": [],
  "self_review": {
    "performed": true,
    "findings": [],
    "residual_risk": [],
    "ready_for_independent_review": false
  },
  "next_state": "blocked",
  "blockers": [],
  "updated_at": "2026-06-13T00:00:00Z"
}
```

`status` and `next_state` must use the states from `SKILL.md`.

## Evidence Rows

Evidence rows must be concrete:

```json
{
  "id": "E1",
  "claim": "The route delegates writes to the owning service",
  "source": "apps/api/src/routes/example.js:42",
  "command": "sed -n '35,55p' apps/api/src/routes/example.js",
  "sha": "abcdef123",
  "result": "PROVEN"
}
```

`result` must be `PROVEN`, `CONTRADICTED`, or `UNPROVEN`.

## Agent Roles

Use one of these roles unless the lead records a reason for adding a narrower
role. Each role must be executed by a distinct Codex subagent or separate Codex
session for the same issue:

- `intake-agent`
- `diagnosis-agent`
- `blast-radius-agent`
- `build-agent`
- `proof-agent`
- `independent-review-agent`
- `patch-or-fix-agent`
- `pr-babysitter-agent`
- `deployment-proof-agent`
- `issue-close-agent`

No role may do another role's job. For example, a `build-agent` may run focused
tests for its own feedback, but it cannot be the `proof-agent` or
`independent-review-agent`.

Every phase file must record `agent_instance_id` or `subagent_session_id`.
Missing worker identity means the handoff is invalid and the lead must not
advance the issue.

## Phase-Specific Minimums

`issue-intake.json`:

- live labels and issue URL
- classification
- reason
- safe automation mode

`diagnose-packet.json`:

- valid `diagnose.build_packet.v1` payload from `$diagnose`
- root-cause status
- proof surface
- exact allowed build paths or stop reason

`blast-radius-summary.json`:

- report path
- checklist path
- verdict
- finding counts by severity
- live schema status
- required proof commands

`build-output.json`:

- changed files
- commits if any
- tests run by builder
- self-review findings
- explicit handoff to proof agent

`proof.json`:

- commands run
- exit codes
- target SHA
- runtime target
- database/service target
- pass/fail snippets

`independent-review.json`:

- review verdict
- files reviewed
- builder self-review checked
- findings and required recycle work

`patch-or-fix.json`:

- formal verdict
- packet path
- validation result
- remaining required fix items

`pr-readiness.json`:

- target base and expected CI checks
- live GitHub branch-protection snapshot
- live GitHub branch-rules/ruleset snapshot
- active workflow inventory relevant to the target branch
- separation of GitHub-required checks from active-but-not-required workflows
- PR body path
- required PR sections with evidence summary
- placeholder scan result
- front-loaded local gate commands and results
- substance-check receipt path when the repo has that gate
- live-proof registry status
- branch freshness or rebase result
- decision: `ready`, `pr-not-ready`, or `blocked`

`pr.json`:

- PR URL and number
- head SHA
- target base
- required PR sections and evidence status
- front-loaded gate result summary
- expected CI checks by name
- checks summary
- review thread count
- Codex/Copilot review state
- merge eligibility

`issue-close.json`:

- close authorization
- merged target
- post-merge proof
- issue comment body
- close command result
