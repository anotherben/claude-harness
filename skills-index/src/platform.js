import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createEmbedder } from './embedder.js';
import { resolvePaths } from './config.js';
import { indexPlatform, latestSourceMtime } from './indexer.js';
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
  ].every((filePath) => existsSync(filePath));
}

function readCompiledArtifacts(paths) {
  return {
    generatedAt: readJson(join(paths.compiledRoot, 'policies.json'), {}).generated_at || null,
    skillsRegistry: readJson(join(paths.compiledRoot, 'skills-registry.json'), {
      generated_at: null,
      skill_roots: paths.skillRoots,
      skills: [],
    }),
    policiesArtifact: readJson(join(paths.compiledRoot, 'policies.json'), { generated_at: null }),
    skillHints: readJson(join(paths.compiledRoot, 'skill-hints.json'), { generated_at: null, rules: [] }),
    adapters: Object.fromEntries(
      ['claude', 'codex']
        .map((name) => [name, readJson(join(paths.compiledRoot, 'adapters', `${name}.json`), null)])
        .filter(([, value]) => value),
    ),
  };
}

function normalizeSearchResults(results) {
  return results.map((entry) => ({
    id: entry.id,
    name: entry.name,
    description: entry.description,
    score: entry.score,
    source_path: entry.sourcePath,
    matched_section: entry.matchedSection,
    preview: entry.preview,
    token_estimate: entry.tokenEstimate,
  }));
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
      skills: indexed.skills,
      policies: indexed.policies,
    };
  } catch (error) {
    store.close();
    throw error;
  }
}

export async function loadPlatform(options = {}) {
  const paths = resolvePaths(options);
  const store = createStore({ dbPath: options.dbPath || paths.dbPath });
  const latestMtime = latestSourceMtime(paths);
  const status = store.getStatus({ latestSourceMtime: latestMtime });

  if (
    options.forceRebuild ||
    !compiledArtifactsExist(paths) ||
    status.counts.documents === 0 ||
    status.stale ||
    !status.indexed_at
  ) {
    store.close();
    return compilePlatform(options);
  }

  return {
    paths,
    store,
    status,
    compiled: readCompiledArtifacts(paths),
    skills: store.listDocuments({ contentType: 'skill', limit: 5000 }),
    policies: store.listDocuments({ contentType: 'policy', limit: 1000 }),
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

export async function matchSkills(taskText, platform, limit = 10) {
  const result = await skillSearch(taskText, platform, {
    limit,
    mode: platform.paths.enableEmbeddings ? 'hybrid' : 'keyword',
  });
  return result.matches;
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
  return {
    generated_at: platform.compiled.policiesArtifact.generated_at || platform.compiled.generatedAt,
    db_path: platform.status.db_path,
    indexed_at: platform.status.indexed_at,
    latest_source_mtime: platform.status.latest_source_mtime,
    stale: platform.status.stale,
    counts: platform.status.counts,
    embeddings_enabled: platform.paths.enableEmbeddings,
    compiled_root: platform.paths.compiledRoot,
  };
}

export function skillTelemetry(platform) {
  return platform.store.getTelemetryReport();
}
