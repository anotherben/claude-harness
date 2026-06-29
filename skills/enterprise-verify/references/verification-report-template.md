# Verification Report Template

```markdown
# Enterprise Verification Report

**Task**: ...
**Date**: YYYY-MM-DD
**Evidence Window**: fresh commands run in this session
**Proof Verdict**: PROVED | UNPROVED
**Proof Scope**: function-level | slice-level | domain-level | full-system
**Proof Scope Boundary**: widest proved scope; fail if broader than proved rows

## Proof Subject Integrity

- final HEAD:
- target/base branch or SHA:
- PR head:
- review artifact head:
- forge artifact head:
- verify artifact head:
- gate summary head:
- receipt heads:
- browser proof heads:
- runtime provenance/deploy source:
- artifact staleness check:
- mismatch verdict: PASS/FAIL with reason

## Proof Scope Boundary

- claimed scope:
- widest proved scope:
- subset-overclaim verdict: PASS/FAIL with reason
- `NOT PROVED` rows blocking a wider claim:

## Automated Checks

- tests:
- build:
- lint:
- import resolution:
- debug artifact scan:

## Contract Clause Coverage

| Clause | Source Evidence | Assertion/Test Evidence | Runtime/Browser/Live Proof | N/A Predicate | Head SHA | Verdict |
|--------|-----------------|-------------------------|----------------------------|---------------|----------|---------|
| PC-1 | file/symbol/line | command/test/receipt | command/artifact | empty unless N/A | SHA | PASS/FAIL |

## Intent Continuity

| Original User Words | Business Outcome | Operator Acceptance | Non-Goals | Proof | Verdict |
|---------------------|------------------|---------------------|-----------|-------|---------|
| ... | ... | ... | ... | command/artifact | PASS/FAIL |

## Code Execution Trace

| Changed Runtime File | Executing Evidence | Result |
|----------------------|--------------------|--------|
| `path/to/file.js` | test/live/E2E command | PASS/FAIL |

## Touched File SRP Proof

| Changed File | SRP Classification | Required Action | Public Seam / Owner Layer Proof | Result |
|--------------|--------------------|-----------------|----------------------------------|--------|
| `path/to/file.js` | fix-now/follow-up/note-only | extraction/non-goal/source-backed note | command/artifact | PASS/FAIL |

## E2E Trace And Edge Cases

| Workflow | Source Of Truth | Final Consumer | Edge Cases Tested | Evidence |
|----------|-----------------|----------------|-------------------|----------|
| ... | DB/API/input/file | UI/export/log | null/empty/tenant/permission/retry | command |

## Runtime Route And Surface Inventory

| Surface | Claimed Behavior | Proof | Result |
|---------|------------------|-------|--------|
| route/event/terminal branch/readiness/health/volume/data path | exact claim | command/artifact or structured N/A | PROVED/NOT PROVED/N/A |

## Browser-Worker Reliability Proof (When Applicable)

| Required Surface | Proof | Result |
|------------------|-------|--------|
| accept response metadata: `runId`, BullMQ id, worker identity, `readinessSnapshot` | command/artifact | PROVED/NOT PROVED/N/A |
| `/api/health` compatibility and readiness endpoint behavior | command/artifact | PROVED/NOT PROVED/N/A |
| terminal worker branches and retry/failure outcomes | command/artifact | PROVED/NOT PROVED/N/A |
| disk/data volume readiness for actual runtime paths | command/artifact | PROVED/NOT PROVED/N/A |
| claimed scrape/data semantics source-to-consumer | command/artifact | PROVED/NOT PROVED/N/A |

## Live DB Proof

| Schema/Query Claim | Mock-Free Evidence | Result |
|--------------------|--------------------|--------|
| ... | `.live.test.js` / psql / integration command | PASS/FAIL |

## DB/Query Ownership Proof

| Query Path | Operation | Owner Seam | Scope Predicates | Affected Row / Readback | Bounded Proof | Cleanup | Result |
|------------|-----------|------------|------------------|-------------------------|---------------|---------|--------|
| `path:line` | SELECT/write/report/verifier/live-proof | service/repository/reader/writer | tenant/owner/current DB | row count/RETURNING/readback/no-row | command/artifact | cleanup command/N/A | PASS/FAIL |

## Repo Gate Matrix

| Gate | Local Command | Result |
|------|---------------|--------|
| PR body / delivery gate | `...` | PASS/FAIL |
| no-new-mock guard | `...` | PASS/FAIL |
| DB ownership gate | `...` | PASS/FAIL |
| live-proof registry | `...` | PASS/FAIL/N/A with reason |
| required CI mirror | `...` | PASS/FAIL |

## Review Freshness

- Final diff SHA:
- Review artifact covers this diff: YES/NO
- Forge artifact covers this diff: YES/NO
- CI/gate-driven pivots after review/forge:
- Re-review/re-forge evidence if pivot occurred:

## Headless Browser Proof

| UI/PDF/File Workflow | Headless Command | Result |
|----------------------|------------------|--------|
| ... | `npx playwright test ...` | PASS/FAIL/SKIPPED with reason |

## Diff Classification

- required:
- enabling:
- drift:

## Conclusion

- what is proven
- what is not proven
- final verdict
```
