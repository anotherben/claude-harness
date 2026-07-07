import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import {
  compilePlatform,
  getPolicyBundle,
  loadPlatform,
  skillBundleStatus,
  skillCatalog,
  skillEvaluateChallengers,
  skillSearch,
  skillStatus,
  skillValidateCandidates,
  taskBootstrap,
} from './platform.js';
import { resolvePaths } from './config.js';

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function parseArgs(argv) {
  const [command = 'compile', ...rest] = argv;
  const flags = {};
  for (let index = 0; index < rest.length; index += 1) {
    const entry = rest[index];
    if (!entry.startsWith('--')) {
      continue;
    }
    const key = entry.slice(2);
    const value = rest[index + 1] && !rest[index + 1].startsWith('--') ? rest[index + 1] : true;
    flags[key] = value;
    if (value !== true) {
      index += 1;
    }
  }
  return { command, flags };
}

function optionsFromFlags(flags) {
  return {
    repoRoot: flags['repo-root'],
    vaultPath: flags['vault-path'],
    platformRoot: flags['platform-root'],
    dbPath: flags['db-path'],
    skipSourceMtime:
      flags['skip-source-mtime'] === true ||
      flags['skip-source-mtime'] === 'true' ||
      process.env.AGENT_PLATFORM_SKIP_SOURCE_MTIME === '1',
    enableEmbeddings:
      flags['enable-embeddings'] === true ||
      flags['enable-embeddings'] === 'true' ||
      process.env.AGENT_PLATFORM_ENABLE_EMBEDDINGS === '1',
  };
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

function sanitizeSegment(value) {
  return (
    String(value || 'default')
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'default'
  );
}

function detectRepoName(repoUrl) {
  return (
    String(repoUrl || '')
      .split('/')
      .filter(Boolean)
      .pop()
      ?.replace(/\.git$/i, '') || 'external-skill-source'
  );
}

function updateExternalSourceManifest(manifestPath, source) {
  const current = readJson(manifestPath, { sources: [] });
  const nextSources = (current.sources || []).filter((entry) => entry.name !== source.name);
  nextSources.push(source);
  mkdirSync(join(manifestPath, '..'), { recursive: true });
  writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        sources: nextSources,
      },
      null,
      2,
    ),
  );
}

function runGit(args, cwd = null) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'git command failed').trim());
  }
  return result;
}

function gitStdout(args, cwd = null) {
  return runGit(args, cwd).stdout.trim();
}

function managedMirrorExists(repoPath) {
  return existsSync(join(repoPath, '.git'));
}

function resolveHeadCommit(repoPath) {
  if (!managedMirrorExists(repoPath)) {
    return null;
  }
  try {
    return gitStdout(['-C', repoPath, 'rev-parse', 'HEAD']);
  } catch {
    return null;
  }
}

function mirrorHasLocalDrift(repoPath) {
  return gitStdout(['-C', repoPath, 'status', '--porcelain', '--ignored']).length > 0;
}

function resolveRemoteCommit(repoUrl, ref) {
  const output = gitStdout(['ls-remote', repoUrl, ref]);
  const line = output
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean)[0];
  if (!line) {
    throw new Error(`unable to resolve remote ref ${ref} for ${repoUrl}`);
  }
  return line.split(/\s+/)[0];
}

const MANAGED_EXTERNAL_MARKER = '.skills-index-managed';

function isInsidePath(parentPath, childPath) {
  const relativePath = relative(resolve(parentPath), resolve(childPath));
  return relativePath === '' || (!!relativePath && !relativePath.startsWith('..') && !isAbsolute(relativePath));
}

function nearestExistingPath(filePath) {
  let current = resolve(filePath);
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) {
      return current;
    }
    current = parent;
  }
  return current;
}

function assertManagedTargetPath({ managedRoot, targetRoot }) {
  const resolvedManagedRoot = resolve(managedRoot);
  const resolvedTargetRoot = resolve(targetRoot);
  if (!isInsidePath(resolvedManagedRoot, resolvedTargetRoot)) {
    throw new Error(`sync-external target must be under managed root: ${managedRoot}`);
  }

  mkdirSync(resolvedManagedRoot, { recursive: true });
  const existingPath = nearestExistingPath(resolvedTargetRoot);
  if (existsSync(existingPath) && lstatSync(existingPath).isSymbolicLink()) {
    throw new Error(`sync-external target must not resolve through a symlink: ${targetRoot}`);
  }

  const realManagedRoot = realpathSync(resolvedManagedRoot);
  const realExistingPath = existsSync(existingPath) ? realpathSync(existingPath) : realManagedRoot;
  if (!isInsidePath(realManagedRoot, realExistingPath)) {
    throw new Error(`sync-external target must resolve under managed root: ${managedRoot}`);
  }
}

function prepareManagedTarget({ targetRoot, repoPath, managedRoot }) {
  assertManagedTargetPath({ managedRoot, targetRoot });

  const markerPath = join(targetRoot, MANAGED_EXTERNAL_MARKER);
  if (existsSync(targetRoot) && !existsSync(markerPath)) {
    throw new Error(`refusing to delete unmarked sync-external target: ${targetRoot}`);
  }

  mkdirSync(targetRoot, { recursive: true });
  writeFileSync(markerPath, 'managed by skills-index sync-external\n');
  rmSync(repoPath, { recursive: true, force: true });
}

function cloneMirror({ targetRoot, repoPath, managedRoot, repoUrl, ref, forceFresh = false }) {
  prepareManagedTarget({ targetRoot, repoPath, managedRoot });
  runGit(['clone', '--depth', '1', '--branch', ref, repoUrl, repoPath]);
  return {
    mode: forceFresh ? 'fresh-clone' : 'cloned',
    changed: true,
    commit_before: null,
    commit_after: resolveHeadCommit(repoPath),
  };
}

function updateMirror({ repoPath, repoUrl, ref }) {
  const commitBefore = resolveHeadCommit(repoPath);
  const remoteCommit = resolveRemoteCommit(repoUrl, ref);
  runGit(['-C', repoPath, 'remote', 'set-url', 'origin', repoUrl]);

  if (commitBefore && commitBefore === remoteCommit) {
    const localDrift = mirrorHasLocalDrift(repoPath);
    if (localDrift) {
      runGit(['-C', repoPath, 'reset', '--hard', 'HEAD']);
      runGit(['-C', repoPath, 'clean', '-fdx']);
    }
    return {
      mode: localDrift ? 'cleaned' : 'reused',
      changed: localDrift,
      commit_before: commitBefore,
      commit_after: resolveHeadCommit(repoPath),
      remote_commit: remoteCommit,
    };
  }

  runGit(['-C', repoPath, 'fetch', '--depth', '1', 'origin', ref]);
  runGit(['-C', repoPath, 'checkout', '--force', '--detach', 'FETCH_HEAD']);
  runGit(['-C', repoPath, 'reset', '--hard', 'FETCH_HEAD']);
  runGit(['-C', repoPath, 'clean', '-fdx']);

  return {
    mode: 'updated',
    changed: true,
    commit_before: commitBefore,
    commit_after: resolveHeadCommit(repoPath),
    remote_commit: remoteCommit,
  };
}

function syncExternalSkillSource(flags, options) {
  const repoUrl = String(flags['repo-url'] || '').trim();
  if (!repoUrl) {
    throw new Error('sync-external requires --repo-url');
  }

  const paths = resolvePaths(options);
  const ref = String(flags.ref || 'main');
  const name = String(flags.name || detectRepoName(repoUrl));
  const skillSubdir = String(flags['skill-subdir'] || 'skills');
  const managedRoot = join(paths.platformRoot, 'external-skills');
  const targetRoot = resolve(
    flags.target ||
    join(managedRoot, sanitizeSegment(name), sanitizeSegment(ref)),
  );
  const repoPath = join(targetRoot, 'repo');
  const skillRoot = join(repoPath, skillSubdir);
  const forceFresh = flags['force-fresh'] === true || flags['force-refresh'] === true;

  const syncResult =
    managedMirrorExists(repoPath) && !forceFresh
      ? updateMirror({ repoPath, repoUrl, ref })
      : cloneMirror({ targetRoot, repoPath, managedRoot, repoUrl, ref, forceFresh });

  if (!existsSync(skillRoot)) {
    throw new Error(`mirrored repo does not contain skill directory: ${skillRoot}`);
  }

  const manifestPath = String(flags['manifest-path'] || paths.externalSourceManifestPath);
  updateExternalSourceManifest(manifestPath, {
    name,
    repo_url: repoUrl,
    ref,
    enabled: true,
    trust_level: 'external',
    advisory_only: true,
    skill_root: skillRoot,
  });

  return {
    name,
    repo_url: repoUrl,
    ref,
    manifest_path: manifestPath,
    repo_path: repoPath,
    skill_root: skillRoot,
    ...syncResult,
  };
}

async function runWatch(options) {
  const { watch } = await import('chokidar');
  const paths = resolvePaths(options);

  let rebuildTimer = null;
  async function rebuild(trigger = 'startup') {
    const platform = await compilePlatform(options);
    try {
      printJson({
        event: trigger,
        generated_at: platform.compiled.generatedAt,
        counts: platform.status.counts,
      });
    } finally {
      platform.store.close();
    }
  }

  await rebuild('startup');
  const watcher = watch(paths.watchRoots, {
    ignoreInitial: true,
    persistent: true,
  });

  watcher.on('all', (event, filePath) => {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => {
      rebuild(`${event}:${filePath}`).catch((error) => {
        console.error('[skills-index]', error.message);
      });
    }, 150);
  });
}

async function run() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  const options = optionsFromFlags(flags);

  if (command === 'watch') {
    await runWatch(options);
    return;
  }

  if (command === 'compile' || command === 'index') {
    const platform = await compilePlatform(options);
    try {
      printJson({
        generated_at: platform.compiled.generatedAt,
        compiled_root: platform.paths.compiledRoot,
        db_path: platform.paths.dbPath,
        counts: platform.status.counts,
      });
      return;
    } finally {
      platform.store.close();
    }
  }

  if (command === 'catalog') {
    const platform = await loadPlatform(options);
    try {
      printJson(skillCatalog(platform, { limit: Number(flags.limit || 100) }));
      return;
    } finally {
      platform.store.close();
    }
  }

  if (command === 'search' || command === 'match') {
    const platform = await loadPlatform(options);
    try {
      printJson(
        await skillSearch(String(flags.text || flags.query || ''), platform, {
          limit: Number(flags.limit || 10),
          mode: String(flags.mode || 'keyword'),
        }),
      );
      return;
    } finally {
      platform.store.close();
    }
  }

  if (command === 'status') {
    const platform = await loadPlatform(options);
    try {
      printJson(skillStatus(platform));
      return;
    } finally {
      platform.store.close();
    }
  }

  if (command === 'bundle-status') {
    const platform = await loadPlatform(options);
    try {
      printJson(skillBundleStatus(platform, { repo: flags.repo || null, taskType: flags.task || null }));
      return;
    } finally {
      platform.store.close();
    }
  }

  if (command === 'policy') {
    const platform = await loadPlatform(options);
    try {
      printJson(getPolicyBundle(String(flags.agent || 'claude'), platform, flags.repo || null, flags.task || null));
      return;
    } finally {
      platform.store.close();
    }
  }

  if (command === 'bootstrap') {
    const platform = await loadPlatform(options);
    try {
      printJson(
        await taskBootstrap(String(flags.agent || 'claude'), String(flags.text || flags.query || ''), platform, {
          repo: flags.repo || null,
          taskType: flags.task || null,
          limit: Number(flags.limit || 8),
        }),
      );
      return;
    } finally {
      platform.store.close();
    }
  }

  if (command === 'validate') {
    const platform = await loadPlatform(options);
    try {
      printJson(
        await skillValidateCandidates(platform, {
          repo: flags.repo || null,
          taskType: flags.task || null,
          taskText: String(flags.text || flags.query || ''),
          skillIds: String(flags.skills || '')
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean),
          limit: Number(flags.limit || 10),
        }),
      );
      return;
    } finally {
      platform.store.close();
    }
  }

  if (command === 'evaluate') {
    const platform = await loadPlatform(options);
    try {
      printJson(
        await skillEvaluateChallengers(platform, {
          repo: flags.repo || null,
          taskType: flags.task || null,
          bundleKey: flags.bundle || flags['bundle-key'] || null,
          capabilityKey: flags.capability || flags['capability-key'] || null,
          shadowLimit: flags['shadow-limit'] ? Number(flags['shadow-limit']) : null,
        }),
      );
      return;
    } finally {
      platform.store.close();
    }
  }

  if (command === 'sync-external') {
    printJson(syncExternalSkillSource(flags, options));
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

run().catch((error) => {
  console.error(`[skills-index] ${error.message}`);
  process.exit(1);
});
