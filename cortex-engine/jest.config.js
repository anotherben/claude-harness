module.exports = {
  // 1 worker per test file — tree-sitter native bindings have per-process state
  // that corrupts when multiple test files share a worker
  maxWorkers: 14,
  testTimeout: 60000,
};
