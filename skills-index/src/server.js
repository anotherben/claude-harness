import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  compilePlatform,
  getPolicyBundle,
  getSkillBundle,
  getSkillMetadata,
  loadPlatform,
  matchSkills,
  skillCatalog,
  skillOutline,
  skillReadSection,
  skillReadSections,
  skillSearch,
  skillStatus,
  skillTelemetry,
} from './platform.js';
import { buildMeta, estimateTokens, makeTextResult } from './telemetry.js';

function errorResult(message) {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: message }, null, 2) }],
    isError: true,
  };
}

function fileTokensFromBundle(bundle) {
  return bundle.reduce((sum, item) => sum + (item.token_estimate || 0), 0);
}

async function withPlatform(platformLoader, fn) {
  const platform = await platformLoader();
  try {
    return await fn(platform);
  } finally {
    platform.store?.close?.();
  }
}

async function respondWithTelemetry({ toolName, queryText = '', platform, payload, fileTokens = 0, resultCount = 0 }) {
  const responseTokens = estimateTokens(JSON.stringify(payload));
  platform.store.recordTelemetry({
    toolName,
    queryText,
    fileTokens,
    responseTokens,
    resultCount,
  });
  const report = platform.store.getTelemetryReport();
  return makeTextResult(
    payload,
    buildMeta({
      timingMs: 0,
      fileTokens,
      responseTokens,
      report,
    }),
  );
}

export function buildToolHandlers({ platformLoader = loadPlatform, compileLoader = compilePlatform } = {}) {
  return {
    async skill_catalog({ limit = 100 }) {
      const startedAt = performance.now();
      return withPlatform(platformLoader, async (platform) => {
        const payload = skillCatalog(platform, { limit });
        const fileTokens = payload.skills.reduce((sum, skill) => sum + (skill.token_estimate || 0), 0);
        const responseTokens = estimateTokens(JSON.stringify(payload));
        platform.store.recordTelemetry({
          toolName: 'skill_catalog',
          fileTokens,
          responseTokens,
          resultCount: payload.count,
        });
        const report = platform.store.getTelemetryReport();
        return makeTextResult(
          payload,
          buildMeta({
            timingMs: performance.now() - startedAt,
            fileTokens,
            responseTokens,
            report,
          }),
        );
      });
    },
    async skill_search({ query, limit = 10, mode = 'keyword' }) {
      const startedAt = performance.now();
      return withPlatform(platformLoader, async (platform) => {
        const payload = await skillSearch(query, platform, { limit, mode });
        const fileTokens = payload.matches.reduce((sum, skill) => sum + (skill.token_estimate || 0), 0);
        const responseTokens = estimateTokens(JSON.stringify(payload));
        platform.store.recordTelemetry({
          toolName: 'skill_search',
          queryText: query,
          fileTokens,
          responseTokens,
          resultCount: payload.count,
        });
        const report = platform.store.getTelemetryReport();
        return makeTextResult(
          payload,
          buildMeta({
            timingMs: performance.now() - startedAt,
            fileTokens,
            responseTokens,
            report,
          }),
        );
      });
    },
    async skill_outline({ skill_id }) {
      const startedAt = performance.now();
      return withPlatform(platformLoader, async (platform) => {
        const payload = skillOutline(skill_id, platform);
        if (!payload) {
          return errorResult('Skill not found');
        }
        const fileTokens = payload.skill.token_estimate || 0;
        const responseTokens = estimateTokens(JSON.stringify(payload));
        platform.store.recordTelemetry({
          toolName: 'skill_outline',
          queryText: skill_id,
          fileTokens,
          responseTokens,
          resultCount: payload.sections.length,
        });
        const report = platform.store.getTelemetryReport();
        return makeTextResult(
          payload,
          buildMeta({
            timingMs: performance.now() - startedAt,
            fileTokens,
            responseTokens,
            report,
          }),
        );
      });
    },
    async skill_read_section({ skill_id, section = 'overview' }) {
      const startedAt = performance.now();
      return withPlatform(platformLoader, async (platform) => {
        const payload = skillReadSection(skill_id, section, platform);
        if (!payload) {
          return errorResult('Skill section not found');
        }
        const fileTokens = payload.skill.token_estimate || 0;
        const responseTokens = estimateTokens(JSON.stringify(payload));
        platform.store.recordTelemetry({
          toolName: 'skill_read_section',
          queryText: `${skill_id}:${section}`,
          fileTokens,
          responseTokens,
          resultCount: 1,
        });
        const report = platform.store.getTelemetryReport();
        return makeTextResult(
          payload,
          buildMeta({
            timingMs: performance.now() - startedAt,
            fileTokens,
            responseTokens,
            report,
          }),
        );
      });
    },
    async skill_read_sections({ requests }) {
      const startedAt = performance.now();
      return withPlatform(platformLoader, async (platform) => {
        const payload = skillReadSections(requests, platform);
        const fileTokens = fileTokensFromBundle(payload.bundle);
        const responseTokens = estimateTokens(JSON.stringify(payload));
        platform.store.recordTelemetry({
          toolName: 'skill_read_sections',
          fileTokens,
          responseTokens,
          resultCount: payload.count,
        });
        const report = platform.store.getTelemetryReport();
        return makeTextResult(
          payload,
          buildMeta({
            timingMs: performance.now() - startedAt,
            fileTokens,
            responseTokens,
            report,
          }),
        );
      });
    },
    async skill_status() {
      const startedAt = performance.now();
      return withPlatform(platformLoader, async (platform) => {
        const payload = skillStatus(platform);
        const responseTokens = estimateTokens(JSON.stringify(payload));
        const report = platform.store.getTelemetryReport();
        return makeTextResult(
          payload,
          buildMeta({
            timingMs: performance.now() - startedAt,
            fileTokens: responseTokens,
            responseTokens,
            report,
          }),
        );
      });
    },
    async skill_telemetry() {
      const startedAt = performance.now();
      return withPlatform(platformLoader, async (platform) => {
        const payload = skillTelemetry(platform);
        const responseTokens = estimateTokens(JSON.stringify(payload));
        const report = platform.store.getTelemetryReport();
        return makeTextResult(
          payload,
          buildMeta({
            timingMs: performance.now() - startedAt,
            fileTokens: responseTokens,
            responseTokens,
            report,
          }),
        );
      });
    },
    async list_skills({ limit = 100 }) {
      return this.skill_catalog({ limit });
    },
    async match_skills({ task_text, limit = 10 }) {
      return this.skill_search({ query: task_text, limit, mode: 'keyword' });
    },
    async get_skill_metadata({ skill_id }) {
      return withPlatform(platformLoader, async (platform) => {
        const payload = getSkillMetadata(skill_id, platform);
        if (!payload) {
          return errorResult('Skill not found');
        }
        return makeTextResult(payload);
      });
    },
    async get_skill_section({ skill_id, section = 'overview' }) {
      return this.skill_read_section({ skill_id, section });
    },
    async get_skill_bundle({ skill_ids, sections = [] }) {
      return withPlatform(platformLoader, async (platform) => {
        const bundle = getSkillBundle(skill_ids, sections, platform);
        return makeTextResult({ count: bundle.length, bundle });
      });
    },
    async get_policy_bundle({ agent, repo, task_type }) {
      return withPlatform(platformLoader, async (platform) => {
        const payload = getPolicyBundle(agent, platform, repo || null, task_type || null);
        return makeTextResult(payload);
      });
    },
    async rebuild_platform() {
      const platform = await compileLoader({ forceRebuild: true });
      try {
        return makeTextResult({
          generated_at: platform.compiled.generatedAt,
          compiled_root: platform.paths.compiledRoot,
          skills: platform.status.counts.skills,
          policies: platform.status.counts.policies,
        });
      } finally {
        platform.store.close();
      }
    },
  };
}

export function createServer() {
  const server = new McpServer({
    name: 'skills-index',
    version: '0.2.0',
  });
  const handlers = buildToolHandlers();

  server.tool('skill_catalog', 'List indexed skills with compact metadata and section outlines.', {
    limit: z.number().int().min(1).max(200).optional().default(100),
  }, async (args) => handlers.skill_catalog(args));

  server.tool('skill_search', 'Search indexed skills by keyword or hybrid retrieval.', {
    query: z.string().min(1).max(4000),
    limit: z.number().int().min(1).max(50).optional().default(10),
    mode: z.enum(['keyword', 'hybrid', 'semantic']).optional().default('keyword'),
  }, async (args) => handlers.skill_search(args));

  server.tool('skill_outline', 'Return the section outline for one indexed skill.', {
    skill_id: z.string().min(1),
  }, async (args) => handlers.skill_outline(args));

  server.tool('skill_read_section', 'Read one section from one skill.', {
    skill_id: z.string().min(1),
    section: z.string().min(1).optional().default('overview'),
  }, async (args) => handlers.skill_read_section(args));

  server.tool('skill_read_sections', 'Read multiple sections across one or more skills.', {
    requests: z.array(
      z.object({
        skill_id: z.string().min(1),
        sections: z.array(z.string()).optional(),
      }),
    ).min(1).max(25),
  }, async (args) => handlers.skill_read_sections(args));

  server.tool('skill_status', 'Return index freshness and count information.', {}, async () => handlers.skill_status({}));
  server.tool('skill_telemetry', 'Return cumulative token-savings telemetry.', {}, async () => handlers.skill_telemetry({}));

  server.tool('list_skills', 'Compatibility alias for skill_catalog.', {
    limit: z.number().int().min(1).max(200).optional().default(100),
  }, async (args) => handlers.list_skills(args));
  server.tool('match_skills', 'Compatibility alias for skill_search.', {
    task_text: z.string().min(1).max(4000),
    limit: z.number().int().min(1).max(50).optional().default(10),
  }, async (args) => handlers.match_skills(args));
  server.tool('get_skill_metadata', 'Compatibility metadata reader.', {
    skill_id: z.string().min(1),
  }, async (args) => handlers.get_skill_metadata(args));
  server.tool('get_skill_section', 'Compatibility section reader.', {
    skill_id: z.string().min(1),
    section: z.string().min(1).optional().default('overview'),
  }, async (args) => handlers.get_skill_section(args));
  server.tool('get_skill_bundle', 'Compatibility bundle reader.', {
    skill_ids: z.array(z.string()).min(1).max(25),
    sections: z.array(z.string()).optional(),
  }, async (args) => handlers.get_skill_bundle(args));
  server.tool('get_policy_bundle', 'Return compiled policy bundle for an agent.', {
    agent: z.string().min(1),
    repo: z.string().optional(),
    task_type: z.string().optional(),
  }, async (args) => handlers.get_policy_bundle(args));
  server.tool('rebuild_platform', 'Rebuild the persistent index and compiled artifacts.', {}, async () =>
    handlers.rebuild_platform({}),
  );

  return server;
}

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error('[skills-index]', error);
    process.exit(1);
  });
}
