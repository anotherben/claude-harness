# Mechanical Checks

Run these as binary checks before deeper probing:

1. import resolution
2. untracked or orphaned source files
3. contract items without tests
4. debug artifacts
5. obvious drift against the plan
6. tenant or auth safety flags where applicable
7. mutable module-level state or concurrency risks where applicable
8. changed runtime files without executing tests/live/E2E proof
9. schema/query/data claims without real DB proof
10. UI/PDF/file workflows without headless browser proof
11. edge cases from plan/contract without tests or explicit non-goal
12. missing local mirror for required PR body, delivery, no-new-mock, DB ownership, live-proof, or CI gates
13. review/forge evidence captured before a later code pivot
14. reusable skill/generator code hard-coding repo-specific commands instead of reading repo-local config
15. idempotence/tuning/ranking tests pinning volatile implementation constants instead of invariant behavior
16. any explicit contract/TDD/plan/PC clause lacking its own source evidence, executable assertion/test evidence, and runtime/browser/live proof or structured N/A
17. final HEAD, base/target, PR head, gate summary, review/forge/verify artifact heads, command receipt heads, browser proof heads, or runtime provenance disagreeing about the proof subject
18. async/worker/UI/API claims without a route/surface inventory covering every claimed route, event, terminal branch, readiness/health endpoint, runtime volume/dependency, and data-semantic path
19. receipts that say only `PC PASS`, suite PASS, screenshot PASS, or browser PASS without command/log path, current head, clause/surface id, and exercised route or runtime path
20. browser-worker reliability claims without accept response metadata (`runId`, BullMQ id, worker identity, `readinessSnapshot`), `/api/health` compatibility, terminal branches, and disk/data volume readiness
21. scrape/data semantic claims without source-to-consumer proof from accepted job through worker outcome and persisted/projected data
22. full-workflow, full-domain, or full-system claims when any in-scope route/surface/contract row is `NOT PROVED`, stale, or tied to a different SHA/runtime provenance

Hard failures should be fixed before deeper forge work continues.
