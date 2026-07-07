/**
 * Standalone daemon entry point. Spawned detached by the proxy.
 * Reads --key=value args to configure socket/pid/db paths.
 */
import { startDaemon } from './daemon.js';

const opts = {};
for (const arg of process.argv.slice(2)) {
  const eq = arg.indexOf('=');
  if (eq > 0) {
    const key = arg.slice(2, eq); // strip '--'
    opts[key] = arg.slice(eq + 1);
  }
}
// skillRoots may be passed as a comma-separated list
if (typeof opts.skillRoots === 'string') {
  opts.skillRoots = opts.skillRoots ? opts.skillRoots.split(',') : undefined;
}
if (opts.skipEmbeddings !== undefined) {
  opts.skipEmbeddings = opts.skipEmbeddings === 'true' || opts.skipEmbeddings === '1';
}
if (opts.skipSourceMtime !== undefined) {
  opts.skipSourceMtime = opts.skipSourceMtime === 'true' || opts.skipSourceMtime === '1';
}
if (!opts.runtime && process.env.SKILLS_INDEX_RUNTIME) {
  opts.runtime = process.env.SKILLS_INDEX_RUNTIME;
}

startDaemon(opts)
  .then((daemon) => {
    process.on('SIGTERM', () => daemon.close().then(() => process.exit(0)));
    process.on('SIGINT', () => daemon.close().then(() => process.exit(0)));
  })
  .catch((err) => {
    process.stderr.write(`skills-index daemon: ${err.message}\n`);
    process.exit(1);
  });
