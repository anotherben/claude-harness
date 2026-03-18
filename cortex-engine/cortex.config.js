/** @type {import('./src/types').CortexConfig} */
module.exports = {
  watchPaths: ['.'],
  ignorePaths: ['node_modules', '.git', '.cortex', 'dist', 'build', 'coverage'],
  extensions: [
    '.js', '.jsx', '.cjs', '.mjs', '.ts', '.tsx',
    '.json', '.yaml', '.yml', '.graphql', '.gql',
    '.md', '.toml', '.xml', '.html', '.css', '.scss', '.less',
    '.vue', '.svelte',
  ],
  dbPath: '.cortex/index.db',
  debounceMs: 100,
};
