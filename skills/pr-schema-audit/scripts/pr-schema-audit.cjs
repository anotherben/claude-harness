#!/usr/bin/env node
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const child = require('child_process');
const mod = require('module');
const DB_ENV = 'HELPDESK_SCHEMA_AUDIT_DATABASE_URL';
const DB_FILE = path.join(os.homedir(), '.codex', 'secrets', 'helpdesk-schema-audit-db-url');
const EXTS = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.sql', '.ts', '.tsx']);
const SQL_RE = /\b(select|insert|update|delete|with|from|join|where|on\s+conflict|returning|create|alter|drop)\b/i;
// A string is treated as a verifiable SQL statement only if (after normalisation strips comments)
// it BEGINS with a statement keyword. Prevents prose/HTML strings that merely contain a word like
// "from" (e.g. an email template with a <table> element) from being parsed as SQL.
const SQL_STMT_RE = /^\(*\s*(with|select|insert|update|delete|create|alter|drop|truncate|merge|explain|refresh)\b/i;
function isStatement(s) { return SQL_STMT_RE.test(String(s || '')); }
// Words that can follow a closing ')' but are SQL keywords, not subquery aliases.
var SUBALIAS_KW = new Set(['on', 'and', 'or', 'where', 'group', 'order', 'having', 'limit', 'offset', 'returning', 'then', 'else', 'end', 'when', 'loop', 'as', 'join', 'left', 'right', 'inner', 'outer', 'full', 'cross', 'union', 'except', 'intersect', 'is', 'not', 'in', 'like', 'ilike', 'between', 'desc', 'asc', 'nulls', 'using', 'over', 'filter', 'within', 'do', 'values', 'from', 'set', 'for', 'with', 'window', 'fetch']);
const SEV = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const MARK = 'pr-schema-audit:';
function args(argv) {
  var a = { dbEnv: DB_ENV, dbFile: DB_FILE, publish: false, json: false, output: '', maxFiles: 1000 };
  for (var i = 0; i < argv.length; i += 1) {
    var x = argv[i];
    function next() { i += 1; if (!(i < argv.length)) throw new Error('missing value for ' + x); return argv[i]; }
    if (x === '--pr') a.pr = next();
    else if (x === '--repo') a.repo = next();
    else if (x === '--db-url-env') a.dbEnv = next();
    else if (x === '--db-url-file') a.dbFile = home(next());
    else if (x === '--output') a.output = home(next());
    else if (x === '--max-files') a.maxFiles = Number.parseInt(next(), 10);
    else if (x === '--publish') a.publish = true;
    else if (x === '--dry-run') a.publish = false;
    else if (x === '--json') a.json = true;
    else if (x === '-h' || x === '--help') { help(); process.exit(0); }
    else throw new Error('unknown argument: ' + x);
  }
  if (!a.pr) throw new Error('missing required --pr');
  if (!Number.isFinite(a.maxFiles) || a.maxFiles < 1) throw new Error('--max-files must be positive');
  return a;
}
function help() {
  console.log('Usage: pr-schema-audit.cjs --pr N [--repo owner/name] [--publish] [--json] [--output path]');
  console.log('Reads DB URL from ' + DB_ENV + ' or ' + DB_FILE + '. Values are never printed.');
}
function home(v) { if (!v) return v; if (v === '~') return os.homedir(); if (v.startsWith('~/')) return path.join(os.homedir(), v.slice(2)); return v; }
function gh(xs) {
  var r = child.spawnSync('gh', xs, { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 80 * 1024 * 1024 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error('gh ' + xs.join(' ') + ' failed: ' + (r.stderr || r.stdout || '').trim());
  return r.stdout;
}
function ghj(xs) { return JSON.parse(gh(xs)); }
function pg() {
  try { return require('pg'); } catch (_) {}
  try { return mod.createRequire(path.join(process.cwd(), 'package.json'))('pg'); } catch (_) {}
  try { return mod.createRequire('/Users/ben/helpdesk/package.json')('pg'); } catch (_) {}
  try { return mod.createRequire('/Users/ben/Projects/helpdesk/package.json')('pg'); } catch (e) { throw new Error('pg package unavailable: ' + e.message); }
}
function secret(a) {
  if (process.env[a.dbEnv]) return { value: process.env[a.dbEnv].trim(), source: 'env:' + a.dbEnv };
  if (a.dbFile && fs.existsSync(a.dbFile)) {
    var mode = fs.statSync(a.dbFile).mode & 0o777;
    if ((mode & 0o077) !== 0) throw new Error('secret file is readable beyond owner: ' + a.dbFile);
    return { value: fs.readFileSync(a.dbFile, 'utf8').trim(), source: 'file:' + a.dbFile };
  }
  throw new Error('database URL missing; set ' + a.dbEnv + ' or create owner-only file ' + a.dbFile);
}
function repoName(r) { if (r) return r; return ghj(['repo', 'view', '--json', 'nameWithOwner']).nameWithOwner; }
function prInfo(repo, pr) { return ghj(['pr', 'view', pr, '--repo', repo, '--json', 'number,title,state,mergedAt,headRefOid,baseRefName,headRefName,url,author']); }
function changed(repo, pr) {
  // Use the files API so each path carries its change status; `removed` files do not exist at the
  // PR head and must be skipped, not reported as "could not be read". --jq streams TSV per page so
  // this stays correct across pagination (large PRs). Falls back to name-only (status unknown).
  try {
    var out = gh(['api', '--paginate', 'repos/' + repo + '/pulls/' + pr + '/files', '--jq', '.[] | [.filename, .status] | @tsv']);
    return out.split(/\r?\n/).map(function(s) { return s.replace(/\r$/, ''); }).filter(Boolean).map(function(ln) { var p = ln.split('\t'); return { path: p[0], status: p[1] || 'modified' }; });
  } catch (_) {
    return gh(['pr', 'diff', pr, '--repo', repo, '--name-only']).split(/\r?\n/).map(function(s) { return s.trim(); }).filter(Boolean).map(function(p) { return { path: p, status: 'modified' }; });
  }
}
function apiPath(f) { return f.split('/').map(encodeURIComponent).join('/'); }
// Transient GitHub/transport failures (rate limit, flaky auth, 5xx, network) must not be reported as
// schema findings — they say nothing about the PR. Retry them; a non-transient error (e.g. 404) is
// returned immediately.
function isTransient(msg) { return /\b(401|403|429|5\d\d)\b|bad credentials|rate limit|abuse detection|secondary rate|timeout|timed out|temporarily|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang|connection reset|could not resolve host/i.test(String(msg || '')); }
// A rate limit / abuse block does not clear within the retry window and makes EVERY subsequent fetch
// fail. Treat it as fatal so the run aborts with a clear "inconclusive" message rather than emitting
// a flood of phantom "could not be read" findings (a false DO NOT MERGE).
function isRateLimit(msg) { return /rate limit exceeded|secondary rate limit|abuse detection mechanism/i.test(String(msg || '')); }
function sleepMs(ms) { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch (_) {} }
function fileAt(repo, f, ref) {
  var lastErr = '';
  for (var attempt = 0; attempt < 4; attempt += 1) {
    if (attempt > 0) sleepMs(400 * attempt);
    try {
      var j = ghj(['api', '--method', 'GET', 'repos/' + repo + '/contents/' + apiPath(f), '-f', 'ref=' + ref]);
      if (Array.isArray(j) || j.type !== 'file') return { ok: false, reason: 'not a file at PR head' };
      if (j.content && j.encoding === 'base64') return { ok: true, text: Buffer.from(j.content, 'base64').toString('utf8') };
      if (j.sha) {
        var b = ghj(['api', '--method', 'GET', 'repos/' + repo + '/git/blobs/' + j.sha]);
        if (b.content && b.encoding === 'base64') return { ok: true, text: Buffer.from(b.content, 'base64').toString('utf8') };
      }
      return { ok: false, reason: 'unsupported content encoding' };
    } catch (e) { lastErr = e.message; if (isRateLimit(e.message)) throw new Error('GitHub API rate limit exceeded — audit is inconclusive; rerun after the limit resets'); if (!isTransient(e.message)) return { ok: false, reason: e.message }; }
  }
  return { ok: false, reason: 'github fetch failed after retries (transient): ' + lastErr };
}
async function schema(url) {
  var Client = pg().Client;
  var c = new Client({ connectionString: url, ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false } });
  await c.connect();
  try {
    var cols = await c.query("select table_schema, table_name, column_name, data_type, udt_name, is_nullable, column_default from information_schema.columns where table_schema not in ('pg_catalog','information_schema') order by table_schema, table_name, ordinal_position");
    // information_schema.columns omits materialized views; read their columns from the catalog so
    // references to mv_* relations resolve instead of reporting a phantom "table not found".
    var mv = await c.query("select n.nspname as table_schema, c.relname as table_name, a.attname as column_name, format_type(a.atttypid, a.atttypmod) as data_type, t.typname as udt_name, case when a.attnotnull then 'NO' else 'YES' end as is_nullable, null as column_default from pg_class c join pg_namespace n on n.oid = c.relnamespace join pg_attribute a on a.attrelid = c.oid join pg_type t on t.oid = a.atttypid where c.relkind = 'm' and a.attnum > 0 and not a.attisdropped and n.nspname not in ('pg_catalog','information_schema') order by n.nspname, c.relname, a.attnum");
    var idx = await c.query("select schemaname, tablename, indexname, indexdef from pg_indexes where schemaname not in ('pg_catalog','information_schema') order by schemaname, tablename, indexname");
    var cons = await c.query("select ns.nspname as table_schema, tbl.relname as table_name, con.conname as constraint_name, con.contype as constraint_type, array_remove(array_agg(att.attname order by key.ord), null) as columns from pg_constraint con join pg_class tbl on tbl.oid = con.conrelid join pg_namespace ns on ns.oid = tbl.relnamespace left join unnest(con.conkey) with ordinality as key(attnum, ord) on true left join pg_attribute att on att.attrelid = tbl.oid and att.attnum = key.attnum where ns.nspname not in ('pg_catalog','information_schema') group by ns.nspname, tbl.relname, con.conname, con.contype order by ns.nspname, tbl.relname, con.conname");
    return indexSchema(cols.rows.concat(mv.rows), idx.rows, cons.rows);
  } finally { await c.end(); }
}
function indexSchema(cols, idx, cons) {
  var tables = new Map(); var bare = new Map();
  cols.forEach(function(r) {
    var k = r.table_schema + '.' + r.table_name;
    if (!tables.has(k)) tables.set(k, { schema: r.table_schema, name: r.table_name, key: k, columns: new Map(), indexes: [], constraints: [] });
    tables.get(k).columns.set(r.column_name, r);
    if (!bare.has(r.table_name)) bare.set(r.table_name, new Set());
    bare.get(r.table_name).add(k);
  });
  idx.forEach(function(r) { var k = r.schemaname + '.' + r.tablename; if (tables.has(k)) tables.get(k).indexes.push(r); });
  cons.forEach(function(r) { var k = r.table_schema + '.' + r.table_name; r.columns = arr(r.columns); if (tables.has(k)) tables.get(k).constraints.push(r); });
  return { tables: tables, bare: bare, tableCount: tables.size, columnCount: cols.length };
}
// Postgres array columns (e.g. a constraint's column list) normally arrive as JS arrays, but
// can surface as a raw '{a,b}' string when the array type parser is not registered. Coerce
// defensively so downstream .map/.includes never throw on a non-array (a crash that aborts the
// whole audit and masks every real finding).
function arr(v) { if (Array.isArray(v)) return v; if (v == null) return []; var s = String(v).trim(); if (s.charAt(0) === '{') return s.slice(1, -1).split(',').map(function(x) { return x.replace(/^"|"$/g, '').trim(); }).filter(Boolean); return s ? [s] : []; }
function table(sc, raw) {
  var n = ident(raw); var parts = n.split('.');
  if (parts.length === 2 && (parts[0] === 'information_schema' || parts[0] === 'pg_catalog')) return systemTable(n);
  // Unqualified Postgres system-catalog relations (pg_class, pg_index, pg_indexes, pg_constraint,
  // pg_attribute, pg_namespace, ...) live in pg_catalog, which the live-schema read excludes.
  // Migration-verification code references them directly; treat them as system tables, not gaps.
  if (parts.length === 1 && /^pg_[a-z]/i.test(n) && !sc.bare.has(n)) return systemTable('pg_catalog.' + n);
  if (parts.length === 2) return sc.tables.get(parts[0] + '.' + parts[1]) || null;
  if (sc.tables.has('public.' + n)) return sc.tables.get('public.' + n);
  var s = sc.bare.get(n);
  return s && s.size === 1 ? sc.tables.get(Array.from(s)[0]) : null;
}
function systemTable(n) {
  var cols = new Map();
  ['table_schema', 'table_name', 'column_name', 'constraint_name', 'indexname', 'schemaname', 'tablename'].forEach(function(c) { cols.set(c, { column_name: c }); });
  return { schema: n.split('.')[0], name: n.split('.')[1], key: n, columns: cols, indexes: [], constraints: [], system: true };
}
function ident(v) { return String(v || '').replace(/["`]/g, '').trim(); }
function scan(files, repo, ref, maxFiles) {
  if (maxFiles < files.length) throw new Error('too many changed files: ' + files.length);
  var scanned = []; var skipped = [];
  files.forEach(function(fi) {
    var f = fi.path;
    if (fi.status === 'removed') { skipped.push({ path: f, reason: 'removed in PR' }); return; }
    if (!EXTS.has(path.extname(f).toLowerCase())) { skipped.push({ path: f, reason: 'extension not audited' }); return; }
    var got = fileAt(repo, f, ref);
    if (!got.ok) { scanned.push({ path: f, ok: false, reason: got.reason, envVars: [], dbCalls: [], sqlStatements: [], secretLiterals: [] }); return; }
    var x = extract(f, got.text); x.path = f; x.ok = true; scanned.push(x);
  });
  return { scanned: scanned, skipped: skipped };
}
function extract(f, txt) {
  var envVars = envs(txt); var secretLiterals = secrets(txt);
  if (path.extname(f).toLowerCase() === '.sql') { var nf = norm(txt); return { envVars: envVars, secretLiterals: secretLiterals, dbCalls: [], sqlStatements: isStatement(nf) ? [{ file: f, line: 1, source: 'sql-file', sql: nf }] : [] }; }
  var code = blankJsComments(txt);
  var vars = sqlVars(code); var fns = sqlFns(code); var dbCalls = calls(code, vars, fns); var st = [];
  dbCalls.forEach(function(c) { if (c.resolved && isStatement(c.sql)) st.push({ file: f, line: c.line, source: 'db-call:' + c.callee, sql: c.sql }); });
  vars.forEach(function(v) { if (!v.usedByCall && isStatement(v.sql)) st.push({ file: f, line: v.line, source: 'sql-variable:' + v.name, sql: v.sql }); });
  return { envVars: envVars, secretLiterals: secretLiterals, dbCalls: dbCalls, sqlStatements: st };
}
function envs(txt) {
  var out = new Map(); var patterns = [/process\.env\.([A-Z][A-Z0-9_]*)/g, /process\.env\[['"]([A-Z][A-Z0-9_]*)['"]\]/g];
  patterns.forEach(function(re) { var m; while ((m = re.exec(txt))) out.set(m[1], line(txt, m.index)); });
  return Array.from(out.entries()).map(function(x) { return { name: x[0], line: x[1] }; });
}
var FIXTURE_HOST = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|::1)$|(^|\.)(test|example|invalid|localhost)$/i;
var PLACEHOLDER_CRED = /^(user|username|pass|password|passwd|secret|example|sample|dummy|placeholder|changeme|change-me|test|testing|foo|bar|baz|x{3,}|redacted|your[-_]?\w*)$/i;
// A credential that literally embeds a placeholder word (e.g. "dev-password", "super-secret-password")
// is fixture data, not a real leaked secret — genuine generated secrets do not spell out "password".
var PLACEHOLDER_SUBSTR = /(password|passwd|secret|changeme|change-me|placeholder|example|sample|dummy|redacted|fakepass|your[-_])/i;
// A connection-string-shaped value is only a real leaked secret if it embeds
// non-interpolated credentials pointing at a non-fixture host. Env-var passthroughs
// (e.g. "$DATABASE_URL"), interpolations, and test/example fixtures are not secrets.
function looksLikeRealSecret(value) {
  var v = String(value || '').trim();
  if (!v) return false;
  if (/^\$\{?[A-Za-z_]/.test(v) || /^%[A-Za-z_]\w*%$/.test(v) || /process\.env\b/.test(v)) return false;
  var creds = v.match(/:\/\/([^:@\/\s]+):([^@\/\s]+)@([^\/:?\s]+)/);
  if (!creds) return false;
  if (/[$%{}]/.test(creds[1] + creds[2])) return false;
  if (FIXTURE_HOST.test(creds[3])) return false;
  if (PLACEHOLDER_CRED.test(creds[1]) || PLACEHOLDER_CRED.test(creds[2])) return false;
  if (PLACEHOLDER_SUBSTR.test(creds[1]) || PLACEHOLDER_SUBSTR.test(creds[2])) return false;
  return true;
}
function secrets(txt) {
  var out = []; var ps = [{ kind: 'postgresql URL literal', re: /postgres(?:ql)?:\/\/[^'"`\s)]+/gi, value: function(m) { return m[0]; } }, { kind: 'database URL assignment', re: /\b[A-Z0-9_]*DATABASE_URL[A-Z0-9_]*\s*[:=]\s*['"]([^'"]+)['"]/gi, value: function(m) { return m[1]; } }, { kind: 'private key marker', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g, value: null }];
  ps.forEach(function(p) { var m; while ((m = p.re.exec(txt))) { if (p.value && !looksLikeRealSecret(p.value(m))) continue; out.push({ kind: p.kind, line: line(txt, m.index) }); } });
  return out;
}
function sqlVars(txt) {
  var vars = new Map(); var re = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([`'"])/g; var m;
  while ((m = re.exec(txt))) { var lit = str(txt, m.index + m[0].length - 1); if (!lit) continue; var sql = norm(lit.value); if (SQL_RE.test(sql)) vars.set(m[1], { name: m[1], line: line(txt, m.index), sql: sql, usedByCall: false }); re.lastIndex = lit.endIndex; }
  // Ternary-assigned SQL: `const q = cond ? 'SELECT ...' : 'SELECT ...'`. Resolve to the consequent
  // literal (both branches usually hit the same tables). The negative lookahead skips direct string
  // assignments (handled above) so a `?` placeholder inside a literal is not mistaken for a ternary.
  var re2 = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?!['"`])[^;={]*?\?\s*([`'"])/g; var m2;
  while ((m2 = re2.exec(txt))) { if (vars.has(m2[1])) continue; var lit2 = str(txt, m2.index + m2[0].length - 1); if (!lit2) continue; var sql2 = norm(lit2.value); if (isStatement(sql2)) vars.set(m2[1], { name: m2[1], line: line(txt, m2.index), sql: sql2, usedByCall: false }); }
  return vars;
}
// Same-file functions that return a static SQL literal, e.g. `function q() { return `SELECT ...` }`
// or `const q = () => `SELECT ...``. A `db.query(q())` call is then resolvable to that SQL rather
// than reported as unresolved. Maps function name -> normalised SQL of its first SQL return.
function sqlFns(txt) {
  var out = new Map(); var m;
  var re1 = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g;
  while ((m = re1.exec(txt))) { var sql = firstReturnedSql(braceSpan(txt, txt.indexOf('{', m.index))); if (sql) out.set(m[1], sql); }
  var re2 = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*/g;
  while ((m = re2.exec(txt))) { var rest = txt.slice(re2.lastIndex); if (rest.charAt(0) === '{') { var b = firstReturnedSql(braceSpan(txt, re2.lastIndex)); if (b) out.set(m[1], b); } else { var k = 0; while (k < rest.length && /\s/.test(rest[k])) k += 1; if (["'", '"', '`'].includes(rest[k])) { var lit = str(rest, k); if (lit) { var s = norm(lit.value); if (isStatement(s)) out.set(m[1], s); } } } }
  return out;
}
function firstReturnedSql(body) { var re = /\breturn\s*['"`]/g; var m; while ((m = re.exec(body))) { var lit = str(body, m.index + m[0].length - 1); if (!lit) continue; var s = norm(lit.value); if (isStatement(s)) return s; } return null; }
function calls(txt, vars, fns) {
  var out = []; var re = /\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*){0,3})\s*\.\s*(query|execute|raw|many|one|none|transaction)\s*\(|\bsql\s*`/g; var m;
  while ((m = re.exec(txt))) {
    if (m[0].startsWith('sql`')) { var lit = str(txt, m.index + 3); out.push({ callee: 'sql-template', line: line(txt, m.index), resolved: Boolean(lit), sql: lit ? norm(lit.value) : '', unresolvedReason: lit ? '' : 'template literal unreadable', snippet: lit ? '' : lineAt(txt, m.index) }); if (lit) re.lastIndex = lit.endIndex; continue; }
    var parenIdx = txt.indexOf('(', m.index); var first = firstArg(txt, parenIdx + 1); var callee = m[1] + '.' + m[2]; var ln = line(txt, m.index); var method = m[2];
    var literalSql = Boolean(first && first.type === 'literal');
    var varSql = Boolean(first && first.type === 'identifier' && vars.has(first.value));
    // A transaction call with a callback, or any DB method whose first argument is a function,
    // is a wrapper: it carries no SQL string of its own. The SQL lives in nested .query/.execute
    // calls inside the callback body, which this same pass scans and verifies independently.
    // Flagging the wrapper as "unresolved SQL" is a false-positive HIGH, so recognize it instead.
    if ((first && first.type === 'function') || (method === 'transaction' && !literalSql && !varSql)) { out.push({ callee: callee, line: ln, resolved: true, wrapper: method === 'transaction' ? 'transaction' : 'callback', sql: '', unresolvedReason: '' }); continue; }
    // A spread first argument (`client.query(...args)`) forwards a caller's arguments — a pass-through
    // shim, not a literal SQL site, so there is nothing to resolve here.
    if (first && first.type === 'spread') { out.push({ callee: callee, line: ln, resolved: true, wrapper: 'forward', sql: '', unresolvedReason: '' }); continue; }
    if (literalSql) { out.push({ callee: callee, line: ln, resolved: true, sql: norm(first.value), unresolvedReason: '' }); continue; }
    if (varSql) { var v = vars.get(first.value); v.usedByCall = true; out.push({ callee: callee, line: ln, resolved: true, sql: v.sql, unresolvedReason: '' }); continue; }
    // `.execute({...})` / `.query({...})` with an object argument: extract a text:/sql: literal if
    // present (pg's object form), otherwise it is a non-DB method call (e.g. service.execute({...})).
    if (first && first.type === 'object') { var os = objectSql(first.value); out.push(os ? { callee: callee, line: ln, resolved: true, sql: os, unresolvedReason: '' } : { callee: callee, line: ln, resolved: true, wrapper: 'non-sql', sql: '', unresolvedReason: '' }); continue; }
    var span = parenIdx >= 0 ? argSpan(txt, parenIdx) : '';
    // Inline ternary of static literals: `db.query(cond ? 'SELECT ...' : 'SELECT ...')`.
    var ts = ternarySql(span); if (ts) { out.push({ callee: callee, line: ln, resolved: true, sql: ts, unresolvedReason: '' }); continue; }
    // Argument is a call to a same-file function that returns a static SQL literal: `db.query(buildSql())`.
    var cm = /^\s*([A-Za-z_$][\w$]*)\s*\(/.exec(span); if (cm && fns && fns.has(cm[1])) { out.push({ callee: callee, line: ln, resolved: true, sql: fns.get(cm[1]), unresolvedReason: '' }); continue; }
    if (!first) { out.push({ callee: callee, line: ln, resolved: false, sql: '', unresolvedReason: 'first argument missing', snippet: lineAt(txt, m.index) }); continue; }
    out.push({ callee: callee, line: ln, resolved: false, sql: '', unresolvedReason: first.type + ':' + first.value, snippet: lineAt(txt, m.index) });
  }
  return out;
}
function firstArg(txt, start) {
  var i = start; while (i < txt.length && /\s/.test(txt[i])) i += 1;
  if (["'", '"', '`'].includes(txt[i])) { var lit = str(txt, i); return lit ? { type: 'literal', value: lit.value } : null; }
  if (txt[i] === '{') return { type: 'object', value: braceSpan(txt, i) };
  var rest = txt.slice(i);
  if (rest.slice(0, 3) === '...') return { type: 'spread', value: '...' };
  if (isFunctionArg(rest)) return { type: 'function', value: 'callback' };
  var id = rest.match(/^([A-Za-z_$][\w$]*)/);
  if (id) { if (/^\s*=>/.test(rest.slice(id[1].length))) return { type: 'function', value: 'callback' }; return { type: 'identifier', value: id[1] }; }
  var ex = rest.slice(0, 80).split(/[,\n)]/)[0].trim(); return ex ? { type: 'expression', value: ex } : null;
}
// Balanced substring from an opening '{' (object literal) or, for argSpan, the first call argument
// up to the top-level comma or matching ')'. Used to recover SQL from object/ternary arguments.
function braceSpan(txt, i) { var d = 0; var j = i; while (j < txt.length) { var ch = txt[j]; if (ch === "'" || ch === '"' || ch === '`') { var lit = str(txt, j); if (lit) { j = lit.endIndex; continue; } } if (ch === '{') d += 1; else if (ch === '}') { d -= 1; if (d === 0) return txt.slice(i, j + 1); } j += 1; } return txt.slice(i); }
// String-aware so commas/parens INSIDE SQL string literals (e.g. `SELECT id, name FROM t`) do not
// prematurely terminate the first-argument span.
function argSpan(txt, openParen) { var d = 0; var j = openParen; while (j < txt.length) { var ch = txt[j]; if (ch === "'" || ch === '"' || ch === '`') { var lit = str(txt, j); if (lit) { j = lit.endIndex; continue; } } if (ch === '(') d += 1; else if (ch === ')') { d -= 1; if (d === 0) return txt.slice(openParen + 1, j); } else if (ch === ',' && d === 1) return txt.slice(openParen + 1, j); j += 1; } return txt.slice(openParen + 1); }
// Replace JS line/block comment characters with spaces (newlines and length preserved so reported
// line numbers stay correct), skipping string/template literals so a commented-out `db.query()` is
// not parsed as a real call. Applied before DB-call/SQL-variable extraction.
function blankJsComments(txt) {
  var a = txt.split(''); var i = 0; var n = txt.length;
  while (i < n) {
    var c = txt[i];
    if (c === "'" || c === '"' || c === '`') { var lit = str(txt, i); if (lit) { i = lit.endIndex; continue; } i += 1; continue; }
    if (c === '/' && txt[i + 1] === '/') { while (i < n && txt[i] !== '\n') { a[i] = ' '; i += 1; } continue; }
    if (c === '/' && txt[i + 1] === '*') { while (i < n && !(txt[i] === '*' && txt[i + 1] === '/')) { if (txt[i] !== '\n') a[i] = ' '; i += 1; } if (i < n) { a[i] = ' '; a[i + 1] = ' '; i += 2; } continue; }
    i += 1;
  }
  return a.join('');
}
// Pull a SQL statement out of pg's object call form ({ text|sql: '...' }); null when absent/not SQL.
function objectSql(objText) { var m = /\b(?:text|sql)\s*:\s*['"`]/.exec(objText); if (!m) return null; var lit = str(objText, m.index + m[0].length - 1); if (!lit) return null; var s = norm(lit.value); return isStatement(s) ? s : null; }
// Resolve a ternary-of-literals argument to its consequent SQL literal; null when not a SQL ternary.
function ternarySql(span) { var qi = span.indexOf('?'); if (qi < 0) return null; var sub = span.slice(qi + 1); var mm = /^\s*['"`]/.exec(sub); if (!mm) return null; var lit = str(sub, mm.index + mm[0].length - 1); if (!lit) return null; var s = norm(lit.value); return isStatement(s) ? s : null; }
// True when the upcoming source is a function expression: an async/plain function, an
// async or parenthesised arrow, or an async single-param arrow. Single-param arrows without
// parens (e.g. `client => ...`) are detected by the caller via the `=>` lookahead above.
function isFunctionArg(rest) {
  return /^async\s+function\b/.test(rest) || /^function\b/.test(rest) || /^async\s*\(/.test(rest) || /^async\s+[A-Za-z_$][\w$]*\s*=>/.test(rest) || /^\([^()]*\)\s*=>/.test(rest);
}
function str(txt, q) {
  var quote = txt[q]; if (!["'", '"', '`'].includes(quote)) return null;
  var value = ''; var esc = false;
  for (var i = q + 1; i < txt.length; i += 1) { var ch = txt[i]; if (esc) { value += ch; esc = false; continue; } if (ch === '\\') { esc = true; value += ch; continue; } if (ch === quote) return { value: value, endIndex: i + 1 }; value += ch; }
  return null;
}
function norm(sql) { return stripComments(String(sql || '')).replace(/\$\{[^}]*\}/g, '?').replace(/\s+/g, ' ').trim(); }
// Strip SQL line (--) and block (/* */) comments before parsing so commented-out prose
// (e.g. "cannot update or block another tenant's") is not mis-read as table/column references.
// Single-quoted strings and dollar-quoted bodies are preserved so comment markers inside
// literals survive intact.
function stripComments(s) {
  var out = ''; var i = 0; var n = s.length;
  while (i < n) {
    var c = s[i]; var d = i + 1 < n ? s[i + 1] : '';
    if (c === '$') { var dq = /^\$[A-Za-z_0-9]*\$/.exec(s.slice(i)); if (dq) { var tag = dq[0]; var e = s.indexOf(tag, i + tag.length); if (e < 0) { out += s.slice(i); break; } out += s.slice(i, e + tag.length); i = e + tag.length; continue; } }
    if (c === "'") { out += c; i += 1; while (i < n) { out += s[i]; if (s[i] === "'") { if (s[i + 1] === "'") { out += s[i + 1]; i += 2; continue; } i += 1; break; } i += 1; } continue; }
    if (c === '-' && d === '-') { var nl = s.indexOf('\n', i); if (nl < 0) { out += ' '; break; } out += ' '; i = nl; continue; }
    if (c === '/' && d === '*') { var ce = s.indexOf('*/', i + 2); if (ce < 0) { out += ' '; break; } out += ' '; i = ce + 2; continue; }
    out += c; i += 1;
  }
  return out;
}
function line(txt, idx) { var n = 1; for (var i = 0; i < idx; i += 1) if (txt.charCodeAt(i) === 10) n += 1; return n; }
function lineAt(txt, idx) { var s = txt.lastIndexOf('\n', idx) + 1; var e = txt.indexOf('\n', idx); if (e < 0) e = txt.length; return txt.slice(s, e).trim(); }
function finding(severity, file, lineNo, title, detail) { return { severity: severity, file: file, line: lineNo, title: title, detail: detail }; }
function analyze(files, sc) {
  var findings = []; var statements = [];
  files.forEach(function(f) {
    if (!f.ok) { findings.push(finding('HIGH', f.path, 1, 'changed file could not be read at PR head', f.reason)); return; }
    f.secretLiterals.forEach(function(s) { findings.push(finding('CRITICAL', f.path, s.line, 'possible secret literal in PR file', s.kind)); });
    f.dbCalls.forEach(function(c) { if (!c.resolved) findings.push(finding('HIGH', f.path, c.line, 'DB call is not statically resolved', c.callee + ': ' + c.unresolvedReason + (c.snippet ? ' | source: ' + snip(c.snippet) : ''))); });
    var created = createdTables(f.sqlStatements);
    f.sqlStatements.forEach(function(s) { var checked = sqlCheck(s, sc, created); statements.push(checked); checked.findings.forEach(function(x) { findings.push(x); }); });
  });
  return { findings: findings, statements: statements };
}
function sqlCheck(st, sc, created) {
  // Parse against a copy with string-literal contents blanked, so SQL keywords appearing inside
  // string values (e.g. 'Generated from Smart PO recommendations') are not read as table refs.
  // Keep the original `sql` for human-readable snippets. `created` holds tables the PR itself
  // creates (temp/fixture/migration tables), which are excluded like CTE names.
  var sql = st.sql; var psql = maskStrings(sql); created = created || new Set();
  var refs = tableRefs(psql); var ctes = cteNames(psql); var aliases = new Map(); var derived = new Set(); var tableRows = []; var columnChecks = []; var findings = [];
  // An alias bound to a CTE or a PR-created table has computed columns we cannot verify against the
  // live schema. The SAME alias may also be bound to a base table in another query scope (alias reuse,
  // e.g. `JOIN purchase_orders po` inside a CTE and `LEFT JOIN po_stock po` outside) — the flat parser
  // cannot tell the scopes apart, so any column ref on such an alias is ambiguous and is not flagged.
  // Aliases attached to a derived subquery — `(SELECT ...) po` / `(...) AS po` — name a result set
  // with computed columns, not a base table. The same alias is often reused for a base table in an
  // inner scope (e.g. `JOIN purchase_orders po` inside the subquery), so treat such aliases as derived.
  var subAlias = /\)\s+(?:as\s+)?([a-zA-Z_][\w$]*)/gi; var sa;
  while ((sa = subAlias.exec(psql))) { if (!SUBALIAS_KW.has(sa[1].toLowerCase())) derived.add(sa[1].toLowerCase()); }
  refs.forEach(function(r) { var low = ident(r.name).toLowerCase(); if (ctes.has(low) || created.has(low)) { if (r.alias) derived.add(r.alias.toLowerCase()); return; } var t = table(sc, r.name); if (!t) { findings.push(finding('HIGH', st.file, st.line, 'table not found in live schema: ' + r.name, snip(sql))); return; } tableRows.push({ raw: r.name, alias: r.alias, kind: r.kind, table: t.key }); aliases.set(r.name, t); aliases.set(t.name, t); aliases.set(t.key, t); if (r.alias) aliases.set(r.alias, t); });
  aliasCols(psql).forEach(function(r) { if (derived.has(String(r.alias).toLowerCase())) return; var t = aliases.get(r.alias); if (!t) return; columnChecks.push({ table: t.key, column: r.column, source: r.alias + '.' + r.column }); if (!t.system && !t.columns.has(r.column)) findings.push(finding('HIGH', st.file, st.line, 'column not found in live schema: ' + r.alias + '.' + r.column, r.alias + ' maps to ' + t.key)); });
  insertCols(psql).forEach(function(x) { if (created.has(ident(x.table).toLowerCase())) return; var t = table(sc, x.table); if (!t) return; x.columns.forEach(function(c) { columnChecks.push({ table: t.key, column: c, source: 'insert:' + c }); if (!t.columns.has(c)) findings.push(finding('HIGH', st.file, st.line, 'INSERT column not found in live schema: ' + x.table + '.' + c, snip(sql))); }); });
  updateCols(psql).forEach(function(x) { if (created.has(ident(x.table).toLowerCase())) return; var t = table(sc, x.table); if (!t) return; x.columns.forEach(function(c) { columnChecks.push({ table: t.key, column: c, source: 'update:' + c }); if (!t.columns.has(c)) findings.push(finding('HIGH', st.file, st.line, 'UPDATE column not found in live schema: ' + x.table + '.' + c, snip(sql))); }); });
  conflictCols(psql).forEach(function(x) { var target = tableRows.find(function(r) { return r.kind === 'insert'; }); if (!target) return; var t = sc.tables.get(target.table); if (!t) return; var missing = x.columns.filter(function(c) { return !t.columns.has(c); }); missing.forEach(function(c) { findings.push(finding('HIGH', st.file, st.line, 'ON CONFLICT column not found in live schema: ' + target.table + '.' + c, snip(sql))); }); if (missing.length === 0 && 0 < x.columns.length && !unique(t, x.columns)) findings.push(finding('MEDIUM', st.file, st.line, 'ON CONFLICT target lacks obvious live unique coverage: ' + target.table + '(' + x.columns.join(', ') + ')', snip(sql))); });
  return Object.assign({}, st, { snippet: snip(sql), tableRefs: tableRows, columnChecks: columnChecks, findings: findings });
}
// Blank the CONTENTS of string literals (single-quoted and dollar-quoted) while preserving length,
// so positions stay stable for downstream index math. Used only for structural parsing.
function maskStrings(sql) {
  var a = sql.split(''); var i = 0; var n = sql.length;
  while (i < n) {
    if (sql[i] === '$') { var dq = /^\$[A-Za-z_0-9]*\$/.exec(sql.slice(i)); if (dq) { var tag = dq[0]; var e = sql.indexOf(tag, i + tag.length); if (e < 0) { for (var k = i + tag.length; k < n; k += 1) a[k] = ' '; return a.join(''); } for (var k2 = i + tag.length; k2 < e; k2 += 1) a[k2] = ' '; i = e + tag.length; continue; } }
    if (sql[i] === "'") { i += 1; while (i < n) { if (sql[i] === "'") { if (sql[i + 1] === "'") { a[i] = ' '; a[i + 1] = ' '; i += 2; continue; } i += 1; break; } a[i] = ' '; i += 1; } continue; }
    i += 1;
  }
  return a.join('');
}
// Tables the PR itself creates (CREATE [TEMP] TABLE, CREATE TABLE AS) — test-fixture temp tables and
// not-yet-applied migration tables — cannot be verified against a live schema that predates them.
function createdTables(statements) {
  var out = new Set(); var re = /\bcreate\s+(?:global\s+|local\s+)?(?:temp(?:orary)?\s+|unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?([a-zA-Z_][\w".]*)/gi;
  statements.forEach(function(s) { var m; var masked = maskStrings(s.sql); while ((m = re.exec(masked))) { var nm = ident(m[1]); out.add((nm.split('.').pop() || nm).toLowerCase()); } });
  return out;
}
function tableRefs(sql) {
  var out = []; var bad = new Set(['where', 'join', 'left', 'right', 'inner', 'outer', 'full', 'cross', 'on', 'set', 'values', 'returning', 'group', 'order', 'limit']);
  // Keywords that follow FROM/JOIN/UPDATE but are never table names: LATERAL (precedes a
  // function), SET (the assignment clause matched by `UPDATE <tbl> SET` / `DO UPDATE SET`), and
  // reserved value-keywords that appear after FROM inside EXTRACT()/casts (INTERVAL, CURRENT_*).
  var notTable = new Set(['lateral', 'set', 'interval', 'current_date', 'current_time', 'current_timestamp', 'localtime', 'localtimestamp']);
  var pats = [{ kind: 'from', re: /\bfrom\s+([a-zA-Z_][\w."]*)(?:\s+(?:as\s+)?([a-zA-Z_][\w$]*))?/gi }, { kind: 'join', re: /\bjoin\s+([a-zA-Z_][\w."]*)(?:\s+(?:as\s+)?([a-zA-Z_][\w$]*))?/gi }, { kind: 'update', re: /\bupdate\s+([a-zA-Z_][\w."]*)(?:\s+(?:as\s+)?([a-zA-Z_][\w$]*))?/gi }, { kind: 'insert', re: /\binsert\s+into\s+([a-zA-Z_][\w."]*)/gi }, { kind: 'delete', re: /\bdelete\s+from\s+([a-zA-Z_][\w."]*)(?:\s+(?:as\s+)?([a-zA-Z_][\w$]*))?/gi }];
  pats.forEach(function(p) { var m; while ((m = p.re.exec(sql))) {
    var name = ident(m[1]);
    if (notTable.has(name.toLowerCase())) continue;
    // `FOR UPDATE [OF ...] [SKIP LOCKED|NOWAIT]` is a row-locking clause, not an UPDATE statement;
    // its trailing token (SKIP, OF, ...) must not be read as a table.
    if (p.kind === 'update' && /\bfor\s+$/i.test(sql.slice(0, m.index))) continue;
    // `EXTRACT(field FROM expr)` / `SUBSTRING(x FROM ...)`: the FROM here is function syntax, not a
    // table source. Detect the `(word ` immediately before FROM (a function's first argument).
    if (p.kind === 'from' && /\(\s*\w+\s*$/.test(sql.slice(0, m.index))) continue;
    // A name immediately followed by '(' is a set-returning/table function (UNNEST(...),
    // jsonb_to_recordset(...), json_array_elements(...)), not a base table.
    if (sql.slice(m.index + m[0].length).replace(/^\s+/, '').charAt(0) === '(') continue;
    out.push({ kind: p.kind, name: name, alias: m[2] && !bad.has(m[2].toLowerCase()) ? m[2] : '' });
  } });
  return out;
}
// Names introduced by WITH ... AS ( ... ) common table expressions. These are query-local
// and must not be resolved against the live schema as if they were base tables.
function cteNames(sql) { var out = new Set(); if (!/\bwith\b/i.test(sql)) return out; var re = /([a-zA-Z_][\w$]*)\s*(?:\([^)]*\))?\s+as\s+(?:not\s+materialized\s+|materialized\s+)?\(/gi; var m; while ((m = re.exec(sql))) out.add(m[1].toLowerCase()); return out; }
function aliasCols(sql) { var out = []; var re = /\b([a-zA-Z_][\w$]*)\.([a-zA-Z_][\w$]*)\b/g; var m; while ((m = re.exec(sql))) out.push({ alias: m[1], column: m[2] }); return out; }
function insertCols(sql) { var out = []; var re = /\binsert\s+into\s+([a-zA-Z_][\w."]*)\s*\(([^)]+)\)/gi; var m; while ((m = re.exec(sql))) out.push({ table: ident(m[1]), columns: cols(m[2]) }); return out; }
function updateCols(sql) { var out = []; var re = /\bupdate\s+([a-zA-Z_][\w."]*)(?:\s+(?:as\s+)?[a-zA-Z_][\w$]*)?\s+set\s+(.+?)(?:\s+where|\s+returning|$)/gi; var m; while ((m = re.exec(sql))) { var cs = []; var sr = /\b([a-zA-Z_][\w$]*)\s*=(?!>)/g; var sm; while ((sm = sr.exec(m[2]))) cs.push(sm[1]); out.push({ table: ident(m[1]), columns: cs }); } return out; }
function conflictCols(sql) { var out = []; var re = /\bon\s+conflict\s*\(([^)]+)\)/gi; var m; while ((m = re.exec(sql))) out.push({ columns: cols(m[1]) }); return out; }
function cols(s) { return s.split(',').map(function(v) { return ident(v.trim().replace(/\s+(asc|desc|nulls\s+first|nulls\s+last)$/i, '')); }).filter(function(v) { return /^[A-Za-z_][\w$]*$/.test(v); }); }
function unique(t, columns) { var wanted = columns.map(function(c) { return c.toLowerCase(); }); var ok = false; t.constraints.forEach(function(cn) { if (!['p', 'u'].includes(cn.constraint_type)) return; var have = (cn.columns || []).map(function(c) { return String(c).toLowerCase(); }); if (wanted.length === have.length && wanted.every(function(c) { return have.includes(c); })) ok = true; }); t.indexes.forEach(function(ix) { var low = ix.indexdef.toLowerCase(); if (/\bunique\b/i.test(ix.indexdef) && wanted.every(function(c) { return low.includes(c); })) ok = true; }); return ok; }
function snip(sql) { var x = norm(sql); return 260 < x.length ? x.slice(0, 257) + '...' : x; }
function ids(findings) { var c = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 }; var lab = { CRITICAL: 'CRIT', HIGH: 'HIGH', MEDIUM: 'MED', LOW: 'LOW' }; return findings.slice().sort(function(a, b) { return SEV[a.severity] - SEV[b.severity]; }).map(function(f) { c[f.severity] += 1; return Object.assign({ id: 'PSA-' + lab[f.severity] + '-' + String(c[f.severity]).padStart(3, '0') }, f); }); }
function verdict(findings) { if (findings.some(function(f) { return f.severity === 'CRITICAL'; })) return 'DO NOT MERGE - CRITICAL FINDINGS'; if (findings.some(function(f) { return f.severity === 'HIGH'; })) return 'DO NOT MERGE - HIGH FINDINGS'; if (findings.some(function(f) { return f.severity === 'MEDIUM'; })) return 'NEEDS REVIEW - MEDIUM FINDINGS'; return 'PASS - LIVE SCHEMA CHECKS PASSED'; }
function cov(paths, scanned, skipped, statements) { var env = new Set(); var db = 0; var res = 0; var wrap = 0; scanned.forEach(function(f) { if (!f.ok) return; f.envVars.forEach(function(v) { env.add(v.name); }); db += f.dbCalls.length; res += f.dbCalls.filter(function(c) { return c.resolved; }).length; wrap += f.dbCalls.filter(function(c) { return c.wrapper; }).length; }); return { changedFiles: paths.length, scannedFiles: scanned.length, skippedFiles: skipped.length, dbCalls: db, resolvedDbCalls: res, wrapperDbCalls: wrap, sqlStatements: statements.length, tableRefs: statements.reduce(function(s, x) { return s + x.tableRefs.length; }, 0), columnChecks: statements.reduce(function(s, x) { return s + x.columnChecks.length; }, 0), envVars: env.size }; }
function md(v) { return String(v == null ? '' : v).replace(/\|/g, '\\|').replace(/\n/g, ' / '); }
function report(r) { var L = []; L.push(MARK + r.repo + '#' + r.pr.number + ':' + r.pr.headRefOid); L.push('# PR Schema Audit: ' + r.repo + '#' + r.pr.number); L.push(''); L.push('- Verdict: ' + r.verdict); L.push('- PR: [' + r.pr.title + '](' + r.pr.url + ')'); L.push('- State: ' + r.pr.state + (r.pr.mergedAt ? ', merged at ' + r.pr.mergedAt : '')); L.push('- Head SHA: ' + r.pr.headRefOid); L.push('- Base: ' + r.pr.baseRefName); L.push('- DB secret source: ' + r.secretSource + ' (value redacted)'); L.push('- Publish mode: ' + (r.publish ? 'enabled' : 'dry-run')); L.push(''); L.push('## Zoom-Out Trace'); L.push(''); L.push('- Read live PR metadata, diff path list, and changed source files at PR head through GitHub.'); L.push('- Parsed DB calls, SQL variables, SQL files, env vars, and secret-shaped literals.'); L.push('- Read live Postgres columns, indexes, and constraints.'); L.push('- Routed publication by PR lifecycle.'); L.push(''); L.push('## Blast Radius'); L.push(''); Object.keys(r.coverage).forEach(function(k) { L.push('- ' + k + ': ' + r.coverage[k]); }); L.push('- liveSchemaTables: ' + r.schema.tableCount); L.push('- liveSchemaColumns: ' + r.schema.columnCount); L.push(''); L.push('## Coverage Ledger'); L.push(''); L.push('| File | Status | DB calls | SQL statements | Env vars |'); L.push('|---|---:|---:|---:|---:|'); r.files.forEach(function(f) { L.push('| ' + md(f.path) + ' | ' + (f.ok ? 'scanned' : 'failed: ' + md(f.reason)) + ' | ' + f.dbCalls.length + ' | ' + f.sqlStatements.length + ' | ' + f.envVars.length + ' |'); }); r.skippedFiles.forEach(function(f) { L.push('| ' + md(f.path) + ' | skipped: ' + md(f.reason) + ' | 0 | 0 | 0 |'); }); L.push(''); L.push('## Live Schema Verification'); L.push(''); if (!r.statements.length) L.push('No SQL statements were resolved from changed files.'); else { L.push('| File | Line | Source | Tables | Columns | Status |'); L.push('|---|---:|---|---|---:|---|'); r.statements.forEach(function(s) { var tables = s.tableRefs.map(function(t) { return t.raw + (t.alias ? ' as ' + t.alias : '') + ' maps to ' + t.table; }).join('; ') || 'none'; L.push('| ' + md(s.file) + ' | ' + s.line + ' | ' + md(s.source) + ' | ' + md(tables) + ' | ' + s.columnChecks.length + ' | ' + (s.findings.length ? 'FAIL' : 'PASS') + ' |'); }); } L.push(''); L.push('## Findings'); L.push(''); if (!r.findings.length) L.push('No schema failures were detected.'); else { L.push('| ID | Severity | File | Line | Finding | Detail |'); L.push('|---|---|---|---:|---|---|'); r.findings.forEach(function(f) { L.push('| ' + f.id + ' | ' + f.severity + ' | ' + md(f.file) + ' | ' + f.line + ' | ' + md(f.title) + ' | ' + md(f.detail) + ' |'); }); } L.push(''); L.push('## Publication Plan'); L.push(''); L.push('- Publication needed: ' + (r.publicationNeeded ? 'yes' : 'no')); L.push('- Target if publishing: ' + r.publicationTarget); L.push('- Result: ' + (r.publicationResult || (r.publish ? 'not attempted' : 'dry-run only'))); L.push(''); L.push('## Trace Boundaries'); L.push(''); L.push('- Dynamic SQL expressions that cannot be resolved are HIGH coverage failures.'); L.push('- Transaction and callback wrappers carry no SQL of their own; their nested .query/.execute calls are scanned and verified independently (' + (r.coverage.wrapperDbCalls || 0) + ' wrapper call(s) recognized).'); L.push('- The audit reads live schema but does not execute application workflows or mutate application data.'); L.push('- The audit does not fix code.'); L.push(''); return L.join('\n'); }
function body(r, full) { var L = [MARK + r.repo + '#' + r.pr.number + ':' + r.pr.headRefOid, 'Schema audit failed for ' + r.repo + '#' + r.pr.number + ' at ' + r.pr.headRefOid + '.', '', 'Verdict: ' + r.verdict, '']; L.push('Coverage: ' + JSON.stringify(r.coverage)); L.push(''); r.findings.slice(0, 20).forEach(function(f) { L.push('- ' + f.id + ' ' + f.severity + ': ' + f.file + ':' + f.line + ' ' + f.title); }); if (20 < r.findings.length) L.push('- additional findings omitted from summary: ' + (r.findings.length - 20)); L.push('', 'Full local report path was provided by the audit runner output. Rerun the skill with --output to regenerate it.'); return L.join('\n'); }
function existingPrComment(repo, pr, marker) { try { return ghj(['api', '--method', 'GET', 'repos/' + repo + '/issues/' + pr + '/comments', '--paginate']).find(function(c) { return c.body && c.body.includes(marker); }); } catch (_) { return null; } }
function existingIssue(repo, marker) { try { return ghj(['issue', 'list', '--repo', repo, '--state', 'all', '--search', marker, '--json', 'number,title,url', '--limit', '10'])[0] || null; } catch (_) { return null; } }
function publish(r, full) { if (!r.publicationNeeded) return 'no failures to publish'; var marker = MARK + r.repo + '#' + r.pr.number + ':' + r.pr.headRefOid; var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-schema-audit-')); var bp = path.join(tmp, 'body.md'); fs.writeFileSync(bp, body(r, full)); if (r.pr.state === 'OPEN') { var ep = existingPrComment(r.repo, r.pr.number, marker); if (ep) return 'existing PR comment found: ' + (ep.html_url || ep.url); return gh(['pr', 'comment', String(r.pr.number), '--repo', r.repo, '--body-file', bp]).trim() || 'created PR conversation comment'; } var ei = existingIssue(r.repo, marker); if (ei) return 'existing issue found: ' + ei.url; var title = ('[schema-audit] PR #' + r.pr.number + ': ' + r.pr.title).slice(0, 250); return gh(['issue', 'create', '--repo', r.repo, '--label', 'bug', '--title', title, '--body-file', bp]).trim() || 'created bug issue'; }
async function main() { var a = args(process.argv.slice(2)); var repo = repoName(a.repo); var sec = secret(a); var pr = prInfo(repo, String(a.pr)); var paths = changed(repo, String(a.pr)); var scanned = scan(paths, repo, pr.headRefOid, a.maxFiles); var sc = await schema(sec.value); var an = analyze(scanned.scanned, sc); var findings = ids(an.findings); var r = { repo: repo, pr: pr, secretSource: sec.source, publish: a.publish, schema: { tableCount: sc.tableCount, columnCount: sc.columnCount }, files: scanned.scanned, skippedFiles: scanned.skipped, statements: an.statements, findings: findings, publicationNeeded: findings.some(function(f) { return ['CRITICAL', 'HIGH', 'MEDIUM'].includes(f.severity); }), publicationTarget: pr.state === 'OPEN' ? 'open PR conversation comment' : 'bug-labeled GitHub issue', publicationResult: '', coverage: {}, verdict: '' }; r.coverage = cov(paths, scanned.scanned, scanned.skipped, r.statements); r.verdict = verdict(findings); var first = report(r); if (a.publish) r.publicationResult = publish(r, first); var final = report(r); if (a.output) fs.writeFileSync(a.output, final); if (a.json) console.log(JSON.stringify({ repo: r.repo, pr: r.pr.number, state: r.pr.state, headRefOid: r.pr.headRefOid, verdict: r.verdict, coverage: r.coverage, findings: r.findings, publicationNeeded: r.publicationNeeded, publicationTarget: r.publicationTarget, publicationResult: r.publicationResult, output: a.output || null }, null, 2)); else console.log(final); }
if (require.main === module) { main().catch(function(e) { console.error('pr-schema-audit failed: ' + e.message); process.exit(1); }); }
module.exports = { calls: calls, firstArg: firstArg, isFunctionArg: isFunctionArg, extract: extract, analyze: analyze, sqlCheck: sqlCheck, cov: cov, norm: norm, stripComments: stripComments, tableRefs: tableRefs, table: table, arr: arr, indexSchema: indexSchema, systemTable: systemTable, isStatement: isStatement, maskStrings: maskStrings, createdTables: createdTables, updateCols: updateCols, sqlVars: sqlVars, looksLikeRealSecret: looksLikeRealSecret, objectSql: objectSql, ternarySql: ternarySql, blankJsComments: blankJsComments, argSpan: argSpan, sqlFns: sqlFns, isRateLimit: isRateLimit, isTransient: isTransient };
