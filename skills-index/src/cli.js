import { compilePlatform, getPolicyBundle, loadPlatform, skillCatalog, skillSearch, skillStatus } from './platform.js';
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
    enableEmbeddings:
      flags['enable-embeddings'] === true ||
      flags['enable-embeddings'] === 'true' ||
      process.env.AGENT_PLATFORM_ENABLE_EMBEDDINGS === '1',
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

  if (command === 'policy') {
    const platform = await loadPlatform(options);
    try {
      printJson(getPolicyBundle(String(flags.agent || 'claude'), platform, flags.repo || null, flags.task || null));
      return;
    } finally {
      platform.store.close();
    }
  }

  throw new Error(`Unknown command: ${command}`);
}

run().catch((error) => {
  console.error(`[skills-index] ${error.message}`);
  process.exit(1);
});
