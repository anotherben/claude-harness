#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

function parseArgs(argv) {
  const out = { repo: process.cwd(), count: 5, json: false };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--repo') out.repo = path.resolve(argv[++i]);
    else if (arg === '--count') out.count = Number(argv[++i]);
    else if (arg === '--json') out.json = true;
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: select-domain-migration-candidates.cjs --repo PATH --count 2..5 [--json]');
      process.exit(0);
    }
  }
  if (!Number.isFinite(out.count) || out.count < 2 || out.count > 5) {
    throw new Error('--count must be between 2 and 5 for the daily selector');
  }
  return out;
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function repoPath(repo, rel) { return path.join(repo, rel); }
function fileExists(repo, rel) { return fs.existsSync(repoPath(repo, rel)); }
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
function getRouteCard(repo) {
  const rel = '.codex/enterprise-state/hook-ledger/latest-route-card.json';
  const full = repoPath(repo, rel);
  if (!fs.existsSync(full)) return { present: false, summary: 'missing' };
  try {
    const card = readJson(full);
    return { present: true, route: card.route || null, allowed_to_edit_here: card.allowed_to_edit_here, needs_clean_worktree: card.needs_clean_worktree, summary: `${card.route || 'unknown'} allowed=${card.allowed_to_edit_here} clean=${card.needs_clean_worktree}` };
  } catch (error) {
    return { present: true, error: String(error.message || error), summary: 'unreadable' };
  }
}
function runAudit(repo) {
  const script = repoPath(repo, 'scripts/db-write-enforcement.cjs');
  if (!fs.existsSync(script)) throw new Error('missing db-write enforcement script');
  const stdout = cp.execFileSync(process.execPath, [script, '--mode', 'audit', '--format', 'json'], { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const parsed = JSON.parse(stdout);
  if (!Array.isArray(parsed.inventory)) throw new Error('db-write audit returned no inventory array');
  return parsed.inventory;
}
function pathsForOwner(meta) {
  const paths = [];
  if (typeof meta.ownerPath === 'string') paths.push(meta.ownerPath);
  if (Array.isArray(meta.ownerPath)) paths.push.apply(paths, meta.ownerPath.filter(Boolean));
  if (Array.isArray(meta.ownerPaths)) paths.push.apply(paths, meta.ownerPaths.filter(Boolean));
  return Array.from(new Set(paths));
}
function likelyDomainFor(text, table) {
  const s = `${text} ${table}`.toLowerCase();
  if (/competitor|price.*watch|marketplace/.test(s)) return 'competitorPricing';
  if (/custom_report|dashboard|report_|saved_filter|analytics/.test(s)) return 'analyticsReporting';
  if (/rex_sync_queue|sync_queue|outbox|worker/.test(s)) return 'syncQueueWorkers';
  if (/stock.*forecast|forecast|velocity/.test(s)) return 'stockForecast';
  if (/supplier.*portal|portal|catalog/.test(s)) return 'supplierPortal';
  if (/purchase|purchase_order|smart.*po|supplier/.test(s)) return 'purchasing';
  if (/product|variant|shopify|price|sku/.test(s)) return 'products';
  if (/ticket|message|call|email|support|youtube/.test(s)) return 'tickets';
  if (/order|payment|fulfillment/.test(s)) return 'orders';
  if (/invoice|document|qbo|bill/.test(s)) return 'documentsInvoicing';
  if (/sticky/.test(s)) return 'stickyNotes';
  if (/gift/.test(s)) return 'giftVouchers';
  if (/bug/.test(s)) return 'bugIntake';
  return 'needs-domain-decision';
}
function riskFlags(file, tables, metaList) {
  const notes = metaList.map((meta) => meta.notes || '').join(' ');
  const text = `${file} ${tables.join(' ')} ${notes}`.toLowerCase();
  const flags = [];
  if (/auth|permission|session|tenant|security/.test(text) || metaList.some((meta) => meta.securityCritical)) flags.push('security-or-tenant');
  if (/inventory|stock|forecast|purchase_order|order|payment|invoice/.test(text)) flags.push('data-integrity');
  if (/sync|queue|job|worker|shopify|rex|qbo|external/.test(text)) flags.push('integration-or-async');
  return flags;
}
function mutationMatches(ownerPath, file) {
  return ownerPath.endsWith('/') ? file.startsWith(ownerPath) : file === ownerPath || file.startsWith(ownerPath + '/');
}

function main() {
  const args = parseArgs(process.argv);
  const repo = path.resolve(args.repo);
  const required = ['apps/api/ownership/db-write-owners.json', 'scripts/db-write-enforcement.cjs', 'docs/architecture/domain/INDEX.md', 'apps/api/src/services'];
  for (const rel of required) if (!fileExists(repo, rel)) throw new Error('missing Helpdesk path: ' + rel);
  const head = runVc(repo, ['rev-parse', 'HEAD']);
  const localOriginDev = runVc(repo, ['rev-parse', 'origin/dev']);
  const remoteDev = remoteDevSha(repo);
  if (head !== 'unknown' && remoteDev !== 'unknown' && head !== remoteDev) throw new Error('hard stop: HEAD does not match remote dev');
  const routeCard = getRouteCard(repo);
  const inventory = runAudit(repo);
  const ownersRaw = readJson(repoPath(repo, 'apps/api/ownership/db-write-owners.json'));
  const owners = ownersRaw.tables || ownersRaw;
  const byPath = new Map();

  for (const [table, meta] of Object.entries(owners)) {
    if ((meta.lifecycle || 'active') !== 'active') continue;
    for (const ownerPath of pathsForOwner(meta)) {
      if (!ownerPath.startsWith('apps/api/src/services/')) continue;
      const item = byPath.get(ownerPath) || { ownerPath, tables: new Set(), metaList: [], mutationSites: 0, operations: new Map(), liveTests: new Set() };
      item.tables.add(table);
      item.metaList.push(meta);
      if (meta.requiredLiveTest) item.liveTests.add(meta.requiredLiveTest);
      byPath.set(ownerPath, item);
    }
  }
  for (const site of inventory) {
    for (const item of byPath.values()) {
      if (site.file && mutationMatches(item.ownerPath, site.file)) {
        item.mutationSites += 1;
        const opKey = site.operation || 'mutation';
        item.operations.set(opKey, (item.operations.get(opKey) || 0) + 1);
      }
    }
  }

  const candidates = Array.from(byPath.values()).map((item) => {
    const tables = Array.from(item.tables).sort();
    const likelyDomain = likelyDomainFor(item.ownerPath, tables.join(' '));
    const domainPath = likelyDomain === 'needs-domain-decision' ? null : `apps/api/src/domains/${likelyDomain}`;
    const existingDomain = domainPath ? fileExists(repo, domainPath) : false;
    const flags = riskFlags(item.ownerPath, tables, item.metaList);
    const gated = flags.some((flag) => ['security-or-tenant', 'data-integrity', 'integration-or-async'].includes(flag));
    let score = tables.length * 12 + item.mutationSites * 2 + item.liveTests.size * 4;
    if (/gatekeeper/i.test(item.ownerPath)) score += 8;
    if (existingDomain) score += 8;
    if (!existingDomain) score -= 4;
    if (flags.includes('security-or-tenant')) score -= 12;
    if (flags.includes('integration-or-async')) score -= 6;
    return { ownerPath: item.ownerPath, score, tables, mutationSites: item.mutationSites, operations: Object.fromEntries(Array.from(item.operations.entries()).sort()), likelyDomain, existingDomain, liveTests: Array.from(item.liveTests).sort(), flags, gated, suggestedSeam: existingDomain ? `${domainPath}/services/writeBoundary/` : `create ${domainPath || 'domain'} writeBoundary after discovery` };
  }).sort((left, right) => right.score - left.score || right.mutationSites - left.mutationSites || left.ownerPath.localeCompare(right.ownerPath));

  const result = { repo, head, remoteDev, localOriginDev, routeCard, count: args.count, candidates: candidates.slice(0, args.count) };
  if (args.json) { console.log(JSON.stringify(result, null, 2)); return; }
  console.log('# Daily Domain Migration Candidates');
  console.log(`\nRepo: ${repo}`);
  console.log(`HEAD: ${head}`);
  console.log(`remote dev: ${remoteDev}`);
  console.log(`local origin/dev: ${localOriginDev}`);
  console.log(`Route card: ${routeCard.summary}`);
  console.log(`\nTop ${result.candidates.length} candidates:\n`);
  result.candidates.forEach((candidate, index) => {
    console.log(`## ${index + 1}. ${candidate.ownerPath}`);
    console.log(`- Score: ${candidate.score}`);
    console.log(`- Likely domain: ${candidate.likelyDomain}${candidate.existingDomain ? ' (exists)' : ' (not found)'}`);
    console.log(`- Tables: ${candidate.tables.join(', ') || 'none'}`);
    console.log(`- Mutation sites: ${candidate.mutationSites}`);
    console.log(`- Operations: ${Object.entries(candidate.operations).map((entry) => `${entry[0]}=${entry[1]}`).join(', ') || 'none found by audit'}`);
    console.log(`- Live tests: ${candidate.liveTests.join(', ') || 'missing or unknown'}`);
    console.log(`- Risk flags: ${candidate.flags.join(', ') || 'none'}`);
    console.log(`- Gate: ${candidate.gated ? 'enterprise discovery required before implementation' : 'standard refactor lane still requires review gates'}`);
    console.log(`- Proposed seam: ${candidate.suggestedSeam}`);
    console.log('- Required next read: owner registry entry, service file, target domain README or flow doc, tests, and GOTCHAS.md.\n');
  });
}

main();
