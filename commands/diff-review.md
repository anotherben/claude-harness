Review the current diff before committing. Be concise.

1. `git diff --stat` — show what changed
2. `git diff --cached --stat` — show what's staged
3. For each changed file, check:
   - Any debug code (console.log, debugger)?
   - Any scope creep beyond the current task?
   - Any accidental deletions?
4. Report: "Diff: [N files, +X/-Y lines] | Issues: [list or 'clean']"
