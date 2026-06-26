#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const BUG_LABEL = 'bug';
const INVESTIGATION_LABEL = 'needs-investigation';
const PUBLICATION_LABELS = [BUG_LABEL, INVESTIGATION_LABEL];
const GITHUB_WEB_ROOT = 'https://github.com/';
const ISSUE_PATH_SEGMENT = '/' + 'issues' + '/';
const ADD_LABEL_FLAG = '--' + 'add-label';
const BODY_FLAG = '--' + 'body';
const COLOR_FLAG = '--' + 'color';
const DESCRIPTION_FLAG = '--' + 'description';
const JSON_FLAG = '--' + 'json';
const LABEL_FLAG = '--' + 'label';
const LIMIT_FLAG = '--' + 'limit';
const PAGINATE_FLAG = '--' + 'paginate';
const REPO_FLAG = '--' + 'repo';
const SEARCH_FLAG = '--' + 'search';
const SLURP_FLAG = '--' + 'slurp';
const STATE_FLAG = '--' + 'state';
const TITLE_FLAG = '--' + 'title';

const SOURCE_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts'
]);

const SOURCE_TOKENS = new Set([
  'rex', 'retail', 'express', 'shopify', 'external', 'internal',
  'canonical', 'local', 'supplier', 'vendor', 'customer',
  'order', 'product', 'variant', 'inventory', 'sku', 'invoice',
  'payment', 'purchase', 'po'
]);

const ID_TOKENS = new Set([
  'id', 'ids', 'uuid', 'key', 'sku', 'handle', 'code', 'number',
  'reference', 'ref'
]);

const STRONG_TOKENS = new Set([
  'rex', 'shopify', 'external', 'internal', 'canonical', 'local',
  'legacy', 'retail', 'express'
]);

const GENERIC_TOKENS = new Set([
  'item', 'entity', 'record', 'row', 'data', 'value', 'object',
  'result', 'payload', 'input', 'model'
]);

const GENERIC_METHODS = new Set([
  'at', 'concat', 'delete', 'each', 'entries', 'every', 'filter',
  'find', 'findIndex', 'flat', 'flatMap', 'forEach', 'get', 'has',
  'includes', 'join', 'keys', 'map', 'mockRejectedValue',
  'mockRejectedValueOnce', 'mockResolvedValue', 'mockResolvedValueOnce',
  'push', 'reduce', 'set', 'some', 'sort', 'toMatchObject', 'values'
]);

// Source SYSTEMS are the only axis we flag cross-confusion on. Domain-entity
// tokens (order/product/supplier/payment/...) are intentionally NOT systems:
// a field legitimately combining entities (e.g. rexOrderId holding a payment's
// order id) is not a wrong-object bug. REX (retail express) and Shopify are the
// two concrete external systems in this codebase; mixing their identifiers is
// the high-confidence bug class this skill exists to catch.
const SYSTEM_BY_TOKEN = new Map([
  ['rex', 'rex'], ['retail', 'rex'], ['express', 'rex'],
  ['shopify', 'shopify']
]);

// Single-argument cast wrappers we unwrap so `String(shopifyOrder.id)` still
// resolves to its underlying reference.
const CAST_CALL_NAMES = new Set(['String', 'Number', 'BigInt', 'Boolean']);

// A target whose name says it deliberately holds a *foreign* system's id
// (e.g. rexExternalId stores the Shopify transaction id by design). Cross-system
// values into these fields are expected, not bugs, so we never flag them.
const FOREIGN_HOLDER_TOKENS = new Set([
  'external', 'foreign', 'source', 'origin', 'remote', 'upstream'
]);

// Verb prefixes that mark a destructured name as a function/helper import rather
// than a bare identity field (resolveReturnReasonId, buildExternalOrderId, ...).
const VERB_PREFIXES = new Set([
  'get', 'set', 'load', 'resolve', 'build', 'normalize', 'assert', 'make',
  'create', 'fetch', 'find', 'map', 'to', 'from', 'is', 'has', 'compute',
  'ensure', 'apply', 'push', 'send', 'sync', 'update', 'save', 'write', 'mark',
  'handle', 'validate', 'parse', 'format', 'convert', 'derive', 'with', 'use',
  'register'
]);

function startsWithVerb(name) {
  const first = splitName(name)[0];
  return first ? VERB_PREFIXES.has(first) : false;
}

const VALID_FAIL_ON = new Set(['critical', 'high', 'medium', 'low', 'never']);

function parseArgs(argv) {
  const args = {
    repo: null,
    pr: null,
    base: null,
    head: 'HEAD',
    files: [],
    output: null,
    handoffOutput: null,
    json: false,
    publish: false,
    dryRun: false,
    failOn: 'high',
    includeTests: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) {
        throw new Error(`Missing value for ${arg}`);
      }
      i += 1;
      return argv[i];
    };

    if (arg === '--repo') args.repo = next();
    else if (arg === '--pr') args.pr = next();
    else if (arg === '--base') args.base = next();
    else if (arg === '--head') args.head = next();
    else if (arg === '--file') args.files.push(next());
    else if (arg === '--output') args.output = next();
    else if (arg === '--handoff-output') args.handoffOutput = next();
    else if (arg === '--json') args.json = true;
    else if (arg === '--publish') args.publish = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--include-tests') args.includeTests = true;
    else if (arg === '--fail-on') args.failOn = next();
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.pr && !args.base && args.files.length === 0) {
    args.base = 'origin/dev';
  }
  args.failOn = String(args.failOn).toLowerCase();
  if (!VALID_FAIL_ON.has(args.failOn)) {
    throw new Error(`Invalid --fail-on value: ${args.failOn}`);
  }
  return args;
}

function printHelp() {
  console.log(`Usage:
  code-variable-audit.cjs --repo owner/name --pr 123 --dry-run
  code-variable-audit.cjs --base origin/dev --head HEAD --dry-run
  code-variable-audit.cjs --file path/to/file.ts --dry-run

Options:
  --repo owner/name       GitHub repository. Defaults to gh repo view.
  --pr number            Pull request to audit through gh.
  --base ref             Local git diff base when --pr is not used.
  --head ref             Local git diff head. Defaults to HEAD.
  --file path            Add a local file. May be repeated.
  --output path          Write Markdown report.
  --handoff-output path  Write issue-to-green-pr handoff JSON when an issue exists.
  --json                 Emit JSON instead of Markdown.
  --publish              Publish findings: open PR comment or bug issue.
  --dry-run              Never publish.
  --include-tests        Analyze test files too (default: excluded from findings).
  --fail-on level        Exit non-zero at critical, high, medium, low, or never.`);
}

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf8',
    maxBuffer: options.maxBuffer || 20 * 1024 * 1024
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(`${cmd} ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout;
}

function runWithRetry(cmd, args, options, attemptCount) {
  const maxAttempts = attemptCount || 3;
  let lastError = null;
  for (let attempt = 1; attempt < maxAttempts + 1; attempt += 1) {
    try {
      return run(cmd, args, options || {});
    } catch (err) {
      lastError = err;
      const transient = /Bad credentials|HTTP 5|timeout|ECONNRESET|ETIMEDOUT/i.test(err.message);
      if (!transient || attempt === maxAttempts) throw err;
    }
  }
  throw lastError;
}

function tryRun(cmd, args) {
  return spawnSync(cmd, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024
  });
}

function resolveTypescript() {
  const candidates = [
    path.join(process.cwd(), 'node_modules/typescript/lib/typescript.js'),
    'typescript'
  ];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (_err) {
      // Try the next candidate.
    }
  }
  throw new Error(
    'Could not load the TypeScript compiler API. Run from a repo with typescript installed.'
  );
}

function resolveRepo(explicitRepo) {
  if (explicitRepo) return explicitRepo;
  const out = run('gh', ['repo', 'view', '--json', 'nameWithOwner']);
  return JSON.parse(out).nameWithOwner;
}

function readPrContext(repo, pr) {
  const out = run('gh', [
    'pr', 'view', pr, '--repo', repo, '--json',
    'number,title,url,state,mergedAt,headRefOid,headRefName,baseRefName,isDraft'
  ]);
  return JSON.parse(out);
}

function readPrFiles(repo, pr) {
  return run('gh', [
    'api', `repos/${repo}/pulls/${pr}/files`, '--paginate',
    '--jq', '.[] | [.filename, .["stat"+"us"]] | @tsv'
  ])
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function readPrFileAtHead(repo, file, ref) {
  const encoded = file.split('/').map(encodeURIComponent).join('/');
  const out = runWithRetry('gh', [
    'api', `repos/${repo}/contents/${encoded}`, '--method', 'GET', '-F', `ref=${ref}`
  ], {}, 3);
  const payload = JSON.parse(out);
  if (!payload || payload.encoding !== 'base64' || typeof payload.content !== 'string') {
    throw new Error(`GitHub contents API did not return base64 content for ${file}`);
  }
  return Buffer.from(payload.content.replace(/\s/g, ''), 'base64').toString('utf8');
}

function readLocalChangedFiles(base, head) {
  return run('git', ['diff', '--name-only', `${base}...${head}`])
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function readLocalFile(file) {
  return fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');
}

function splitName(name) {
  if (!name) return [];
  return String(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((token) => {
      if (token === 'retailexpress') return ['retail', 'express'];
      if (token === 'rex') return ['retail', 'express'];
      if (token === 'rexproduct') return ['retail', 'express', 'product'];
      if (token === 'shopifyproduct') return ['shopify', 'product'];
      if (token === 'po') return ['purchase', 'order'];
      return [token];
    });
}

function tokenSet(text) {
  return new Set(splitName(text));
}

function interestingTokens(tokens) {
  return [...tokens].filter((token) => SOURCE_TOKENS.has(token) || ID_TOKENS.has(token));
}

function intersects(a, b) {
  for (const item of a) {
    if (b.has(item)) return true;
  }
  return false;
}

function getLineCol(sourceFile, node) {
  const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return { line: pos.line + 1, column: pos.character + 1 };
}

function getContextName(stack) {
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    const node = stack[i];
    const hasFunctionShape = node && node.parameters && node.body;
    if (!hasFunctionShape) continue;
    if (node.name && typeof node.name.getText === 'function') {
      return node.name.getText();
    }
    if (node.parent && node.parent.name && typeof node.parent.name.getText === 'function') {
      return node.parent.name.getText();
    }
    return '<anonymous-function>';
  }
  return '<file>';
}

function scriptKindForFile(ts, file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.tsx') return ts.ScriptKind.TSX;
  if (ext === '.jsx') return ts.ScriptKind.JSX;
  if (ext === '.ts' || ext === '.mts' || ext === '.cts') return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

function rootIdentifierText(expr, ts) {
  let current = expr;
  while (current) {
    if (ts.isIdentifier(current)) return current.text;
    if (ts.isThis(current)) return 'this';
    if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isCallExpression(current)) {
      current = current.expression;
      continue;
    }
    return null;
  }
  return null;
}

function expressionTokens(exprText, rootText) {
  return interestingTokens(tokenSet(`${rootText || ''} ${exprText || ''}`));
}

function nodeText(node, sourceFile) {
  return node.getText(sourceFile).replace(/\s+/g, ' ').trim();
}

function systemsOf(tokens) {
  const systems = new Set();
  for (const token of tokens) {
    const system = SYSTEM_BY_TOKEN.get(token);
    if (system) systems.add(system);
  }
  return systems;
}

// Unwrap parenthesis/non-null/as and single-arg cast calls so we reach the
// underlying value expression (e.g. String(shopify.id) -> shopify.id).
function unwrapValueExpr(node, ts) {
  let current = node;
  while (current) {
    if (ts.isParenthesizedExpression(current)) { current = current.expression; continue; }
    if (ts.isNonNullExpression && ts.isNonNullExpression(current)) { current = current.expression; continue; }
    if (ts.isAsExpression && ts.isAsExpression(current)) { current = current.expression; continue; }
    if (ts.isTypeAssertionExpression && ts.isTypeAssertionExpression(current)) { current = current.expression; continue; }
    if (ts.isCallExpression(current)) {
      const callee = current.expression;
      const name = ts.isIdentifier(callee)
        ? callee.text
        : (ts.isPropertyAccessExpression(callee) ? callee.name.text : null);
      if (name && CAST_CALL_NAMES.has(name) && current.arguments.length >= 1) {
        current = current.arguments[0];
        continue;
      }
    }
    return current;
  }
  return current;
}

// A "pure reference" is an identifier / this / member / element-access chain.
// Literals (string/number/template), object/array literals and arbitrary calls
// are NOT references, so we never tokenize literal *contents* — the dominant
// false-positive source in the original detector.
function isPureReference(node, ts) {
  let current = node;
  while (current) {
    if (ts.isIdentifier(current)) return true;
    if (current.kind === ts.SyntaxKind.ThisKeyword) return true;
    if (ts.isPropertyAccessExpression(current)) { current = current.expression; continue; }
    if (ts.isElementAccessExpression(current)) { current = current.expression; continue; }
    if (ts.isParenthesizedExpression(current)) { current = current.expression; continue; }
    if (ts.isNonNullExpression && ts.isNonNullExpression(current)) { current = current.expression; continue; }
    return false;
  }
  return false;
}

// Describe a value expression for source-system analysis. `systemTokens` uses
// leaf-property precedence: the innermost property name decides the system when
// it carries one (so shopifyOrder.rexProductId reads as REX, not Shopify),
// otherwise the root object decides it.
function referenceInfo(node, ts, sourceFile) {
  if (!node) return { isRef: false, tokens: [], systemTokens: [], root: null };
  const inner = unwrapValueExpr(node, ts);
  if (!inner || !isPureReference(inner, ts)) {
    return { isRef: false, tokens: [], systemTokens: [], root: null };
  }
  const allTokens = interestingTokens(tokenSet(nodeText(inner, sourceFile)));
  const root = rootIdentifierText(inner, ts);
  let leaf = null;
  if (ts.isPropertyAccessExpression(inner)) leaf = inner.name.text;
  else if (ts.isElementAccessExpression(inner) && ts.isStringLiteral(inner.argumentExpression)) leaf = inner.argumentExpression.text;
  else if (ts.isIdentifier(inner)) leaf = inner.text;
  const leafSystems = systemsOf(tokenSet(leaf || ''));
  const systemSource = leafSystems.size ? (leaf || '') : (root || '');
  return {
    isRef: true,
    tokens: allTokens,
    systemTokens: interestingTokens(tokenSet(systemSource)),
    root
  };
}

function propertyNameText(nameNode, sourceFile, ts) {
  if (!nameNode) return null;
  if (ts.isIdentifier(nameNode) || ts.isStringLiteral(nameNode) || ts.isNumericLiteral(nameNode)) {
    return nameNode.text;
  }
  return nodeText(nameNode, sourceFile);
}

// Only the called method/function's OWN name carries intent. The receiver chain
// (localStorage, skuMappingsRouteService, invoiceProcessing, ...) must not inject
// tokens — that was a major false-positive source.
function callIntentText(expr, sourceFile, ts) {
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  if (ts.isIdentifier(expr)) return expr.text;
  return '';
}

function collectFile(ts, file, content) {
  const sourceFile = ts.createSourceFile(
    file,
    content,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForFile(ts, file)
  );
  const diagnostics = sourceFile.parseDiagnostics || [];
  const record = {
    file,
    status: diagnostics.length ? 'parsed_with_diagnostics' : 'scanned',
    diagnostics: diagnostics.map((diag) => String(diag.messageText)),
    memberAccesses: [],
    declarations: [],
    assignments: [],
    payloadAssignments: [],
    calls: [],
    destructures: [],
    identifiers: new Set(),
    contexts: new Map()
  };

  function contextBucket(name) {
    if (!record.contexts.has(name)) {
      record.contexts.set(name, {
        name,
        memberAccesses: [],
        declarations: [],
        assignments: [],
        payloadAssignments: [],
        calls: [],
        destructures: [],
        basesByProperty: new Map()
      });
    }
    return record.contexts.get(name);
  }

  function addMember(member, context) {
    record.memberAccesses.push(member);
    context.memberAccesses.push(member);
    if (!context.basesByProperty.has(member.property)) {
      context.basesByProperty.set(member.property, new Map());
    }
    const bases = context.basesByProperty.get(member.property);
    const base = member.root || member.base || '<unknown>';
    bases.set(base, (bases.get(base) || 0) + 1);
  }

  function addDeclaration(node, contextName, context) {
    const location = getLineCol(sourceFile, node);
    if (ts.isIdentifier(node.name)) {
      const initializerText = node.initializer ? nodeText(node.initializer, sourceFile) : '';
      const valueInfo = node.initializer
        ? referenceInfo(node.initializer, ts, sourceFile)
        : { isRef: false, tokens: [], systemTokens: [], root: null };
      const decl = {
        file,
        context: contextName,
        line: location.line,
        column: location.column,
        name: node.name.text,
        initializer: initializerText,
        sourceRoot: valueInfo.root,
        targetTokens: interestingTokens(tokenSet(node.name.text)),
        sourceTokens: valueInfo.tokens,
        valueInfo
      };
      record.declarations.push(decl);
      context.declarations.push(decl);
      return;
    }

    if (!ts.isObjectBindingPattern(node.name)) return;
    const initializerText = node.initializer ? nodeText(node.initializer, sourceFile) : '';
    const baseInfo = node.initializer
      ? referenceInfo(node.initializer, ts, sourceFile)
      : { isRef: false, tokens: [], systemTokens: [], root: null };
    for (const element of node.name.elements) {
      const name = propertyNameText(element.propertyName || element.name, sourceFile, ts);
      const boundName = propertyNameText(element.name, sourceFile, ts);
      const item = {
        file,
        context: contextName,
        line: location.line,
        column: location.column,
        property: name,
        boundName,
        initializer: initializerText,
        sourceRoot: baseInfo.root,
        baseIsReference: baseInfo.isRef,
        baseSystemTokens: baseInfo.systemTokens,
        propertyTokens: interestingTokens(tokenSet(name)),
        sourceTokens: baseInfo.tokens
      };
      record.destructures.push(item);
      context.destructures.push(item);
    }
  }

  function visit(node, stack) {
    const contextName = getContextName(stack);
    const context = contextBucket(contextName);
    if (ts.isIdentifier(node)) record.identifiers.add(node.text);

    if (ts.isPropertyAccessExpression(node)) {
      const root = rootIdentifierText(node.expression, ts);
      const property = node.name.text;
      const location = getLineCol(sourceFile, node);
      addMember({
        file,
        context: contextName,
        line: location.line,
        column: location.column,
        text: nodeText(node, sourceFile),
        base: nodeText(node.expression, sourceFile),
        root,
        property,
        baseTokens: expressionTokens(nodeText(node.expression, sourceFile), root),
        propertyTokens: interestingTokens(tokenSet(property))
      }, context);
    }

    if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)) {
      const root = rootIdentifierText(node.expression, ts);
      const property = node.argumentExpression.text;
      const location = getLineCol(sourceFile, node);
      addMember({
        file,
        context: contextName,
        line: location.line,
        column: location.column,
        text: nodeText(node, sourceFile),
        base: nodeText(node.expression, sourceFile),
        root,
        property,
        baseTokens: expressionTokens(nodeText(node.expression, sourceFile), root),
        propertyTokens: interestingTokens(tokenSet(property))
      }, context);
    }

    if (ts.isVariableDeclaration(node) && node.name) {
      addDeclaration(node, contextName, context);
    }

    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const location = getLineCol(sourceFile, node);
      const targetText = nodeText(node.left, sourceFile);
      const valueText = nodeText(node.right, sourceFile);
      const valueInfo = referenceInfo(node.right, ts, sourceFile);
      const item = {
        file,
        context: contextName,
        line: location.line,
        column: location.column,
        target: targetText,
        value: valueText,
        sourceRoot: valueInfo.root,
        targetTokens: interestingTokens(tokenSet(targetText)),
        sourceTokens: valueInfo.tokens,
        valueInfo
      };
      record.assignments.push(item);
      context.assignments.push(item);
    }

    if (ts.isPropertyAssignment(node)) {
      const location = getLineCol(sourceFile, node);
      const key = propertyNameText(node.name, sourceFile, ts);
      const value = node.initializer ? nodeText(node.initializer, sourceFile) : '';
      const valueInfo = node.initializer
        ? referenceInfo(node.initializer, ts, sourceFile)
        : { isRef: false, tokens: [], systemTokens: [], root: null };
      const item = {
        file,
        context: contextName,
        line: location.line,
        column: location.column,
        key,
        value,
        sourceRoot: valueInfo.root,
        targetTokens: interestingTokens(tokenSet(key)),
        sourceTokens: valueInfo.tokens,
        valueInfo
      };
      record.payloadAssignments.push(item);
      context.payloadAssignments.push(item);
    }

    if (ts.isCallExpression(node)) {
      const location = getLineCol(sourceFile, node);
      const callName = nodeText(node.expression, sourceFile);
      const callIntent = callIntentText(node.expression, sourceFile, ts);
      const args = node.arguments.map((argument, index) => {
        const text = nodeText(argument, sourceFile);
        const valueInfo = referenceInfo(argument, ts, sourceFile);
        return { index, text, sourceRoot: valueInfo.root, sourceTokens: valueInfo.tokens, valueInfo };
      });
      const item = {
        file,
        context: contextName,
        line: location.line,
        column: location.column,
        callName,
        callTokens: interestingTokens(tokenSet(callIntent)),
        args
      };
      record.calls.push(item);
      context.calls.push(item);
    }

    stack.push(node);
    ts.forEachChild(node, (child) => visit(child, stack));
    stack.pop();
  }

  visit(sourceFile, []);
  record.identifiers = [...record.identifiers].sort();
  record.contexts = [...record.contexts.values()].map((context) => ({
    ...context,
    basesByProperty: [...context.basesByProperty.entries()].map(([property, bases]) => ({
      property,
      bases: [...bases.entries()].map(([base, count]) => ({ base, count }))
    }))
  }));
  return record;
}

// Systems a value comes from: its own tokens, plus in-file provenance for its
// root identifier (e.g. `const orderId = shopifyOrder.id` makes `orderId` shopify).
function valueSystems(valueInfo, provenance) {
  const systems = systemsOf(valueInfo.systemTokens);
  if (valueInfo.root && provenance && provenance.has(valueInfo.root)) {
    systems.add(provenance.get(valueInfo.root));
  }
  return systems;
}

// A finding exists only when a NAME claims one source system and a REFERENCE
// value provably comes from a different one. Same-system, system-less, and
// literal values never produce a finding.
function systemConflict(targetName, targetTokens, valueInfo, provenance) {
  if (!valueInfo || !valueInfo.isRef) return null;
  // Fields explicitly named to hold a foreign system's id are not bugs.
  // Checked against the raw name because foreign-holder words (source/foreign/...)
  // are not retained by interestingTokens.
  for (const token of splitName(targetName)) {
    if (FOREIGN_HOLDER_TOKENS.has(token)) return null;
  }
  const targetSystems = systemsOf(targetTokens);
  if (targetSystems.size === 0) return null;
  const sourceSystems = valueSystems(valueInfo, provenance);
  if (sourceSystems.size === 0) return null;
  const foreign = [...sourceSystems].filter((system) => !targetSystems.has(system));
  if (foreign.length === 0) return null;
  return {
    severity: 'critical',
    targetSystems: [...targetSystems],
    sourceSystems: [...sourceSystems],
    foreign
  };
}

// Map identifiers to a single source system based on their (reference) initializer.
function buildProvenance(record) {
  const map = new Map();
  for (const decl of record.declarations || []) {
    if (!decl.valueInfo || !decl.valueInfo.isRef) continue;
    const systems = systemsOf(decl.valueInfo.systemTokens);
    if (systems.size === 1) map.set(decl.name, [...systems][0]);
  }
  return map;
}

function relevant(tokens) {
  return [...new Set(tokens)].filter((token) => SOURCE_TOKENS.has(token) || ID_TOKENS.has(token));
}

function addFinding(findings, finding) {
  findings.push({
    id: `CVA-${String(findings.length + 1).padStart(4, '0')}`,
    ...finding
  });
}

function conflictReview(role, conflict) {
  return `${role} names the ${conflict.targetSystems.join('/')} system but the value comes from ${conflict.foreign.join('/')}. Confirm the correct identifier source.`;
}

function analyzeRecords(records, options) {
  const includeTests = Boolean(options && options.includeTests);
  const findings = [];
  const ambiguities = [];

  for (const record of records) {
    if (record.status === 'parse_failed') {
      addFinding(findings, {
        severity: 'high',
        rule: 'parse-failed',
        file: record.file,
        line: 1,
        evidence: record.error,
        requiredReview: 'Fix parser/read failure or audit this file manually.'
      });
      continue;
    }
    if (record.status === 'parsed_with_diagnostics') {
      // Partial-parse coverage note. Kept LOW so it never flips the verdict on
      // valid files the standalone parser merely cannot fully resolve.
      addFinding(findings, {
        severity: 'low',
        rule: 'parse-diagnostics',
        file: record.file,
        line: 1,
        evidence: record.diagnostics.join('; ') || 'TypeScript parser reported diagnostics.',
        requiredReview: 'Partial parse; identity findings in this file may be incomplete.'
      });
    }

    // Test files carry synthetic fixtures (literal ids, deliberate mismatches)
    // that are not production bugs. Excluded from findings by default.
    if (record.isTest && !includeTests) continue;

    const provenance = buildProvenance(record);

    for (const context of record.contexts) {
      // Source systems present anywhere in this scope (gates the erasure rule).
      const contextSystems = new Set();
      for (const member of context.memberAccesses) {
        for (const s of systemsOf(tokenSet(member.base))) contextSystems.add(s);
      }
      for (const d of context.destructures) {
        if (d.baseIsReference) for (const s of systemsOf(d.baseSystemTokens)) contextSystems.add(s);
      }
      for (const decl of context.declarations) {
        if (decl.valueInfo) for (const s of valueSystems(decl.valueInfo, provenance)) contextSystems.add(s);
      }

      // Destructuring an identity off a system-tagged object into a bare name,
      // in a scope that also references another system — erases which system.
      // The base must be a real object reference (not a require()/import/call),
      // and the bound name must be a bare identity field (not a helper import).
      for (const d of context.destructures) {
        if (!d.baseIsReference) continue;
        const prop = String(d.property || '').toLowerCase();
        const identity = ID_TOKENS.has(prop) || prop.endsWith('id');
        if (!identity) continue;
        if (startsWithVerb(d.boundName) || startsWithVerb(d.property)) continue;
        const baseSystems = systemsOf(d.baseSystemTokens);
        if (baseSystems.size === 0) continue;
        const boundSystems = systemsOf(tokenSet(d.boundName));
        const erases = [...baseSystems].some((s) => !boundSystems.has(s));
        if (erases && contextSystems.size >= 2) {
          addFinding(findings, {
            severity: 'high',
            rule: 'identity-source-erased-by-destructure',
            file: d.file,
            line: d.line,
            evidence: `Destructures ${d.property} from ${d.initializer} into ${d.boundName}`,
            requiredReview: `Scope mixes ${[...contextSystems].join('/')} identities; keep the source-system name (e.g. ${[...baseSystems][0]}Id) so the source is not erased.`
          });
        }
      }
    }

    for (const decl of record.declarations) {
      const conflict = systemConflict(decl.name, decl.targetTokens, decl.valueInfo, provenance);
      if (!conflict) continue;
      addFinding(findings, {
        severity: conflict.severity,
        rule: 'variable-name-source-mismatch',
        file: decl.file,
        line: decl.line,
        evidence: `${decl.name} = ${decl.initializer}`,
        requiredReview: conflictReview('Variable', conflict)
      });
    }

    for (const assignment of record.assignments) {
      const conflict = systemConflict(assignment.target, assignment.targetTokens, assignment.valueInfo, provenance);
      if (!conflict) continue;
      addFinding(findings, {
        severity: conflict.severity,
        rule: 'assignment-target-source-mismatch',
        file: assignment.file,
        line: assignment.line,
        evidence: `${assignment.target} = ${assignment.value}`,
        requiredReview: conflictReview('Assignment target', conflict)
      });
    }

    for (const payload of record.payloadAssignments) {
      if (String(payload.key || '').endsWith('.sql')) continue;
      if (/^(GET|POST|PUT|PATCH|DELETE) /.test(String(payload.key || ''))) continue;
      const conflict = systemConflict(payload.key, payload.targetTokens, payload.valueInfo, provenance);
      if (!conflict) continue;
      addFinding(findings, {
        severity: conflict.severity,
        rule: 'payload-key-source-mismatch',
        file: payload.file,
        line: payload.line,
        evidence: `${payload.key}: ${payload.value}`,
        requiredReview: conflictReview('Payload key', conflict)
      });
    }

    // NOTE: a call-argument rule (method system vs argument system) was tried and
    // removed. Resolver/lookup/linker functions legitimately take one system's id
    // and return/operate on another's (getRexOrderId(shopifyOrderId),
    // finalizeShopifyOrderItemLinks(orderUuid, rexOrderId), ...), so a function
    // name cannot tell us the expected system of its arguments without the
    // signature. It produced only false positives on real PRs and is intentionally
    // not implemented. Cross-system *storage* is still caught by the name-binding
    // rules above (variable/assignment/payload) plus provenance.
  }

  return { findings, ambiguities };
}

function severityRank(severity) {
  return { critical: 4, high: 3, medium: 2, low: 1 }[String(severity).toLowerCase()] || 0;
}

function verdict(findings) {
  const max = findings.reduce((rank, finding) => {
    return Math.max(rank, severityRank(finding.severity));
  }, 0);
  if (max >= 4) return 'AUDIT FAIL - CRITICAL VARIABLE FINDINGS';
  if (max >= 3) return 'AUDIT FAIL - HIGH VARIABLE FINDINGS';
  if (max >= 2) return 'NEEDS REVIEW - VARIABLE AMBIGUITY FOUND';
  return 'PASS - NO VARIABLE SOURCE MISMATCHES DETECTED';
}

function shouldFail(findings, failOn) {
  if (failOn === 'never') return false;
  const threshold = severityRank(failOn);
  return Boolean(threshold && findings.some((finding) => severityRank(finding.severity) >= threshold));
}

function summarize(records, skipped, findings, ambiguities, target) {
  return {
    target,
    changedFiles: records.length + skipped.length,
    scannedFiles: records.length,
    skippedFiles: skipped.length,
    memberAccesses: records.reduce((sum, record) => sum + record.memberAccesses.length, 0),
    declarations: records.reduce((sum, record) => sum + record.declarations.length, 0),
    assignments: records.reduce((sum, record) => sum + record.assignments.length, 0),
    payloadAssignments: records.reduce((sum, record) => sum + record.payloadAssignments.length, 0),
    calls: records.reduce((sum, record) => sum + record.calls.length, 0),
    identifiers: records.reduce((sum, record) => sum + record.identifiers.length, 0),
    findings: findings.length,
    ambiguities: ambiguities.length
  };
}

function mdEscape(value) {
  return String(value == null ? '' : value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function publicationEvidence(value) {
  let text = String(value == null ? '' : value);
  text = text.replace(/postgres(?:ql)?:\/\/\S+/gi, 'postgresql://[redacted]');
  text = text.replace(/https?:\/\/\S+/gi, 'https://[redacted]');
  text = text.replace(
    /(token|secret|password|auth|api.key)\s*[:=]\s*['"`][^'"`]+['"`]/gi,
    '$1=[redacted]'
  );
  return text;
}

function issueNumberFromUrl(url) {
  const text = String(url == null ? '' : url);
  const match = text.match(new RegExp(`${ISSUE_PATH_SEGMENT}(\\d+)(?:\\b|$)`));
  return match ? Number(match[1]) : null;
}

function issueUrlFor(repo, issueNumber) {
  return `${GITHUB_WEB_ROOT}${repo}${ISSUE_PATH_SEGMENT}${issueNumber}`;
}

function labelFlagArgs(optionName, labels) {
  const result = [];
  for (const label of labels) {
    result.push(optionName, label);
  }
  return result;
}

function ensureRepoLabel(repo, label, color, description) {
  const out = run('gh', [
    'label', 'list', REPO_FLAG, repo, SEARCH_FLAG, label, JSON_FLAG, 'name', LIMIT_FLAG, '100'
  ]);
  const labels = JSON.parse(out ? out : '[]');
  let found = false;
  for (const entry of labels) {
    if (entry && entry.name === label) found = true;
  }
  if (found) return `label exists: ${label}`;
  const created = run('gh', [
    'label', 'create', label, REPO_FLAG, repo, COLOR_FLAG, color, DESCRIPTION_FLAG, description
  ]);
  const createdText = created.trim();
  return createdText ? createdText : `created label: ${label}`;
}

function ensurePublicationLabels(repo) {
  const results = [];
  results.push(ensureRepoLabel(repo, BUG_LABEL, 'd73a4a', 'Something is not working'));
  results.push(ensureRepoLabel(
    repo,
    INVESTIGATION_LABEL,
    'fbca04',
    'Automated audit finding that needs investigation'
  ));
  return results;
}

function addIssueLabels(repo, issueNumber) {
  if (!issueNumber) return 'issue label update skipped: issue number unavailable';
  const out = run('gh', ['issue', 'edit', String(issueNumber), REPO_FLAG, repo, ...labelFlagArgs(ADD_LABEL_FLAG, PUBLICATION_LABELS)]);
  const text = out.trim();
  return text ? text : `ensured issue labels: ${PUBLICATION_LABELS.join(', ')}`;
}


function issueToGreenPrHandoff(input) {
  const issueNumber = input.issueNumber ? input.issueNumber : issueNumberFromUrl(input.issueUrl);
  const target = input.issueUrl ? input.issueUrl : (issueNumber ? issueUrlFor(input.repo, issueNumber) : null);
  if (!target) return null;
  const firstFindingIds = [];
  for (const finding of input.findings.slice(0, 20)) {
    firstFindingIds.push(finding.id);
  }
  return {
    schema_version: 'code_variable_audit.issue_to_green_pr_handoff.v1',
    skill: 'issue-to-green-pr',
    target,
    recommended_prompt: `Use $issue-to-green-pr on ${target}`,
    repo: input.repo,
    issue: issueNumber,
    labels: PUBLICATION_LABELS,
    source_pr: input.prContext ? {
      number: input.prContext.number,
      url: input.prContext.url,
      state: input.prContext.state,
      mergedAt: input.prContext.mergedAt ? input.prContext.mergedAt : null,
      headRefOid: input.prContext.headRefOid,
      baseRefName: input.prContext.baseRefName
    } : null,
    audit: {
      target: input.summary.target,
      verdict: verdict(input.findings),
      changedFiles: input.summary.changedFiles,
      scannedFiles: input.summary.scannedFiles,
      skippedFiles: input.summary.skippedFiles,
      findingCount: input.findings.length,
      firstFindingIds
    },
    guardrails: [
      'code-variable-audit is audit-only and must not fix code',
      'issue-to-green-pr owns diagnosis, blast-radius, build, review, proof, and PR work',
      'the issue target is explicit and bypasses batch label discovery only, not safety gates'
    ]
  };
}

function writeHandoffIfRequested(args, handoff) {
  if (!args.handoffOutput) return null;
  if (!handoff) return null;
  fs.mkdirSync(path.dirname(path.resolve(args.handoffOutput)), { recursive: true });
  fs.writeFileSync(args.handoffOutput, `${JSON.stringify(handoff, null, 2)}\n`);
  return args.handoffOutput;
}

function dryRunPublication() {
  return {
    result: 'dry-run only',
    target: null,
    labels: [],
    labelResult: [],
    issueUrl: null,
    issueNumber: null,
    issueToGreenPrHandoff: null,
    handoffOutput: null
  };
}

function renderMarkdown(data) {
  const { summary, records, skipped, findings, ambiguities, prContext, publishResult, args } = data;
  const publication = data.publication ? data.publication : {};
  const issueToGreenPrHandoff = data.issueToGreenPrHandoff ? data.issueToGreenPrHandoff : null;
  const lines = [];
  lines.push(`# Code Variable Audit: ${summary.target}`);
  lines.push('');
  lines.push(`- Verdict: ${verdict(findings)}`);
  if (prContext) {
    lines.push(`- PR: [${mdEscape(prContext.title)}](${prContext.url})`);
    lines.push(`- State: ${prContext.state}${prContext.mergedAt ? `, merged at ${prContext.mergedAt}` : ''}`);
    lines.push(`- Head SHA: ${prContext.headRefOid}`);
    lines.push(`- Base: ${prContext.baseRefName}`);
  }
  lines.push(`- Publish mode: ${args.publish && !args.dryRun ? 'publish' : 'dry-run'}`);
  lines.push('');
  lines.push('## Zoom-Out Trace');
  lines.push('');
  lines.push('- Resolved target metadata and changed files.');
  lines.push('- Parsed every changed JS/TS source file with the TypeScript compiler API.');
  lines.push('- Collected member accesses, declarations, assignments, payload keys, calls, destructuring, and identifiers.');
  lines.push('- Compared target names and call/payload intent against value/source tokens.');
  lines.push('- Routed publication by PR lifecycle when requested.');
  lines.push('');
  lines.push('## Blast Radius');
  lines.push('');
  for (const [key, value] of Object.entries(summary)) {
    if (key !== 'target') lines.push(`- ${key}: ${value}`);
  }
  lines.push('');
  lines.push('## Coverage Ledger');
  lines.push('');
  lines.push('| File | Status | Members | Declarations | Assignments | Payload keys | Calls |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|');
  for (const record of records) {
    const excluded = record.isTest && !(args && args.includeTests);
    const status = excluded ? `${record.status} (test: excluded)` : record.status;
    lines.push(`| ${mdEscape(record.file)} | ${mdEscape(status)} | ${record.memberAccesses.length} | ${record.declarations.length} | ${record.assignments.length} | ${record.payloadAssignments.length} | ${record.calls.length} |`);
  }
  for (const item of skipped) {
    lines.push(`| ${mdEscape(item.file)} | ${mdEscape(item.reason)} | 0 | 0 | 0 | 0 | 0 |`);
  }
  lines.push('');
  lines.push('## Suspicion Ledger');
  lines.push('');
  if (findings.length === 0) {
    lines.push('No suspicious variable-source findings were detected.');
  } else {
    lines.push('| ID | Severity | Rule | File | Line | Evidence | Required review |');
    lines.push('|---|---:|---|---|---:|---|---|');
    for (const finding of findings) {
      lines.push(`| ${finding.id} | ${finding.severity.toUpperCase()} | ${mdEscape(finding.rule)} | ${mdEscape(finding.file)} | ${finding.line || ''} | ${mdEscape(finding.evidence)} | ${mdEscape(finding.requiredReview)} |`);
    }
  }
  lines.push('');
  lines.push('## Ambiguity Ledger');
  lines.push('');
  if (ambiguities.length === 0) {
    lines.push('No mixed identity-property contexts were detected.');
  } else {
    lines.push('| File | Context | Property | Bases |');
    lines.push('|---|---|---|---|');
    for (const ambiguity of ambiguities) {
      const bases = ambiguity.bases.map((base) => `${base.base} (${base.count})`).join(', ');
      lines.push(`| ${mdEscape(ambiguity.file)} | ${mdEscape(ambiguity.context)} | ${mdEscape(ambiguity.property)} | ${mdEscape(bases)} |`);
    }
  }
  lines.push('');
  lines.push('## Publication Plan');
  lines.push('');
  lines.push(`- Publication needed: ${findings.length > 0 ? 'yes' : 'no'}`);
  const isOpenPr = prContext ? prContext.state === 'OPEN' : false;
  const target = isOpenPr
    ? 'open PR comment'
    : `GitHub issue labeled ${PUBLICATION_LABELS.join(', ')}`;
  lines.push(`- Target if publishing: ${target}`);
  lines.push(`- Result: ${publishResult ? publishResult : 'dry-run only'}`);
  if (publication.labels) {
    if (publication.labels.length) lines.push(`- Investigation labels: ${publication.labels.join(', ')}`);
  }
  if (publication.handoffOutput) lines.push(`- Handoff output: ${publication.handoffOutput}`);
  if (issueToGreenPrHandoff) {
    lines.push('');
    lines.push('## Issue-To-Green-PR Handoff');
    lines.push('');
    lines.push(`- Target issue: ${issueToGreenPrHandoff.target}`);
    lines.push(`- Skill: ${issueToGreenPrHandoff.skill}`);
    lines.push(`- Recommended prompt: ${issueToGreenPrHandoff.recommended_prompt}`);
    lines.push('- Boundary: code-variable-audit remains audit-only; issue-to-green-pr owns the fix workflow.');
  }
  lines.push('');
  lines.push('## Trace Boundaries');
  lines.push('');
  lines.push('- The audit does not execute code or application workflows.');
  lines.push('- The audit cannot prove business intent by syntax alone; every finding requires source-truth review.');
  lines.push('- Dynamic property names, runtime data shapes, and framework magic may require manual follow-up.');
  lines.push('- The audit does not fix code.');
  lines.push('');
  return lines.join('\n');
}

function markerFor(target, prContext) {
  return prContext ? `code-variable-audit:${target}:${prContext.headRefOid}` : `code-variable-audit:${target}`;
}

function publicationBody({ summary, findings, prContext }) {
  const lines = [
    `<!-- ${markerFor(summary.target, prContext)} -->`,
    `# Code Variable Audit: ${summary.target}`,
    '',
    `Verdict: ${verdict(findings)}`,
    '',
    `Scanned ${summary.scannedFiles}/${summary.changedFiles} changed files and found ${findings.length} finding(s).`,
    ''
  ];
  for (const finding of findings.slice(0, 20)) {
    lines.push(`- ${finding.id} ${finding.severity.toUpperCase()} ${finding.rule}: ${finding.file}:${finding.line || 1} - ${publicationEvidence(finding.evidence)}`);
  }
  if (findings.length > 20) {
    lines.push(`- ... ${findings.length - 20} additional finding(s) omitted from the GitHub body.`);
  }
  if (prContext) {
    if (prContext.state !== 'OPEN' && prContext.mergedAt) {
      lines.push('');
      lines.push('Next workflow: run `$issue-to-green-pr` on this GitHub issue after creation.');
      lines.push('The audit is read-only; diagnosis, build, proof, and PR work belong to issue-to-green-pr.');
    }
  }
  return lines.join('\n');
}

function publishIfNeeded({ args, repo, prContext, summary, findings }) {
  const publication = dryRunPublication();
  if (!args.publish) return publication;
  if (args.dryRun) return publication;
  if (findings.length === 0) return publication;
  if (!prContext) return publication;

  const body = publicationBody({ summary, findings, prContext });
  const marker = markerFor(summary.target, prContext);
  if (prContext.state === 'OPEN') {
    let comments = JSON.parse(run('gh', [
      'api', `repos/${repo}${ISSUE_PATH_SEGMENT}${prContext.number}/comments`, PAGINATE_FLAG, SLURP_FLAG
    ]));
    if (Array.isArray(comments.at(0))) comments = comments.flat();
    let existingComment = null;
    for (const comment of comments) {
      if (comment.body && comment.body.includes(marker)) existingComment = comment;
    }
    publication.target = 'open PR comment';
    if (existingComment) {
      publication.result = `existing PR comment: ${existingComment.html_url}`;
      return publication;
    }
    const out = run('gh', ['pr', 'comment', String(prContext.number), REPO_FLAG, repo, BODY_FLAG, body]);
    const text = out.trim();
    publication.result = text ? text : 'posted PR comment';
    return publication;
  }

  if (!prContext.mergedAt) {
    publication.result = 'closed-unmerged PR: no investigation issue created';
    publication.target = 'none';
    return publication;
  }

  const labelResult = ensurePublicationLabels(repo);
  const issueSearchOut = run('gh', [
    'issue', 'list', REPO_FLAG, repo, STATE_FLAG, 'all', SEARCH_FLAG, marker,
    JSON_FLAG, 'number,url,title,state'
  ]);
  const issues = JSON.parse(issueSearchOut ? issueSearchOut : '[]');
  let closedMarkerIssue = null;
  for (const issue of issues) {
    const issueState = String(issue.state ? issue.state : '').toUpperCase();
    if (issueState === 'OPEN') {
      const issueNumber = issue.number ? issue.number : issueNumberFromUrl(issue.url);
      const labelEditResult = addIssueLabels(repo, issueNumber);
      const allLabelResults = labelResult.slice();
      allLabelResults.push(labelEditResult);
      const handoff = issueToGreenPrHandoff({
        repo,
        issueUrl: issue.url,
        issueNumber,
        prContext,
        summary,
        findings
      });
      return {
        result: `existing investigation issue: ${issue.url}`,
        target: 'investigation issue',
        labels: PUBLICATION_LABELS,
        labelResult: allLabelResults,
        issueUrl: issue.url,
        issueNumber,
        issueToGreenPrHandoff: handoff,
        handoffOutput: null
      };
    }
    closedMarkerIssue = issue;
  }
  if (closedMarkerIssue) {
    throw new Error(`Existing code-variable-audit marker issue is not open: ${closedMarkerIssue.url}`);
  }
  const title = `[variable-audit] PR #${prContext.number}: ${prContext.title}`.slice(0, 240);
  const out = run('gh', [
    'issue', 'create', REPO_FLAG, repo, TITLE_FLAG, title, BODY_FLAG, body,
    ...labelFlagArgs(LABEL_FLAG, PUBLICATION_LABELS)
  ]);
  let issueUrl = out.trim();
  for (const part of out.trim().split(/\s+/)) {
    if (part.startsWith('https://')) issueUrl = part;
    if (part.startsWith('http://')) issueUrl = part;
  }
  const issueNumber = issueNumberFromUrl(issueUrl);
  const handoff = issueToGreenPrHandoff({
    repo,
    issueUrl,
    issueNumber,
    prContext,
    summary,
    findings
  });
  return {
    result: issueUrl ? `created investigation issue: ${issueUrl}` : 'created investigation issue',
    target: 'investigation issue',
    labels: PUBLICATION_LABELS,
    labelResult,
    issueUrl,
    issueNumber,
    issueToGreenPrHandoff: handoff,
    handoffOutput: null
  };
}

function isTestFile(file) {
  const normalized = String(file || '').replace(/\\/g, '/');
  if (/\.(test|spec|cy)\.[cm]?[jt]sx?$/i.test(normalized)) return true;
  return /(^|\/)(__tests__|__mocks__|tests?|e2e|cypress)(\/|$)/i.test(normalized);
}

function loadTarget(args) {
  const ts = resolveTypescript();
  const skipped = [];
  let files = [];
  let prContext = null;
  let repo = args.repo;
  let target = 'local';

  if (args.pr) {
    repo = resolveRepo(args.repo);
    prContext = readPrContext(repo, args.pr);
    files = readPrFiles(repo, args.pr);
    target = `${repo}#${prContext.number}`;
  } else if (args.files.length > 0) {
    files = args.files;
    target = args.files.length === 1 ? args.files[0] : `${args.files.length} local files`;
  } else {
    files = readLocalChangedFiles(args.base, args.head || 'HEAD');
    target = `${args.base}...${args.head || 'HEAD'}`;
  }

  const records = [];
  for (const fileEntry of files) {
    let file = fileEntry;
    let changeState = null;
    if (prContext && fileEntry.includes('\t')) {
      const [nextFile, nextState] = fileEntry.split('\t');
      file = nextFile;
      changeState = nextState;
    }
    if (changeState === 'removed') {
      skipped.push({ file, reason: 'skipped: file removed in PR' });
      continue;
    }
    const ext = path.extname(file).toLowerCase();
    if (!SOURCE_EXTENSIONS.has(ext)) {
      skipped.push({ file, reason: 'skipped: extension not audited' });
      continue;
    }
    const testFile = isTestFile(file);
    try {
      const content = prContext ? readPrFileAtHead(repo, file, prContext.headRefOid) : readLocalFile(file);
      const collected = collectFile(ts, file, content);
      collected.isTest = testFile;
      records.push(collected);
    } catch (err) {
      records.push({
        file,
        status: 'parse_failed',
        error: err.message,
        isTest: testFile,
        memberAccesses: [],
        declarations: [],
        assignments: [],
        payloadAssignments: [],
        calls: [],
        destructures: [],
        identifiers: [],
        contexts: []
      });
    }
  }
  return { repo, prContext, target, records, skipped };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const loaded = loadTarget(args);
  const analysis = analyzeRecords(loaded.records, { includeTests: args.includeTests });
  const summary = summarize(
    loaded.records,
    loaded.skipped,
    analysis.findings,
    analysis.ambiguities,
    loaded.target
  );
  const publication = publishIfNeeded({
    args,
    repo: loaded.repo,
    prContext: loaded.prContext,
    summary,
    findings: analysis.findings
  });
  publication.handoffOutput = writeHandoffIfRequested(args, publication.issueToGreenPrHandoff);
  const publishResult = publication.result;
  const output = {
    summary,
    verdict: verdict(analysis.findings),
    records: loaded.records,
    skipped: loaded.skipped,
    findings: analysis.findings,
    ambiguities: analysis.ambiguities,
    prContext: loaded.prContext,
    publishResult,
    publication,
    issueToGreenPrHandoff: publication.issueToGreenPrHandoff
  };

  if (args.json) {
    const text = JSON.stringify(output, null, 2);
    if (args.output) {
      fs.writeFileSync(args.output, text);
      console.log(JSON.stringify({
        output: args.output,
        verdict: output.verdict,
        summary: output.summary,
        publishResult: output.publishResult,
        issueToGreenPrTarget: output.issueToGreenPrHandoff ? output.issueToGreenPrHandoff.target : null,
        handoffOutput: output.publication ? output.publication.handoffOutput : null
      }, null, 2));
    } else {
      console.log(text);
    }
  } else {
    const markdown = renderMarkdown({
      summary,
      records: loaded.records,
      skipped: loaded.skipped,
      findings: analysis.findings,
      ambiguities: analysis.ambiguities,
      prContext: loaded.prContext,
      publishResult,
      publication,
      issueToGreenPrHandoff: publication.issueToGreenPrHandoff,
      args
    });
    if (args.output) fs.writeFileSync(args.output, markdown);
    console.log(markdown);
  }

  if (shouldFail(analysis.findings, args.failOn)) process.exitCode = 2;
}

try {
  main();
} catch (err) {
  console.error(`code-variable-audit failed: ${err.message}`);
  process.exit(1);
}
