#!/usr/bin/env node
'use strict';
// Parser guard for pr-schema-audit.cjs. Runs offline (no GitHub, no DB) and exercises the
// static DB-call resolver, focusing on the wrapper/callback edge cases that must NOT produce
// false-positive HIGH findings. Run: node scripts/pr-schema-audit.test.cjs
const assert = require('assert');
const path = require('path');
const m = require(path.join(__dirname, 'pr-schema-audit.cjs'));

let pass = 0;
function ok(name, cond) { assert.ok(cond, 'FAIL: ' + name); pass += 1; console.log('  ok  ' + name); }

// --- isFunctionArg unit checks ---
ok('async arrow detected', m.isFunctionArg('async (client) => {'));
ok('plain arrow detected', m.isFunctionArg('(client) => {'));
ok('function expr detected', m.isFunctionArg('function (client) {'));
ok('async function detected', m.isFunctionArg('async function (c) {'));
ok('async single-param arrow detected', m.isFunctionArg('async client => {'));
ok('sql identifier NOT a function', !m.isFunctionArg('mySqlConst)'));
ok('object literal NOT a function', !m.isFunctionArg('{ isolationLevel: 1 }'));

// --- the exact transaction-wrapper pattern that previously produced a false HIGH ---
const txSrc = [
  "function applyWithLock(eventRecord, data, callback) {",
  "  return db.transaction(async (transactionClient) => {",
  "    await transactionClient.query('SELECT pg_advisory_xact_lock($1, $2)', lockKeys);",
  "    const locked = await refreshEventRecordForApply(eventRecord, transactionClient);",
  "    return callback(locked);",
  "  });",
  "}",
].join('\n');
let calls = m.calls(txSrc, new Map());
const tx = calls.find(c => c.callee === 'db.transaction');
ok('transaction call recognized', !!tx);
ok('transaction is resolved (no false HIGH)', tx.resolved === true);
ok('transaction tagged as wrapper', tx.wrapper === 'transaction');
ok('transaction carries no SQL', tx.sql === '');
const inner = calls.find(c => c.callee === 'transactionClient.query');
ok('nested query still scanned', !!inner);
ok('nested query resolved with real SQL', inner.resolved && /pg_advisory_xact_lock/.test(inner.sql));

// --- inline arrow / function-expr / options+callback transaction wrappers ---
calls = m.calls("db.transaction(client => client.query('SELECT 1'))", new Map());
ok('inline arrow wrapper resolved', calls.find(c => c.callee === 'db.transaction').resolved === true);
ok('inline arrow nested query resolved', calls.find(c => c.callee === 'client.query').sql === 'SELECT 1');
calls = m.calls("db.transaction(function (c) { return c.query('SELECT 2'); })", new Map());
ok('function-expr wrapper resolved', calls.find(c => c.callee === 'db.transaction').resolved === true);
calls = m.calls("db.transaction({ isolationLevel: 'serializable' }, async (c) => { await c.query('SELECT 3'); })", new Map());
ok('options+callback transaction is wrapper', calls.find(c => c.callee === 'db.transaction').wrapper === 'transaction');

// --- normal SQL calls unchanged ---
calls = m.calls("db.query('SELECT * FROM foo WHERE id = $1')", new Map());
ok('literal query still resolved', calls[0].resolved && /from foo/i.test(calls[0].sql));
const vars = new Map([['q', { name: 'q', sql: 'SELECT * FROM bar', usedByCall: false }]]);
calls = m.calls("db.query(q)", vars);
ok('sql-variable query still resolved', calls[0].resolved && calls[0].sql === 'SELECT * FROM bar');

// --- genuinely unresolved call: still HIGH, now WITH a source snippet ---
calls = m.calls("pool.query(buildDynamicSql(filters))", new Map());
ok('dynamic builder still unresolved', calls[0].resolved === false);
ok('unresolved call carries source snippet', /buildDynamicSql/.test(calls[0].snippet || ''));

// --- analyze: wrapper produces no finding; dynamic builder produces exactly one HIGH ---
const file = { ok: true, path: 'x.js', secretLiterals: [], envVars: [],
  dbCalls: [].concat(m.calls(txSrc, new Map()), m.calls("pool.query(buildDynamicSql())", new Map())),
  sqlStatements: [] };
const an = m.analyze([file], { tables: new Map(), bare: new Map() });
ok('exactly one HIGH (the dynamic builder, not the transaction)', an.findings.length === 1);
ok('the HIGH finding includes the source snippet', /source:/.test(an.findings[0].detail));

// === Iteration 2: false-positive classes found auditing real PRs ===

// --- SQL comments must be stripped before parsing (PR 2797: comment "update or block ...") ---
ok('line comment stripped', !/block/.test(m.norm("SELECT 1 -- cannot update or block another tenant\nFROM x")));
ok('block comment stripped', m.norm("SELECT 1 /* update or else */ FROM x") === 'SELECT 1 FROM x');
ok('comment marker inside string survives', /a--b/.test(m.norm("SELECT 'a--b' FROM x")));
ok('dollar-quoted body survives', /BEGIN/.test(m.norm("CREATE FUNCTION f() AS $$ BEGIN -- hi\n END $$ LANGUAGE plpgsql")));

// --- tableRefs must not treat functions / keywords as tables ---
function names(sql) { return m.tableRefs(sql).map(function(r) { return r.name.toLowerCase(); }); }
ok('UNNEST in FROM is not a table', !names("SELECT 1 FROM UNNEST(order_ids) AS oid(x)").includes('unnest'));
ok('LATERAL keyword is not a table', !names("FROM pg_class t JOIN LATERAL unnest(t.indkey) WITH ORDINALITY AS k(a,b) ON true").includes('lateral'));
ok('jsonb_to_recordset is not a table', !names("FROM jsonb_to_recordset($1) AS r(a int)").includes('jsonb_to_recordset'));
ok('DO UPDATE SET does not yield a `set` table', !names("INSERT INTO backorders (id) VALUES ($1) ON CONFLICT (id) DO UPDATE SET sku = $2").includes('set'));
ok('real table after FROM still captured', names("SELECT 1 FROM backorders b").includes('backorders'));

// --- build a small live-schema stand-in to exercise sqlCheck end to end ---
const cols = [
  ['public','backorders','id'],['public','backorders','order_ids'],['public','backorders','sku'],
  ['public','backorders','status'],['public','backorders','linked_po_id'],['public','backorders','retail_express_product_id'],
  ['public','orders','id'],['public','orders','order_number'],
].map(function(r){ return { table_schema: r[0], table_name: r[1], column_name: r[2] }; });
// constraint column list deliberately supplied as a raw Postgres-array STRING to prove arr() coercion
const cons = [{ table_schema: 'public', table_name: 'backorders', constraint_name: 'backorders_pkey', constraint_type: 'p', columns: '{id}' }];
const sc = m.indexSchema(cols, [], cons);

function check(sql) { return m.sqlCheck({ file: 'f.js', line: 1, source: 'test', sql: m.norm(sql) }, sc); }

// unqualified pg_catalog relations resolve as system tables, not "table not found"
ok('pg_class resolves as system table', m.table(sc, 'pg_class') && m.table(sc, 'pg_class').system === true);
ok('pg_indexes resolves as system table', m.table(sc, 'pg_indexes') && m.table(sc, 'pg_indexes').system === true);
ok('app table named pg_x is NOT shadowed', m.table(sc, 'orders') && m.table(sc, 'orders').system !== true);

ok('pg_catalog index query has no findings', check("SELECT i.relname FROM pg_class t JOIN pg_index ix ON ix.indrelid = t.oid JOIN pg_class i ON i.oid = ix.indexrelid JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) JOIN pg_attribute a ON a.attrelid = t.oid").findings.length === 0);
ok('UNNEST EXISTS subquery has no findings', check("SELECT id FROM backorders WHERE EXISTS (SELECT 1 FROM UNNEST(order_ids) AS oid(order_id_text) JOIN orders o ON o.order_number = oid.order_id_text)").findings.length === 0);
ok('commented migration prose yields no phantom table', check("-- a write for one tenant cannot update or block another tenant\nSELECT id FROM backorders").findings.length === 0);

// ON CONFLICT + DO UPDATE SET against a constraint whose columns came in as a string must NOT throw
let upsert;
ok('upsert with string-array constraint does not crash', (function(){ try { upsert = check("INSERT INTO backorders (id, sku) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET sku = $3"); return true; } catch (e) { return false; } })());
ok('upsert on the unique id has no findings', upsert.findings.length === 0);

// a genuinely missing table is still reported
ok('genuinely missing table still flagged', check("SELECT * FROM table_that_does_not_exist").findings.some(function(f){ return /table not found/.test(f.title); }));

// === Iteration 3: classes found auditing PR 2794 (crash unmasked these) ===

// FOR UPDATE SKIP LOCKED — locking clause, not an UPDATE statement (was "table not found: SKIP")
ok('FOR UPDATE SKIP LOCKED yields no SKIP table', !names("SELECT id FROM backorders WHERE status = $1 FOR UPDATE SKIP LOCKED").includes('skip'));
ok('FOR UPDATE OF t yields no OF table', !names("SELECT 1 FROM orders o FOR UPDATE OF o").includes('of'));
ok('FOR UPDATE row-lock query still resolves the real table', check("SELECT id FROM backorders FOR UPDATE SKIP LOCKED").findings.length === 0);

// EXTRACT(EPOCH FROM INTERVAL '...') — keyword, not a table (was "table not found: INTERVAL")
ok('EXTRACT FROM INTERVAL has no findings', check("SELECT EXTRACT(EPOCH FROM INTERVAL '35 days')::int / 86400 AS age_days").findings.length === 0);

// string literal containing SQL keywords must not yield phantom tables (was "table not found: Smart")
ok('keyword inside string literal is masked', check("SELECT id FROM backorders WHERE note = 'Generated from Smart PO recommendations'").findings.length === 0);
ok('maskStrings blanks literal contents but keeps length', m.maskStrings("a 'from x' b").length === "a 'from x' b".length && !/from/.test(m.maskStrings("a 'from x' b")));

// HTML/prose template that merely contains SQL words is NOT a statement (was "table not found: the")
ok('HTML email template is not a statement', m.isStatement("\n <div><table>pick the items from the slip</table></div>") === false);
ok('real query IS a statement', m.isStatement("SELECT 1 FROM x") === true);
ok('migration starting after comment is a statement', m.isStatement(m.norm("-- header\nCREATE TABLE x (id int)")) === true);

// CREATE TEMP TABLE used later in the same file must not be "table not found" (probe tables)
const probeStmts = [
  { file: 'p.test.js', line: 1, source: 'db', sql: m.norm("CREATE TEMP TABLE sfe_backfill_probe (id serial PRIMARY KEY, sku text, tenant_id uuid) ON COMMIT DROP") },
  { file: 'p.test.js', line: 2, source: 'db', sql: m.norm("INSERT INTO sfe_backfill_probe (sku) VALUES ($1)") },
  { file: 'p.test.js', line: 3, source: 'db', sql: m.norm("UPDATE sfe_backfill_probe SET tenant_id = $1 WHERE sku = $2") },
];
const created = m.createdTables(probeStmts);
ok('createdTables captures the temp table', created.has('sfe_backfill_probe'));
const probeFile = { ok: true, path: 'p.test.js', secretLiterals: [], envVars: [], dbCalls: [], sqlStatements: probeStmts };
ok('temp-table file produces no findings', m.analyze([probeFile], sc).findings.length === 0);

// make_interval(hours => ...) named-arg must NOT be read as a SET column (was "UPDATE column ...hours")
ok('named-arg => is not a SET column', !m.updateCols("UPDATE competitor_websites SET next_scrape_at = NOW() + make_interval(hours => $2), updated_at = NOW() WHERE id = $1")[0].columns.map(function(c){return c.toLowerCase();}).includes('hours'));
ok('named-arg update real columns still captured', m.updateCols("UPDATE competitor_websites SET next_scrape_at = NOW() + make_interval(hours => $2), updated_at = NOW() WHERE id = $1")[0].columns.indexOf('next_scrape_at') >= 0);

// === Iteration 4: classes found auditing PR 2793 ===

// placeholder-bearing credentials are fixtures, not real leaked secrets
ok('dev-password URL is a fixture', m.looksLikeRealSecret("postgresql://helpdesk_dev_user:dev-password@dpg-abc.singapore-postgres.render.com/helpdesk_dev") === false);
ok('super-secret-password URL is a fixture', m.looksLikeRealSecret("postgresql://htnhelpdesk_user:super-secret-password@dpg-abc/htnhelpdesk") === false);
ok('a real random secret is still detected', m.looksLikeRealSecret("postgresql://u_a1b2:Xq9SzKp2Lm7Vt4Rn@db.prod.internal/app") === true);

// CTE/derived alias reused as a base-table alias must NOT trigger column-not-found (po.* case)
const poSql = "WITH po_stock AS (SELECT poi.retail_express_product_id, SUM(poi.quantity_ordered - poi.quantity_received) AS total_on_order FROM purchase_order_items poi JOIN purchase_orders po ON poi.po_id = po.id GROUP BY poi.retail_express_product_id) SELECT COALESCE(po.total_on_order, 0) AS stock_on_order FROM orders o LEFT JOIN po_stock po ON o.retail_express_product_id = po.retail_express_product_id";
// extend the schema stand-in with the base tables this query touches
const cols2 = cols.concat([
  ['public','purchase_order_items','retail_express_product_id'],['public','purchase_order_items','po_id'],['public','purchase_order_items','quantity_ordered'],['public','purchase_order_items','quantity_received'],
  ['public','purchase_orders','id'],['public','orders','retail_express_product_id'],
].map(function(r){ return { table_schema: r[0], table_name: r[1], column_name: r[2] }; }));
const sc2 = m.indexSchema(cols2, [], []);
ok('CTE-alias column reuse yields no false positive', m.sqlCheck({ file: 'orders.js', line: 1, source: 'db', sql: m.norm(poSql) }, sc2).findings.length === 0);

// CURRENT_DATE inside EXTRACT has no findings
ok('EXTRACT FROM CURRENT_DATE has no findings', check("SELECT fiscal_year FROM backorders WHERE status = EXTRACT(YEAR FROM CURRENT_DATE)::integer").findings.length === 0);

// .execute({...}) on a non-DB object is not flagged as unresolved SQL
ok('object-arg execute with no SQL is not unresolved', m.calls("await receiveStockAuthority.execute({ poId, receiveData: req.body })", new Map()).every(function(c){ return c.resolved === true; }));
// pg object form { text: '...' } is resolved to its SQL
ok('object-arg with text: is resolved to its SQL', /from sticky_communications/i.test((m.calls("await db.query({ text: 'SELECT id FROM sticky_communications WHERE id = $1', values: [x] })", new Map())[0] || {}).sql || ''));

// ternary of two static SQL literals at the call site is resolved, not flagged unresolved
const tern = m.calls("await db.query(scoped ? 'SELECT id FROM sticky_communications WHERE id = $1 AND sticky_note_id = $2' : 'SELECT id FROM sticky_communications WHERE id = $1', params)", new Map());
ok('inline ternary-of-literals resolves', tern[0].resolved === true && /sticky_communications/i.test(tern[0].sql));
// ternary assigned to a variable then passed to query is resolved via the var
const tvars = m.sqlVars("const upsertSql = reactivateHeld\n  ? `INSERT INTO rex_sync_queue (sync_type) VALUES ($1)`\n  : `INSERT INTO rex_sync_queue (sync_type) VALUES ($2)`;");
ok('ternary var assignment is captured as SQL', tvars.has('upsertSql') && /rex_sync_queue/i.test(tvars.get('upsertSql').sql));
const tvarCall = m.calls("await client.query(upsertSql, [a, b])", tvars);
ok('var-assigned ternary call resolves', tvarCall[0].resolved === true);
// a `?` placeholder inside a normal literal assignment is NOT mistaken for a ternary
const phVars = m.sqlVars("const q = 'SELECT id FROM x WHERE y = ?';");
ok('placeholder ? in literal does not break var capture', phVars.has('q') && phVars.get('q').sql === 'SELECT id FROM x WHERE y = ?');

// deleted (removed) files are not "could not be read" — exercised via scan-status semantics in re-run

// === Iteration 5: classes found in PR 2793 re-run ===

// db.query() inside a JS comment must not be parsed as a real DB call
ok('db.query in a line comment is blanked', m.calls(m.blankJsComments("// NOT a raw db.query() in a worker\nconst x = 1;"), new Map()).length === 0);
ok('db.query in a block comment is blanked', m.calls(m.blankJsComments("/* we wrap db.query() to scope */\nconst y = 2;"), new Map()).length === 0);
ok('blankJsComments preserves a real query in code', m.calls(m.blankJsComments("await db.query('SELECT 1 FROM x'); // run it"), new Map()).filter(function(c){return c.resolved && /from x/i.test(c.sql);}).length === 1);
ok('blankJsComments preserves line count', m.blankJsComments("a\n// c\nb").split('\n').length === 3);
ok('// inside a string literal is NOT treated as a comment', /from sticky/i.test(m.calls(m.blankJsComments("db.query('SELECT 1 FROM sticky -- ok // x')"), new Map())[0].sql));

// ternary literal whose SQL contains commas must still resolve (argSpan must skip string contents)
const ternComma = m.calls("await db.query(\n  scoped\n    ? 'SELECT id, sticky_note_id, direction FROM sticky_communications WHERE id = $1 AND sticky_note_id = $2'\n    : 'SELECT id, sticky_note_id, direction FROM sticky_communications WHERE id = $1',\n  params,\n)", new Map());
ok('argSpan skips commas inside SQL strings', ternComma[0].resolved === true && /sticky_communications/i.test(ternComma[0].sql));

// derived-subquery alias reused as a base-table alias (orders.js:436 pattern)
const subSql = "SELECT COALESCE(po.total_on_order, 0) AS stock_on_order FROM orders o LEFT JOIN ( SELECT poi.retail_express_product_id, SUM(poi.quantity_ordered - poi.quantity_received) AS total_on_order FROM purchase_order_items poi JOIN purchase_orders po ON poi.po_id = po.id GROUP BY poi.retail_express_product_id ) po ON o.retail_express_product_id = po.retail_express_product_id";
ok('derived-subquery alias yields no column false positive', m.sqlCheck({ file: 'orders.js', line: 1, source: 'db', sql: m.norm(subSql) }, sc2).findings.length === 0);

// spread-forwarding query call is a pass-through shim, not an unresolved SQL site
ok('spread-arg query is not unresolved', m.calls("db.query = (...args) => client.query(...args);", new Map()).every(function(c){ return c.resolved === true; }));

// === Iteration 6: same-file function returning static SQL (PR 2756/2758/2763/2764) ===
const fnSrc = "function buildReadSelect() {\n  return `SELECT q.id FROM rex_sync_queue q WHERE q.status = 'failed'`;\n}\nasync function run(client) {\n  const result = await client.query(buildReadSelect(), [a, b]);\n}";
const fnsMap = m.sqlFns(m.blankJsComments(fnSrc));
ok('sqlFns captures a SQL-returning function', fnsMap.has('buildReadSelect') && /rex_sync_queue/i.test(fnsMap.get('buildReadSelect')));
const fnCalls = m.calls(m.blankJsComments(fnSrc), new Map(), fnsMap);
const qcall = fnCalls.find(function(c){ return c.callee === 'client.query'; });
ok('db.query(fn()) resolves to the function SQL', qcall && qcall.resolved === true && /rex_sync_queue/i.test(qcall.sql));
// arrow-function form
const arrowFns = m.sqlFns("const readSel = () => `SELECT id FROM orders`;");
ok('sqlFns captures an arrow returning SQL', arrowFns.has('readSel') && /from orders/i.test(arrowFns.get('readSel')));
// a non-SQL-returning function is NOT registered, so its call stays unresolved
const plainFns = m.sqlFns("function helper() { return 42; }");
ok('non-SQL function is not registered', !plainFns.has('helper'));
ok('db.query(unknownFn()) stays unresolved', m.calls("await db.query(unknownFn())", new Map(), new Map())[0].resolved === false);

// === Iteration 7: GitHub API rate-limit must abort cleanly, not flood phantom findings ===
ok('rate-limit message is detected', m.isRateLimit("gh: API rate limit exceeded for user ID 84759746 (HTTP 403)") === true);
ok('secondary rate limit is detected', m.isRateLimit("You have exceeded a secondary rate limit") === true);
ok('a plain 404 is NOT a rate limit', m.isRateLimit("HTTP 404: Not Found") === false);
ok('a flaky 401 is transient but not a rate limit', m.isTransient("gh: Bad credentials (HTTP 401)") === true && m.isRateLimit("gh: Bad credentials (HTTP 401)") === false);

console.log('\nAll ' + pass + ' assertions passed.');
