export const meta = {
  name: 'bug-factory-per-bug-pipeline',
  description: 'bug-factory engine: confirm -> plan/zoom-out/blast-radius convergence (fresh eyes) -> build (1 agent/file) -> test -> 3-lens review, per bug, separate agent per job',
  phases: [
    { title: 'Confirm' },
    { title: 'Plan-converge' },
    { title: 'Build' },
    { title: 'Test' },
    { title: 'Review' },
    { title: 'Verify' },
  ],
}

// args: { bugs: [{ id, title, summary, worktree, branch }], mainRepo, maxRounds }
const A = typeof args === 'string' ? JSON.parse(args) : (args || {})
const MAIN = A.mainRepo || '/Users/ben/helpdesk'
const MAX_ROUNDS = A.maxRounds || 4
const BUGS = Array.isArray(A.bugs) ? A.bugs : []
if (!BUGS.length) { log('bug-factory: no bugs passed in args.bugs — nothing to do'); return { results: [] } }

// price-aware routing (user directive: cheaper models for grunt work)
const GRUNT = 'sonnet'

const env = (wt) => `Worktree: ${wt} (cd here; verify \`git -C ${wt} branch --show-current\`; NEVER main/dev). NO MCP; Read blocked on source >50 lines — use sed/grep/git; edit via Edit (small) or perl/git-apply (large). Commit ONLY files your job needs by explicit path (no \`git add -A\`). For jest/psql you MUST target the DEV DB (helpdesk_dev), NEVER prod: \`. /Users/ben/.claude/skills/bug-factory/devdb-env.sh || exit 1\` then run against "\$TEST_DATABASE_URL" (verify: \`psql "\$TEST_DATABASE_URL" -c "SELECT current_database()"\` prints helpdesk_dev). root .env DATABASE_URL is PROD htnhelpdesk — never use it; apps/api/.env is a drifted local DB. Never --no-verify, no push, no PR. Proof = pasted evidence only.`

const CONFIRM = { type: 'object', required: ['reproducible', 'evidence'], properties: {
  reproducible: { type: 'boolean' }, evidence: { type: 'string' }, reproSteps: { type: 'string' }, signature: { type: 'string' } } }
const PLAN = { type: 'object', required: ['approach', 'filesToChange'], properties: {
  approach: { type: 'string' }, rootCauseDecision: { type: 'string' },
  filesToChange: { type: 'array', items: { type: 'object', properties: { file: { type: 'string' }, change: { type: 'string' } } } },
  redTest: { type: 'string' }, doNotChange: { type: 'array', items: { type: 'string' } } } }
const ZOOM = { type: 'object', required: ['map', 'concerns'], properties: {
  map: { type: 'string' }, correctedNames: { type: 'string' }, concerns: { type: 'array', items: { type: 'string' } } } }
const BLAST = { type: 'object', required: ['verdict', 'concerns', 'liveDbEvidence'], properties: {
  verdict: { type: 'string', enum: ['SAFE', 'ADJUST', 'BLOCK'] },
  liveDbEvidence: { type: 'string', description: 'pasted \\d / query output proving no schema drift for the plan' },
  callers: { type: 'string' }, concerns: { type: 'array', items: { type: 'string' } } } }
const BUILD1 = { type: 'object', required: ['file', 'committed'], properties: {
  file: { type: 'string' }, committed: { type: 'string' }, diffSummary: { type: 'string' }, selfReview: { type: 'string' }, blockers: { type: 'array', items: { type: 'string' } } } }
const TEST = { type: 'object', required: ['pass', 'output'], properties: {
  pass: { type: 'boolean' }, output: { type: 'string' }, regressions: { type: 'array', items: { type: 'string' } } } }
const REVIEW = { type: 'object', required: ['verdict', 'blastRadius', 'patchOrFix', 'zoomOut'], properties: {
  verdict: { type: 'string', enum: ['APPROVE', 'APPROVE WITH NITS', 'REQUEST CHANGES'] },
  blastRadius: { type: 'string' }, patchOrFix: { type: 'string', description: 'root-cause vs symptom verdict' }, zoomOut: { type: 'string' },
  findings: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string' }, note: { type: 'string' } } } } } }
const VERIFY = { type: 'object', required: ['verified', 'uiApplicable', 'proofPath', 'evidence'], properties: {
  verified: { type: 'boolean' },
  uiApplicable: { type: 'boolean', description: 'true if the diff touches apps/admin/** or apps/api/src/routes/**' },
  proofPath: { type: 'string', description: 'docs/verify/<slug>-browser-proof.md written with explicit demonstrative proof' },
  evidence: { type: 'string', description: 'explicit "fix X resolved bug X by demonstrating behaviour Y (before/after)" — never "seems to work"' },
  smoke: { type: 'string', description: 'local Cortex app/api up + admin renders (curl :3000 health + Playwright/page-load on :5173)' } } }

async function planConverge(bug) {
  let plan = null, history = []
  let cleanPasses = 0
  for (let round = 1; round <= MAX_ROUNDS && cleanPasses < 2; round += 1) {
    const fresh = round > 1 || cleanPasses > 0 ? ' (FRESH eyes — a previous round raised concerns; re-examine from scratch)' : ''
    plan = await agent(
      `PLANNER for bug "${bug.title}"${fresh}. ${env(bug.worktree)}\nBUG: ${bug.summary}\n${plan ? 'PRIOR PLAN + concerns to resolve:\n' + JSON.stringify({ plan, concerns: history.slice(-1)[0] }) : ''}\nInvestigate with grep/sed, produce the minimal safe plan (approach, root-cause decision w/ evidence, exact files+changes, RED test, do-not-change). Do NOT write code.\nCI-GATE PRE-SATISFACTION (the plan MUST bake these in, they are push/merge-blocking gates discovered the hard way): (1) if any changed file is schema-coupled/DB-backed (SQL, db.query callers, table reads/writes), the test plan uses a real .live.test.js against helpdesk_dev (env-gated, self-cleaning, close config/database pool in afterAll) — mocked db.query shape-tests are BLOCKED at push by scripts/ci/ensureNoNewMockTests.cjs; (2) any DB-backed source file in filesToChange needs a matching REGISTRY entry in scripts/review/live-proof-registry.cjs (pattern + live-proof command) or the required review-hard check fails with "Live DB proof registry gap" — include that registry edit in filesToChange; (3) if the diff touches apps/api/src/domains/purchasing/**, plan a purchasing full-kit freshness refresh as the LAST commit before push (re-prove PC-LIVE-DB live via ~/.claude/skills/bug-factory/purchasing-cert-env.sh, re-subject docs/verify/2026-05-02-purchasing-dev-full-kit-closeout-artifact.json+md to HEAD; recipe = git show 67ab6381e) or preflight-dev fails and copilot-review-wait treats it as a blocking check; (4) CODE PLACEMENT LAW: any NEW runtime file is FORBIDDEN under apps/api/src/services/ — new modules go under apps/api/src/domains/<domain>/ (editing existing services/ files is allowed); (5) SRP cohort ratchet: keep new/edited files under 400 lines or plan an evidence-quality srp_justification.`,
      { schema: PLAN, label: `plan:${bug.id}:r${round}`, phase: 'Plan-converge' })
    const zoom = await agent(
      `ZOOM-OUT for "${bug.title}" (independent of planner). ${env(bug.worktree)}\nPLAN: ${JSON.stringify(plan)}\nMap the area in plain language, correct any hallucinated symbol names (verify by grep), and list concerns this plan misses. concerns=[] if none.`,
      { schema: ZOOM, label: `zoom:${bug.id}:r${round}`, phase: 'Plan-converge', model: GRUNT })
    const blast = await agent(
      `BLAST-RADIUS for "${bug.title}" (independent). ${env(bug.worktree)}\nPLAN: ${JSON.stringify(plan)}\nTrace callers/tests/SQL/tenant/siblings. MANDATORY: validate the plan against the LIVE LOCAL DB for schema drift and PASTE the evidence into liveDbEvidence (psql "$TEST_DATABASE_URL" -c "\\d <table>" + real sample queries + constraint/index checks). verdict SAFE/ADJUST/BLOCK; concerns=[] if none.`,
      { schema: BLAST, label: `blast:${bug.id}:r${round}`, phase: 'Plan-converge', model: GRUNT })
    // agent() returns null on terminal API errors (e.g. session limits) — treat as a failed round, not a crash
    const zoomR = zoom || { concerns: ['zoom agent errored (null result) — fresh re-run needed'] }
    const blastR = blast || { verdict: 'ADJUST', concerns: ['blast agent errored (null result) — fresh re-run needed'], liveDbEvidence: '' }
    const concerns = [...(zoomR.concerns || []), ...(blastR.concerns || []), ...(blastR.verdict !== 'SAFE' ? [`blast verdict=${blastR.verdict}`] : [])]
    history.push({ round, concerns, liveDbEvidence: blastR.liveDbEvidence })
    // Convergence gates on the STRUCTURED plan-safety signal (blast-radius verdict SAFE) sustained
    // for 2 consecutive fresh-eyes rounds — NOT on zero advisory concerns (fresh agents always surface
    // minor test-craft/line-drift/out-of-scope nits, so zero-concerns is unreachable and nothing ever builds).
    // Advisory concerns are still captured in history and must be honored by the build agents.
    const planSafe = blastR.verdict === 'SAFE'
    if (planSafe) { cleanPasses += 1 } else { cleanPasses = 0 }
    log(`bug ${bug.id} plan round ${round}: blast=${blastR.verdict}, ${concerns.length} advisory concerns, cleanPasses=${cleanPasses}`)
  }
  return { plan, converged: cleanPasses >= 2, history }
}

async function buildPerFile(bug, plan) {
  const builds = []
  // RED test first (its own job)
  builds.push(await agent(
    `RED-TEST AUTHOR for "${bug.title}" (TDD; you only write the failing test). ${env(bug.worktree)}\nPLAN: ${JSON.stringify(plan.plan || plan)}\nWrite the failing test described in the plan's redTest, run it, PASTE the failing output (proving it catches the bug), commit ONLY the test file by explicit path.\nGATE RULE: if the code under test is schema-coupled/DB-backed, the test MUST be a real .live.test.js against helpdesk_dev (mirror an existing *.live.test.js: env-flag-gated describe.skip, TEST_DATABASE_URL with no DATABASE_URL fallback, self-cleaning rows, close require('../../config/database').pool in afterAll so no --forceExit). Do NOT write mocked db.query/jest.mock(...database) shape-tests — scripts/ci/ensureNoNewMockTests.cjs hard-blocks them at push for schema-coupled files.`,
    { schema: BUILD1, label: `build-redtest:${bug.id}`, phase: 'Build', model: GRUNT }))
  // one agent per production file, SEQUENTIAL (each sees prior commits)
  const files = ((plan.plan || plan).filesToChange || []).map((f) => f.file).filter(Boolean)
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i]
    builds.push(await agent(
      `BUILDER for "${bug.title}" — you edit EXACTLY ONE file: ${file}. ${env(bug.worktree)}\nLOCKED PLAN: ${JSON.stringify(plan.plan || plan)}\nImplement the plan's change for THIS file only (other files are handled by other builders). Make the minimal edit, verify with git diff, commit ONLY ${file} by explicit path. Re-read your own diff vs the plan before returning.`,
      { schema: BUILD1, label: `build:${bug.id}:${file.split('/').pop()}`, phase: 'Build', model: GRUNT }))
  }
  return builds
}

const results = await pipeline(
  BUGS,
  (bug) => agent(
    `CONFIRM agent for bug "${bug.title}". ${env(bug.worktree)}\nBUG: ${bug.summary}\nReproduce it; produce concrete evidence it is REAL (failing test / log signature / DB state / repro steps). reproducible=false if you cannot reproduce (with evidence).`,
    { schema: CONFIRM, label: `confirm:${bug.id}`, phase: 'Confirm', model: GRUNT }).then((confirm) => ({ bug, confirm })),
  async ({ bug, confirm }) => {
    if (!confirm.reproducible) { log(`bug ${bug.id} NOT reproducible — skipping to sweep`); return { bug, confirm, skip: 'not-reproducible' } }
    const planned = await planConverge(bug)
    return { bug, confirm, planned }
  },
  async (ctx) => {
    if (ctx.skip) return ctx
    if (!ctx.planned.converged) { log(`bug ${ctx.bug.id} plan did NOT converge in ${MAX_ROUNDS} rounds — escalate`); return { ...ctx, skip: 'plan-not-converged' } }
    const builds = await buildPerFile(ctx.bug, ctx.planned)
    return { ...ctx, builds }
  },
  async (ctx) => {
    if (ctx.skip) return ctx
    const test = await agent(
      `INDEPENDENT TESTER for "${ctx.bug.title}" (you did NOT build it). ${env(ctx.bug.worktree)}\nRun the relevant unit + integration suites against the live DB and PASTE output. Confirm the bug behaviour is fixed + no regression in touched modules (prove any pre-existing failures identical on parent). pass=true ONLY with pasted passing output.`,
      { schema: TEST, label: `test:${ctx.bug.id}`, phase: 'Test', model: GRUNT })
    return { ...ctx, test }
  },
  async (ctx) => {
    if (ctx.skip) return ctx
    const review = await agent(
      `INDEPENDENT REVIEWER for "${ctx.bug.title}" (you did NOT plan/build/test it). ${env(ctx.bug.worktree)}\nReview the diff (git -C ${ctx.bug.worktree} diff origin/dev...HEAD) through THREE lenses: (1) BLAST-RADIUS — completeness, missed callers/siblings; (2) PATCH-OR-FIX — is it root-cause or a symptom band-aid? reject band-aids; (3) ZOOM-OUT — does it fit the architecture. Any HIGH finding => REQUEST CHANGES (bounces to plan loop). Verdict + the three lens results + findings.`,
      { schema: REVIEW, label: `review:${ctx.bug.id}`, phase: 'Review' })
    return { ...ctx, review }
  },
  async (ctx) => {
    if (ctx.skip) return ctx
    const slug = ctx.bug.id || (ctx.bug.branch || '').split('/').pop() || 'bug'
    const verify = await agent(
      `INDEPENDENT VERIFIER for "${ctx.bug.title}" (you did NOT plan/build/test/review it). ${env(ctx.bug.worktree)}
This is the MANDATORY pre-ship verify gate — it runs against the LOCAL CORTEX instance (pm2 helpdesk-local-*, admin http://localhost:5173, api http://localhost:3000, DB helpdesk_dev_local_linked) and produces explicit demonstrative proof.
1. Determine uiApplicable: does this diff touch apps/admin/** or apps/api/src/routes/**? (\`git -C ${ctx.bug.worktree} diff --name-only origin/dev...HEAD\`).
2. Smoke (ALWAYS): confirm the local Cortex is up — \`curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health\` (or /api/health) AND a real browser/page-load of http://localhost:5173 (use Playwright headless: load the admin, assert the root renders). PASTE the result into smoke.
3. If uiApplicable=true: drive Chrome (Playwright) through the bug's user-facing path on the local Cortex and demonstrate before→after (screenshots/DOM/console).
   SURFACE-GATED (HARD — mocks NEVER sufficient): Shopify diff -> a REAL dev-Shopify canary (actual dev Shopify store call, paste request+response); REX diff -> a REAL dev-REX canary (actual dev REX/SOAP call, paste response); other API/script -> a REAL live-dev canary (run the job/script against the dev DB/runtime, paste output; use integration-guard for dev endpoints). State "UI path n/a because <reason>" as the non-UI disclaimer — it does NOT exempt the canary.
4. Write the proof to docs/verify/${slug}-browser-proof.md (commit it by explicit path) with an EXPLICIT statement: "fix <change> resolved bug <id> by demonstrating the REAL fixed behaviour, in PLAIN TEXT with real before/after values (NO 'behaviour Y' / angle-bracket placeholders). Then RUN the gate and paste its PASS: node ~/.claude/skills/bug-factory/verify-proof-gate.cjs --proof docs/verify/${slug}-browser-proof.md --diff-base origin/dev --repo ${ctx.bug.worktree}. "seems to work" / mocks-as-canary are rejected.
Return verified=true ONLY with the pasted demonstrative evidence + the smoke result + proofPath.`,
      { schema: VERIFY, label: `verify:${ctx.bug.id}`, phase: 'Verify', model: GRUNT })
    return { ...ctx, verify }
  },
)

// SHIP GATE (orchestrator runs this BEFORE any PR to dev): for each non-skipped, converged result,
//   node ~/.claude/skills/bug-factory/verify-proof-gate.cjs --proof docs/verify/<slug>-browser-proof.md --diff "<changed files>"
// must exit 0 (proof present + demonstrative, browser-run present for UI/route diffs) or the dev PR is BLOCKED.
return { results: results.filter(Boolean) }
