# Adversarial Lenses

Use at least these five lenses:

1. `3AM diagnosis`: would logs and evidence explain the failure to an on-call engineer?
2. `Delete test`: what can be removed with no effect, suggesting dead code or dead assertions?
3. `New hire`: would a future maintainer understand the contract and implementation boundary?
4. `Adversary`: how would a malicious or careless caller break this?
5. `Scale`: what changes at 10x, 100x, or under bursty concurrency?
6. `Schema reality`: does current code actually match the live DB schema/query behavior without mocks?
7. `Code execution`: did the tests/E2E commands execute every changed runtime file?
8. `E2E edge path`: does each workflow run source-to-consumer with null/empty/tenant/permission/error/retry cases?
9. `Headless UI`: do browser-visible, PDF upload, file upload, preview/download, modal, or navigation flows pass in headless browser automation?
10. `Gate pessimist`: would the PR body, delivery gate, no-new-mock guard, DB ownership gate, live-proof registry, or required CI checks fail this after push?
11. `Stale pass`: did any review/forge pass happen before a later code pivot, leaving unreviewed current code?
12. `Portability`: did reusable generators, templates, or global skills hard-code one repo's commands, paths, or exceptions instead of reading repo-local config?
13. `Volatile constants`: do idempotence, tuning, ranking, heuristic, or generated-score tests pin current magic numbers instead of proving transitions and stability?
14. `Clause coverage`: does every explicit contract/TDD/plan/PC clause have exact source evidence, executable assertion/test evidence, and runtime/browser/live proof or structured N/A?
15. `Proof subject freshness`: do final HEAD, base/target, PR head, review/forge/verify artifacts, gate summaries, receipts, browser proofs, and runtime provenance name the same current subject?
16. `Runtime surface inventory`: for async/worker/UI/API work, did proof cover every claimed route, event, terminal branch, readiness/health surface, runtime volume/dependency, and data-semantic path instead of only a smoke subset?
17. `Browser-worker reliability`: if the lane claims browser-worker behavior, did proof exercise accept response metadata, backwards-compatible health routes, worker identity/queue metadata, terminal branches, disk/data volume readiness, and claimed scrape/data semantics?
18. `Receipt specificity`: would each receipt let a reviewer identify the command, log/artifact path, head SHA, contract clause or runtime surface, and exact exercised route without reading surrounding prose?
19. `Subset overclaim`: is the final claim narrower than or equal to the proved inventory, or is a smoke/admin/Chrome subset being used to imply full worker, domain, or system safety?

Classify each finding as either:

- `bug` -> recycle into the contract
- `improvement` -> log, but do not block unless risk is material
