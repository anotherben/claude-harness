import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildToolHandlers } from '../src/server.js';
import { loadPlatform } from '../src/platform.js';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function writeFile(filePath, contents) {
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, contents);
}

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'skills-server-'));
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
direct_read_max_lines: 50
tight_read_limit_max: 80
---

# Cortex First
`,
  );

  writeFile(
    join(vault, '_standards', 'agent-platform', '03-skill-platform.md'),
    `---
id: skill-platform
type: agent_policy
default_sections: [Overview, Workflow]
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
---

# Adapters
`,
  );

  return { vault, platformRoot, repoRoot, skillRoot };
}

function parseResult(result) {
  return JSON.parse(result.content[0].text);
}

test('server exposes indexed tool surface', async () => {
  const fixture = makeFixture();
  const options = {
    vaultPath: fixture.vault,
    platformRoot: fixture.platformRoot,
    repoRoot: fixture.repoRoot,
    skillRoots: [fixture.skillRoot],
    skipEmbeddings: true,
  };

  const handlers = buildToolHandlers({
    platformLoader: async () => loadPlatform(options),
  });

  const catalog = parseResult(await handlers.skill_catalog({ limit: 10 }));
  const search = parseResult(await handlers.skill_search({ query: 'sql migration', limit: 5 }));
  const outline = parseResult(await handlers.skill_outline({ skill_id: 'sql-guard' }));
  const section = parseResult(await handlers.skill_read_section({ skill_id: 'sql-guard', section: 'workflow' }));
  const sections = parseResult(
    await handlers.skill_read_sections({
      requests: [{ skill_id: 'sql-guard', sections: ['when-to-use', 'workflow'] }],
    }),
  );
  const status = parseResult(await handlers.skill_status({}));
  const telemetry = parseResult(await handlers.skill_telemetry({}));
  const policyBundle = parseResult(await handlers.get_policy_bundle({ agent: 'claude', repo: 'helpdesk' }));

  assert.equal(catalog.skills[0].id, 'sql-guard');
  assert.equal(search.matches[0].id, 'sql-guard');
  assert.equal(outline.skill.id, 'sql-guard');
  assert.equal(section.section.slug, 'workflow');
  assert.equal(sections.bundle[0].sections.length, 2);
  assert.equal(status.counts.skills, 1);
  assert.equal(typeof telemetry.total_queries, 'number');
  assert.equal(policyBundle.agent, 'claude');
});

test('cli commands return indexed platform results', () => {
  const fixture = makeFixture();
  const env = {
    ...process.env,
    OBSIDIAN_VAULT_PATH: fixture.vault,
    AGENT_PLATFORM_ROOT: fixture.platformRoot,
    CODEX_PROJECT_ROOT: fixture.repoRoot,
    AGENT_PLATFORM_SKIP_EMBEDDINGS: '1',
  };

  const compile = spawnSync('node', ['src/cli.js', 'compile'], {
    cwd: packageRoot,
    env,
    encoding: 'utf8',
  });
  const search = spawnSync('node', ['src/cli.js', 'search', '--text', 'sql migration'], {
    cwd: packageRoot,
    env,
    encoding: 'utf8',
  });
  const status = spawnSync('node', ['src/cli.js', 'status'], {
    cwd: packageRoot,
    env,
    encoding: 'utf8',
  });

  assert.equal(compile.status, 0);
  assert.equal(search.status, 0);
  assert.equal(status.status, 0);
  assert.match(search.stdout, /sql-guard/);
  assert.match(status.stdout, /"counts"/);
});
