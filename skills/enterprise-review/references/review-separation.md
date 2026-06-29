# Review Separation

## Stage 1: Spec Compliance

Check:

- contract items implemented
- tests exist for contract items
- assertions prove the intended behavior
- consumer map still holds
- no drifted files are masquerading as required work
- schema, query, and data-sensitive items have current-code reads plus live/integration DB proof; mock-only, migration-only, and diff-only proof fails
- every changed runtime file is mapped to a code execution path, E2E trace, or documented non-runtime reason
- UI, PDF, file upload, preview, download, and rendered workflow changes have headless browser evidence
- edge cases named in plan or contract are covered, or the review fails with exact missing cases
- reusable generators/templates do not hard-code one repo's command list, paths, or policy exceptions unless sourced from repo-local config
- idempotence, tuning, ranking, heuristic, or generated-score tests avoid pinning volatile constants unless the exact value is the business contract

Output:

- `SPEC PASS`
- or `SPEC FAIL` with exact gaps

## Stage 2: Code Quality

Check:

- architecture and maintainability
- import resolution
- safety rules such as tenancy/auth where relevant
- file-size risk
- debug artifacts
- test quality and negative coverage

Output:

- `QUALITY PASS`
- or `QUALITY FAIL` with exact issues
