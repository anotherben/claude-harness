# A/B-1: Routing correctness scenarios (8)

Each scenario is fed verbatim to a fresh-context agent under condition A (OLD: the four
full-cycle SKILL.mds + vault-process, pre-refactor from origin/main) and condition B (NEW:
skills/go/SKILL.md + GATES.md). The agent must answer ONLY: (1) which pipeline/depth it would
run, (2) the ordered stage list, (3) which model/worker runs each stage, (4) how the work
ships (exact merge mechanics). No actual execution.

S1 (bug, small): "Typo in the refund email subject line — apps/api/src/emails/refundEmail.js says 'Refnud'. Fix it."
   Expected: QUICK; build→test→SHIP; no research; ships via 6-section PR body + rebase merge.
S2 (bug, DB-coupled): "Orders with a deleted customer crash the invoice endpoint with 42703. Fix it."
   Expected: DEBUG→STANDARD; diagnose/root-cause first (opus); live-DB contract test (real jest config, __LIVE_DB_PROOF__); DB-proof line in PR body.
S3 (idea): "I want customers to get an SMS when their repair is ready. We've never sent SMS."
   Expected: DEEP; research fan-out (sonnet/haiku) → design → plan (opus) → build (sonnet) → codex adversarial review → SHIP.
S4 (refactor): "productSyncService.js is 700 lines and does 4 jobs, split it up."
   Expected: STANDARD/DEEP; blast-radius guard; SRP ratchet awareness (400 soft/800 hard, justified entries not boilerplate); Code Placement Law (no new files under services/).
S5 (UI): "Make the purchasing dashboard table sortable by supplier column."
   Expected: QUICK/STANDARD; Playwright/browser verify required; purchasing scope → full-kit evidence gate awareness + plan-approval pause.
S6 (question): "Why do we resolve copilot threads reply-only instead of pushing?"
   Expected: ANSWER; no pipeline, no build stages.
S7 (issue #): "Handle issue #3618."
   Expected: issue intake; DEBUG depth (payment-sync poison bug); worktree; yield protocol check before claiming.
S8 (ops): "Promote dev to production."
   Expected: route to /promote (not a build pipeline); pinned portal deploys awareness / plan-approval pause.

## Scoring rubric (opus judge, blind to condition labels)
Per scenario, 0-2 each:
- R1 depth/route correctness (matches Expected)
- R2 stage completeness (no missing verify/ship; no ceremony stages that don't exist)
- R3 model routing stated and sensible (any routing at all scores ≥1; correct tiering =2)
- R4 gate fidelity (mentions real gates: 6-section body/DB-proof/copilot-wait convergence/rebase-only; inventing nonexistent gates = 0)
- R5 dead-reference-free (references only skills/files that exist in its condition's tree)
Max 10/scenario, 80/condition.

# A/B-2: Ship-stage fidelity
Prompt: "You have a finished diff touching apps/api/src/services/orderSync.js (SQL change).
Produce the exact shipping plan: PR body, checks you expect, how you converge review threads,
how you merge." Run under A (old full-cycle 'ship' guidance) and B (GATES.md + /go SHIP).
Judge: count of correct gate behaviors covered (body sections=1, exact DB-proof line format=2,
thread convergence protocol=2, rerun-after-green=1, event-payload body caveat=1, rebase-only=1,
worktree teardown=1, restale/force-with-lease=1). Max 10.

# A/B-3: Claude vs Codex worker (routing path proof)
Deferred to a real helpdesk bug in a follow-up run if time allows; the codex plugin path is
already verified working (codex-cli 0.142.4, --cwd/--output-schema plumbing confirmed).
Minimum this pass: one live `codex-companion.mjs review --cwd <worktree>` smoke test against the
skill-refactor diff to prove the adversarial-review lane /go prescribes actually returns
schema-valid JSON.
