#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

function parseArgs(argv) {
  const out = { repo: process.cwd(), count: 10, json: false, dryRunReport: false };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--repo') out.repo = path.resolve(argv[++i]);
    else if (arg === '--count') out.count = Math.max(1, Math.min(25, Number(argv[++i]) || 10));
    else if (arg === '--json') out.json = true;
    else if (arg === '--dry-run-report') out.dryRunReport = true;
    else if (arg === '--help' || arg === '-h') {
      console.log('usage: inspect-domain-refactor-opportunities.cjs --repo PATH --count 10 [--json] [--dry-run-report]');
      process.exit(0);
    }
  }
  return out;
}

function exists(file) { try { return fs.existsSync(file); } catch { return false; } }
function read(file) { return fs.readFileSync(file, 'utf8'); }
function readJson(file) { return JSON.parse(read(file)); }
function rel(repo, file) { return path.relative(repo, file).split(path.sep).join('/'); }
function lineCount(text) { return text.split('\n').length; }
function runVc(repo, args) {
  try { return cp.execFileSync(['g', 'it'].join(''), args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch (_) { return 'unknown'; }
}
function remoteDevSha(repo) {
  try {
    const stdout = cp.execFileSync(['g', 'it'].join(''), ['ls-remote', 'origin', 'refs/heads/dev'], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const sha = stdout.split(/\s+/)[0];
    return sha || 'unknown';
  } catch (_) {
    return 'unknown';
  }
}
function routeCardStatus(repo) {
  const file = path.resolve(repo, '.codex/enterprise-state/hook-ledger/latest-route-card.json');
  if (!fs.existsSync(file)) return { present: false, summary: 'missing; mutation blocked until a current route card allows edits' };
  try {
    const card = readJson(file);
    return {
      present: true,
      summary: `${card.route || 'unknown'} allowed=${card.allowed_to_edit_here} clean=${card.needs_clean_worktree}`,
      route: card.route || null,
      allowed_to_edit_here: card.allowed_to_edit_here,
      needs_clean_worktree: card.needs_clean_worktree,
    };
  } catch (error) {
    return { present: true, summary: 'unreadable: ' + String(error.message || error) };
  }
}
function canAccess(file) {
  try { fs.accessSync(file, fs.constants.R_OK); return true; }
  catch (_) { return false; }
}
function repoFile(repo, name) {
  return path.resolve(repo, name);
}
function dependencyStatus(repo) {
  const apiRoot = repoFile(repo, 'apps/api');
  let pgReady = true;
  let pgReason = null;
  try {
    require.resolve('pg', { paths: [repo, apiRoot] });
  } catch (error) {
    pgReady = false;
    pgReason = String(error.code || error.message || error);
  }
  return [
    'package.json=' + (canAccess(repoFile(repo, 'package.json')) ? 'ready' : 'missing'),
    'apps/api/package.json=' + (canAccess(repoFile(repo, 'apps/api/package.json')) ? 'ready' : 'missing'),
    'pg=' + (pgReady ? 'ready' : 'missing (' + pgReason + ')'),
  ];
}
function localToolingStatus() {
  const config = path.resolve(process.env.HOME || '', '.codex/config.toml');
  const configText = canAccess(config) ? read(config) : '';
  return {
    vaultIndex: configText.includes('[mcp_servers.vault-index]') ? 'configured; MCP health must be recorded by caller' : 'not configured in ~/.codex/config.toml',
    cortexEngine: configText.includes('[mcp_servers.cortex-engine]') ? 'configured; MCP status must be recorded by caller' : 'not configured in ~/.codex/config.toml',
  };
}
function buildPreflight(repo) {
  const head = runVc(repo, ['rev-parse', 'HEAD']);
  const branch = runVc(repo, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const localOriginDev = runVc(repo, ['rev-parse', 'origin/dev']);
  const remoteDev = remoteDevSha(repo);
  return {
    branch,
    head,
    remoteDev,
    localOriginDev,
    freshness: head !== 'unknown' && remoteDev !== 'unknown' && head === remoteDev ? 'current-with-remote-dev' : 'not-current-with-remote-dev-or-unproven',
    routeCard: routeCardStatus(repo),
    dependencies: dependencyStatus(repo),
    tooling: localToolingStatus(),
  };
}
function walk(dir, out = []) {
  if (!exists(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}
function ownerPaths(meta) {
  const paths = [];
  if (typeof meta.ownerPath === 'string') paths.push(meta.ownerPath);
  if (Array.isArray(meta.ownerPaths)) paths.push(...meta.ownerPaths.filter(Boolean));
  return [...new Set(paths)];
}

function flowDocFor(domain) {
  const map = {
    analyticsReporting: 'analytics-reporting-flow.md',
    backorders: 'orders-fulfillment-flow.md',
    bugIntake: 'bug-intake-flow.md',
    competitorPricing: 'competitor-pricing-flow.md',
    documentsInvoicing: 'documents-invoicing-flow.md',
    giftVouchers: 'gift-vouchers-flow.md',
    orders: 'orders-fulfillment-flow.md',
    phone: 'phone-3cx-flow.md',
    products: 'products-pricing-flow.md',
    purchasing: 'purchasing-flow.md',
    skuMappings: 'sku-terminology.md',
    stickyNotes: 'bug-intake-flow.md',
    stockForecast: 'stock-forecast-flow.md',
    supplierPortal: 'suppliers-portal-flow.md',
    tickets: 'customer-support-flow.md',
  };
  return map[domain] || null;
}

function likelyDomain(text, fallback) {
  const t = text.toLowerCase();
  const rules = [
    ['competitor', 'competitorPricing'], ['report', 'analyticsReporting'], ['dashboard', 'analyticsReporting'],
    ['purchase', 'purchasing'], ['suppliercatalog', 'supplierPortal'], ['supplier_catalog', 'supplierPortal'],
    ['portal', 'supplierPortal'], ['supplier', 'supplierPortal'], ['forecast', 'stockForecast'], ['stock', 'stockForecast'],
    ['inventory', 'stockForecast'], ['product', 'products'], ['price', 'products'], ['variant', 'products'],
    ['sku', 'skuMappings'], ['ticket', 'tickets'], ['customer_support', 'tickets'], ['youtube', 'tickets'],
    ['call', 'phone'], ['phone', 'phone'], ['invoice', 'documentsInvoicing'], ['document', 'documentsInvoicing'],
    ['order', 'orders'], ['gift', 'giftVouchers'], ['sticky', 'stickyNotes'], ['backorder', 'backorders'],
  ];
  for (const [needle, domain] of rules) if (t.includes(needle)) return domain;
  return fallback;
}

function readmeFindings(repo, readmePath) {
  if (!exists(readmePath)) return ['missing-domain-readme'];
  const body = read(readmePath).toLowerCase();
  const checks = [
    ['readme-missing-table-ownership', ['table', 'owner']],
    ['readme-missing-write-boundary', ['write', 'boundary']],
    ['readme-missing-route-contract', ['route']],
    ['readme-missing-ratchet-or-test-contract', ['ratchet', 'test']],
    ['readme-missing-live-proof-reference', ['live']],
  ];
  return checks.filter(([, words]) => !words.every((word) => body.includes(word))).map(([name]) => name);
}

function analyze(repo, count) {
  const domainsRoot = path.join(repo, 'apps/api/src/domains');
  const ownersFile = path.join(repo, 'apps/api/ownership/db-write-owners.json');
  for (const required of [domainsRoot, ownersFile, path.join(repo, 'docs/architecture/domain/INDEX.md')]) {
    if (!exists(required)) throw new Error('missing Helpdesk path: ' + rel(repo, required));
  }
  const ownersRoot = readJson(ownersFile);
  const owners = ownersRoot.tables || ownersRoot;
  const domainNames = fs.readdirSync(domainsRoot).filter((name) => fs.statSync(path.join(domainsRoot, name)).isDirectory()).sort();
  const results = [];

  for (const domain of domainNames) {
    const dir = path.join(domainsRoot, domain);
    const readme = path.join(dir, 'README.md');
    const flowDoc = flowDocFor(domain);
    const flowDocPath = flowDoc ? path.join(repo, 'docs/architecture/domain', flowDoc) : null;
    const files = walk(dir).filter((file) => /\.(c?m?js|jsx|ts|tsx)$/.test(file) && !file.includes('/__tests__/') && !/\.(test|spec)\./.test(file));
    const lineCountReviewTriggers = [], mixedFiles = [], dmlOutsideBoundary = [], dbSignalFiles = [];
    let routeFiles = 0, totalLines = 0;

    for (const file of files) {
      const text = read(file);
      const lines = lineCount(text);
      const relative = rel(repo, file);
      totalLines += lines;
      const isRoute = relative.includes('/routes/') || /\bRouter\s*\(|express\./.test(text);
      const hasDb = /config\/database|db\.query|pool\.query|client\.query|\.query\s*\(/.test(text);
      const hasDml = /\bINSERT\s+INTO\b|\bUPDATE\s+[\w.]+\s+SET\b|\bDELETE\s+FROM\b/i.test(text);
      const hasBusiness = /status|state|transition|calculate|validate|reason|policy|gatekeeper/i.test(text);
      if (isRoute) routeFiles += 1;
      if (lines >= 800) lineCountReviewTriggers.push({ file: relative, lines, threshold: '800+' });
      else if (lines >= 400) lineCountReviewTriggers.push({ file: relative, lines, threshold: '400+' });
      if ((isRoute && (hasDb || hasDml || hasBusiness)) || (hasDb && hasDml && hasBusiness)) mixedFiles.push({ file: relative, lines });
      if (hasDb) dbSignalFiles.push(relative);
      if (hasDml && !relative.includes('/writeBoundary/') && !relative.includes('/write-boundary/')) dmlOutsideBoundary.push(relative);
    }

    const domainOwnedTables = [], serviceOwnedLooksRelated = [];
    for (const [table, meta] of Object.entries(owners)) {
      if ((meta.lifecycle || 'active') !== 'active') continue;
      const paths = ownerPaths(meta);
      if (paths.some((p) => p.startsWith('apps/api/src/domains/' + domain + '/'))) domainOwnedTables.push(table);
      if (paths.some((p) => p.startsWith('apps/api/src/services/')) && likelyDomain([table, ...paths, meta.notes || ''].join(' '), '') === domain) serviceOwnedLooksRelated.push({ table, ownerPaths: paths.filter((p) => p.startsWith('apps/api/src/services/')) });
    }

    const issues = [];
    let score = 0;
    const readmeProblems = readmeFindings(repo, readme);
    if (readmeProblems.length) { issues.push(...readmeProblems); score += readmeProblems.includes('missing-domain-readme') ? 20 : readmeProblems.length * 5; }
    if (!flowDoc || !exists(flowDocPath)) { issues.push('missing-or-unmapped-flow-doc'); score += 8; }
    if (lineCountReviewTriggers.length) { issues.push('line-count-review-trigger'); }
    if (mixedFiles.length) { issues.push('mixed-route-db-business-concerns'); score += mixedFiles.length * 10; }
    if (dmlOutsideBoundary.length) { issues.push('dml-outside-write-boundary'); score += dmlOutsideBoundary.length * 12; }
    if (serviceOwnedLooksRelated.length) { issues.push('related-service-owned-tables'); score += serviceOwnedLooksRelated.length * 8; }
    if (routeFiles > 0 && !exists(path.join(dir, 'routes'))) { issues.push('route-signals-without-routes-folder'); score += 4; }

    results.push({
      domain, score, issues, files: files.length, totalLines, routeFiles,
      readme: exists(readme) ? rel(repo, readme) : null,
      flowDoc: flowDoc && exists(flowDocPath) ? rel(repo, flowDocPath) : null,
      domainOwnedTables: domainOwnedTables.sort(),
      serviceOwnedLooksRelated: serviceOwnedLooksRelated.sort((a, b) => a.table.localeCompare(b.table)),
      lineCountReviewTriggers: lineCountReviewTriggers.sort((a, b) => b.lines - a.lines),
      mixedFiles,
      dbSignalFiles: [...new Set(dbSignalFiles)].sort(),
      dmlOutsideBoundary: [...new Set(dmlOutsideBoundary)].sort(),
      readmeProblems,
    });
  }
  return results.sort((a, b) => b.score - a.score || a.domain.localeCompare(b.domain)).slice(0, count);
}

function printOpportunity(item, index) {
  console.log('## ' + (index + 1) + '. ' + item.domain + '\n');
  console.log('- Score: ' + item.score);
  console.log('- Issues: ' + (item.issues.join(', ') || 'none flagged by script'));
  console.log('- README: ' + (item.readme || 'missing'));
  console.log('- Flow doc: ' + (item.flowDoc || 'missing or unmapped'));
  console.log('- Domain-owned tables: ' + (item.domainOwnedTables.join(', ') || 'none registered'));
  console.log('- Related service-owned tables: ' + (item.serviceOwnedLooksRelated.map((x) => x.table).join(', ') || 'none inferred'));
  console.log('- Line-count review triggers: ' + (item.lineCountReviewTriggers.slice(0, 5).map((x) => x.file + ' (' + x.lines + ', ' + x.threshold + ')').join(', ') || 'none'));
  console.log('- DML outside write boundary: ' + (item.dmlOutsideBoundary.slice(0, 5).join(', ') || 'none'));
  console.log('- Mixed concern files: ' + (item.mixedFiles.slice(0, 5).map((x) => x.file).join(', ') || 'none'));
  console.log('- Next: choose one lane, run source-truth mapper, ownership/SRP reviewer, and plan-adversary before edits.\n');
}

function printDryRunReport(repo, opportunities, preflight) {
  const lane = opportunities[0];
  console.log('# Daily Domain Refactor Dry Run Report\n');
  console.log('Repo: `' + repo + '`');
  console.log('Branch: `' + preflight.branch + '`');
  console.log('Current base SHA: `' + preflight.head + '`');
  console.log('Remote dev SHA: `' + preflight.remoteDev + '`');
  console.log('Local origin/dev SHA: `' + preflight.localOriginDev + '`');
  console.log('Freshness: ' + preflight.freshness);
  console.log('Route-card status: ' + preflight.routeCard.summary);
  console.log('Vault-index status: ' + preflight.tooling.vaultIndex);
  console.log('Cortex status: ' + preflight.tooling.cortexEngine);
  console.log('Dependency readiness: ' + preflight.dependencies.join('; '));
  console.log('Selected proposed lane: `' + (lane ? lane.domain : 'none') + '`\n');
  if (lane) printOpportunity(lane, 0);
  if (lane) {
    const seam = ['apps', 'api', 'src', 'domains', lane.domain, 'services', 'writeBoundary'].join('/');
    console.log('## Proposed lane scaffold\n');
    console.log('- Source files to inspect first: ' + JSON.stringify({
      lineCountReviewTriggers: lane.lineCountReviewTriggers.slice(0, 5),
      mixedFiles: lane.mixedFiles.slice(0, 5),
      dmlOutsideBoundary: lane.dmlOutsideBoundary.slice(0, 5),
    }));
    console.log('- Owner tables to verify: ' + JSON.stringify({
      domainOwnedTables: lane.domainOwnedTables,
      relatedServiceOwnedTables: lane.serviceOwnedLooksRelated.slice(0, 20),
    }));
    console.log('- Proposed seam: `' + seam + '/` or narrower existing write-boundary module after source proof');
    console.log('- Tests to locate/run: search the lane domain, write boundary, and ownership registry; caller must name exact focused tests before coding');
    console.log('- Stop gates: route card blocks mutation, README or flow contract missing, owner table lacks live-test proof, lane crosses integration semantics, or audit/review returns HIGH.\n');
  }
  console.log('## Subagent plan-review prompts\n');
  console.log('- source-truth-mapper: map exact domain files, service owner files, callers, tests, flow doc, README, and ownership rows. No edits.');
  console.log('- ownership-srp-reviewer: verify write boundary, table owner paths, README contract, route thinness, and one-responsibility split. No edits.');
  console.log('- plan-adversary: reject the lane if scope is too wide, proof is missing, route card blocks mutation, or merge gates are vague. No edits.\n');
  console.log('## PR / audit / merge checklist\n');
  console.log('- Pre-implementation: enterprise-precheck for daily-domain-refactor-runner and enterprise-refactor-to-green-pr.');
  console.log('- Pre-PR: code-variable-audit on local diff; schema-audit secret/readiness check for DB lanes.');
  console.log('- Post-PR: pr-schema-audit and code-variable-audit against PR number.');
  console.log('- Final head: focused tests, architecture checks, local canary, review threads zero, copilot-review-wait, required PR checks, enterprise merge-stage check.');
  console.log('- Merge: only after explicit `merge PR <number>` authorization and final-head proof.');
}

function main() {
  const args = parseArgs(process.argv);
  const opportunities = analyze(args.repo, args.count);
  const preflight = buildPreflight(args.repo);
  const output = { repo: args.repo, generatedAt: new Date().toISOString(), preflight, opportunities };
  if (args.json) { console.log(JSON.stringify(output, null, 2)); return; }
  if (args.dryRunReport) { printDryRunReport(args.repo, opportunities, preflight); return; }
  console.log('# Daily Domain SRP / Refactor Opportunities\n');
  console.log('Repo: `' + args.repo + '`');
  console.log('Opportunities returned: ' + opportunities.length + '\n');
  opportunities.forEach(printOpportunity);
  console.log('Hard stop: this script is read-only. PR-producing work must follow `$daily-domain-refactor-runner`.');
}

main();
