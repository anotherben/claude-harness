import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compilePlatform, getPolicyBundle, loadPlatform, skillCatalog, taskBootstrap } from '../src/platform.js';

const packageRoot = join(fileURLToPath(new URL('..', import.meta.url)));

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
  opencode:
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

  writeFile(
    join(vault, '_standards', 'agent-platform', 'skill-routing-registry.json'),
    JSON.stringify(
      {
        version: 1,
        bundle_rules: [
          {
            key: 'global-reviewed-fallback',
          },
        ],
        skill_overrides: [
          {
            skill_id: 'sql-guard',
            review_status: 'reviewed',
            tier_default: 'primary',
            workflow_tags: ['implementation'],
            stack_tags: ['agnostic'],
          },
        ],
      },
      null,
      2,
    ),
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
  const routing = JSON.parse(readFileSync(join(platformRoot, 'compiled', 'skill-routing.json'), 'utf8'));
  const adapters = JSON.parse(readFileSync(join(platformRoot, 'compiled', 'adapters', 'claude.json'), 'utf8'));
  const opencode = JSON.parse(readFileSync(join(platformRoot, 'compiled', 'adapters', 'opencode.json'), 'utf8'));

  assert.equal(platform.status.counts.skills, 1);
  assert.equal(skillCatalog(platform, { limit: 10 }).skills.length, 1);
  assert.equal(policies.retrieval.direct_read_max_lines, 60);
  assert.equal(hints.rules.length, 1);
  assert.equal(routing.skill_overrides[0].skill_id, 'sql-guard');
  assert.equal(adapters.enforcement_mode, 'fail_closed');
  assert.equal(opencode.supports_mcp, true);

  const policyBundle = getPolicyBundle('claude', platform, 'helpdesk', 'feature');
  assert.equal(policyBundle.policies.retrieval.tight_read_limit_max, 90);
  assert.equal(policyBundle.adapter.name, 'claude');
  assert.equal(getPolicyBundle('opencode', platform, 'helpdesk', 'feature').adapter.name, 'opencode');

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
  const routing = JSON.parse(readFileSync(join(platformRoot, 'compiled', 'skill-routing.json'), 'utf8'));

  assert.equal(Array.isArray(registry.skills), true);
  assert.equal(registry.skills[0].id, 'sql-guard');
  assert.equal(Array.isArray(registry.skills[0].sections), true);
  assert.equal(policies.retrieval.tight_read_limit_max, 80);
  assert.equal(hints.rules[0].skill, 'sql-guard');
  assert.equal(Array.isArray(routing.bundle_rules), true);

  platform.store.close();
});

test('repo-local skills stay authoritative over external skills with the same id', async () => {
  const root = mkdtempSync(join(tmpdir(), 'skills-indexer-precedence-'));
  const vault = join(root, 'vault');
  const platformRoot = join(root, 'platform');
  const repoRoot = join(root, 'repo');
  const repoSkillRoot = join(repoRoot, '.codex', 'repo-skills');
  const externalSkillRoot = join(root, 'external', 'antigravity', 'main', 'repo', 'skills');

  writeFile(
    join(repoSkillRoot, 'sql-guard', 'SKILL.md'),
    `---
name: sql-guard
description: Local SQL guard
---

# SQL Guard
## Workflow
Use the local implementation.
`,
  );

  writeFile(
    join(externalSkillRoot, 'sql-guard', 'SKILL.md'),
    `---
name: sql-guard
description: External SQL guard
---

# SQL Guard
## Workflow
Use the external implementation.
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
---

# Cortex First
`,
  );

  const platform = await compilePlatform({
    vaultPath: vault,
    platformRoot,
    repoRoot,
    skillRoots: [repoSkillRoot],
    externalSources: [
      {
        name: 'antigravity-awesome-skills',
        enabled: true,
        trust_level: 'external',
        skill_root: externalSkillRoot,
      },
    ],
    skipEmbeddings: true,
  });

  const catalog = skillCatalog(platform, { limit: 10 });
  assert.equal(platform.status.counts.skills, 1);
  assert.equal(catalog.skills[0].source_root, repoSkillRoot);
  assert.equal(catalog.skill_roots.includes(externalSkillRoot), true);

  platform.store.close();
});

test('explicit canonical shim invocation returns canonical content', async () => {
  const root = mkdtempSync(join(tmpdir(), 'skills-indexer-canonical-shim-'));
  const vault = join(root, 'vault');
  const platformRoot = join(root, 'platform');
  const repoRoot = join(root, 'repo');
  const skillRoot = join(root, 'skills');
  const canonicalPath = join(root, 'canonical', 'deep-think', 'SKILL.md');

  writeFile(
    canonicalPath,
    `---
name: deep-think-canonical
description: Canonical deep think protocol
---

CANONICAL_SENTINEL

# Canonical Deep Think
## Workflow
### Use Canonical
Use the canonical protocol.
`,
  );

  writeFile(
    join(skillRoot, 'deep-think-shim', 'SKILL.md'),
    `---
name: deep-think-shim
description: Shim deep think protocol
shim_for: deep-think
canonical_path: ${canonicalPath}
---

SHIM_SENTINEL

# Shim Deep Think
## Workflow
### Use Shim
Use the shim protocol.
`,
  );

  const platform = await compilePlatform({
    vaultPath: vault,
    platformRoot,
    repoRoot,
    skillRoots: [skillRoot],
    skipEmbeddings: true,
  });
  const bootstrap = await taskBootstrap('codex', 'use $deep-think before editing', platform, {
    repo: repoRoot,
    taskType: 'implementation',
    limit: 3,
  });
  const registrySkill = platform.compiled.skillsRegistry.skills.find((skill) => skill.id === 'deep-think');
  const overview = platform.store.getSkillSection('deep-think', 'overview').section.content;
  const workflow = platform.store.getSkillSection('deep-think', 'Workflow').section.content;

  assert.equal(registrySkill.shim_for, 'deep-think');
  assert.equal(registrySkill.canonical_path, canonicalPath);
  assert.equal(bootstrap.recommendations[0].id, 'deep-think');
  assert.match(bootstrap.recommendations[0].preview, /CANONICAL_SENTINEL/);
  assert.doesNotMatch(bootstrap.recommendations[0].preview, /SHIM_SENTINEL/);
  assert.match(overview, /CANONICAL_SENTINEL/);
  assert.doesNotMatch(overview, /SHIM_SENTINEL/);
  assert.match(workflow, /### Use Canonical\nUse the canonical protocol\./);
  assert.doesNotMatch(workflow, /Use the shim protocol/);

  platform.store.close();
});

test('loadPlatform reports whether compiled state was reused or rebuilt', async () => {
  const root = mkdtempSync(join(tmpdir(), 'skills-indexer-load-state-'));
  const vault = join(root, 'vault');
  const platformRoot = join(root, 'platform');
  const repoRoot = join(root, 'repo');
  const skillRoot = join(root, 'skills');
  const skillPath = join(skillRoot, 'sql-guard', 'SKILL.md');

  writeFile(
    skillPath,
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
---

# Cortex First
`,
  );

  const compiled = await compilePlatform({
    vaultPath: vault,
    platformRoot,
    repoRoot,
    skillRoots: [skillRoot],
    skipEmbeddings: true,
  });
  compiled.store.close();

  const reused = await loadPlatform({
    vaultPath: vault,
    platformRoot,
    repoRoot,
    skillRoots: [skillRoot],
    skipEmbeddings: true,
  });
  assert.equal(reused.load_state, 'reused');
  reused.store.close();

  const future = new Date(Date.now() + 2000);
  utimesSync(skillPath, future, future);
  writeFile(
    skillPath,
    `---
name: sql-guard
description: SQL safety checker updated
---

# SQL Guard
## Workflow
Check tenant scope and parameters carefully.
`,
  );

  const rebuilt = await loadPlatform({
    vaultPath: vault,
    platformRoot,
    repoRoot,
    skillRoots: [skillRoot],
    skipEmbeddings: true,
  });
  assert.equal(rebuilt.load_state, 'rebuilt');
  rebuilt.store.close();
});

test('loadPlatform rebuilds when a new skill appears after compile', async () => {
  const root = mkdtempSync(join(tmpdir(), 'skills-indexer-new-skill-'));
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
`,
  );

  const compiled = await compilePlatform({
    vaultPath: vault,
    platformRoot,
    repoRoot,
    skillRoots: [skillRoot],
    skipEmbeddings: true,
  });
  compiled.store.close();

  writeFile(
    join(skillRoot, 'new-skill', 'SKILL.md'),
    `---
name: new-skill
description: Newly added skill
---

# New Skill
`,
  );
  const future = new Date(Date.now() + 2000);
  utimesSync(join(skillRoot, 'new-skill', 'SKILL.md'), future, future);

  const rebuilt = await loadPlatform({
    vaultPath: vault,
    platformRoot,
    repoRoot,
    skillRoots: [skillRoot],
    skipEmbeddings: true,
  });

  assert.equal(rebuilt.load_state, 'rebuilt');
  assert.equal(rebuilt.compiled.skillsRegistry.skills.some((skill) => skill.id === 'new-skill'), true);
  rebuilt.store.close();
});

test('loadPlatform rebuilds when the routing registry changes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'skills-indexer-routing-'));
  const vault = join(root, 'vault');
  const platformRoot = join(root, 'platform');
  const repoRoot = join(root, 'repo');
  const skillRoot = join(root, 'skills');
  const routingPath = join(vault, '_standards', 'agent-platform', 'skill-routing-registry.json');

  writeFile(
    join(skillRoot, 'sql-guard', 'SKILL.md'),
    `---
name: sql-guard
description: SQL safety checker
---

# SQL Guard
`,
  );
  writeFile(
    routingPath,
    JSON.stringify({ version: 1, bundle_rules: [{ key: 'global-reviewed-fallback' }] }, null, 2),
  );

  const compiled = await compilePlatform({
    vaultPath: vault,
    platformRoot,
    repoRoot,
    skillRoots: [skillRoot],
    skipEmbeddings: true,
  });
  compiled.store.close();

  writeFile(
    routingPath,
    JSON.stringify(
      {
        version: 2,
        bundle_rules: [{ key: 'changed-routing-bundle' }],
      },
      null,
      2,
    ),
  );
  const future = new Date(Date.now() + 2000);
  utimesSync(routingPath, future, future);

  const rebuilt = await loadPlatform({
    vaultPath: vault,
    platformRoot,
    repoRoot,
    skillRoots: [skillRoot],
    skipEmbeddings: true,
  });

  assert.equal(rebuilt.load_state, 'rebuilt');
  assert.equal(rebuilt.compiled.routingArtifact.bundle_rules[0].key, 'changed-routing-bundle');
  rebuilt.store.close();
});

test('loadPlatform rebuilds when compiled routing artifact is missing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'skills-indexer-routing-artifact-'));
  const vault = join(root, 'vault');
  const platformRoot = join(root, 'platform');
  const repoRoot = join(root, 'repo');
  const skillRoot = join(root, 'skills');
  const routingArtifactPath = join(platformRoot, 'compiled', 'skill-routing.json');

  writeFile(
    join(skillRoot, 'sql-guard', 'SKILL.md'),
    `---
name: sql-guard
description: SQL safety checker
---

# SQL Guard
`,
  );

  const compiled = await compilePlatform({
    vaultPath: vault,
    platformRoot,
    repoRoot,
    skillRoots: [skillRoot],
    skipEmbeddings: true,
  });
  compiled.store.close();
  assert.equal(existsSync(routingArtifactPath), true);

  rmSync(routingArtifactPath);
  const rebuilt = await loadPlatform({
    vaultPath: vault,
    platformRoot,
    repoRoot,
    skillRoots: [skillRoot],
    skipEmbeddings: true,
  });

  assert.equal(rebuilt.load_state, 'rebuilt');
  assert.equal(existsSync(routingArtifactPath), true);
  rebuilt.store.close();
});

test('sync-external reuses an unchanged mirrored repo instead of recloning', () => {
  const root = mkdtempSync(join(tmpdir(), 'skills-indexer-sync-'));
  const sourceRoot = join(root, 'source');
  const repoRoot = join(root, 'repo');
  const platformRoot = join(root, 'platform');
  const vault = join(root, 'vault');
  const cliPath = join(packageRoot, 'src', 'cli.js');

  mkdirSync(join(sourceRoot, 'skills', 'skill-installer'), { recursive: true });
  writeFile(
    join(sourceRoot, 'skills', 'skill-installer', 'SKILL.md'),
    `---
name: skill-installer
description: Install skills
---

# Skill Installer
## Workflow
Install skills from a source repo.
`,
  );

  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Codex',
    GIT_AUTHOR_EMAIL: 'codex@example.com',
    GIT_COMMITTER_NAME: 'Codex',
    GIT_COMMITTER_EMAIL: 'codex@example.com',
  };
  assert.equal(spawnSync('git', ['init', '-b', 'main', sourceRoot], { encoding: 'utf8', env: gitEnv }).status, 0);
  assert.equal(spawnSync('git', ['-C', sourceRoot, 'add', '.'], { encoding: 'utf8', env: gitEnv }).status, 0);
  assert.equal(
    spawnSync('git', ['-C', sourceRoot, 'commit', '-m', 'init'], { encoding: 'utf8', env: gitEnv }).status,
    0,
  );

  const runSync = () =>
    spawnSync(
      'node',
      [
        cliPath,
        'sync-external',
        '--name',
        'fixture-skills',
        '--repo-url',
        sourceRoot,
        '--ref',
        'main',
        '--repo-root',
        repoRoot,
        '--vault-path',
        vault,
        '--platform-root',
        platformRoot,
      ],
      { encoding: 'utf8', env: process.env },
    );

  const first = runSync();
  assert.equal(first.status, 0, first.stderr);
  const firstPayload = JSON.parse(first.stdout);
  assert.equal(firstPayload.changed, true);
  assert.equal(firstPayload.mode === 'cloned' || firstPayload.mode === 'fresh-clone', true);

  const second = runSync();
  assert.equal(second.status, 0, second.stderr);
  const secondPayload = JSON.parse(second.stdout);
  assert.equal(secondPayload.changed, false);
  assert.equal(secondPayload.mode, 'reused');
  assert.equal(secondPayload.commit_before, secondPayload.commit_after);

  const mirroredSkillPath = join(firstPayload.repo_path, 'skills', 'skill-installer', 'SKILL.md');
  const staleMirrorPath = join(firstPayload.repo_path, 'stale.tmp');
  writeFile(
    mirroredSkillPath,
    `---
name: skill-installer
description: Tampered mirror
---

# Tampered
`,
  );
  writeFile(staleMirrorPath, 'stale mirror file');

  const cleaned = runSync();
  assert.equal(cleaned.status, 0, cleaned.stderr);
  const cleanedPayload = JSON.parse(cleaned.stdout);
  assert.equal(cleanedPayload.changed, true);
  assert.equal(cleanedPayload.mode, 'cleaned');
  assert.match(readFileSync(mirroredSkillPath, 'utf8'), /Install skills from a source repo/);
  assert.equal(existsSync(staleMirrorPath), false);

  const unsafeTarget = join(root, 'ordinary-project-dir');
  const sentinelPath = join(unsafeTarget, 'sentinel.txt');
  writeFile(sentinelPath, 'do not delete');
  const unsafe = spawnSync(
    'node',
    [
      cliPath,
      'sync-external',
      '--name',
      'fixture-skills',
      '--repo-url',
      sourceRoot,
      '--ref',
      'main',
      '--target',
      unsafeTarget,
      '--repo-root',
      repoRoot,
      '--vault-path',
      vault,
      '--platform-root',
      platformRoot,
    ],
    { encoding: 'utf8', env: process.env },
  );

  assert.notEqual(unsafe.status, 0);
  assert.match(unsafe.stderr, /target must be under managed root/);
  assert.equal(readFileSync(sentinelPath, 'utf8'), 'do not delete');

  const outsideRoot = join(root, 'outside');
  const outsideRepo = join(outsideRoot, 'repo');
  const symlinkTarget = join(platformRoot, 'external-skills', 'linked-target');
  const symlinkSentinel = join(outsideRepo, 'sentinel.txt');
  mkdirSync(outsideRepo, { recursive: true });
  writeFile(symlinkSentinel, 'do not delete');
  writeFile(join(outsideRoot, '.skills-index-managed'), 'managed by skills-index sync-external\n');
  symlinkSync(outsideRoot, symlinkTarget);

  const symlinked = spawnSync(
    'node',
    [
      cliPath,
      'sync-external',
      '--name',
      'fixture-skills',
      '--repo-url',
      sourceRoot,
      '--ref',
      'main',
      '--target',
      symlinkTarget,
      '--repo-root',
      repoRoot,
      '--vault-path',
      vault,
      '--platform-root',
      platformRoot,
    ],
    { encoding: 'utf8', env: process.env },
  );

  assert.notEqual(symlinked.status, 0);
  assert.match(symlinked.stderr, /symlink|resolve under managed root/);
  assert.equal(readFileSync(symlinkSentinel, 'utf8'), 'do not delete');
});
