import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const defaultHarnessRoot = dirname(packageRoot);

function uniq(values) {
  return [...new Set(values.filter(Boolean).map((entry) => resolve(entry)))];
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
  const standardsRoot = resolve(overrides.standardsRoot || join(vaultPath, '_standards', 'agent-platform'));
  const compiledRoot = resolve(overrides.compiledRoot || join(platformRoot, 'compiled'));
  const telemetryRoot = resolve(overrides.telemetryRoot || join(platformRoot, 'telemetry'));
  const dbPath = resolve(overrides.dbPath || join(platformRoot, 'skills-index.sqlite'));

  const repoSkillRoot = join(repoRoot, '.codex', 'repo-skills');
  const projectClaudeSkillRoot = join(repoRoot, '.claude', 'skills');
  const harnessSkillRoot = join(harnessRoot, 'skills');
  const skillRoots = uniq(
    overrides.skillRoots || [
      repoSkillRoot,
      projectClaudeSkillRoot,
      harnessSkillRoot,
      join(home, '.codex', 'skills'),
      join(home, '.claude', 'skills'),
    ],
  );
  const watchRoots = uniq(overrides.watchRoots || [standardsRoot, ...skillRoots]);

  return {
    home,
    repoRoot,
    harnessRoot,
    vaultPath,
    platformRoot,
    standardsRoot,
    skillRoots,
    compiledRoot,
    telemetryRoot,
    dbPath,
    watchRoots,
    enableEmbeddings:
      overrides.enableEmbeddings ?? process.env.AGENT_PLATFORM_ENABLE_EMBEDDINGS === '1',
  };
}
