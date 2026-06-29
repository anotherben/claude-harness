# Proof Surfaces

Use this reference when choosing what counts as actual proof. Pick the highest real surface that can safely be exercised.

## Surface Matrix

| Change type | Required proof | Supporting evidence only |
|---|---|---|
| UI or human workflow | Browser run from natural entry point to completion, with screenshot/trace or visible state, plus one realistic edge case | Component tests, DOM snapshots, type checks |
| User-facing API | Request against the running route with realistic auth/tenant context, response inspected, and side effect verified if the route writes | Handler unit test, mocked request object |
| DB or data behavior | Live dev DB query before/after, affected rows inspected, constraints/indexes checked when relevant | Migration diff, model/type/schema reading |
| Worker, queue, cron, or async flow | Job is enqueued or triggered, processed, and the resulting state/log/destination is observed | Direct function call test, mocked queue assertion |
| External integration | Safe sandbox or live-safe call with request/response/state evidence; if unavailable, record the gap and cap the verdict | Mocked SDK call, contract types |
| CLI or script | Command run on realistic input, exit code and output inspected, generated/modified artifacts checked | Static review, smoke import |
| Generated document, report, or media | Artifact opened, rendered, parsed, or consumed by the real target tool or library | File exists, snapshot only |
| Pure internal helper | Highest real consumer exercised; if none exists, focused tests plus real importer/module-load proof | Source reading only |

## Browser Proof Standard

For UI or workflow changes, browser proof must include:

1. The app/server target used.
2. The entry point the user would naturally start from.
3. The changed step exercised in the browser.
4. The natural completion state.
5. One realistic edge case, empty state, error state, second tenant, permission state, or large-data state when applicable.
6. Side effects checked outside the browser when the UI writes or triggers work.

If a browser cannot run, the verdict is `UNPROVED` for UI/workflow changes unless the user explicitly accepts external-review limitations.

## Evidence Quality

Good evidence is observable and replayable:

- Include command names, route paths, URLs, selectors, DB table names, job IDs, or output filenames.
- State exact PASS/FAIL results.
- Name what was not exercised.
- Avoid "looks good", "should work", "tests pass", or "covered by code" as proof statements.

## Counterexample Selection

Choose the counterexample that would most embarrass a shallow fix:

- The original bad record shape.
- Null/missing/empty value if the bug involved assumptions.
- Historical row, cancelled row, soft-deleted row, or fallback identity if the bug involved data matching.
- Alternate route, bulk path, worker path, retry path, or concurrent path if the bug involved workflow coverage.
- Second tenant or lower-permission user if the bug touched auth, tenant, or visibility.
