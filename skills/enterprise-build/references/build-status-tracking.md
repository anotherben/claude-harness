# Build Status Tracking

Use `.codex/enterprise-state/agent-sessions/<agent-id>-<slug>-postconditions.json`
to track contract postconditions for the current agent lane. This file is a
machine-proof receipt registry, not a completion claim.

Build may write `pending`, `red`, `green`, `blocked`, and `recycled`. Build must
not write `verified`; verification is a downstream `enterprise-verify` or
`enterprise-harness` state.

Validate transitions before handoff:

```bash
python3 scripts/validate_postcondition_transitions.py --status-file .codex/enterprise-state/agent-sessions/<agent-id>-<slug>-postconditions.json --receipt-log .codex/enterprise-state/command-receipts.jsonl
```

Record the build handoff with exact artifact keys:

```bash
enterprise-agent-session record-stage --repo-root "$PWD" --agent-id <agent-id> --stage build --artifact build_packet=<path> --artifact postconditions=<path> --artifact command_receipts=<path>
```

## Status File Shape

```json
{
  "schema": "enterprise-build-postconditions.v3",
  "agent_id": "<agent-id>",
  "slug": "<work-slug>",
  "contract_file": "docs/contracts/<contract>.md",
  "build_packet_file": ".codex/enterprise-state/<packet>.json",
  "command_receipt_log": ".codex/enterprise-state/command-receipts.jsonl",
  "base_ref": "origin/dev",
  "base_sha": "<base-sha-or-empty>",
  "head_sha": "<head-before-build-or-current-head>",
  "head_sha_after": "<head-after-last-build-edit>",
  "current_git_state": "<agent-session-current-code-state-hash-or-empty>",
  "worktree": "<repo-relative-or-absolute-worktree>",
  "postconditions": [
    {
      "id": "PC-1",
      "type": "postcondition",
      "status": "pending",
      "status_reason": "",
      "contracted_reason": "the specific failing reason Expected RED must prove",
      "allowed_runtime_paths": [],
      "allowed_test_paths": [],
      "allowed_artifact_paths": [],
      "test_file": "",
      "test_name": "",
      "runtime_paths": [],
      "expected_red": "",
      "expected_green": "",
      "red_receipt_id": "",
      "green_receipt_id": "",
      "receipt_ids": [],
      "blocker_reason": "",
      "recycle_reason": "",
      "artifact_path": ".codex/enterprise-state/agent-sessions/<artifact>.json",
      "log_path": ".codex/enterprise-state/agent-sessions/<log>.txt",
      "notes": ""
    }
  ]
}
```

## Command Receipt Shape

RED and GREEN receipts must align with
`enterprise-harness/scripts/run_with_receipt.py` and be current-head proof from
commands that actually ran. Staged, queued, delegated, headless-ready, or
CI-expected commands are not command receipts.

```json
{
  "schema": "enterprise_command_receipt.v1",
  "receipt_id": "<uuid>",
  "id": "PC-1",
  "proof_type": "unit",
  "command": "node --test tests/example.test.js",
  "argv": ["node", "--test", "tests/example.test.js"],
  "shell": false,
  "started_at": "2026-05-26T00:00:00Z",
  "finished_at": "2026-05-26T00:00:01Z",
  "duration_ms": 1000,
  "repo_root": "<repo-root>",
  "base_ref": "origin/dev",
  "base_sha": "<base-sha-or-empty>",
  "head_sha": "<head-before-command>",
  "head_sha_after": "<head-after-command>",
  "head_unchanged": true,
  "exit_code": 0,
  "command_status": "PASS",
  "timed_out": false,
  "test_file": "tests/example.test.js",
  "test_name": "PC-1 behavior",
  "changed_runtime_paths": [],
  "artifact_path": ".codex/enterprise-state/agent-sessions/<receipt-artifact>.json",
  "log_path": ".codex/enterprise-state/agent-sessions/<command-log>.txt",
  "output_excerpt": "...",
  "output_sha256": "<sha256>"
}
```

Required receipt fields:

- `receipt_id`
- `id` or `postcondition_id`
- `command`
- `command_status`
- `proof_type`
- `test_file`
- `test_name`
- `exit_code`
- `started_at`
- `finished_at`
- `head_sha`
- `head_sha_after`
- `output_sha256`
- `artifact_path` or `log_path`

Use `base_ref` and `base_sha` for PR-scoped or changed-file proof. Use
`changed_runtime_paths` for runtime path mapping.

## Status Transitions

- `pending`: no proof has been recorded yet.
- `red`: requires a FAIL receipt whose command proves the contracted RED reason.
- `green`: requires a paired FAIL RED receipt and PASS GREEN receipt for the same postcondition, both current to the build head.
- `blocked`: requires `blocker_reason` or `status_reason`.
- `recycled`: requires `recycle_reason` or `status_reason`.
- `verified`: invalid during build; only downstream verification may produce it.

Rules:

- Never delete entries. Amend by appending receipts or reasons.
- Do not mark `red` unless the command failed for the contracted reason.
- Do not mark `green` unless the paired GREEN command actually ran and proved the postcondition.
- Do not count headless-ready commands, staged commands, planned commands, or CI expectations as GREEN proof.
- Keep receipts portable. Do not store workstation-only command prefixes as proof.
