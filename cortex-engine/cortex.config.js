/** @type {import('./src/types').CortexConfig} */
module.exports = {
  watchPaths: ['.'],
  ignorePaths: ['node_modules', '.git', '.cortex', 'dist', 'build', 'coverage'],
  extensions: ['.js', '.jsx', '.cjs', '.mjs', '.ts', '.tsx'],
  dbPath: '.cortex/index.db',
  debounceMs: 100,
};
