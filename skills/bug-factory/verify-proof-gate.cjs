#!/usr/bin/env node
'use strict';

/**
 * bug-factory verify-proof gate.
 *
 * Hard gate the bug-factory ship step MUST run before creating a PR to dev.
 * Exits non-zero (blocking) unless a verify-proof artifact exists that is
 * EXPLICIT and DEMONSTRATIVE — and, when the diff touches UI/route surfaces,
 * includes a real browser-run line. Enforces the rule that "seems to work" is
 * never acceptable proof.
 *
 * Usage:
 *   node verify-proof-gate.cjs --proof docs/verify/<slug>-browser-proof.md \
 *     [--diff-base origin/dev] [--repo /Users/ben/helpdesk]
 *
 * The --diff-base is used to detect UI/route diffs (apps/admin/** or
 * apps/api/src/routes/**); if present, a browser-run section is REQUIRED.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const repo = arg('repo', process.cwd());
const proofRel = arg('proof');
const diffBase = arg('diff-base', 'origin/dev');

const WEAK = [
  /seems to work/i, /should (?:be fine|work)/i, /looks (?:fine|good|ok)/i,
  /probably works/i, /appears to work/i, /i think it works/i, /no issues found/i,
];
// Unreplaced template placeholders — proof must contain the REAL behaviour, not the template words,
// and must not wrap content in angle brackets (parsed as HTML / dropped by Markdown renderers).
const PLACEHOLDER = [
  /behaviou?r\s+[xyz]\b/i, /\bbug\s+<?id>?\b/i, /\bbefore:\s*<[^>]+>/i, /\bafter:\s*<[^>]+>/i,
  /<(?:broken|correct|expected|actual|x|y|z)[^>]*>/i,
];
const DEMONSTRATIVE = [
  /\bbefore\b[\s\S]{0,400}\bafter\b/i, // before/after narrative
  /resolved .*by demonstrating/i,
  /demonstrat/i,
];
const UI_GLOB = /^(apps\/admin\/|apps\/api\/src\/routes\/)/;
const BROWSER_RUN = /(browser run|playwright|screenshot|localhost:5173|chrome|page\.goto|computer.use)/i;
const UI_NA = /\bn\/a because\b/i;
// Integration surfaces — API/scripts that touch these REQUIRE a real DEV canary against the live
// dev Shopify / dev REX, not mocked tests + an app smoke. (Hard rule, 2026-05-30.)
const SHOPIFY_GLOB = /(shopify|gift.?card|voucher)/i;
const REX_GLOB = /(retail.?express|rexweb|rexwebstore|\/rex|services\/rex|rexInventory|rexProduct|rexOrder|soap)/i;
const SHOPIFY_CANARY = /(dev[- ]?shopify[- ]?canary|myshopify|admin\.shopify|x-shopify|shopify (dev|sandbox|admin) (api|store|call)|gift.?card .*(created|looked ?up|already been taken|422))/i;
const REX_CANARY = /(dev[- ]?rex[- ]?canary|retail.?express (dev|api|soap) (call|response)|rexwebstore|getbalance|REX (dev )?(call|response|soap))/i;
// Any backend/API/script change must show a REAL live-dev exercise (canary), not unit/mocks alone.
const GENERIC_CANARY = /(canary|live (dev )?(call|run|request|query)|real (dev )?(call|run|request)|psql .*(TEST_)?DATABASE_URL|against the (dev|live) (db|database|api|rex|shopify)|HTTP ?200 from|status (code )?200 from|integration test .*(real|live) (db|api))/i;

function fail(msg) { console.error(`verify-proof-gate: BLOCKED — ${msg}`); process.exit(1); }
function ok(msg) { console.log(`verify-proof-gate: PASS — ${msg}`); process.exit(0); }

if (!proofRel) fail('no --proof path given. Run the Verify phase and write docs/verify/<slug>-browser-proof.md first.');

const proofPath = path.isAbsolute(proofRel) ? proofRel : path.join(repo, proofRel);
let body;
try { body = fs.readFileSync(proofPath, 'utf8'); } catch {
  fail(`proof artifact not found at ${proofRel}. The pre-ship Verify gate requires it.`);
}
const text = body.trim();
if (text.length < 120) fail(`proof at ${proofRel} is too thin (${text.length} chars) — needs real demonstrative evidence, not a stub.`);

const weakHit = WEAK.find((re) => re.test(text));
if (weakHit) fail(`proof contains a non-demonstrative phrase (${weakHit}). "seems to work" is not proof — show before→after behaviour.`);

const phHit = PLACEHOLDER.find((re) => re.test(text));
if (phHit) fail(`proof contains an unreplaced template placeholder / angle-bracket markup (${phHit}). Write the REAL behaviour in plain text, not "behaviour Y" or "<broken behaviour>".`);

// FALSE-POSITIVE GUARD: a proof that documents a BLOCKED / RED / not-run canary must NOT pass,
// even though it truthfully contains canary-shaped strings. Reject explicit failure language.
const FAIL_MARKERS = [
  /verified\s*[=:]\s*false/i, /\bblocker\s*[:=]/i, /\bfalse positive\b/i,
  /canary (was )?not run/i, /could not run (a )?real/i, /\bno (real )?canary\b/i,
  /did not (run|reproduce|execute)/i, /does not reproduce/i, /was not run/i,
  /HTTP ?401|HTTP ?403|invalid api key|wrong password|unauthorized/i,
  /went red\b|FAILED\s*[—-]\s*RED|canary[^.\n]{0,40}(failed|red)\b/i,
];
const fm = FAIL_MARKERS.find((re) => re.test(text));
if (fm) fail(`proof reports a BLOCKED / RED / not-run canary (${fm}) — a real PASSING canary is required, not a truthful failure report. Fix the underlying issue and re-canary.`);

if (!DEMONSTRATIVE.some((re) => re.test(text))) {
  fail('proof is not demonstrative — it must explicitly state "fix X resolved bug X by demonstrating behaviour Y" with before/after evidence.');
}

// Classify the diff to decide which verification surface is mandatory.
let uiTouched = false, shopifyTouched = false, rexTouched = false, codeTouched = false;
try {
  const changed = execSync(`git -C "${repo}" diff --name-only ${diffBase}...HEAD`, { encoding: 'utf8' })
    .split('\n').map((s) => s.trim()).filter(Boolean);
  const src = changed.filter((f) => !f.startsWith('docs/') && !f.endsWith('.md'));
  uiTouched = changed.some((f) => UI_GLOB.test(f));
  shopifyTouched = src.some((f) => SHOPIFY_GLOB.test(f));
  rexTouched = src.some((f) => REX_GLOB.test(f));
  // any non-doc source/script change (excluding pure test files) needs a live canary
  codeTouched = src.some((f) => !/(^|\/)__tests__\//.test(f) && !/\.test\.[jt]sx?$/.test(f));
} catch (e) {
  console.error(`verify-proof-gate: WARN — could not compute diff vs ${diffBase} (${e.message}); requiring full proof to be safe.`);
  uiTouched = true; codeTouched = true;
}

// 1) UI surface → real browser run.
if (uiTouched) {
  if (!BROWSER_RUN.test(text)) fail('UI/route diff (apps/admin/** or apps/api/src/routes/**) → a real browser-run (Playwright/Chrome on localhost:5173) is REQUIRED in the proof.');
}
// 2) Shopify integration → live DEV Shopify canary.
if (shopifyTouched && !SHOPIFY_CANARY.test(text)) {
  fail('diff touches Shopify integration → a REAL dev-Shopify canary is REQUIRED (an actual call to the dev Shopify store demonstrating the behaviour), not mocked tests. Add the canary command + its real response.');
}
// 3) REX integration → live DEV REX canary.
if (rexTouched && !REX_CANARY.test(text)) {
  fail('diff touches REX integration → a REAL dev-REX canary is REQUIRED (an actual dev REX/SOAP call demonstrating the behaviour), not mocked tests. Add the canary command + its real response.');
}
// 4) Any backend/API/script change → at least one real live-dev canary (no mocks-only).
if (codeTouched && !uiTouched && !shopifyTouched && !rexTouched && !GENERIC_CANARY.test(text)) {
  fail('API/script diff → a REAL live-dev canary is REQUIRED (live dev DB/runtime call with captured output), not unit/mocked tests + an app smoke alone. Add the canary command + its real result.');
}
const surfaces = [uiTouched && 'browser', shopifyTouched && 'dev-shopify-canary', rexTouched && 'dev-rex-canary', (codeTouched && !uiTouched && !shopifyTouched && !rexTouched) && 'live-dev-canary'].filter(Boolean);
ok(`verified surfaces [${surfaces.join(', ') || 'docs-only'}] with real evidence; proof at ${proofRel}.`);
