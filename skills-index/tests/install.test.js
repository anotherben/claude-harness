import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(packageRoot);
const hasFullSourceCheckout = existsSync(join(repoRoot, 'install.sh')) && existsSync(join(repoRoot, 'skills'));

function writeStub(binDir, name) {
  writeFileSync(join(binDir, name), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
}

function collectSkillFiles(root) {
  const files = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(path);
      } else if (entry.name === 'SKILL.md') {
        files.push(path);
      }
    }
  }
  return files;
}

test('install.sh mirrors full skills to Codex-compatible homes', { skip: hasFullSourceCheckout ? false : 'requires full source checkout' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-install-'));
  try {
    const home = join(root, 'home');
    const fakebin = join(root, 'bin');
    mkdirSync(join(home, 'Library', 'LaunchAgents'), { recursive: true });
    mkdirSync(fakebin, { recursive: true });
    for (const name of ['codex', 'launchctl', 'npm']) {
      writeStub(fakebin, name);
    }

    const result = spawnSync('bash', ['install.sh', '--global'], {
      cwd: repoRoot,
      env: {
        ...process.env,
        HOME: home,
        CLAUDE_HARNESS_HOME: join(home, '.claude-harness'),
        PATH: `${fakebin}:${process.env.PATH}`,
      },
      encoding: 'utf8',
      timeout: 30000,
    });

    assert.equal(result.status, 0, result.stdout + result.stderr);

    const skillRoots = [
      join(home, '.claude', 'skills'),
      join(home, '.codex', 'skills'),
      join(home, '.agents', 'skills'),
      join(home, '.agent-platform', 'skills'),
      join(home, '.continue', 'skills'),
      join(home, '.cursor', 'skills-cursor'),
    ];
    for (const skillRoot of skillRoots) {
      assert.equal(existsSync(join(skillRoot, 'harness-update', 'SKILL.md')), true);
      assert.equal(existsSync(join(skillRoot, 'vault-init', 'SKILL.md')), true);
    }

    const shimPattern = /L[i]ve Shim|lightweight live tr[i]gger|Load the canonical skill thr[o]ugh/;
    const shimHits = skillRoots.flatMap((skillRoot) =>
      collectSkillFiles(skillRoot).filter((file) =>
        shimPattern.test(readFileSync(file, 'utf8')),
      ),
    );
    assert.deepEqual(shimHits, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
