# Codex Headless Workers

Use this reference when enterprise stages delegate bounded build, review, forge,
or verify slices to Codex workers.

## Default

Codex remains the lead orchestrator, contract owner, integrator, and final
decision owner. Workers are optional execution helpers for disjoint work.

Use workers only when:

- the contract/build packet names disjoint owned paths
- forbidden paths are explicit
- required commands and output artifacts are explicit
- the lead can continue useful non-overlapping work
- the worker does not need full transcript context

Keep work local when the next step is tightly coupled, high-risk, or blocked on
the result.

## Preflight

Before dispatch:

1. Run `codex mcp list --json` or the available MCP probe for the worker runtime.
2. Confirm required MCP servers/tools are visible.
3. Write a compact packet artifact under `.codex/enterprise-state/dispatch/<slug>/<stage>/`.
4. Include stage, PC/lens ids, owned paths, forbidden paths, required commands,
   output path, stop rules, and artifact schema.
5. Record the dispatch root or worker artifact in the current agent session when
   worker output is used as proof.

Fail closed if MCP parity, skill access, repo policy, or structured output is not
proven for the worker runtime.

## Worker Prompt Packet

Each worker receives only:

- task slug and stage
- relevant contract/build packet excerpt
- exact owned files/directories
- exact forbidden files/directories
- PC or review/forge/verify lens ids
- required source reads already gathered by the lead
- required commands and expected output paths
- stop/refusal conditions
- instruction not to revert or overwrite other workers' edits

Do not pass the full chat transcript.

## Required Worker Output

Workers must return or write:

- changed files, if any
- commands run and pass/fail status
- receipt ids or artifact paths when receipts are used
- PC/lens status
- unresolved risks/blockers
- confirmation that forbidden paths were not touched

For review/forge/verify workers, output must be structured enough for
`validate_worker_artifacts.py` and the final harness to reference.

## Merge Back To Lead

The lead must:

- inspect worker output before relying on it
- integrate or reject changes
- rerun combined checks
- record final evidence in the agent session
- rerun review/forge/verify when code pivots after worker output

Worker success is supporting evidence, not final ship readiness.
