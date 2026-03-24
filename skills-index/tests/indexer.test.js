import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compilePlatform, getPolicyBundle, skillCatalog } from '../src/platform.js';

function writeFile(filePath, contents) {
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, contents);
}

test('indexer builds db and compiled artifacts', async () => {
  const root = mkdtempSync(join(tmpdir(), 'skills-indexer-'));
  const vault = join(root, 'vault');
  const platformRoot = join(root, 'platform');
  const repoRoot = join(root, 'repo');
  const skillRoot = join(root, 'skills');
  const repoSkillRoot = join(repoRoot, '.codex', 'repo-skills');

  writeFile(
    join(skillRoot, 'sql-guard', 'SKILL.md'),
    `---
name: sql-guard
description: SQL safety checker for database changes
---

# SQL Guard
## When To Use
Use before SQL edits.

## Workflow
Check tenant scope and parameters.
`,
  );

  writeFile(
    join(vault, '_standards', 'agent-platform', '01-cortex-first.md'),
    `---
id: cortex-first
type: agent_policy
artifact_key: retrieval
direct_read_max_lines: 60
tight_read_limit_max: 90
---

# Cortex First
## Workflow
Use indexed reads first.
`,
  );

  writeFile(
    join(vault, '_standards', 'agent-platform', '03-skill-platform.md'),
    `---
id: skill-platform
type: agent_policy
default_sections:
  - Overview
  - Workflow
---

# Skill Platform
`,
  );

  writeFile(
    join(vault, '_standards', 'agent-platform', '04-agent-adapters.md'),
    `---
id: agent-adapters
type: adapter_policy
adapters:
  claude:
    enforcement_mode: fail_closed
    supports_hooks: true
    supports_mcp: true
  codex:
    enforcement_mode: guided
    supports_hooks: false
    supports_mcp: true
---

# Adapters
`,
  );

  writeFile(
    join(vault, '_standards', 'agent-platform', '05-skill-hints.md'),
    `---
id: skill-hints
type: skill_hints
rules:
  - skill: sql-guard
    keywords: [sql, migration, query]
    match_paths: [database/migrations, .sql]
    message: tenant isolation and parameterization
---

# Skill Hints
`,
  );

  const platform = await compilePlatform({
    vaultPath: vault,
    platformRoot,
    repoRoot,
    skillRoots: [repoSkillRoot, skillRoot],
    skipEmbeddings: true,
  });

  const policies = JSON.parse(readFileSync(join(platformRoot, 'compiled', 'policies.json'), 'utf8'));
  const hints = JSON.parse(readFileSync(join(platformRoot, 'compiled', 'skill-hints.json'), 'utf8'));
  const adapters = JSON.parse(readFileSync(join(platformRoot, 'compiled', 'adapters', 'claude.json'), 'utf8'));

  assert.equal(platform.status.counts.skills, 1);
  assert.equal(skillCatalog(platform, { limit: 10 }).skills.length, 1);
  assert.equal(policies.retrieval.direct_read_max_lines, 60);
  assert.equal(hints.rules.length, 1);
  assert.equal(adapters.enforcement_mode, 'fail_closed');

  const policyBundle = getPolicyBundle('claude', platform, 'helpdesk', 'feature');
  assert.equal(policyBundle.policies.retrieval.tight_read_limit_max, 90);
  assert.equal(policyBundle.adapter.name, 'claude');

  platform.store.close();
});

test('compiled artifacts preserve hook-facing shape', async () => {
  const root = mkdtempSync(join(tmpdir(), 'skills-indexer-shape-'));
  const vault = join(root, 'vault');
  const platformRoot = join(root, 'platform');
  const repoRoot = join(root, 'repo');
  const skillRoot = join(root, 'skills');

  writeFile(
    join(skillRoot, 'sql-guard', 'SKILL.md'),
    `---
name: sql-guard
description: SQL safety checker
---

# SQL Guard
## Workflow
Check tenant scope and parameters.
`,
  );

  writeFile(
    join(vault, '_standards', 'agent-platform', '01-cortex-first.md'),
    `---
id: cortex-first
type: agent_policy
artifact_key: retrieval
direct_read_max_lines: 50
tight_read_limit_max: 80
source_extensions: [.js, .jsx, .ts, .tsx]
---

# Cortex First
`,
  );

  writeFile(
    join(vault, '_standards', 'agent-platform', '05-skill-hints.md'),
    `---
id: skill-hints
type: skill_hints
rules:
  - skill: sql-guard
    match_paths: [.sql]
    keywords: [sql]
    message: SQL safety
---

# Skill Hints
`,
  );

  const platform = await compilePlatform({
    vaultPath: vault,
    platformRoot,
    repoRoot,
    skillRoots: [skillRoot],
    skipEmbeddings: true,
  });

  const registry = JSON.parse(readFileSync(join(platformRoot, 'compiled', 'skills-registry.json'), 'utf8'));
  const policies = JSON.parse(readFileSync(join(platformRoot, 'compiled', 'policies.json'), 'utf8'));
  const hints = JSON.parse(readFileSync(join(platformRoot, 'compiled', 'skill-hints.json'), 'utf8'));

  assert.equal(Array.isArray(registry.skills), true);
  assert.equal(registry.skills[0].id, 'sql-guard');
  assert.equal(Array.isArray(registry.skills[0].sections), true);
  assert.equal(policies.retrieval.tight_read_limit_max, 80);
  assert.equal(hints.rules[0].skill, 'sql-guard');

  platform.store.close();
});
