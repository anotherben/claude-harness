# Contract Quality Gate

All checks must pass before the contract can move from `DRAFT` to `LOCKED`.

1. Every deliverable from the design appears in the contract.
2. Every postcondition can become a concrete test assertion.
3. Every changed output has a consumer map.
4. Blast radius covers siblings, consumers, and alternate entry points.
5. Error cases cover user input and external dependencies.
6. Non-goals are explicit.
7. Traceability matrix has no orphaned contract items.
8. Proof-scope label matches what is actually covered.
9. Order hardening docs were read when applicable.
10. No vague words like `works`, `handles`, `appropriately`, or `etc`.
11. Every postcondition is grounded in current code read in this branch/worktree.
12. No postcondition is based only on migrations, diffs, branch names, or plan prose.
13. Every schema/query/data-sensitive postcondition names real DB evidence and a mock-free live/integration test.
14. File and module architecture records responsibility, directory rationale, public seam, and SRP risk.
15. Mechanical Build Packet names exact `Module Boundary`, `Folder Placement`, `Public Seam`, `Owner Layer`, `Allowed Dependency Direction`, `Forbidden Imports`, and `Architecture Tests`.
16. Architecture tests are public-seam tests: module graph, startup seam, seam-load, or equivalent consumer smoke proof; private-helper-only tests do not satisfy this gate.
17. Every changed runtime file maps to code-level proof and source-to-consumer E2E trace.
18. Edge cases are tested or explicitly scoped out.
19. UI, PDF upload, file upload, preview/download, modal, navigation, and rendered-output workflows name headless browser proof.
20. PR Review Prevention Matrix exists for non-trivial or PR-producing work, and every applicable row maps to a PC/INV/ERR item plus a required proof command.
21. Branch/reason/status/SQL-path changes have positive, negative, sibling-reason, idempotent repeat, and placeholder-ordering proof where applicable.
22. Async/deferred/worker work has claim, reclaim, timeout, retry, idempotency, terminal-state, partial-commit, and duplicate-side-effect proof where applicable.
23. Interface/config/input changes preserve caller compatibility and lock omitted/nullish/falsy handling with negative tests.
24. SQL/migration work proves cast safety, indexability, migration immutability/checksum posture, concurrent-index/lock posture, and bounded live-proof query scope.
25. Verifier/replay/backtest/report/live-proof code proves runtime-to-proof parity by sharing helpers or proving equivalent predicates and truth conditions.
26. Proof infrastructure proves lane ownership, mixed-file collision behavior, and missing-resource fail-closed behavior.
27. Security/observability/error changes prove secret redaction for adversarial message/stack/non-object shapes, stable log fields, useful diagnostics, and live-data redaction.
28. UI custom controls and navigation changes prove keyboard/focus behavior, nested-route specificity, lock/rehydration behavior, and visible consumer state.
29. Artifacts prove portable commands, current head/base, consistent receipts/counts/timestamps, required frontmatter, no placeholders, no stale PR-state text, and no live operational identifiers.
30. Test strategy proves no new schema-coupled DB mocks, restored env, runtime behavior over source-string proof, and stable assertions over brittle counts.
31. Architecture Ratchet Matrix proves changed boundaries, public seams, owner layers, allowed dependency direction, forbidden imports, architecture tests, and future regression traps before build.
32. Local Full-Schema Proof Plan exists for schema/query/data-sensitive work, using an explicit dev/staging/test/local/non-production Postgres source with local target identity, restore, migration, runtime query proof, safety controls, and cleanup. N/A requires an applicability predicate, source evidence, and changed paths proving doc-only/no-runtime/no-db scope; otherwise the contract blocks or narrows the claim.
