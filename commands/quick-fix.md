Fix a single-file bug quickly. No ceremony.

Issue: $ARGUMENTS

1. Read the relevant file and identify root cause
2. Write a failing test if one doesn't exist
3. Fix the cause, not the symptom
4. Run `npx vitest related <file> --run` to verify
5. Run `npx tsc --noEmit` to type-check
6. Report what was fixed and what test covers it
