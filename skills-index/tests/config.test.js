import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolvePaths } from '../src/config.js';

test('resolvePaths defaults to Codex-compatible skill roots', () => {
  const root = mkdtempSync(join(tmpdir(), 'skills-config-'));
  const repoRoot = join(root, 'project');
  const harnessRoot = join(root, 'claude-harness');
  const vaultPath = join(root, 'vault');
  const platformRoot = join(root, 'platform');

  const paths = resolvePaths({
    repoRoot,
    harnessRoot,
    vaultPath,
    platformRoot,
  });

  assert.equal(paths.harnessRoot, harnessRoot);
  assert.match(paths.skillRoots.join('\n'), new RegExp(`${repoRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\.codex/repo-skills`));
  assert.equal(paths.runtime, 'codex');
  assert.equal(paths.skillRoots.includes(join(harnessRoot, 'skills')), false);
  assert.equal(paths.skillRoots.includes(join(repoRoot, '.claude', 'skills')), false);
  assert.equal(paths.skillRoots.includes(join(homedir(), '.claude', 'skills')), false);
  assert.equal(paths.skillRoots.includes(join(homedir(), '.codex', 'skills')), true);
});

test('resolvePaths default vault path is portable and home-relative', () => {
  const previousVaultPath = process.env.OBSIDIAN_VAULT_PATH;
  delete process.env.OBSIDIAN_VAULT_PATH;
  try {
    const root = mkdtempSync(join(tmpdir(), 'skills-config-default-vault-'));
    const paths = resolvePaths({
      repoRoot: join(root, 'project'),
      harnessRoot: join(root, 'claude-harness'),
      platformRoot: join(root, 'platform'),
    });

    assert.equal(paths.vaultPath, join(homedir(), 'Documents', 'Product Ideas'));
  } finally {
    if (previousVaultPath === undefined) {
      delete process.env.OBSIDIAN_VAULT_PATH;
    } else {
      process.env.OBSIDIAN_VAULT_PATH = previousVaultPath;
    }
  }
});

test('resolvePaths lets skipEmbeddings override enabled embeddings env', () => {
  const previousEnableEmbeddings = process.env.AGENT_PLATFORM_ENABLE_EMBEDDINGS;
  process.env.AGENT_PLATFORM_ENABLE_EMBEDDINGS = '1';
  try {
    const root = mkdtempSync(join(tmpdir(), 'skills-config-skip-embeddings-'));
    const paths = resolvePaths({
      repoRoot: join(root, 'project'),
      harnessRoot: join(root, 'claude-harness'),
      platformRoot: join(root, 'platform'),
      vaultPath: join(root, 'vault'),
      skipEmbeddings: true,
    });

    assert.equal(paths.enableEmbeddings, false);
  } finally {
    if (previousEnableEmbeddings === undefined) {
      delete process.env.AGENT_PLATFORM_ENABLE_EMBEDDINGS;
    } else {
      process.env.AGENT_PLATFORM_ENABLE_EMBEDDINGS = previousEnableEmbeddings;
    }
  }
});

test('resolvePaths selects the Codex user skill root for Codex runtime', () => {
  const root = mkdtempSync(join(tmpdir(), 'skills-config-codex-'));
  const repoRoot = join(root, 'project');
  const harnessRoot = join(root, 'claude-harness');
  const vaultPath = join(root, 'vault');
  const platformRoot = join(root, 'platform');

  const paths = resolvePaths({
    repoRoot,
    harnessRoot,
    vaultPath,
    platformRoot,
    runtime: 'codex',
  });

  assert.equal(paths.skillRoots.includes(join(homedir(), '.codex', 'skills')), true);
  assert.equal(paths.skillRoots.includes(join(homedir(), '.claude', 'skills')), false);
  assert.equal(paths.skillRoots.includes(join(harnessRoot, 'skills')), false);
  assert.equal(paths.skillRoots.includes(join(repoRoot, '.claude', 'skills')), false);
  assert.equal(paths.skillRoots.includes(join(repoRoot, '.codex', 'repo-skills')), true);
});

test('resolvePaths keeps Claude roots when Claude runtime is explicit', () => {
  const root = mkdtempSync(join(tmpdir(), 'skills-config-claude-'));
  const repoRoot = join(root, 'project');
  const harnessRoot = join(root, 'claude-harness');
  const vaultPath = join(root, 'vault');
  const platformRoot = join(root, 'platform');

  const paths = resolvePaths({
    repoRoot,
    harnessRoot,
    vaultPath,
    platformRoot,
    runtime: 'claude',
  });

  assert.equal(paths.runtime, 'claude');
  assert.equal(paths.skillRoots.includes(join(harnessRoot, 'skills')), true);
  assert.equal(paths.skillRoots.includes(join(repoRoot, '.claude', 'skills')), true);
  assert.equal(paths.skillRoots.includes(join(homedir(), '.claude', 'skills')), true);
  assert.equal(paths.skillRoots.includes(join(homedir(), '.codex', 'skills')), false);
});

test('resolvePaths honors SKILLS_INDEX_RUNTIME=claude env', () => {
  const previousRuntime = process.env.SKILLS_INDEX_RUNTIME;
  process.env.SKILLS_INDEX_RUNTIME = 'claude';
  try {
    const root = mkdtempSync(join(tmpdir(), 'skills-config-claude-env-'));
    const repoRoot = join(root, 'project');
    const harnessRoot = join(root, 'claude-harness');
    const vaultPath = join(root, 'vault');
    const platformRoot = join(root, 'platform');

    const paths = resolvePaths({
      repoRoot,
      harnessRoot,
      vaultPath,
      platformRoot,
    });

    assert.equal(paths.runtime, 'claude');
    assert.equal(paths.skillRoots.includes(join(harnessRoot, 'skills')), true);
    assert.equal(paths.skillRoots.includes(join(repoRoot, '.claude', 'skills')), true);
    assert.equal(paths.skillRoots.includes(join(homedir(), '.claude', 'skills')), true);
    assert.equal(paths.skillRoots.includes(join(homedir(), '.codex', 'skills')), false);
  } finally {
    if (previousRuntime === undefined) {
      delete process.env.SKILLS_INDEX_RUNTIME;
    } else {
      process.env.SKILLS_INDEX_RUNTIME = previousRuntime;
    }
  }
});

test('resolvePaths appends enabled external skill roots from manifest', () => {
  const root = mkdtempSync(join(tmpdir(), 'skills-config-manifest-'));
  const repoRoot = join(root, 'project');
  const harnessRoot = join(root, 'claude-harness');
  const vaultPath = join(root, 'vault');
  const platformRoot = join(root, 'platform');
  const externalRoot = join(root, 'external', 'antigravity', 'main', 'repo', 'skills');
  const manifestPath = join(platformRoot, 'external-sources.json');

  mkdirSync(join(manifestPath, '..'), { recursive: true });
  writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        sources: [
          {
            name: 'antigravity-awesome-skills',
            repo_url: 'https://github.com/sickn33/antigravity-awesome-skills.git',
            ref: 'main',
            enabled: true,
            trust_level: 'external',
            skill_root: externalRoot,
          },
        ],
      },
      null,
      2,
    ),
  );

  const paths = resolvePaths({
    repoRoot,
    harnessRoot,
    vaultPath,
    platformRoot,
  });

  assert.equal(paths.externalSources.length, 1);
  assert.equal(paths.externalSkillRoots[0], externalRoot);
  assert.equal(paths.skillRoots.at(-1), externalRoot);
  assert.equal(paths.routingRegistryPath, join(vaultPath, '_standards', 'agent-platform', 'skill-routing-registry.json'));
  assert.equal(paths.watchRoots.includes(paths.routingRegistryPath), true);
});
