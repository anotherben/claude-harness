const { performance } = require('../telemetry');

function registerGitTools(server, gitIntegration, telemetry) {
  server.tool('cortex_git_status', {
    description: 'Current branch, uncommitted changes, staged files',
    inputSchema: { type: 'object', properties: {} },
  }, async () => {
    const t0 = performance.now();
    const status = await gitIntegration.status();
    const result = { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
    const elapsed = performance.now() - t0;
    if (!telemetry) return result;
    return telemetry.wrapTimingOnly(result, elapsed);
  });

  server.tool('cortex_git_diff', {
    description: 'Diff vs branch/commit. Omit params for uncommitted changes.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Base branch or commit' },
        to: { type: 'string', description: 'Target branch or commit (default: HEAD)' },
        file: { type: 'string', description: 'Specific file to diff' },
      },
    },
  }, async (params) => {
    const t0 = performance.now();
    const diff = await gitIntegration.diff(params);
    const result = { content: [{ type: 'text', text: diff || '(no changes)' }] };
    const elapsed = performance.now() - t0;
    if (!telemetry) return result;
    return telemetry.wrapTimingOnly(result, elapsed);
  });

  server.tool('cortex_git_blame', {
    description: 'Who last changed each line of a file and why',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'File to blame' },
      },
      required: ['file_path'],
    },
  }, async (params) => {
    const t0 = performance.now();
    try {
      const blame = await gitIntegration.blame(params.file_path);
      const result = { content: [{ type: 'text', text: JSON.stringify(blame, null, 2) }] };
      const elapsed = performance.now() - t0;
      if (!telemetry) return result;
      return telemetry.wrapTimingOnly(result, elapsed);
    } catch (err) {
      const result = { content: [{ type: 'text', text: `Blame failed: ${err.message}` }], isError: true };
      const elapsed = performance.now() - t0;
      if (!telemetry) return result;
      return telemetry.wrapTimingOnly(result, elapsed);
    }
  });

  server.tool('cortex_git_log', {
    description: 'Recent commits, optionally filtered by file',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Filter to commits touching this file' },
        max_count: { type: 'number', description: 'Max commits to return (default: 20)' },
      },
    },
  }, async (params) => {
    const t0 = performance.now();
    const log = await gitIntegration.log({
      file: params.file,
      maxCount: params.max_count || 20,
    });
    const result = { content: [{ type: 'text', text: JSON.stringify(log, null, 2) }] };
    const elapsed = performance.now() - t0;
    if (!telemetry) return result;
    return telemetry.wrapTimingOnly(result, elapsed);
  });

  server.tool('cortex_git_hotspots', {
    description: 'Files with most edits and bug fixes in recent history',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Lookback period in days (default: 30)' },
        limit: { type: 'number', description: 'Max results (default: 20)' },
      },
    },
  }, async (params) => {
    const t0 = performance.now();
    const hotspots = await gitIntegration.hotspots({
      days: params.days || 30,
      limit: params.limit || 20,
    });
    const result = { content: [{ type: 'text', text: JSON.stringify(hotspots, null, 2) }] };
    const elapsed = performance.now() - t0;
    if (!telemetry) return result;
    return telemetry.wrapTimingOnly(result, elapsed);
  });
}

module.exports = { registerGitTools };
