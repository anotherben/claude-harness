# Final Gate Checks

Run and record:

1. required artifacts exist
2. no forbidden Claude files were modified
3. expected skill folders exist
4. frontmatter exists in every `SKILL.md`
5. staged references exist where linked
6. install target is not touched without approval
7. verification report exists for the current agent session
8. every contract `PC-*` and invariant has trace proof: current evidence file, command output, test file, test name, and changed runtime path or documented non-runtime reason
9. changed runtime files have code execution proof, E2E trace proof, or documented non-runtime reason
10. intent continuity is proven: original user words, business outcome, operator acceptance, non-goals, and proof rows still match the final diff
11. touched-file SRP proof exists for every changed file; contracted `fix-now` refactors are implemented and mixed-responsibility files are not left as vague follow-up cleanup
12. DB/query ownership proof exists for every SELECT, write, repair, projection, sync, migration, report, verifier, and live-proof query, including owner seam, current DB/schema, scoping, affected-row/readback, bounded proof, cleanup, and redaction evidence
13. schema, query, and data-sensitive changes have live/integration DB proof, not mock-only, migration-only, or diff-only evidence
14. UI, PDF, file upload, preview, download, and rendered workflow changes have headless browser evidence
15. edge cases named in plan or contract are verified or explicitly blocked
16. `PARTIALLY PROVED`, `UNPROVED`, mock-only, stale, wrong-head, missing intent-continuity, missing touched-file SRP, missing DB/query ownership, and important untested edge-case evidence are treated as FAIL, not WARN
17. remaining risks are named explicitly
18. repo gate matrix passed locally: PR body/delivery gate, no-new-mock guard, DB ownership gate, live-proof registry, and required CI mirrors
19. review and forge artifacts cover the current final diff after any CI-driven pivot
20. PR timing policy is satisfied: normal PRs can remain open, high-risk PRs are draft until gates pass or have an explicit exception, and Copilot/advisory comments are either reviewed on current head or routed to advisory-harvest
21. Verification commands were run through `run_with_receipt.py`, producing current-head command receipts
22. `check_pc_trace.py` passes against the current postcondition registry, verification evidence, and receipt log
23. `changed_file_proof_map.py` passes for the current diff, verification evidence, and receipt log
24. `validate_architecture_contract.py` passes for the recorded build packet or locked contract
25. Architecture proof shows changed files obey the named module boundary, folder placement, public seam, owner layer, dependency direction, forbidden imports, and architecture tests
26. `validate_worker_artifacts.py` passes for every delegated Codex worker output, or the verification report records that no delegated workers were used
27. `pr_readiness_gate.py` passes for PR-backed work or the verification report records `not-applicable`; high-risk non-draft exceptions need receipt-backed gate evidence
28. `validate_structured_proof.py` passes for verification, forge/review, and solution artifacts
29. `validate_release_readiness.py` passes against the verification artifact
30. `enterprise_release_risk` exists and classifies the lane as `low`, `medium`, `high`, or `critical` with evidence from changed surfaces, data sensitivity, tenant/security exposure, deploy/config/migration impact, and rollback difficulty
31. `enterprise_post_merge_test_kit` passes for deployable PRs: a `post-merge-test-kit` artifact is drafted before merge/pr-readiness, or the verification report records a concrete non-deployable reason
32. `enterprise_rollback_readiness` passes for high/critical releases: rollback owner, rollback trigger, rollback command/procedure, feature-flag or disable path, migration/data rollback posture, and communication owner are present or explicitly not-applicable with evidence
33. `enterprise_observability_proof` passes: exact log source/query, metrics/dashboard, health check, queue/job/readback signal, alert/watch window, and post-deploy owner are recorded for affected runtime surfaces
34. `enterprise_security_privacy_proof` passes when relevant: auth, tenant scope, permissions, PII, secrets, payment, webhook, upload, and external integration boundaries have explicit proof with redacted evidence
35. `enterprise_performance_regression` passes when relevant: hot paths, queries, workers, syncs, rendering, PDF/file flows, or high-volume loops have a regression budget and proof for latency, query plan/index safety, queue backlog, timeout/retry behavior, or a documented not-applicable reason
36. `enterprise_intent_continuity` passes: final implementation and proof preserve original user words, business outcome, operator acceptance, and non-goals
37. `enterprise_touched_file_srp` passes: changed files honor SRP classifications, public seams, owner layers, and contracted `fix-now` refactors
38. `enterprise_db_query_ownership` passes: every query path, including read-only proof/report queries, stays on the approved owner seam and proves scoping/readback/bounded-work semantics
39. `enterprise_branch_reason_coverage` passes: new mode flags, reason strings, status/code branches, SQL branches, and structured result paths have positive, negative, sibling-reason, idempotent repeat, and placeholder-ordering proof where applicable
40. `enterprise_cast_index_safety` passes: SQL/parser casts from JSON/text/external IDs guard empty, malformed, and out-of-range values before casting, and changed predicates remain indexable or carry query-plan proof
41. `enterprise_runtime_proof_parity` passes: verifier, replay, backtest, report, live-proof, and production runtime logic share helpers or prove equivalent predicates, inputs, and truth conditions
42. `enterprise_proof_lane_integrity` passes: live-proof registries, command selectors, CI mirrors, and route/file matchers select domain-specific lanes for mixed diffs and fail non-zero when asserted runtime resources are absent
43. `enterprise_integration_fault_matrix` passes: external integrations prove fallback criteria, timeout/cancellation, idempotent retry boundaries, sanitized external errors, and no duplicate side effects
44. `enterprise_boundary_scope_invariants` passes: tenant, supplier, owner, affected-row, identifier, omitted-field/upsert, and governed-write invariants are proven for every changed read/update path
45. `enterprise_observability_redaction_contract` passes: log/error changes prove secret redaction for adversarial message/stack/non-object shapes, stable log field shape, useful diagnostics, and redacted live operational identifiers
46. `enterprise_public_seam_consumer_contract` passes: exports, startup seams, API clients, UI lock/rehydration, nested-route specificity, custom-control keyboard/focus behavior, and downstream consumers are proven where relevant
47. `enterprise_architecture_ratchet` passes: changed boundaries, public seams, owner layers, allowed dependency direction, forbidden imports, architecture tests, and future regression traps are proven or structured not-applicable with applicability predicate, source evidence, current head, and non-runtime scope
48. `enterprise_local_full_schema_proof` passes: schema/query/data-sensitive work has explicit dev/staging/test/local/non-production Postgres source, local target identity, restore/migration command, runtime query proof, safety controls, and cleanup; N/A is valid only for doc-only/no-runtime/no-db changed paths with source evidence
49. `enterprise_evidence_portability` passes: verification and PR-readiness artifacts are current-head/current-base, portable, and internally consistent, with no committed workstation-local command prefixes, stale PR-state checklists, placeholders, missing frontmatter, leaked live identifiers, or contradictory gate status
50. `enterprise_test_integrity` passes: no new schema-coupled DB mocks, restored environment, behavior/runtime proof over source-string proof, stable assertions over brittle counts, and seam/startup tests for changed public seams

Use `FAIL` for missing artifacts or unauthorized install writes.
Use `FAIL` when a contract item is represented only by a test count, suite summary, or stale report instead of PC-level trace proof.
Use `FAIL` for missing code execution proof, required live DB proof, required E2E trace proof, or required headless browser proof.
Use `FAIL` when original intent has evaporated into generic implementation proof, when touched-file SRP classifications are missing or ignored, or when DB/query ownership is missing for read-only proof/report queries.
Use `FAIL` when required repo gates are only assumed from CI or when review/forge evidence predates the current code.
Use `FAIL` when a high-risk PR is treated as normal without rationale, when stale Copilot/advisory review is counted as current-head evidence, or when useful advisory comments are skipped without fix/follow-up/trap/gate/eval disposition.
Use `FAIL` when structured proof blocks are missing, stale, not on the current head, partially proved, mock-only, source-string-only for runtime behavior, or do not map every changed runtime file.
Use `FAIL` when delegated worker claims are not backed by Codex headless worker result artifacts.
Use `FAIL` when SRP/folder/module claims are vague, private-helper-only, missing a public seam test, or not backed by the architecture contract gate.
Use `FAIL` when release risk is unclassified, deployable PRs lack a drafted post-merge test kit, rollback ownership is vague, observability proof is only "watch logs", security/privacy-sensitive changes lack explicit redacted proof, performance-impacting changes lack a regression budget, intent continuity is unproven, touched-file SRP/refactor proof is missing, DB/query ownership is missing for any read/write/report/proof path, proof lanes can false-pass, artifacts are stale/non-portable, branch/reason-set or cast/index proof is missing, runtime/proof parity is unproven, integration fault semantics are not locked, boundary/scope invariants are missing, public seam consumers are not proven, architecture ratchets are absent, local full-schema proof is missing for schema/query work, test integrity is weak, or async/inventory/invoice/label-printing lifecycle proof is partial. Missing exact field-spelling, preserved confirmation, commit-boundary, helper return-variant, retry, or rehydration proof is partial lifecycle proof.
