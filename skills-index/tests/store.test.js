import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../src/store.js';
import { parseSections } from '../src/markdown.js';

function makeDocument() {
  const sections = parseSections(`# SQL Guard
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
    sourcePath: '/tmp/sql-guard/SKILL.md',
    sourceRoot: '/tmp',
    relativePath: 'sql-guard/SKILL.md',
    precedenceScope: 'user',
    hash: 'hash-1',
    lineCount: 6,
    tokenEstimate: sections.reduce((sum, section) => sum + section.tokenEstimate, 0),
    attributes: { name: 'sql-guard' },
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

  store.close();
});
