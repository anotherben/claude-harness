Run the verification pipeline. Report results concisely.

1. `npx tsc --noEmit` — type check
2. `npx vitest run` — unit tests
3. Report: "Types: [pass/fail] | Tests: [X passed, Y failed, Z skipped]"

If anything fails, show only the errors from changed files (filter with `git diff --name-only`).
