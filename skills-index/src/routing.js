import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const DEFAULT_REVIEW_STATUS_BY_SCOPE = {
  repo: 'reviewed',
  claude: 'reviewed',
  harness: 'reviewed',
  user: 'reviewed',
  external: 'candidate',
  global: 'candidate',
};

const DEFAULT_TIER_BY_SCOPE = {
  repo: 'primary',
  claude: 'backup',
  harness: 'backup',
  user: 'backup',
  external: 'advisory',
  global: 'advisory',
};

const DEFAULT_REQUIRED_SECTIONS = ['overview', 'workflow'];
const DEFAULT_UNSAFE_HELPER_PATTERNS = [
  'curl\\s+[^\\n|]+\\|\\s*(sh|bash)',
  'rm\\s+-rf\\b',
  'sudo\\s+',
  'chmod\\s+777\\b',
];
const DEFAULT_TASK_TYPES = ['planning', 'implementation', 'review', 'verification'];

function readJson(filePath, fallback) {
  if (!existsSync(filePath)) {
    return fallback;
  }
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeStringArray(values, { lower = false } = {}) {
  const input = Array.isArray(values) ? values : values ? [values] : [];
  return uniq(
    input
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .map((value) => (lower ? value.toLowerCase() : value)),
  );
}

function normalizeBundleRule(rule, index) {
  return {
    key: String(rule.key || `bundle-${index + 1}`),
    label: String(rule.label || rule.key || `bundle-${index + 1}`),
    repo_match: normalizeStringArray(rule.repo_match || rule.repos || []),
    stack_tags: normalizeStringArray(rule.stack_tags || rule.stack_key || [], { lower: true }),
    task_types: normalizeStringArray(rule.task_types || [], { lower: true }),
    priority: Number(rule.priority || 0),
  };
}

function normalizeSkillOverride(override, index) {
  return {
    key: String(override.key || override.skill_id || `skill-override-${index + 1}`),
    skill_id: String(override.skill_id || ''),
    review_status: override.review_status ? String(override.review_status) : null,
    tier_default: override.tier_default ? String(override.tier_default) : null,
    capability_keys: normalizeStringArray(override.capability_keys || [], { lower: true }),
    bundle_keys: normalizeStringArray(override.bundle_keys || []),
    workflow_tags: normalizeStringArray(override.workflow_tags || [], { lower: true }),
    stack_tags: normalizeStringArray(override.stack_tags || [], { lower: true }),
    notes: String(override.notes || ''),
  };
}

function normalizeChampionTest(entry, index) {
  return {
    key: String(entry.key || entry.capability_key || `champion-test-${index + 1}`),
    bundle_key: entry.bundle_key ? String(entry.bundle_key) : null,
    capability_key: entry.capability_key ? String(entry.capability_key).toLowerCase() : null,
    champion: entry.champion ? String(entry.champion) : null,
    challengers: normalizeStringArray(entry.challengers || []),
    evaluation_suite: entry.evaluation_suite ? String(entry.evaluation_suite) : null,
    task_types: normalizeStringArray(entry.task_types || [], { lower: true }),
  };
}

function normalizeEvaluationSuite(entry, index) {
  return {
    key: String(entry.key || entry.capability_key || `evaluation-suite-${index + 1}`),
    capability_key: entry.capability_key ? String(entry.capability_key).toLowerCase() : null,
    task_types: normalizeStringArray(entry.task_types || [], { lower: true }),
    shadow_keywords: normalizeStringArray(entry.shadow_keywords || [], { lower: true }),
    cases: (Array.isArray(entry.cases) ? entry.cases : [])
      .map((item) => ({
        prompt: String(item.prompt || '').trim(),
        expected_any: normalizeStringArray(item.expected_any || item.skills || []),
        notes: String(item.notes || ''),
      }))
      .filter((item) => item.prompt),
  };
}

export function loadRoutingRegistry(paths) {
  const raw = readJson(paths.routingRegistryPath, {});
  const defaults = raw.defaults || {};

  return {
    file_path: paths.routingRegistryPath,
    version: Number(raw.version || 1),
    defaults: {
      review_status_by_scope: {
        ...DEFAULT_REVIEW_STATUS_BY_SCOPE,
        ...(defaults.review_status_by_scope || {}),
      },
      tier_by_scope: {
        ...DEFAULT_TIER_BY_SCOPE,
        ...(defaults.tier_by_scope || {}),
      },
      required_sections: normalizeStringArray(
        defaults.required_sections || DEFAULT_REQUIRED_SECTIONS,
        { lower: true },
      ),
      unsafe_helper_patterns: normalizeStringArray(
        defaults.unsafe_helper_patterns || DEFAULT_UNSAFE_HELPER_PATTERNS,
      ),
      shadow_limit: Number(defaults.shadow_limit || 15),
      benchmark_limit: Number(defaults.benchmark_limit || 12),
      benchmark_top_k: Number(defaults.benchmark_top_k || 5),
    },
    bundle_rules: (Array.isArray(raw.bundle_rules) ? raw.bundle_rules : []).map(normalizeBundleRule),
    skill_overrides: (Array.isArray(raw.skill_overrides) ? raw.skill_overrides : [])
      .map(normalizeSkillOverride)
      .filter((entry) => entry.skill_id),
    champion_tests: (Array.isArray(raw.champion_tests) ? raw.champion_tests : [])
      .map(normalizeChampionTest)
      .filter((entry) => entry.capability_key && entry.champion),
    evaluation_suites: (Array.isArray(raw.evaluation_suites) ? raw.evaluation_suites : [])
      .map(normalizeEvaluationSuite)
      .filter((entry) => entry.cases.length > 0),
  };
}

function addTag(tags, value) {
  if (value) {
    tags.add(value);
  }
}

function inferStackKey(tags) {
  if (tags.has('nextjs') && tags.has('postgres')) {
    return 'nextjs-postgres';
  }
  if (tags.has('react') && tags.has('postgres') && tags.has('node')) {
    return 'node-react-postgres';
  }
  if (tags.has('express') && tags.has('postgres')) {
    return 'node-express-postgres';
  }
  if (tags.has('react') && tags.has('node')) {
    return 'node-react';
  }
  if (tags.has('express') && tags.has('node')) {
    return 'node-express';
  }
  if (tags.has('node')) {
    return 'node';
  }
  if (tags.has('python')) {
    return 'python';
  }
  return 'generic';
}

export function detectRepoStack(paths, repoRoot = null) {
  const resolvedRepoRoot = resolve(repoRoot || paths.repoRoot);
  const stackProfilePath = join(resolvedRepoRoot, '.codex', 'enterprise-state', 'stack-profile.json');
  const packagePath = join(resolvedRepoRoot, 'package.json');
  const stackProfile = readJson(stackProfilePath, {});
  const packageJson = readJson(packagePath, {});
  const dependencies = {
    ...(packageJson.dependencies || {}),
    ...(packageJson.devDependencies || {}),
  };

  const tags = new Set();
  const extensions = Array.isArray(stackProfile.conventions?.file_extensions)
    ? stackProfile.conventions.file_extensions
    : [];

  if (extensions.includes('.js') || extensions.includes('.jsx')) {
    addTag(tags, 'javascript');
    addTag(tags, 'node');
  }
  if (extensions.includes('.ts') || extensions.includes('.tsx')) {
    addTag(tags, 'typescript');
    addTag(tags, 'node');
  }
  if (extensions.includes('.sql')) {
    addTag(tags, 'sql');
  }
  if (extensions.includes('.py')) {
    addTag(tags, 'python');
  }

  if (dependencies.react) {
    addTag(tags, 'react');
    addTag(tags, 'node');
  }
  if (dependencies.next) {
    addTag(tags, 'nextjs');
    addTag(tags, 'react');
    addTag(tags, 'node');
  }
  if (dependencies.express) {
    addTag(tags, 'express');
    addTag(tags, 'node');
  }
  if (dependencies.pg || dependencies.postgres) {
    addTag(tags, 'postgres');
  }
  if (dependencies.mysql || dependencies.mysql2) {
    addTag(tags, 'mysql');
  }
  if (dependencies.jest || stackProfile.conventions?.test_framework?.toLowerCase().includes('jest')) {
    addTag(tags, 'jest');
  }
  if (dependencies.playwright || dependencies['@playwright/test']) {
    addTag(tags, 'playwright');
  }

  if (stackProfile.structure?.source_dirs?.frontend) {
    addTag(tags, 'frontend');
  }
  if (stackProfile.structure?.source_dirs?.backend) {
    addTag(tags, 'backend');
  }

  if (!tags.size && packageJson.type === 'module') {
    addTag(tags, 'node');
    addTag(tags, 'javascript');
  }

  const stackKey = inferStackKey(tags);
  return {
    repo_root: resolvedRepoRoot,
    key: stackKey,
    tags: [...tags].sort(),
    source: existsSync(stackProfilePath)
      ? 'stack-profile'
      : existsSync(packagePath)
        ? 'package-json'
        : 'heuristic',
    stack_profile_path: existsSync(stackProfilePath) ? stackProfilePath : null,
    package_path: existsSync(packagePath) ? packagePath : null,
  };
}

function ruleMatchesTaskType(rule, taskType) {
  return !rule.task_types.length || rule.task_types.includes(String(taskType || '').toLowerCase());
}

function ruleMatchesRepo(rule, repoRoot) {
  if (!rule.repo_match.length) {
    return false;
  }
  return rule.repo_match.some((candidate) => {
    if (!candidate) {
      return false;
    }
    if (candidate === '*') {
      return true;
    }
    if (candidate.startsWith('/')) {
      return resolve(candidate) === repoRoot;
    }
    return basename(repoRoot) === candidate || repoRoot.includes(candidate);
  });
}

function ruleMatchesStack(rule, stackTags) {
  if (!rule.stack_tags.length) {
    return false;
  }
  return rule.stack_tags.every((tag) => stackTags.includes(tag));
}

function sortRules(left, right) {
  return right.priority - left.priority || left.key.localeCompare(right.key);
}

export function resolveBundleContext(registry, { repoRoot, taskType = 'implementation', stack }) {
  const resolvedRepoRoot = resolve(repoRoot);
  const normalizedTaskType = String(taskType || 'implementation').toLowerCase();
  const stackTags = stack?.tags || [];

  const repoRule =
    [...registry.bundle_rules]
      .filter((rule) => ruleMatchesRepo(rule, resolvedRepoRoot) && ruleMatchesTaskType(rule, normalizedTaskType))
      .sort(sortRules)[0] || null;
  const stackRule =
    [...registry.bundle_rules]
      .filter(
        (rule) =>
          !rule.repo_match.length &&
          ruleMatchesStack(rule, stackTags) &&
          ruleMatchesTaskType(rule, normalizedTaskType),
      )
      .sort(sortRules)[0] || null;
  const globalRule =
    [...registry.bundle_rules]
      .filter(
        (rule) =>
          !rule.repo_match.length &&
          !rule.stack_tags.length &&
          ruleMatchesTaskType(rule, normalizedTaskType),
      )
      .sort(sortRules)[0] || {
      key: 'global-reviewed-fallback',
      label: 'Global Reviewed Fallback',
      repo_match: [],
      stack_tags: [],
      task_types: [],
      priority: -1,
      synthesized: true,
    };

  const chain = [
    repoRule || {
      key: `repo-${basename(resolvedRepoRoot)}`,
      label: `Repo ${basename(resolvedRepoRoot)}`,
      repo_match: [resolvedRepoRoot],
      stack_tags: [],
      task_types: [normalizedTaskType],
      priority: -2,
      synthesized: true,
    },
    stackRule ||
      (stack?.key && stack.key !== 'generic'
        ? {
            key: `stack-${stack.key}`,
            label: `Stack ${stack.key}`,
            repo_match: [],
            stack_tags: [stack.key],
            task_types: [normalizedTaskType],
            priority: -3,
            synthesized: true,
          }
        : null),
    globalRule,
  ].filter(Boolean);

  const uniqueChain = [];
  const seen = new Set();
  for (const entry of chain) {
    if (seen.has(entry.key)) {
      continue;
    }
    seen.add(entry.key);
    uniqueChain.push(entry);
  }

  return {
    repo_root: resolvedRepoRoot,
    task_type: normalizedTaskType,
    stack,
    resolved_bundle: uniqueChain[0] || globalRule,
    bundle_chain: uniqueChain,
    bundle_keys: uniqueChain.map((entry) => entry.key),
  };
}

function findSkillOverride(registry, skillId, bundleKeys) {
  const candidates = registry.skill_overrides.filter((entry) => entry.skill_id === skillId);
  return (
    candidates.find((entry) => !entry.bundle_keys.length || entry.bundle_keys.some((key) => bundleKeys.includes(key))) ||
    candidates[0] ||
    null
  );
}

function matchesWorkflowTags(workflowTags, taskType) {
  return !workflowTags.length || workflowTags.includes(String(taskType || '').toLowerCase());
}

function matchesStackTags(stackTags, stack) {
  if (!stackTags.length || stackTags.includes('agnostic') || stackTags.includes('global')) {
    return true;
  }
  return stackTags.some((tag) => stack.tags.includes(tag) || stack.key === tag);
}

function championTestMatches(test, bundleKeys, capabilityKeys, taskType) {
  return (
    (!test.bundle_key || bundleKeys.includes(test.bundle_key)) &&
    (!test.task_types.length || test.task_types.includes(String(taskType || '').toLowerCase())) &&
    (!test.capability_key || capabilityKeys.includes(test.capability_key))
  );
}

export function resolveSkillRouting(skill, registry, bundleContext, taskType = 'implementation') {
  const override = findSkillOverride(registry, skill.id, bundleContext.bundle_keys);
  const reviewStatus =
    override?.review_status ||
    registry.defaults.review_status_by_scope[skill.precedenceScope] ||
    'candidate';
  let effectiveTier =
    override?.tier_default || registry.defaults.tier_by_scope[skill.precedenceScope] || 'advisory';
  const capabilityKeys = override?.capability_keys || [];
  const bundleKeys = override?.bundle_keys || [];
  const workflowTags = override?.workflow_tags || [];
  const stackTags = override?.stack_tags || [];
  const bundleMatch = !bundleKeys.length || bundleKeys.some((key) => bundleContext.bundle_keys.includes(key));
  const workflowMatch = matchesWorkflowTags(workflowTags, taskType);
  const stackMatch = matchesStackTags(stackTags, bundleContext.stack || { key: 'generic', tags: [] });
  const matchingChampionTests = registry.champion_tests.filter((entry) =>
    championTestMatches(entry, bundleContext.bundle_keys, capabilityKeys, taskType),
  );

  let championState = 'none';
  if (matchingChampionTests.some((entry) => entry.champion === skill.id)) {
    championState = 'champion';
  } else if (matchingChampionTests.some((entry) => entry.challengers.includes(skill.id))) {
    championState = 'challenger';
  }

  if (reviewStatus !== 'reviewed' && effectiveTier !== 'advisory') {
    effectiveTier = 'advisory';
  }
  if (championState === 'challenger' && effectiveTier === 'primary') {
    effectiveTier = 'backup';
  }
  if ((!bundleMatch || !workflowMatch || !stackMatch) && effectiveTier !== 'advisory') {
    effectiveTier = 'advisory';
  }

  return {
    review_status: reviewStatus,
    effective_tier: effectiveTier,
    capability_keys: capabilityKeys,
    bundle_keys: bundleKeys,
    workflow_tags: workflowTags,
    stack_tags: stackTags,
    bundle_match: bundleMatch,
    workflow_match: workflowMatch,
    stack_match: stackMatch,
    champion_state: championState,
    champion_tests: matchingChampionTests.map((entry) => ({
      key: entry.key,
      bundle_key: entry.bundle_key,
      capability_key: entry.capability_key,
      evaluation_suite: entry.evaluation_suite,
    })),
  };
}

export function summarizeChampionTests(registry, bundleContext, taskType = 'implementation') {
  return registry.champion_tests.filter((entry) =>
    championTestMatches(entry, bundleContext.bundle_keys, [entry.capability_key], taskType),
  );
}

export function listDefaultTaskTypes() {
  return [...DEFAULT_TASK_TYPES];
}
