import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createEmbedder } from './embedder.js';
import { resolvePaths } from './config.js';
import { indexPlatform, latestSourceMtime } from './indexer.js';
import { normalizeSectionKey } from './markdown.js';
import {
  detectRepoStack,
  loadRoutingRegistry,
  resolveBundleContext,
  resolveSkillRouting,
  summarizeChampionTests,
} from './routing.js';
import { createStore } from './store.js';

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

function compiledArtifactsExist(paths) {
  return [
    join(paths.compiledRoot, 'skills-registry.json'),
    join(paths.compiledRoot, 'policies.json'),
    join(paths.compiledRoot, 'skill-hints.json'),
    join(paths.compiledRoot, 'skill-routing.json'),
  ].every((filePath) => existsSync(filePath));
}

function readCompiledArtifacts(paths) {
  const adapterDir = join(paths.compiledRoot, 'adapters');
  const routingArtifactPath = join(paths.compiledRoot, 'skill-routing.json');
  const routingArtifact = existsSync(routingArtifactPath) ? readJson(routingArtifactPath, null) : null;
  const adapters = existsSync(adapterDir)
    ? Object.fromEntries(
        readdirSync(adapterDir)
          .filter((name) => name.endsWith('.json'))
          .map((name) => [name.replace(/\.json$/i, ''), readJson(join(adapterDir, name), null)])
          .filter(([, value]) => value),
      )
    : {};
  return {
    generatedAt: readJson(join(paths.compiledRoot, 'policies.json'), {}).generated_at || null,
    skillsRegistry: readJson(join(paths.compiledRoot, 'skills-registry.json'), {
      generated_at: null,
      skill_roots: paths.skillRoots,
      skills: [],
    }),
    policiesArtifact: readJson(join(paths.compiledRoot, 'policies.json'), { generated_at: null }),
    skillHints: readJson(join(paths.compiledRoot, 'skill-hints.json'), { generated_at: null, rules: [] }),
    routingArtifact: routingArtifact || loadRoutingRegistry(paths),
    adapters,
  };
}

const DEFAULT_AUTO_READ_SECTIONS = ['Overview', 'Workflow', 'Checklist'];
const DEFAULT_PRECEDENCE_ORDER = ['repo', 'claude', 'harness', 'user', 'external', 'global'];
const RECOMMENDATION_SCORE_TOLERANCE = 0.0005;
const DEFAULT_TASK_BOOTSTRAP_POLICY = {
  startup_consult_required: true,
  search_limit: 6,
  max_recommendations: 2,
  auto_read_limit: 1,
  auto_read_sections: DEFAULT_AUTO_READ_SECTIONS,
  precedence_order: DEFAULT_PRECEDENCE_ORDER,
  advisory_only_scopes: ['external'],
};

function precedenceRank(scope, precedenceOrder) {
  const index = precedenceOrder.indexOf(scope);
  return index === -1 ? precedenceOrder.length : index;
}

function championRank(state) {
  return (
    {
      champion: 0,
      none: 1,
      challenger: 2,
    }[state] ?? 1
  );
}

function compareRecommendationCandidates(left, right, precedenceOrder) {
  const scoreDelta = Number(right.score || 0) - Number(left.score || 0);
  if (Math.abs(scoreDelta) > RECOMMENDATION_SCORE_TOLERANCE) {
    return scoreDelta;
  }

  return (
    championRank(left.champion_state) - championRank(right.champion_state) ||
    precedenceRank(left.precedence_scope, precedenceOrder) -
      precedenceRank(right.precedence_scope, precedenceOrder) ||
    left.name.localeCompare(right.name)
  );
}

function resolveTaskBootstrapPolicy(policyBundle) {
  const raw = policyBundle.policies?.task_bootstrap || {};
  return {
    ...DEFAULT_TASK_BOOTSTRAP_POLICY,
    ...raw,
    auto_read_sections: raw.auto_read_sections || DEFAULT_AUTO_READ_SECTIONS,
    precedence_order: raw.precedence_order || DEFAULT_PRECEDENCE_ORDER,
    advisory_only_scopes: raw.advisory_only_scopes || ['external'],
  };
}

function normalizeSearchResults(results) {
  return results.map((entry) => ({
    id: entry.id,
    name: entry.name,
    description: entry.description,
    score: entry.score,
    source_path: entry.sourcePath,
    shim_for: entry.shimFor,
    canonical_path: entry.canonicalPath,
    precedence_scope: entry.precedenceScope,
    matched_section: entry.matchedSection,
    preview: entry.preview,
    token_estimate: entry.tokenEstimate,
  }));
}

function normalizeMentionText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[-_/]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s/$-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildExplicitSkillAliases(skill) {
  const aliases = new Set();
  const addAlias = (value) => {
    const raw = String(value || '').trim().toLowerCase();
    const normalized = normalizeMentionText(value);
    if (raw) {
      aliases.add(raw);
      aliases.add(`$${raw}`);
      aliases.add(`/${raw}`);
    }
    if (normalized) {
      aliases.add(normalized);
      aliases.add(`$${normalized}`);
      aliases.add(`/${normalized}`);
    }
  };

  addAlias(skill.id);
  addAlias(skill.name);
  return [...aliases];
}

function findExplicitSkillMatches(taskText, platform) {
  const rawTaskText = String(taskText || '').toLowerCase();
  const normalizedTaskText = normalizeMentionText(taskText);
  if (!rawTaskText && !normalizedTaskText) {
    return [];
  }

  const registrySkills = platform.compiled.skillsRegistry?.skills || [];
  return registrySkills.flatMap((skill) => {
    const matched = buildExplicitSkillAliases(skill).some((alias) => {
      if (!alias) {
        return false;
      }
      const normalizedAlias = normalizeMentionText(alias);
      return rawTaskText.includes(alias) || (normalizedAlias && normalizedTaskText.includes(normalizedAlias));
    });
    if (!matched) {
      return [];
    }

    const overviewSection =
      (skill.sections || []).find((section) => normalizeSectionKey(section.slug || section.heading) === 'overview') ||
      skill.sections?.[0] ||
      null;

    return [
      {
        id: skill.id,
        name: skill.name,
        description: skill.description,
        score: 1000,
        source_path: skill.source_path,
        shim_for: skill.shim_for || null,
        canonical_path: skill.canonical_path || null,
        precedence_scope: skill.precedence_scope,
        matched_section: overviewSection
          ? {
              heading: overviewSection.heading,
              slug: overviewSection.slug,
              kind: overviewSection.kind,
            }
          : {
              heading: 'Overview',
              slug: 'overview',
              kind: 'section',
            },
        preview: overviewSection?.preview || skill.description,
        token_estimate: skill.token_estimate,
      },
    ];
  });
}

function mergeUniqueMatches(primaryMatches, secondaryMatches) {
  const seen = new Set();
  const merged = [];
  for (const match of [...primaryMatches, ...secondaryMatches]) {
    if (!match?.id || seen.has(match.id)) {
      continue;
    }
    seen.add(match.id);
    merged.push(match);
  }
  return merged;
}

function tierRank(tier) {
  return (
    {
      primary: 0,
      backup: 1,
      advisory: 2,
    }[tier] ?? 3
  );
}

function getRoutingRegistry(platform) {
  return platform.compiled.routingArtifact || loadRoutingRegistry(platform.paths);
}

function getRoutingContext(platform, repo = null, taskType = null) {
  const routingRegistry = getRoutingRegistry(platform);
  const resolvedRepo = repo || platform.paths.repoRoot;
  const normalizedTaskType = String(taskType || 'implementation').toLowerCase();
  const stack = detectRepoStack(platform.paths, resolvedRepo);
  const bundleContext = resolveBundleContext(routingRegistry, {
    repoRoot: resolvedRepo,
    taskType: normalizedTaskType,
    stack,
  });
  return {
    routingRegistry,
    stack,
    bundleContext,
  };
}

function enrichRoutingMatch(match, platform, routingContext, taskType) {
  const skill = platform.store.resolveSkill(match.id) || {
    id: match.id,
    precedenceScope: match.precedence_scope,
  };
  const routing = resolveSkillRouting(
    skill,
    routingContext.routingRegistry,
    routingContext.bundleContext,
    taskType,
  );
  return {
    ...match,
    review_status: routing.review_status,
    effective_tier: routing.effective_tier,
    capability_keys: routing.capability_keys,
    bundle_keys: routing.bundle_keys,
    workflow_tags: routing.workflow_tags,
    stack_tags: routing.stack_tags,
    bundle_match: routing.bundle_match,
    workflow_match: routing.workflow_match,
    stack_match: routing.stack_match,
    champion_state: routing.champion_state,
    champion_tests: routing.champion_tests,
  };
}

function compareRoutedMatches(left, right, policy) {
  return (
    tierRank(left.effective_tier) - tierRank(right.effective_tier) ||
    compareRecommendationCandidates(left, right, policy.precedence_order)
  );
}

function buildTieredMatches(matches, policy) {
  const tiers = {
    primary: [],
    backup: [],
    advisory: [],
  };

  for (const match of matches) {
    const advisoryOnly =
      policy.advisory_only_scopes.includes(match.precedence_scope) ||
      match.review_status !== 'reviewed' ||
      match.effective_tier === 'advisory';
    const tier = advisoryOnly ? 'advisory' : match.effective_tier;
    tiers[tier].push({
      ...match,
      effective_tier: tier,
      advisory_only: advisoryOnly,
      auto_read: false,
      sections_to_read: [],
    });
  }

  const recommendations = [...tiers.primary, ...tiers.backup, ...tiers.advisory]
    .slice(0, policy.max_recommendations)
    .map((match, index) => ({
      ...match,
      recommendation_rank: index + 1,
      confidence: Number(
        (
          Math.max(0.2, 1 - index * 0.15) *
          (match.review_status === 'reviewed' ? 1 : 0.6) *
          (match.bundle_match ? 1 : 0.85) *
          (match.workflow_match ? 1 : 0.85) *
          (match.stack_match ? 1 : 0.85)
        ).toFixed(4),
      ),
    }));

  let autoReadRemaining = policy.auto_read_limit;
  for (const recommendation of recommendations) {
    if (!recommendation.advisory_only && autoReadRemaining > 0) {
      recommendation.auto_read = true;
      recommendation.sections_to_read = policy.auto_read_sections;
      autoReadRemaining -= 1;
    }
  }

  return {
    primary: tiers.primary,
    backup: tiers.backup,
    advisory: tiers.advisory,
    recommendations,
  };
}

function validateStaticSkill(skill, platform, routingRegistry) {
  const outline = platform.store.getSkillOutline(skill.id);
  const sectionSlugs = new Set((outline?.sections || []).map((section) => normalizeSectionKey(section.slug)));
  const missingSections = routingRegistry.defaults.required_sections.filter(
    (section) => !sectionSlugs.has(normalizeSectionKey(section)),
  );
  const sourceText = existsSync(skill.sourcePath) ? readFileSync(skill.sourcePath, 'utf8') : '';
  const unsafePatterns = routingRegistry.defaults.unsafe_helper_patterns.filter((pattern) => {
    try {
      return new RegExp(pattern, 'i').test(sourceText);
    } catch {
      return false;
    }
  });

  const score = Math.max(
    0,
    Number(
      (
        1 -
        missingSections.length * 0.3 -
        (skill.warnings?.length || 0) * 0.1 -
        unsafePatterns.length * 0.1
      ).toFixed(4),
    ),
  );

  return {
    passed: missingSections.length === 0,
    score,
    required_sections: routingRegistry.defaults.required_sections,
    missing_sections: missingSections,
    warnings: skill.warnings || [],
    unsafe_helper_patterns: unsafePatterns,
  };
}

function evaluationCoverageForSkill(skillId, routing, routingRegistry) {
  const suites = routingRegistry.evaluation_suites.filter(
    (suite) =>
      (suite.capability_key && routing.capability_keys.includes(suite.capability_key)) ||
      suite.cases.some((entry) => entry.expected_any.includes(skillId)),
  );
  return {
    suites: suites.map((suite) => suite.key),
    champion_tests: routing.champion_tests.map((entry) => entry.key),
  };
}

function recommendationFromRouting(routing) {
  if (routing.review_status === 'reviewed' && routing.effective_tier === 'primary') {
    return 'eligible-primary';
  }
  if (routing.review_status === 'reviewed' && routing.effective_tier === 'backup') {
    return 'eligible-backup';
  }
  return 'advisory-only';
}

function rankSnapshot(skillId, matches) {
  const index = matches.findIndex((entry) => entry.id === skillId);
  if (index === -1) {
    return {
      present: false,
      rank: null,
      score: 0,
      utility: 0,
    };
  }
  const match = matches[index];
  return {
    present: true,
    rank: index + 1,
    score: Number(match.score || 0),
    utility: Number((1 / (index + 1) + Math.max(0, Number(match.score || 0))).toFixed(4)),
  };
}

function summarizeCompetition(rows) {
  const summary = {
    prompts: rows.length,
    champion_wins: 0,
    challenger_wins: 0,
    ties: 0,
  };
  for (const row of rows) {
    if (row.winner === 'champion') {
      summary.champion_wins += 1;
    } else if (row.winner === 'challenger') {
      summary.challenger_wins += 1;
    } else {
      summary.ties += 1;
    }
  }
  return summary;
}

async function compareSkillsOnPrompts(prompts, championId, challengerId, platform, searchLimit) {
  const rows = [];
  for (const prompt of prompts) {
    const matches = await matchSkills(prompt.prompt || prompt.queryText || '', platform, searchLimit);
    const champion = rankSnapshot(championId, matches);
    const challenger = rankSnapshot(challengerId, matches);
    let winner = 'tie';
    if (challenger.utility > champion.utility) {
      winner = 'challenger';
    } else if (champion.utility > challenger.utility) {
      winner = 'champion';
    }
    rows.push({
      prompt: prompt.prompt || prompt.queryText || '',
      expected_any: prompt.expected_any || [],
      champion,
      challenger,
      winner,
    });
  }
  return {
    rows,
    summary: summarizeCompetition(rows),
  };
}

export async function compilePlatform(options = {}) {
  const paths = resolvePaths(options);
  const store = createStore({ dbPath: options.dbPath || paths.dbPath });
  try {
    const indexed = await indexPlatform(store, options);
    const status = store.getStatus({ latestSourceMtime: indexed.latestSourceMtime });
    return {
      paths,
      store,
      status,
      compiled: indexed.compiled,
      load_state: 'compiled',
    };
  } catch (error) {
    store.close();
    throw error;
  }
}

export async function loadPlatform(options = {}) {
  const paths = resolvePaths(options);
  const store = createStore({ dbPath: options.dbPath || paths.dbPath });
  const latestMtime = options.skipSourceMtime ? null : latestSourceMtime(paths);
  const status = store.getStatus({ latestSourceMtime: latestMtime });

  if (
    options.forceRebuild ||
    !compiledArtifactsExist(paths) ||
    status.counts.documents === 0 ||
    (!options.skipSourceMtime && status.stale) ||
    !status.indexed_at
  ) {
    store.close();
    const rebuilt = await compilePlatform(options);
    return {
      ...rebuilt,
      load_state: 'rebuilt',
    };
  }

  return {
    paths,
    store,
    status,
    compiled: readCompiledArtifacts(paths),
    load_state: 'reused',
  };
}

export function skillCatalog(platform, { limit = 100 } = {}) {
  const skills = platform.store.listDocuments({ contentType: 'skill', limit }).map((skill) => {
    const outline = platform.store.getSkillOutline(skill.id);
    return {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      source_path: skill.sourcePath,
      source_root: skill.sourceRoot,
      relative_path: skill.relativePath,
      shim_for: skill.shimFor,
      canonical_path: skill.canonicalPath,
      precedence_scope: skill.precedenceScope,
      token_estimate: skill.tokenEstimate,
      sections: (outline?.sections || []).map((section) => ({
        heading: section.heading,
        slug: section.slug,
        level: section.level,
        kind: section.kind,
        start_line: section.startLine,
        end_line: section.endLine,
        token_estimate: section.tokenEstimate,
      })),
    };
  });

  return {
    generated_at: platform.compiled.skillsRegistry.generated_at || platform.compiled.generatedAt,
    skill_roots: platform.paths.skillRoots,
    count: skills.length,
    skills,
  };
}

export async function skillSearch(query, platform, { limit = 10, mode = 'keyword' } = {}) {
  let embedding = null;
  if ((mode === 'semantic' || mode === 'hybrid') && platform.paths.enableEmbeddings) {
    try {
      embedding = await createEmbedder().embed(query);
    } catch {
      embedding = null;
    }
  }

  const matches = platform.store.searchSkills({
    query,
    limit,
    contentType: 'skill',
    embedding,
  });

  return {
    query,
    mode: embedding ? mode : 'keyword',
    count: matches.length,
    matches: normalizeSearchResults(matches),
  };
}

export function getSkillMetadata(skillId, platform) {
  const outline = platform.store.getSkillOutline(skillId);
  if (!outline) {
    return null;
  }
  return {
    id: outline.skill.id,
    name: outline.skill.name,
    description: outline.skill.description,
    source_path: outline.skill.sourcePath,
    source_root: outline.skill.sourceRoot,
    relative_path: outline.skill.relativePath,
    shim_for: outline.skill.shimFor,
    canonical_path: outline.skill.canonicalPath,
    token_estimate: outline.skill.tokenEstimate,
    sections: outline.sections,
  };
}

export function skillOutline(skillId, platform) {
  const outline = platform.store.getSkillOutline(skillId);
  if (!outline) {
    return null;
  }
  return {
    skill: {
      id: outline.skill.id,
      name: outline.skill.name,
      description: outline.skill.description,
      source_path: outline.skill.sourcePath,
      source_root: outline.skill.sourceRoot,
      relative_path: outline.skill.relativePath,
      shim_for: outline.skill.shimFor,
      canonical_path: outline.skill.canonicalPath,
      token_estimate: outline.skill.tokenEstimate,
    },
    sections: outline.sections,
  };
}

export function skillReadSection(skillId, sectionName, platform) {
  const result = platform.store.getSkillSection(skillId, sectionName);
  if (!result) {
    return null;
  }
  return {
    skill: {
      id: result.skill.id,
      name: result.skill.name,
      description: result.skill.description,
      source_path: result.skill.sourcePath,
      source_root: result.skill.sourceRoot,
      relative_path: result.skill.relativePath,
      shim_for: result.skill.shimFor,
      canonical_path: result.skill.canonicalPath,
      token_estimate: result.skill.tokenEstimate,
    },
    section: result.section,
  };
}

export function skillReadSections(requests, platform) {
  const bundle = [];
  for (const request of requests) {
    const outline = platform.store.getSkillOutline(request.skill_id);
    if (!outline) {
      continue;
    }
    const sectionNames = request.sections?.length
      ? request.sections
      : platform.compiled.policiesArtifact.skill_platform?.default_sections || ['Overview', 'Workflow'];
    const sections = sectionNames
      .map((name) => platform.store.getSkillSection(request.skill_id, name)?.section)
      .filter(Boolean);
    bundle.push({
      id: outline.skill.id,
      name: outline.skill.name,
      description: outline.skill.description,
      source_path: outline.skill.sourcePath,
      source_root: outline.skill.sourceRoot,
      relative_path: outline.skill.relativePath,
      shim_for: outline.skill.shimFor,
      canonical_path: outline.skill.canonicalPath,
      token_estimate: outline.skill.tokenEstimate,
      sections,
    });
  }
  return {
    count: bundle.length,
    bundle,
  };
}

export function getSkillBundle(skillIds, requestedSections, platform) {
  return skillReadSections(
    skillIds.map((skillId) => ({
      skill_id: skillId,
      sections: requestedSections || [],
    })),
    platform,
  ).bundle;
}

function tokenizeQuery(queryText) {
  return String(queryText || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length >= 3)
    .filter((token) => !new Set(['with', 'from', 'that', 'this', 'into', 'next', 'then', 'feature']).has(token));
}

function computeRoutingBoost(match, queryText, platform) {
  const query = String(queryText || '').toLowerCase();
  const sourcePath = String(match.source_path || '');
  const id = String(match.id || '').toLowerCase();
  const name = String(match.name || '').toLowerCase();
  const description = String(match.description || '').toLowerCase();
  const preview = String(match.preview || '').toLowerCase();
  const searchable = `${id} ${name} ${description} ${preview}`;

  const hasEnterprise = /\benterprise\b/.test(query);
  const hasAiims = /\baiims\b/.test(query);
  const hasLean = /\blean\b/.test(query);
  const hasPhase3 = /\bphase\s*3\b|\bphase3\b/.test(query);
  const hasWave = /\bwave\b/.test(query);
  const hasEvidence = /\bevidence\b|\bprove\b|\bproof\b|\bhonestly\b/.test(query);

  const isRepoLocal = sourcePath.startsWith(`${platform.paths.repoRoot}/.codex/repo-skills/`);
  const isEnterprise = id === 'enterprise' || id.startsWith('enterprise-') || id.startsWith('helpdesk-enterprise');
  const isAiims = id.includes('aiims');

  let boost = 0;

  if (isRepoLocal) {
    boost += 1.5;
  }

  if (hasEnterprise) {
    if (isEnterprise) {
      boost += 6;
    } else if (!isAiims) {
      boost -= 2.5;
    }

    if (id === 'helpdesk-enterprise-lean') {
      boost += 8;
    }

    if (id === 'helpdesk-enterprise') {
      boost += 6;
    }

    if (id === 'enterprise') {
      boost += 4;
    }
  }

  if (hasAiims) {
    if (isAiims) {
      boost += 10;
    } else {
      boost -= 4;
    }

    if (id === 'helpdesk-aiims-enterprise-lean') {
      boost += 9;
    }

    if (hasPhase3 && id === 'helpdesk-aiims-phase3') {
      boost += 9;
    }

    if (hasWave && id === 'helpdesk-aiims-run-wave') {
      boost += 7;
    }

    if (hasEvidence && id === 'helpdesk-aiims-evidence-update') {
      boost += 7;
    }

    if (hasEvidence && id === 'helpdesk-aiims-verify') {
      boost += 4;
    }
  } else if (isAiims) {
    boost -= 3;
  }

  if (hasLean && id.includes('lean')) {
    boost += 3;
  }

  for (const token of tokenizeQuery(query)) {
    if (id.includes(token)) {
      boost += 0.75;
    } else if (searchable.includes(token)) {
      boost += 0.15;
    }
  }

  return boost;
}

function rerankMatches(matches, queryText, platform, limit) {
  return matches
    .map((match) => ({
      ...match,
      routing_score: Number(((match.score || 0) + computeRoutingBoost(match, queryText, platform)).toFixed(4)),
    }))
    .sort((left, right) => {
      if (right.routing_score !== left.routing_score) {
        return right.routing_score - left.routing_score;
      }
      if ((right.score || 0) !== (left.score || 0)) {
        return (right.score || 0) - (left.score || 0);
      }
      return String(left.name || left.id).localeCompare(String(right.name || right.id));
    })
    .slice(0, limit)
    .map(({ routing_score, ...match }) => match);
}

export async function matchSkills(taskText, platform, limit = 10) {
  const result = await skillSearch(taskText, platform, {
    limit: Math.max(limit * 8, 50),
    mode: platform.paths.enableEmbeddings ? 'hybrid' : 'keyword',
  });
  return rerankMatches(result.matches, taskText, platform, limit);
}

export async function taskBootstrap(
  agentName,
  taskText,
  platform,
  { repo = null, taskType = null, limit = null } = {},
) {
  const policyBundle = getPolicyBundle(agentName, platform, repo, taskType);
  const policy = resolveTaskBootstrapPolicy(policyBundle);
  const searchLimit = Number(limit || policy.search_limit || DEFAULT_TASK_BOOTSTRAP_POLICY.search_limit);
  const routingContext = getRoutingContext(platform, repo || platform.paths.repoRoot, taskType || 'implementation');
  const explicitMatches = findExplicitSkillMatches(taskText, platform);
  const matches = mergeUniqueMatches(explicitMatches, await matchSkills(taskText, platform, searchLimit))
    .map((match) => enrichRoutingMatch(match, platform, routingContext, taskType || 'implementation'))
    .sort((left, right) => compareRoutedMatches(left, right, policy));
  const tiered = buildTieredMatches(matches, policy);

  return {
    agent: agentName,
    repo,
    task_type: taskType,
    generated_at: policyBundle.generated_at,
    policy_bundle: policyBundle,
    policy,
    stack: routingContext.stack,
    bundle: {
      key: routingContext.bundleContext.resolved_bundle.key,
      label: routingContext.bundleContext.resolved_bundle.label,
      chain: routingContext.bundleContext.bundle_chain.map((entry) => ({
        key: entry.key,
        label: entry.label,
      })),
    },
    consulted: {
      search_limit: searchLimit,
      recommendation_count: tiered.recommendations.length,
    },
    primary: tiered.primary,
    backup: tiered.backup,
    advisory: tiered.advisory,
    recommendations: tiered.recommendations,
    auto_load: tiered.recommendations
      .filter((recommendation) => recommendation.auto_read)
      .map((recommendation) => ({
        skill_id: recommendation.id,
        sections: recommendation.sections_to_read,
      })),
  };
}

export function getPolicyBundle(agentName, platform, repo = null, taskType = null) {
  return {
    agent: agentName,
    repo,
    task_type: taskType,
    generated_at: platform.compiled.policiesArtifact.generated_at,
    policies: platform.compiled.policiesArtifact,
    adapter: platform.compiled.adapters[agentName] || null,
  };
}

export function skillStatus(platform) {
  const routingRegistry = getRoutingRegistry(platform);
  return {
    generated_at: platform.compiled.policiesArtifact.generated_at || platform.compiled.generatedAt,
    db_path: platform.status.db_path,
    external_source_manifest: platform.paths.externalSourceManifestPath,
    routing_registry_path: platform.paths.routingRegistryPath,
    external_sources: platform.paths.externalSources.length,
    indexed_at: platform.status.indexed_at,
    latest_source_mtime: platform.status.latest_source_mtime,
    stale: platform.status.stale,
    source_mtime_stale: platform.status.source_mtime_stale,
    source_hash_stale: platform.status.source_hash_stale,
    changed_source_count: platform.status.changed_source_count,
    changed_source_paths: platform.status.changed_source_paths,
    missing_source_count: platform.status.missing_source_count,
    missing_source_paths: platform.status.missing_source_paths,
    counts: platform.status.counts,
    embeddings_enabled: platform.paths.enableEmbeddings,
    compiled_root: platform.paths.compiledRoot,
    bundle_rules: routingRegistry.bundle_rules.length,
    champion_tests: routingRegistry.champion_tests.length,
  };
}

export function skillTelemetry(platform) {
  return platform.store.getTelemetryReport();
}

export function skillBundleStatus(platform, { repo = null, taskType = null } = {}) {
  const routingContext = getRoutingContext(platform, repo || platform.paths.repoRoot, taskType || 'implementation');
  const skills = platform.store.listDocuments({ contentType: 'skill', limit: 5000 });
  const countsByTier = {
    primary: 0,
    backup: 0,
    advisory: 0,
  };
  const reviewCounts = {
    reviewed: 0,
    candidate: 0,
  };

  for (const skill of skills) {
    const routing = resolveSkillRouting(
      skill,
      routingContext.routingRegistry,
      routingContext.bundleContext,
      taskType || 'implementation',
    );
    countsByTier[routing.effective_tier] += 1;
    reviewCounts[routing.review_status === 'reviewed' ? 'reviewed' : 'candidate'] += 1;
  }

  return {
    repo: routingContext.bundleContext.repo_root,
    task_type: routingContext.bundleContext.task_type,
    stack: routingContext.stack,
    bundle: {
      key: routingContext.bundleContext.resolved_bundle.key,
      label: routingContext.bundleContext.resolved_bundle.label,
      chain: routingContext.bundleContext.bundle_chain.map((entry) => ({
        key: entry.key,
        label: entry.label,
      })),
    },
    counts_by_tier: countsByTier,
    review_counts: reviewCounts,
    champion_tests: summarizeChampionTests(
      routingContext.routingRegistry,
      routingContext.bundleContext,
      taskType || 'implementation',
    ),
  };
}

export async function skillValidateCandidates(
  platform,
  { repo = null, taskType = null, taskText = '', skillIds = [], limit = 10 } = {},
) {
  const routingContext = getRoutingContext(platform, repo || platform.paths.repoRoot, taskType || 'implementation');
  let targets = [];
  if (Array.isArray(skillIds) && skillIds.length) {
    targets = skillIds.map((skillId) => platform.store.resolveSkill(skillId)).filter(Boolean);
  } else {
    const matches = await matchSkills(taskText, platform, limit);
    targets = matches.map((match) => platform.store.resolveSkill(match.id)).filter(Boolean);
  }

  const validations = targets.map((skill) => {
    const routing = resolveSkillRouting(
      skill,
      routingContext.routingRegistry,
      routingContext.bundleContext,
      taskType || 'implementation',
    );
    return {
      id: skill.id,
      name: skill.name,
      source_path: skill.sourcePath,
      shim_for: skill.shimFor,
      canonical_path: skill.canonicalPath,
      precedence_scope: skill.precedenceScope,
      review_status: routing.review_status,
      effective_tier: routing.effective_tier,
      capability_keys: routing.capability_keys,
      champion_state: routing.champion_state,
      static_validation: validateStaticSkill(skill, platform, routingContext.routingRegistry),
      compatibility: {
        passed: routing.bundle_match && routing.workflow_match && routing.stack_match,
        score: Number(
          (
            (routing.bundle_match ? 0.4 : 0) +
            (routing.workflow_match ? 0.3 : 0) +
            (routing.stack_match ? 0.3 : 0)
          ).toFixed(4),
        ),
        bundle_match: routing.bundle_match,
        workflow_match: routing.workflow_match,
        stack_match: routing.stack_match,
      },
      evaluation: evaluationCoverageForSkill(skill.id, routing, routingContext.routingRegistry),
      recommendation: recommendationFromRouting(routing),
    };
  });

  return {
    repo: routingContext.bundleContext.repo_root,
    task_type: routingContext.bundleContext.task_type,
    stack: routingContext.stack,
    bundle: {
      key: routingContext.bundleContext.resolved_bundle.key,
      label: routingContext.bundleContext.resolved_bundle.label,
    },
    count: validations.length,
    validations,
  };
}

export async function skillEvaluateChallengers(
  platform,
  { repo = null, taskType = null, bundleKey = null, capabilityKey = null, shadowLimit = null } = {},
) {
  const routingContext = getRoutingContext(platform, repo || platform.paths.repoRoot, taskType || 'implementation');
  const benchmarkLimit = routingContext.routingRegistry.defaults.benchmark_limit || 12;
  const relevantTests = routingContext.routingRegistry.champion_tests.filter(
    (entry) =>
      (!bundleKey || entry.bundle_key === bundleKey) &&
      (!capabilityKey || entry.capability_key === String(capabilityKey).toLowerCase()) &&
      (!entry.bundle_key || routingContext.bundleContext.bundle_keys.includes(entry.bundle_key)) &&
      (!entry.task_types.length || entry.task_types.includes(routingContext.bundleContext.task_type)),
  );

  const telemetryQueries = platform.store
    .listTelemetryQueries({
      toolName: 'task_bootstrap',
      limit: shadowLimit || routingContext.routingRegistry.defaults.shadow_limit || 15,
    })
    .filter((entry) => entry.queryText);

  const evaluations = [];
  for (const test of relevantTests) {
    const suite =
      routingContext.routingRegistry.evaluation_suites.find((entry) => entry.key === test.evaluation_suite) ||
      routingContext.routingRegistry.evaluation_suites.find(
        (entry) => entry.capability_key && entry.capability_key === test.capability_key,
      ) ||
      null;
    const benchmarkPrompts = (suite?.cases || []).filter(
      (entry) =>
        !suite?.task_types?.length || suite.task_types.includes(routingContext.bundleContext.task_type),
    );
    const filteredShadow = telemetryQueries.filter((entry) => {
      if (!suite?.shadow_keywords?.length) {
        return true;
      }
      const lower = entry.queryText.toLowerCase();
      return suite.shadow_keywords.some((keyword) => lower.includes(keyword));
    });

    for (const challengerId of test.challengers) {
      const benchmark = await compareSkillsOnPrompts(
        benchmarkPrompts,
        test.champion,
        challengerId,
        platform,
        benchmarkLimit,
      );
      const shadow = await compareSkillsOnPrompts(
        filteredShadow,
        test.champion,
        challengerId,
        platform,
        benchmarkLimit,
      );
      const recommendation =
        benchmark.summary.challenger_wins > benchmark.summary.champion_wins &&
        shadow.summary.challenger_wins > shadow.summary.champion_wins
          ? 'manual-promotion-candidate'
          : 'keep-champion';

      evaluations.push({
        key: `${test.key}:${challengerId}`,
        bundle_key: test.bundle_key,
        capability_key: test.capability_key,
        evaluation_suite: suite?.key || test.evaluation_suite || null,
        champion: test.champion,
        challenger: challengerId,
        benchmark,
        shadow,
        recommendation,
      });
    }
  }

  return {
    repo: routingContext.bundleContext.repo_root,
    task_type: routingContext.bundleContext.task_type,
    stack: routingContext.stack,
    bundle: {
      key: routingContext.bundleContext.resolved_bundle.key,
      label: routingContext.bundleContext.resolved_bundle.label,
    },
    count: evaluations.length,
    evaluations,
  };
}
