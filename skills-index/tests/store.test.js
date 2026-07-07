import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../src/store.js';
import { parseSections } from '../src/markdown.js';

function hashContent(text) {
  return createHash('sha256').update(text).digest('hex');
}

function writeFile(filePath, contents) {
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, contents);
}

function makeDocument(overrides = {}) {
  const sections = overrides.sections || parseSections(`# SQL Guard
## When To Use
Use before SQL edits.

## Workflow
Check tenant scope and parameters.
`);

  return {
    id: 'sql-guard',
    name: 'sql-guard',
    description: 'SQL safety checker for database changes',
    shortDescription: 'SQL safety checker',
    contentType: 'skill',
    sourcePath: overrides.sourcePath || '/tmp/sql-guard/SKILL.md',
    sourceRoot: overrides.sourceRoot || '/tmp',
    relativePath: overrides.relativePath || 'sql-guard/SKILL.md',
    precedenceScope: 'user',
    hash: overrides.hash || 'hash-1',
    sourceMtime: overrides.sourceMtime ?? null,
    shimFor: overrides.shimFor || null,
    canonicalPath: overrides.canonicalPath || null,
    canonicalHash: overrides.canonicalHash || null,
    canonicalMtime: overrides.canonicalMtime ?? null,
    lineCount: 6,
    tokenEstimate: sections.reduce((sum, section) => sum + section.tokenEstimate, 0),
    attributes: overrides.attributes || { name: 'sql-guard' },
    warnings: [],
    tags: {
      skill: ['sql', 'database'],
      sections: [
        { sectionSlug: 'when-to-use', tags: ['usage'] },
        { sectionSlug: 'workflow', tags: ['workflow'] },
      ],
    },
    sections,
  };
}

function sectionLookupFixtureSections() {
  return parseSections(`# Overview
Canonical overview body.

## Workflow
### Step One
Do the first thing.

### Step Two
Do the second thing.
`);
}

test('store persists and searches indexed skills', () => {
  const root = mkdtempSync(join(tmpdir(), 'skills-store-'));
  const dbPath = join(root, 'skills-index.db');
  const store = createStore({ dbPath });

  store.replaceDocument(makeDocument());

  const results = store.searchSkills({ query: 'sql migration tenant query', limit: 5 });
  const outline = store.getSkillOutline('sql-guard');
  const section = store.getSkillSection('sql-guard', 'workflow');

  assert.ok(existsSync(dbPath));
  assert.equal(results[0].id, 'sql-guard');
  assert.equal(outline.sections.length >= 3, true);
  assert.equal(section.section.slug, 'workflow');

  store.close();
});

test('status marks index stale when an indexed source path is missing', () => {
  const root = mkdtempSync(join(tmpdir(), 'skills-status-'));
  const dbPath = join(root, 'skills-index.db');
  const store = createStore({ dbPath });

  const missingSource = join(root, 'missing-skill', 'SKILL.md');
  store.replaceDocument(makeDocument({ sourcePath: missingSource }));

  const status = store.getStatus({ latestSourceMtime: 0 });

  assert.equal(status.stale, true);
  assert.equal(status.source_mtime_stale, false);
  assert.equal(status.missing_source_count, 1);
  assert.equal(status.missing_source_paths[0].source_path, missingSource);

  store.close();
});

test('status marks index stale when the source window advances', () => {
  const root = mkdtempSync(join(tmpdir(), 'skills-status-window-'));
  const dbPath = join(root, 'skills-index.db');
  const store = createStore({ dbPath });
  const sourcePath = join(root, 'skills', 'sql-guard', 'SKILL.md');
  const sourceText = '# SQL Guard\n';

  writeFile(sourcePath, sourceText);
  const sourceMtime = statSync(sourcePath).mtimeMs;
  store.replaceDocument(
    makeDocument({
      sourcePath,
      sourceRoot: join(root, 'skills'),
      relativePath: 'sql-guard/SKILL.md',
      hash: hashContent(sourceText),
      sourceMtime,
    }),
  );
  store.setMeta('last_indexed_at', new Date().toISOString());
  store.setMeta('last_indexed_source_mtime', sourceMtime);

  const status = store.getStatus({ latestSourceMtime: sourceMtime + 1000 });

  assert.equal(status.stale, true);
  assert.equal(status.source_mtime_stale, true);
  assert.equal(status.source_hash_stale, false);
  assert.equal(status.changed_source_count, 0);
  assert.equal(status.missing_source_count, 0);

  store.close();
});

test('status marks a canonical shim stale when the canonical target changes', () => {
  const root = mkdtempSync(join(tmpdir(), 'skills-canonical-status-'));
  const dbPath = join(root, 'skills-index.db');
  const store = createStore({ dbPath });
  const sourcePath = join(root, 'skills', 'deep-think', 'SKILL.md');
  const canonicalPath = join(root, 'canonical', 'deep-think', 'SKILL.md');
  const sourceText = `---
name: deep-think
shim_for: deep-think
canonical_path: ${canonicalPath}
---

SHIM_SENTINEL
`;
  const canonicalText = `---
name: deep-think
---

CANONICAL_SENTINEL
`;

  writeFile(sourcePath, sourceText);
  writeFile(canonicalPath, canonicalText);
  store.replaceDocument(
    makeDocument({
      sourcePath,
      sourceRoot: join(root, 'skills'),
      relativePath: 'deep-think/SKILL.md',
      hash: hashContent(sourceText),
      sourceMtime: statSync(sourcePath).mtimeMs,
      shimFor: 'deep-think',
      canonicalPath,
      canonicalHash: hashContent(canonicalText),
      canonicalMtime: statSync(canonicalPath).mtimeMs,
      attributes: {
        name: 'deep-think',
        shim_for: 'deep-think',
        canonical_path: canonicalPath,
      },
    }),
  );

  writeFile(canonicalPath, `${canonicalText}\nCHANGED_CANONICAL_SENTINEL\n`);

  const status = store.getStatus({ latestSourceMtime: 0 });

  assert.equal(status.stale, true);
  assert.equal(status.source_hash_stale, true);
  assert.equal(status.changed_source_count, 1);
  assert.equal(status.changed_source_paths[0].path_kind, 'canonical');
  assert.equal(status.changed_source_paths[0].reason, 'canonical_hash_changed');
  assert.equal(status.changed_source_paths[0].path, canonicalPath);

  store.close();
});

test('getSkillSection prefers contentful heading matches over empty synthetic overview', () => {
  const root = mkdtempSync(join(tmpdir(), 'skills-section-overview-'));
  const dbPath = join(root, 'skills-index.db');
  const store = createStore({ dbPath });
  const sections = sectionLookupFixtureSections();
  const contentfulOverview = sections.find(
    (section) => section.heading === 'Overview' && section.content,
  );

  store.replaceDocument(makeDocument({ sections }));

  const result = store.getSkillSection('sql-guard', 'Overview');

  assert.equal(result.section.slug, contentfulOverview.slug);
  assert.equal(result.section.content, 'Canonical overview body.');

  store.close();
});

test('getSkillSection aggregates direct children for a missing structural parent', () => {
  const root = mkdtempSync(join(tmpdir(), 'skills-section-workflow-'));
  const dbPath = join(root, 'skills-index.db');
  const store = createStore({ dbPath });
  const sections = sectionLookupFixtureSections();

  assert.equal(sections.some((section) => section.slug === 'workflow'), false);

  store.replaceDocument(makeDocument({ sections }));

  const result = store.getSkillSection('sql-guard', 'Workflow');

  assert.equal(result.section.heading, 'Workflow');
  assert.equal(result.section.slug, 'workflow');
  assert.match(result.section.content, /### Step One\nDo the first thing\./);
  assert.match(result.section.content, /### Step Two\nDo the second thing\./);
  assert.equal(result.section.tokenEstimate > 0, true);

  store.close();
});

test('replaceDocuments removes skills that no longer exist in source roots', () => {
  const root = mkdtempSync(join(tmpdir(), 'skills-replace-'));
  const dbPath = join(root, 'skills-index.db');
  const store = createStore({ dbPath });

  store.replaceDocuments([
    makeDocument({ sourcePath: join(root, 'stale', 'SKILL.md') }),
  ]);
  assert.equal(store.getStatus({ latestSourceMtime: 0 }).missing_source_count, 1);

  store.replaceDocuments([]);
  const status = store.getStatus({ latestSourceMtime: 0 });

  assert.equal(status.counts.documents, 0);
  assert.equal(status.missing_source_count, 0);
  assert.equal(status.stale, false);

  store.close();
});

test('telemetry persists cumulative savings', () => {
  const root = mkdtempSync(join(tmpdir(), 'skills-telemetry-'));
  const dbPath = join(root, 'skills-index.db');
  let store = createStore({ dbPath });

  store.recordTelemetry({
    toolName: 'skill_read_section',
    queryText: 'sql',
    fileTokens: 400,
    responseTokens: 100,
    resultCount: 1,
  });
  store.recordTelemetry({
    toolName: 'skill_outline',
    queryText: 'sql',
    fileTokens: 200,
    responseTokens: 80,
    resultCount: 1,
  });
  store.close();

  store = createStore({ dbPath });
  const report = store.getTelemetryReport();

  assert.equal(report.total_queries, 2);
  assert.equal(report.total_tokens_saved, 420);
  assert.equal(report.avg_tokens_saved_per_query, 210);
  assert.equal(store.listTelemetryQueries({ toolName: 'skill_outline', limit: 5 })[0].queryText, 'sql');

  store.close();
});
