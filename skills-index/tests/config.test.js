import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolvePaths } from '../src/config.js';

test('resolvePaths includes project and harness skill roots by default', () => {
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
  assert.match(paths.skillRoots.join('\n'), new RegExp(`${repoRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\.claude/skills`));
  assert.match(paths.skillRoots.join('\n'), new RegExp(`${repoRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\.codex/repo-skills`));
  assert.match(paths.skillRoots.join('\n'), new RegExp(`${harnessRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/skills`));
});
