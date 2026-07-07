import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const defaultHarnessRoot = dirname(packageRoot);

function uniq(values) {
  return [...new Set(values.filter(Boolean).map((entry) => resolve(entry)))];
}

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

function normalizeExternalSources(sources = []) {
  return sources
    .map((source) => {
      const skillRoot = source.skill_root || source.root_path || source.path;
      if (!skillRoot) {
        return null;
      }
      return {
        name: source.name || null,
        repo_url: source.repo_url || null,
        ref: source.ref || null,
        enabled: source.enabled !== false,
        trust_level: source.trust_level || 'external',
        advisory_only: source.advisory_only !== false,
        skillRoot: resolve(skillRoot),
      };
    })
    .filter(Boolean);
}

function runtimeName(overrides = {}) {
  return String(overrides.runtime || process.env.SKILLS_INDEX_RUNTIME || 'codex').toLowerCase();
}

function isCodexLikeRuntime(runtime) {
  return runtime === 'codex' || runtime === 'opencode';
}

function runtimeUserSkillRoot(home, overrides = {}) {
  if (overrides.userSkillRoot || process.env.SKILLS_INDEX_USER_ROOT) {
    return overrides.userSkillRoot || process.env.SKILLS_INDEX_USER_ROOT;
  }

  const runtime = runtimeName(overrides);
  return isCodexLikeRuntime(runtime)
    ? join(home, '.codex', 'skills')
    : join(home, '.claude', 'skills');
}

export function resolvePaths(overrides = {}) {
  const home = homedir();
  const repoRoot = resolve(
    overrides.repoRoot ||
      process.env.CLAUDE_PROJECT_DIR ||
      process.env.CODEX_PROJECT_ROOT ||
      process.cwd(),
  );
  const harnessRoot = resolve(
    overrides.harnessRoot || process.env.CLAUDE_HARNESS_DIR || defaultHarnessRoot,
  );

  const vaultPath = resolve(
    overrides.vaultPath || process.env.OBSIDIAN_VAULT_PATH || join(home, 'Documents', 'Product Ideas'),
  );
  const platformRoot = resolve(
    overrides.platformRoot || process.env.AGENT_PLATFORM_ROOT || join(home, '.agent-platform'),
  );
  const externalSourceManifestPath = resolve(
    overrides.externalSourceManifestPath || join(platformRoot, 'external-sources.json'),
  );
  const standardsRoot = resolve(overrides.standardsRoot || join(vaultPath, '_standards', 'agent-platform'));
  const routingRegistryPath = resolve(
    overrides.routingRegistryPath || join(standardsRoot, 'skill-routing-registry.json'),
  );
  const compiledRoot = resolve(overrides.compiledRoot || join(platformRoot, 'compiled'));
  const telemetryRoot = resolve(overrides.telemetryRoot || join(platformRoot, 'telemetry'));
  const dbPath = resolve(overrides.dbPath || join(platformRoot, 'skills-index.sqlite'));

  const repoSkillRoot = join(repoRoot, '.codex', 'repo-skills');
  const projectClaudeSkillRoot = join(repoRoot, '.claude', 'skills');
  const harnessSkillRoot = join(harnessRoot, 'skills');
  const userSkillRoot = runtimeUserSkillRoot(home, overrides);
  const runtime = runtimeName(overrides);
  const defaultSkillRoots = isCodexLikeRuntime(runtime)
    ? [repoSkillRoot, userSkillRoot]
    : [repoSkillRoot, projectClaudeSkillRoot, harnessSkillRoot, userSkillRoot];
  const externalSources = normalizeExternalSources(
    overrides.externalSources ||
      readJson(externalSourceManifestPath, { sources: [] }).sources ||
      [],
  );
  const externalSkillRoots = externalSources
    .filter((source) => source.enabled)
    .map((source) => source.skillRoot);
  const skillRoots = uniq(
    [
      ...(overrides.skillRoots || defaultSkillRoots),
      ...externalSkillRoots,
    ],
  );
  const watchRoots = uniq(overrides.watchRoots || [standardsRoot, routingRegistryPath, ...skillRoots]);

  return {
    home,
    repoRoot,
    harnessRoot,
    vaultPath,
    platformRoot,
    externalSourceManifestPath,
    routingRegistryPath,
    externalSources,
    externalSkillRoots,
    standardsRoot,
    skillRoots,
    compiledRoot,
    telemetryRoot,
    dbPath,
    runtime,
    watchRoots,
    enableEmbeddings:
      overrides.skipEmbeddings
        ? false
        : overrides.enableEmbeddings ?? process.env.AGENT_PLATFORM_ENABLE_EMBEDDINGS === '1',
  };
}
