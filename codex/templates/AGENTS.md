# Global Codex Baseline

Use the nearest repository-owned `AGENTS.md` as the authoritative project
contract. Keep global guidance generic and portable; project-specific ownership,
routing, safety, proof, and release rules belong in the repository that owns
them.

Do not infer mutation permission from old session state. Confirm the current
workspace, branch, repository instructions, and objective evidence before an
edit. Treat unresolved authoritative ownership as a reason to investigate and
report, not a reason to invent a generic owner.

For explicitly self-contained tasks, treat the named files and stated outcome
as the complete scope. Do not search memory, history, adjacent files, or broader
repository state unless the named task cannot be completed without them.
Ordinary verbs such as "diagnose", "review", or "fix" do not invoke a workflow
skill; load one only when the user names it or repository instructions require it.
