#!/usr/bin/env node
'use strict';
// Daily local sweep: audit every PR opened in the last 24h against the live Helpdesk schema and
// open a bug-labeled GitHub issue for each GENUINE schema problem. Benign findings (dynamic-SQL
// coverage gaps, and the proof_artifacts cross-DB reference) are excluded. Idempotent: an existing
// issue carrying this PR's marker is not re-opened.
//
// Runs locally (launchd) so it can read the owner-only DB secret and use local gh auth. The DB URL
// is never stored here — the audit script reads it from ~/.codex/secrets/helpdesk-schema-audit-db-url.
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = 'anotherben/helpdesk';
const AUDIT = require('path').join(__dirname, 'pr-schema-audit.cjs');
const WINDOW_MS = 24 * 60 * 60 * 1000;

function log(msg) { process.stdout.write('[' + new Date().toISOString() + '] ' + msg + '\n'); }
function run(cmd, args) { return cp.spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 96 * 1024 * 1024 }); }

// A finding is a GENUINE schema problem only if it is a real schema mismatch — NOT a benign
// "DB call is not statically resolved" coverage gap, and NOT the proof_artifacts cross-DB table.
function isGenuine(f) {
  const t = String(f.title || '');
  if (/DB call is not statically resolved/i.test(t)) return false;
  if (/proof_artifacts/i.test(t)) return false;
  return /not found in live schema|lacks obvious live unique coverage|possible secret literal/i.test(t);
}

function main() {
  // Preflight: gh auth must work non-interactively (keychain accessible under launchd).
  const auth = run('gh', ['auth', 'status']);
  if (auth.status !== 0) { log('FATAL: gh auth not available: ' + (auth.stderr || '').trim()); process.exit(1); }

  const now = Date.now();
  const sinceSearch = new Date(now - 2 * WINDOW_MS).toISOString().slice(0, 10); // wide net, then filter client-side
  const list = run('gh', ['pr', 'list', '--repo', REPO, '--state', 'all', '--search', 'created:>=' + sinceSearch, '--json', 'number,state,title,createdAt', '--limit', '100']);
  if (list.status !== 0) { log('FATAL: gh pr list failed: ' + (list.stderr || '').trim()); process.exit(1); }
  let prs;
  try { prs = JSON.parse(list.stdout || '[]'); } catch (e) { log('FATAL: cannot parse pr list'); process.exit(1); }
  prs = prs.filter(function (p) { return new Date(p.createdAt).getTime() >= now - WINDOW_MS; });
  log('PRs opened in last 24h: ' + prs.length + (prs.length ? ' [' + prs.map(function (p) { return p.number; }).join(', ') + ']' : ''));
  if (!prs.length) { log('Nothing to do.'); return; }

  // Candidate existing issues (for dedup) — broad search, exact marker match done client-side.
  let existing = [];
  const cand = run('gh', ['issue', 'list', '--repo', REPO, '--state', 'all', '--search', 'schema-audit in:title,body', '--json', 'number,title,body,url', '--limit', '100']);
  if (cand.status === 0) { try { existing = JSON.parse(cand.stdout || '[]'); } catch (_) {} }

  let opened = 0, genuineCount = 0;
  for (const pr of prs) {
    const res = run(AUDIT, ['--repo', REPO, '--pr', String(pr.number), '--dry-run', '--json', '--output', '/dev/null']);
    if (res.status !== 0 || !String(res.stdout || '').trim()) {
      const err = (res.stderr || res.stdout || '').trim();
      if (/rate limit/i.test(err)) { log('PR #' + pr.number + ': INCONCLUSIVE (rate limit) — skipped'); continue; }
      log('PR #' + pr.number + ': audit error — ' + err.slice(0, 140)); continue;
    }
    let j;
    try { j = JSON.parse(res.stdout); } catch (e) { log('PR #' + pr.number + ': unparseable audit output'); continue; }
    const genuine = (j.findings || []).filter(isGenuine);
    if (!genuine.length) { log('PR #' + pr.number + ': ' + j.verdict + ' — no genuine problem (' + (j.findings || []).length + ' benign)'); continue; }
    genuineCount += 1;

    const marker = 'psa-daily-pr-' + pr.number;
    const dup = existing.find(function (i) { return String(i.body || '').includes(marker); });
    if (dup) { log('PR #' + pr.number + ': genuine problem, issue already exists (' + dup.url + ') — skipped'); continue; }

    const title = ('[schema-audit] PR #' + pr.number + ': ' + (pr.title || '')).slice(0, 250);
    const body = [
      'The local daily schema audit found a likely **schema mismatch** in PR #' + pr.number + ' (' + pr.state + ').',
      '',
      'Verdict: `' + j.verdict + '`',
      '',
      '### Genuine findings',
      ...genuine.map(function (f) { return '- **' + f.severity + '** ' + f.title + ' — `' + (f.file || '') + ':' + (f.line || '') + '`'; }),
      '',
      '_Benign dynamic-SQL coverage gaps and the `proof_artifacts` cross-DB reference were excluded._',
      '',
      'Re-run locally to inspect: `pr-schema-audit --pr ' + pr.number + ' --dry-run`',
      '',
      '<!-- ' + marker + ' -->',
    ].join('\n');
    const tmp = path.join(os.tmpdir(), marker + '.md');
    fs.writeFileSync(tmp, body);
    const create = run('gh', ['issue', 'create', '--repo', REPO, '--label', 'bug', '--title', title, '--body-file', tmp]);
    try { fs.unlinkSync(tmp); } catch (_) {}
    if (create.status === 0) { opened += 1; log('PR #' + pr.number + ': OPENED issue — ' + (create.stdout || '').trim()); }
    else { log('PR #' + pr.number + ': issue create FAILED — ' + (create.stderr || '').trim().slice(0, 180)); }
  }
  log('Done. checked=' + prs.length + ' genuine=' + genuineCount + ' issues_opened=' + opened);
}

try { main(); } catch (e) { log('FATAL: ' + (e && e.message ? e.message : String(e))); process.exit(1); }
