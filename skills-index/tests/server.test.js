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
  const skillRoot = join(repoRoot, '.codex', 'repo-skills');
  const externalSkillRoot = join(root, 'external', 'antigravity', 'main', 'repo', 'skills');

  writeFile(
    join(repoRoot, 'package.json'),
    JSON.stringify(
      {
        name: 'skills-server-fixture',
        dependencies: {
          react: '^18.0.0',
          pg: '^8.0.0',
        },
        devDependencies: {
          jest: '^29.0.0',
        },
      },
      null,
      2,
    ),
  );

  writeFile(
    join(repoRoot, '.codex', 'enterprise-state', 'stack-profile.json'),
    JSON.stringify(
      {
        conventions: {
          file_extensions: ['.js', '.ts', '.sql'],
          test_framework: 'Jest',
        },
        structure: {
          source_dirs: {
            frontend: 'apps/web/src',
            backend: 'apps/api/src',
          },
        },
      },
      null,
      2,
    ),
  );

  writeFile(
    join(skillRoot, 'repo-skill-ingest', 'SKILL.md'),
    `---
name: repo-skill-ingest
description: Mirror and install skills from GitHub repositories for local use
---

# Repo Skill Ingest
## Overview
Use when mirroring or installing skills from GitHub repositories.

## Workflow
Mirror the repo, validate the skills, and index them locally.
`,
  );

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
    join(externalSkillRoot, 'skill-installer', 'SKILL.md'),
    `---
name: skill-installer
description: Install skills from a GitHub repo
---

# Skill Installer
## Overview
Install external skills from GitHub.

## Workflow
Mirror skills from GitHub into a local skills directory.
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

  writeFile(
    join(vault, '_standards', 'agent-platform', '06-task-bootstrap.md'),
    `---
id: task-bootstrap
type: agent_policy
search_limit: 6
max_recommendations: 3
auto_read_limit: 2
auto_read_sections: [Overview, Workflow, Checklist]
precedence_order: [repo, claude, harness, user, external, global]
advisory_only_scopes: [external]
startup_consult_required: true
---

# Task Bootstrap
`,
  );

  writeFile(
    join(vault, '_standards', 'agent-platform', 'skill-routing-registry.json'),
    JSON.stringify(
      {
        version: 1,
        defaults: {
          shadow_limit: 6,
        },
        bundle_rules: [
          {
            key: 'repo-helpdesk',
            repo_match: ['repo'],
            task_types: ['implementation'],
            priority: 20,
          },
          {
            key: 'stack-node-react-postgres',
            stack_tags: ['node', 'react', 'postgres'],
            task_types: ['implementation'],
            priority: 10,
          },
          {
            key: 'global-reviewed-fallback',
          },
        ],
        skill_overrides: [
          {
            skill_id: 'repo-skill-ingest',
            review_status: 'reviewed',
            tier_default: 'primary',
            capability_keys: ['skill-source-ingestion'],
            workflow_tags: ['implementation'],
            stack_tags: ['agnostic'],
          },
          {
            skill_id: 'skill-installer',
            review_status: 'candidate',
            tier_default: 'advisory',
            capability_keys: ['skill-source-ingestion'],
            workflow_tags: ['implementation'],
            stack_tags: ['agnostic'],
          },
        ],
        champion_tests: [
          {
            key: 'skill-source-ingestion',
            bundle_key: 'repo-helpdesk',
            capability_key: 'skill-source-ingestion',
            champion: 'repo-skill-ingest',
            challengers: ['skill-installer'],
            evaluation_suite: 'skill-source-ingestion',
            task_types: ['implementation'],
          },
        ],
        evaluation_suites: [
          {
            key: 'skill-source-ingestion',
            capability_key: 'skill-source-ingestion',
            task_types: ['implementation'],
            shadow_keywords: ['skill', 'github', 'repo', 'index'],
            cases: [
              {
                prompt: 'install skills from github repo and index them locally',
                expected_any: ['repo-skill-ingest', 'skill-installer'],
              },
              {
                prompt: 'mirror a skill repo and choose usable skills',
                expected_any: ['repo-skill-ingest', 'skill-installer'],
              },
            ],
          },
        ],
      },
      null,
      2,
    ),
  );

  return { vault, platformRoot, repoRoot, skillRoot, externalSkillRoot };
}

function makeHelpdeskEnterpriseRoutingFixture() {
  const root = mkdtempSync(join(tmpdir(), 'skills-helpdesk-routing-'));
  const vault = join(root, 'vault');
  const platformRoot = join(root, 'platform');
  const repoRoot = join(root, 'helpdesk-repo');
  const repoSkillRoot = join(repoRoot, '.codex', 'repo-skills');
  const userSkillRoot = join(root, 'user-skills');

  writeFile(
    join(repoRoot, 'package.json'),
    JSON.stringify(
      {
        name: 'helpdesk-routing-fixture',
        dependencies: {
          react: '^18.0.0',
          pg: '^8.0.0',
        },
      },
      null,
      2,
    ),
  );

  writeFile(
    join(repoRoot, '.codex', 'enterprise-state', 'stack-profile.json'),
    JSON.stringify(
      {
        conventions: {
          file_extensions: ['.js', '.ts'],
          test_framework: 'Jest',
        },
        structure: {
          source_dirs: {
            frontend: 'apps/web/src',
            backend: 'apps/api/src',
          },
        },
      },
      null,
      2,
    ),
  );

  writeFile(
    join(repoSkillRoot, 'helpdesk-enterprise', 'SKILL.md'),
    `---
name: helpdesk-enterprise
description: Helpdesk enterprise entrypoint
---

# Helpdesk Enterprise
## Workflow
Use the Helpdesk enterprise pipeline.
`,
  );

  writeFile(
    join(repoSkillRoot, 'helpdesk-enterprise-review', 'SKILL.md'),
    `---
name: helpdesk-enterprise-review
description: Helpdesk enterprise review gate
---

# Helpdesk Enterprise Review
## Workflow
Run but-why before review and enforce the repo gate.
`,
  );

  writeFile(
    join(repoSkillRoot, 'helpdesk-enterprise-discover', 'SKILL.md'),
    `---
name: helpdesk-enterprise-discover
description: Helpdesk repo discovery entrypoint
---

# Helpdesk Enterprise Discover
## Workflow
Refresh the repo-local profile before enterprise work.
`,
  );

  writeFile(
    join(userSkillRoot, 'enterprise', 'SKILL.md'),
    `---
name: enterprise
description: Generic enterprise workflow
---

# Enterprise
## Workflow
Run the shared enterprise workflow.
`,
  );

  writeFile(
    join(userSkillRoot, 'enterprise-review', 'SKILL.md'),
    `---
name: enterprise-review
description: Generic enterprise review
---

# Enterprise Review
## Workflow
Run the shared enterprise review.
`,
  );

  writeFile(
    join(userSkillRoot, 'prompt-intelligence', 'SKILL.md'),
    `---
name: prompt-intelligence
description: Prompt intelligence session-start skill that loads learned behaviors before enterprise work
---

# Prompt Intelligence
## Workflow
Load prompt intelligence learned behaviors and shape the session before enterprise work.
`,
  );

  writeFile(
    join(userSkillRoot, 'but-why', 'SKILL.md'),
    `---
name: but-why
description: Review preflight and root-cause questioning
---

# But Why
## Workflow
Interrogate whether refactoring is still required before review.
`,
  );

  writeFile(
    join(userSkillRoot, 'harness-init', 'SKILL.md'),
    `---
name: harness-init
description: Project setup helper
---

# Harness Init
## Workflow
Install harness prerequisites.
`,
  );

  writeFile(
    join(userSkillRoot, 'vault-init', 'SKILL.md'),
    `---
name: vault-init
description: Vault setup helper
---

# Vault Init
## Workflow
Install vault prerequisites.
`,
  );

  writeFile(
    join(userSkillRoot, 'enterprise-dev', 'SKILL.md'),
    `---
name: enterprise-dev
description: Deprecated enterprise workflow
---

# Enterprise Dev
## Workflow
Deprecated.
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
  codex:
    enforcement_mode: guided
    supports_hooks: false
    supports_mcp: true
---

# Adapters
`,
  );

  writeFile(
    join(vault, '_standards', 'agent-platform', '06-task-bootstrap.md'),
    `---
id: task-bootstrap
type: agent_policy
search_limit: 6
max_recommendations: 3
auto_read_limit: 2
auto_read_sections: [Overview, Workflow]
precedence_order: [repo, claude, harness, user, external, global]
advisory_only_scopes: [external]
startup_consult_required: true
---

# Task Bootstrap
`,
  );

  writeFile(
    join(vault, '_standards', 'agent-platform', 'skill-routing-registry.json'),
    JSON.stringify(
      {
        version: 1,
        bundle_rules: [
          {
            key: 'repo-helpdesk',
            repo_match: [repoRoot, 'helpdesk'],
            task_types: ['planning', 'implementation', 'review', 'verification'],
            priority: 30,
          },
          {
            key: 'global-reviewed-fallback',
            task_types: ['planning', 'implementation', 'review', 'verification'],
            priority: 10,
          },
        ],
        skill_overrides: [
          {
            skill_id: 'enterprise',
            review_status: 'reviewed',
            tier_default: 'backup',
            capability_keys: ['enterprise-entry', 'enterprise-workflow'],
            workflow_tags: ['planning', 'implementation'],
            stack_tags: ['agnostic'],
          },
          {
            skill_id: 'enterprise-review',
            review_status: 'reviewed',
            tier_default: 'backup',
            capability_keys: ['enterprise-review-gate'],
            workflow_tags: ['review'],
            stack_tags: ['agnostic'],
          },
          {
            skill_id: 'helpdesk-enterprise',
            review_status: 'reviewed',
            tier_default: 'primary',
            capability_keys: ['enterprise-entry', 'enterprise-workflow'],
            bundle_keys: ['repo-helpdesk'],
            workflow_tags: ['planning', 'implementation'],
            stack_tags: ['agnostic'],
          },
          {
            skill_id: 'helpdesk-enterprise-review',
            review_status: 'reviewed',
            tier_default: 'primary',
            capability_keys: ['enterprise-review-gate', 'review-preflight'],
            bundle_keys: ['repo-helpdesk'],
            workflow_tags: ['review'],
            stack_tags: ['agnostic'],
          },
          {
            skill_id: 'helpdesk-enterprise-discover',
            review_status: 'reviewed',
            tier_default: 'backup',
            capability_keys: ['repo-discovery-anchor'],
            bundle_keys: ['repo-helpdesk'],
            workflow_tags: ['planning', 'implementation'],
            stack_tags: ['agnostic'],
          },
          {
            skill_id: 'prompt-intelligence',
            review_status: 'reviewed',
            tier_default: 'backup',
            capability_keys: ['session-behavior-bootstrap'],
            workflow_tags: ['planning', 'implementation', 'review', 'verification'],
            stack_tags: ['agnostic'],
          },
          {
            skill_id: 'but-why',
            review_status: 'reviewed',
            tier_default: 'backup',
            capability_keys: ['review-preflight', 'root-cause-questioning'],
            workflow_tags: ['planning', 'implementation', 'review'],
            stack_tags: ['agnostic'],
          },
          {
            skill_id: 'harness-init',
            review_status: 'reviewed',
            tier_default: 'advisory',
            capability_keys: ['setup-workflow'],
            workflow_tags: ['setup'],
            stack_tags: ['agnostic'],
          },
          {
            skill_id: 'vault-init',
            review_status: 'reviewed',
            tier_default: 'advisory',
            capability_keys: ['setup-workflow'],
            workflow_tags: ['setup'],
            stack_tags: ['agnostic'],
          },
          {
            skill_id: 'enterprise-dev',
            review_status: 'reviewed',
            tier_default: 'advisory',
            capability_keys: ['deprecated-enterprise-workflow'],
            workflow_tags: ['deprecated'],
            stack_tags: ['agnostic'],
          },
        ],
        champion_tests: [
          {
            key: 'enterprise-entry-helpdesk',
            bundle_key: 'repo-helpdesk',
            capability_key: 'enterprise-entry',
            champion: 'helpdesk-enterprise',
            challengers: ['enterprise'],
            evaluation_suite: 'enterprise-entry-routing',
            task_types: ['planning', 'implementation'],
          },
          {
            key: 'enterprise-review-helpdesk',
            bundle_key: 'repo-helpdesk',
            capability_key: 'enterprise-review-gate',
            champion: 'helpdesk-enterprise-review',
            challengers: ['enterprise-review'],
            evaluation_suite: 'enterprise-review-routing',
            task_types: ['review'],
          },
          {
            key: 'prompt-intelligence-helpdesk',
            bundle_key: 'repo-helpdesk',
            capability_key: 'session-behavior-bootstrap',
            champion: 'prompt-intelligence',
            challengers: ['helpdesk-enterprise', 'enterprise'],
            evaluation_suite: 'session-bootstrap-routing',
            task_types: ['planning', 'implementation'],
          },
          {
            key: 'review-preflight-helpdesk',
            bundle_key: 'repo-helpdesk',
            capability_key: 'review-preflight',
            champion: 'but-why',
            challengers: ['helpdesk-enterprise-review', 'enterprise-review'],
            evaluation_suite: 'review-preflight-routing',
            task_types: ['review'],
          },
        ],
        evaluation_suites: [
          {
            key: 'enterprise-entry-routing',
            capability_key: 'enterprise-entry',
            task_types: ['planning', 'implementation'],
            shadow_keywords: ['enterprise', 'helpdesk', 'microsoft', 'prompt-intelligence'],
            cases: [
              {
                prompt: 'start enterprise work in helpdesk and load prompt intelligence first',
                expected_any: ['helpdesk-enterprise', 'enterprise'],
              },
              {
                prompt: 'use the helpdesk enterprise workflow for a microsoft-standard implementation',
                expected_any: ['helpdesk-enterprise', 'enterprise'],
              },
            ],
          },
          {
            key: 'enterprise-review-routing',
            capability_key: 'enterprise-review-gate',
            task_types: ['review'],
            shadow_keywords: ['review', 'but-why', 'preflight', 'refactor'],
            cases: [
              {
                prompt: 'run the helpdesk enterprise review with a but-why preflight before code review',
                expected_any: ['helpdesk-enterprise-review', 'enterprise-review'],
              },
            ],
          },
          {
            key: 'session-bootstrap-routing',
            capability_key: 'session-behavior-bootstrap',
            task_types: ['planning', 'implementation'],
            shadow_keywords: ['prompt intelligence', 'learned behaviors', 'session start', 'enterprise work'],
            cases: [
              {
                prompt: 'load prompt intelligence learned behaviors before enterprise work',
                expected_any: ['prompt-intelligence', 'helpdesk-enterprise'],
              },
            ],
          },
          {
            key: 'review-preflight-routing',
            capability_key: 'review-preflight',
            task_types: ['review'],
            shadow_keywords: ['but why', 'refactor', 'preflight', 'before review'],
            cases: [
              {
                prompt: 'use but why to decide whether refactoring is still required before review',
                expected_any: ['but-why', 'helpdesk-enterprise-review'],
              },
            ],
          },
        ],
      },
      null,
      2,
    ),
  );

  return { vault, platformRoot, repoRoot, repoSkillRoot, userSkillRoot };
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
    externalSources: [
      {
        name: 'antigravity-awesome-skills',
        enabled: true,
        trust_level: 'external',
        skill_root: fixture.externalSkillRoot,
      },
    ],
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
  const bundleStatus = parseResult(
    await handlers.skill_bundle_status({
      repo: fixture.repoRoot,
      task_type: 'implementation',
    }),
  );
  const bootstrap = parseResult(
    await handlers.task_bootstrap({
      agent: 'claude',
      task_text: 'install skills from github and review bootstrap policy',
      repo: fixture.repoRoot,
      task_type: 'implementation',
      limit: 6,
    }),
  );
  const validation = parseResult(
    await handlers.skill_validate_candidates({
      repo: fixture.repoRoot,
      task_type: 'implementation',
      task_text: 'install skills from github and index them locally',
      limit: 5,
    }),
  );
  const evaluation = parseResult(
    await handlers.skill_evaluate_challengers({
      repo: fixture.repoRoot,
      task_type: 'implementation',
      capability_key: 'skill-source-ingestion',
      shadow_limit: 5,
    }),
  );

  assert.equal(catalog.skills.some((skill) => skill.id === 'sql-guard'), true);
  assert.equal(search.matches.some((skill) => skill.id === 'sql-guard'), true);
  assert.equal(outline.skill.id, 'sql-guard');
  assert.equal(section.section.slug, 'workflow');
  assert.equal(sections.bundle[0].sections.length, 2);
  assert.equal(status.counts.skills, 3);
  assert.equal(typeof telemetry.total_queries, 'number');
  assert.equal(policyBundle.agent, 'claude');
  assert.equal(policyBundle.policies.task_bootstrap.search_limit, 6);
  assert.equal(bundleStatus.bundle.key, 'repo-helpdesk');
  assert.equal(bootstrap.policy.startup_consult_required, true);
  assert.equal(bootstrap.recommendations.length > 0, true);
  assert.equal(bootstrap.bundle.key, 'repo-helpdesk');
  assert.equal(bootstrap.stack.key, 'node-react-postgres');
  assert.equal(bootstrap.primary[0].id, 'repo-skill-ingest');
  assert.equal(
    bootstrap.recommendations.some(
      (recommendation) =>
        recommendation.precedence_scope === 'external' && recommendation.advisory_only,
    ),
    true,
  );
  assert.equal(validation.validations.some((entry) => entry.id === 'skill-installer'), true);
  assert.equal(evaluation.evaluations[0].champion, 'repo-skill-ingest');
  assert.equal(evaluation.evaluations[0].challenger, 'skill-installer');
  assert.equal(
    bootstrap.auto_load.every((entry) => Array.isArray(entry.sections) && entry.sections.length > 0),
    true,
  );
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
  const bootstrap = spawnSync(
    'node',
    ['src/cli.js', 'bootstrap', '--agent', 'claude', '--repo', fixture.repoRoot, '--task', 'implementation', '--text', 'install skills from github'],
    {
      cwd: packageRoot,
      env,
      encoding: 'utf8',
    },
  );
  const bundleStatus = spawnSync(
    'node',
    ['src/cli.js', 'bundle-status', '--repo', fixture.repoRoot, '--task', 'implementation'],
    {
      cwd: packageRoot,
      env,
      encoding: 'utf8',
    },
  );
  const validate = spawnSync(
    'node',
    ['src/cli.js', 'validate', '--repo', fixture.repoRoot, '--task', 'implementation', '--text', 'install skills from github'],
    {
      cwd: packageRoot,
      env,
      encoding: 'utf8',
    },
  );
  const evaluate = spawnSync(
    'node',
    ['src/cli.js', 'evaluate', '--repo', fixture.repoRoot, '--task', 'implementation', '--capability-key', 'skill-source-ingestion'],
    {
      cwd: packageRoot,
      env,
      encoding: 'utf8',
    },
  );

  assert.equal(compile.status, 0);
  assert.equal(search.status, 0);
  assert.equal(status.status, 0);
  assert.equal(bootstrap.status, 0);
  assert.equal(bundleStatus.status, 0);
  assert.equal(validate.status, 0);
  assert.equal(evaluate.status, 0);
  assert.match(search.stdout, /sql-guard/);
  assert.match(status.stdout, /"counts"/);
  assert.match(bundleStatus.stdout, /"bundle"/);
  assert.match(bootstrap.stdout, /"recommendations"/);
  assert.match(validate.stdout, /"validations"/);
  assert.match(evaluate.stdout, /"evaluations"/);
});

test('server prefers helpdesk enterprise champions and demotes setup-only helpers', async () => {
  const fixture = makeHelpdeskEnterpriseRoutingFixture();
  const options = {
    vaultPath: fixture.vault,
    platformRoot: fixture.platformRoot,
    repoRoot: fixture.repoRoot,
    skillRoots: [fixture.repoSkillRoot, fixture.userSkillRoot],
    skipEmbeddings: true,
  };

  const handlers = buildToolHandlers({
    platformLoader: async () => loadPlatform(options),
  });

  const enterpriseBootstrap = parseResult(
    await handlers.task_bootstrap({
      agent: 'codex',
      task_text: 'start enterprise work in helpdesk and load prompt intelligence first',
      repo: fixture.repoRoot,
      task_type: 'planning',
      limit: 8,
    }),
  );
  const enterpriseMatch = parseResult(
    await handlers.match_skills({
      task_text: 'start enterprise work in helpdesk and load prompt intelligence first',
      limit: 8,
    }),
  );
  const reviewBootstrap = parseResult(
    await handlers.task_bootstrap({
      agent: 'codex',
      task_text: 'run the helpdesk enterprise review with a but-why preflight before code review',
      repo: fixture.repoRoot,
      task_type: 'review',
      limit: 8,
    }),
  );
  const promptBootstrap = parseResult(
    await handlers.task_bootstrap({
      agent: 'codex',
      task_text: 'load prompt intelligence learned behaviors before enterprise work',
      repo: fixture.repoRoot,
      task_type: 'planning',
      limit: 8,
    }),
  );
  const butWhyBootstrap = parseResult(
    await handlers.task_bootstrap({
      agent: 'codex',
      task_text: 'use but-why to decide whether refactoring is still required before review',
      repo: fixture.repoRoot,
      task_type: 'review',
      limit: 8,
    }),
  );
  const entryEvaluation = parseResult(
    await handlers.skill_evaluate_challengers({
      repo: fixture.repoRoot,
      task_type: 'planning',
      capability_key: 'enterprise-entry',
      shadow_limit: 4,
    }),
  );
  const reviewEvaluation = parseResult(
    await handlers.skill_evaluate_challengers({
      repo: fixture.repoRoot,
      task_type: 'review',
      capability_key: 'enterprise-review-gate',
      shadow_limit: 4,
    }),
  );
  const promptEvaluation = parseResult(
    await handlers.skill_evaluate_challengers({
      repo: fixture.repoRoot,
      task_type: 'planning',
      capability_key: 'session-behavior-bootstrap',
      shadow_limit: 4,
    }),
  );
  const preflightEvaluation = parseResult(
    await handlers.skill_evaluate_challengers({
      repo: fixture.repoRoot,
      task_type: 'review',
      capability_key: 'review-preflight',
      shadow_limit: 4,
    }),
  );

  assert.equal(enterpriseBootstrap.primary[0].id, 'helpdesk-enterprise');
  assert.equal(enterpriseBootstrap.primary[0].champion_state, 'champion');
  assert.equal(enterpriseMatch.matches[0].id, 'helpdesk-enterprise');
  assert.equal(enterpriseBootstrap.backup.some((skill) => skill.id === 'enterprise'), true);
  assert.equal(enterpriseBootstrap.recommendations.some((skill) => skill.id === 'prompt-intelligence'), true);
  assert.equal(
    enterpriseBootstrap.auto_load.some((skill) => skill.skill_id === 'prompt-intelligence'),
    true,
  );
  assert.equal(
    enterpriseBootstrap.backup.some((skill) => ['harness-init', 'vault-init', 'enterprise-dev'].includes(skill.id)),
    false,
  );

  assert.equal(reviewBootstrap.primary[0].id, 'helpdesk-enterprise-review');
  assert.equal(reviewBootstrap.primary[0].champion_state, 'champion');
  assert.equal(reviewBootstrap.backup.some((skill) => skill.id === 'enterprise-review'), true);

  assert.equal(promptBootstrap.recommendations.some((skill) => skill.id === 'prompt-intelligence'), true);
  assert.equal(
    promptBootstrap.recommendations.some(
      (skill) =>
        skill.id === 'prompt-intelligence' &&
        skill.capability_keys.includes('session-behavior-bootstrap') &&
        skill.champion_state === 'champion',
    ),
    true,
  );
  assert.equal(butWhyBootstrap.recommendations.some((skill) => skill.id === 'but-why'), true);
  assert.equal(
    butWhyBootstrap.recommendations.some(
      (skill) => skill.id === 'but-why' && skill.capability_keys.includes('review-preflight'),
    ),
    true,
  );

  assert.equal(entryEvaluation.evaluations[0].champion, 'helpdesk-enterprise');
  assert.equal(entryEvaluation.evaluations[0].challenger, 'enterprise');
  assert.equal(reviewEvaluation.evaluations[0].champion, 'helpdesk-enterprise-review');
  assert.equal(reviewEvaluation.evaluations[0].challenger, 'enterprise-review');
  assert.equal(promptEvaluation.evaluations[0].champion, 'prompt-intelligence');
  assert.equal(promptEvaluation.evaluations[0].challenger, 'helpdesk-enterprise');
  assert.equal(preflightEvaluation.evaluations[0].champion, 'but-why');
  assert.equal(preflightEvaluation.evaluations[0].challenger, 'helpdesk-enterprise-review');
});
