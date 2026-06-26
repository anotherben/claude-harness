# Issue To Green PR State Contract

Use this contract for the standalone single-issue workflow. Store all files
under:

```text
~/.codex/runs/issue-to-green-pr/<run-id>/issues/<issue-number>/
```

Optional repo mirror when route policy allows it:

```text
.codex/issue-to-green-pr/<run-id>/issues/<issue-number>/
```

## Required Files

Create only files for phases reached:

```text
run.json
target-issue.json
diagnose-packet.json
blast-radius-summary.json
build-output.json
proof.json
independent-review.json
patch-or-fix.json
pr-readiness.json
pr.json
issue-close.json
```

## Common Envelope

```json
{
  "schema_version": "issue_to_green_pr.v1",
  "run_id": "2026-06-13T00-00-00Z-example",
  "repo": "owner/name",
  "issue": 1234,
  "issue_url": "https://github.com/owner/name/issues/1234",
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

`agent_instance_id` or `subagent_session_id` is required for every worker phase.
Missing worker identity invalidates the handoff.

## Evidence Rows

```json
{
  "id": "E1",
  "claim": "The target branch requires copilot-review-wait by ruleset",
  "source": "GitHub branch rules API",
  "command": "gh api repos/owner/name/rules/branches/dev",
  "sha": "abcdef123",
  "result": "PROVEN"
}
```

`result` must be `PROVEN`, `CONTRADICTED`, or `UNPROVEN`.

## Phase Minimums

`target-issue.json`:

- explicit target input
- resolved repo, issue number, issue URL
- live issue title, labels, state, comments/links summary
- classification and safe run mode

`diagnose-packet.json`:

- valid `diagnose.build_packet.v1`
- root-cause status
- proof surface
- exact allowed build paths or stop reason

`blast-radius-summary.json`:

- report/checklist path
- verdict
- finding counts by severity
- live schema/status/thread context
- required proof commands

`build-output.json`:

- changed files and commits
- tests run by builder for feedback
- self-review findings
- explicit handoff to proof agent

`proof.json`:

- commands, exit codes, target SHA
- runtime target
- database/service target
- pass/fail snippets

`independent-review.json`:

- verdict
- files reviewed
- builder self-review checked
- findings and recycle instructions

`patch-or-fix.json`:

- formal verdict
- packet path
- validation result
- remaining required fix items

`pr-readiness.json`:

- live GitHub branch-protection snapshot
- live branch rules/ruleset snapshot
- active workflow inventory
- GitHub-required checks vs active-but-not-required workflows
- PR body path
- required PR sections with evidence status
- placeholder scan result
- local gate command results
- live-proof registry status
- branch freshness or rebase result
- decision: `ready`, `pr-not-ready`, or `blocked`

`pr.json`:

- PR URL and number
- head SHA and target base
- checks summary
- review-thread count
- Codex/Copilot review state
- merge eligibility

`issue-close.json`:

- close authorization
- merged target
- post-merge proof
- issue comment body
- close command result
