# Agent Stage Gates

Gate enforcement is agent-bound, not repo-bound.

Before a gated stage starts, run the stable wrapper:

```bash
enterprise-required-gates --repo-root "$PWD" --agent-id <agent-id> --stage <stage>
```

The required-gates runner wraps the agent-session stage gate and the portable
enterprise self-checks. Agents must call it from `$enterprise`; users should not
have to run separate `npm`, `node`, or harness commands to prove enterprise
compliance.

Use stable wrappers from any worktree, including clean promotion worktrees that
do not yet contain repo-local gate files:

```bash
enterprise-required-gates --repo-root <repo-root> --stage <stage> --agent-id <agent-id>
enterprise-agent-session record-stage --repo-root <repo-root> --agent-id <agent-id> --stage <stage> --artifact key=path
enterprise-containment --repo-root <repo-root> --agent-id <agent-id> --path <file>
```

The wrapper prefers `tools/enterprise-skills/enterprise/scripts/enterprise_required_gates.py`
when present and falls back to the reviewed global copy under
`~/.codex/skills/enterprise/scripts/`.

From `build` through `merge`, the runner also executes
`validate_enterprise_containment.py`. If source files changed, containment fails
unless the same agent session has a locked contract, a mechanical
`build_packet`, and every touched source file is covered by `Allowed Runtime
Paths` or `Allowed Test Paths`. Non-`QUICK` lanes also require the full
plan/plan-360-audit/contract-manager chain. `QUICK` lanes may skip that full
chain only when the session records `path_classification=QUICK` plus the locked
quick contract and mechanical packet. This is the anti-freehand lock: source
edits outside the packet cannot become build-ready, PR-ready, merge-ready, or
done.

For `harness`, `pr-readiness`, and `merge`, the same runner also fails closed
unless final proof artifacts are present and the receipt-backed harness scripts
run: `check_pc_trace.py`, `changed_file_proof_map.py`,
`validate_structured_proof.py`, `validate_release_readiness.py`,
`validate_worker_artifacts.py` when delegated workers were used, and
`pr_readiness_gate.py` for PR-backed readiness or merge. These scripts treat
`PARTIALLY PROVED`, `UNPROVED`, mock-only, stale, wrong-head, and failed proof
states as FAIL; only full proof can pass final gates.

After a stage writes its artifact, record the handoff:

```bash
enterprise-agent-session record-stage --repo-root "$PWD" --agent-id <agent-id> --stage <stage> --artifact key=path
```

Minimum upstream requirements by stage:

- `contract`: recorded `plan` plus recorded `plan_360_audit`
- `build`: non-`QUICK` requires recorded `plan`, recorded `plan_360_audit`, recorded `contract_review`, recorded `contract`, recorded `build_packet`, contract file is `LOCKED`, and the build packet passes the mechanical packet check. `QUICK` requires recorded `contract`, recorded `build_packet`, `path_classification=QUICK`, `LOCKED`, and mechanical packet.
- `review`: recorded `build`, recorded `plan`, recorded `plan_360_audit`, recorded `contract_review`, recorded `contract`, recorded `build_packet`, and the build packet passes the mechanical packet check
- `forge`: recorded `review`, recorded `plan`, recorded `plan_360_audit`, recorded `contract_review`, recorded `contract`, recorded `review` artifact
- `verify`: recorded `build`, recorded `plan`, recorded `plan_360_audit`, recorded `contract_review`, recorded `contract`, recorded `build_packet`, and review + forge evidence unless the path is `QUICK`
- `harness`: recorded `review`, recorded `forge`, recorded `verify`, recorded `build_packet`, `review`, `forge_report`, and `verification` artifacts; review/forge/verify must be in order and cover the current code state
- `pr-readiness`: recorded `review`, recorded `forge`, recorded `verify`, recorded `build_packet`, `review`, `forge_report`, and `verification` artifacts; review/forge/verify must be in order and cover the current code state
- `merge`: same as `pr-readiness`; run this before any merge command
- `compound`: recorded `verify` and recorded `verification` artifact

The `build_packet` artifact may point at the locked contract if that contract
contains a complete `Mechanical Build Packet` section. The
`mechanical_build_packet` check mirrors `BUILD_PACKET_REQUIRED_TERMS` in
`agent_session.py` and requires these exact packet fields: `Allowed Runtime Paths`,
`Allowed Test Paths`, `Allowed Artifact Paths`, `Module Boundary`,
`Folder Placement`, `Public Seam`, `Owner Layer`, `Allowed Dependency Direction`,
`Forbidden Imports`, `Architecture Tests`, `Postcondition Execution Order`,
`Expected RED`, `Expected GREEN`, `Required Commands`, `Forbidden Changes`, and
`Refusal Conditions`. The check is semantic, not just string-based: path fields
must name exact paths, command fields must name exact commands, architecture fields
must name exact seams/layers/import direction/architecture tests, and vague entries
such as affected files, relevant tests, standard checks, clean architecture, normal
layering, or TBD/pending text fail before BUILD, REVIEW, VERIFY, HARNESS, PR
readiness, or MERGE can start. For async, worker, order, invoice, inventory,
pricing, label-printing, notification, staff workflow, SQL/cast, live-proof,
verification-artifact, or PR-readiness lanes, the packet must name field-level,
lifecycle, branch/reason-set, cast/index-safety, runtime-proof-parity,
proof-lane-integrity, integration-fault, boundary-invariant,
architecture-ratchet, local-full-schema, observability-redaction, public-seam/UI/accessibility, bounded-live-proof,
test-integrity, and artifact-portability proof commands early enough for
build/review/forge to catch issues before final PR review, including exact producer field spelling, old synchronous
confirmation/error preservation, commit-boundary bookkeeping, helper return variants, retry, rehydration, sibling reason branches, malformed/out-of-range casts, runtime/proof parity, proof-lane collisions, missing-resource proof failures, external fallback/idempotency, tenant/supplier/owner invariants, architecture boundary regression traps, local Postgres full-schema proof, redaction/log contracts, consumer seam/UI accessibility proof, no-mock/source-string proof integrity, and portable/current artifacts. The `$enterprise` required-gates runner also runs
`validate_architecture_contract.py` for build/review/forge/verify/harness/pr-readiness/merge.
It also runs `validate_enterprise_containment.py` for those stages so the final
diff cannot drift outside the packet.

For edit-time enforcement, repos can run the same script with explicit `--path`
arguments from Edit/Write/MultiEdit hooks. For Codex-authored commits, repos can
run it with `--include-staged` from a pre-commit hook. In Helpdesk, staged
source commits are gated when `CODEX_CI` or `CODEX_ENTERPRISE_AGENT_ID` is
present, so ordinary human commits are not forced through the agent-session gate
while agent commits are.

Recommended artifact keys:

- `design`
- `plan`
- `plan_360_audit`
- `contract_review`
- `contract`
- `build_packet`
- `postconditions`
- `review`
- `forge_report`
- `verification`
- `pr_readiness`
- `solution`
