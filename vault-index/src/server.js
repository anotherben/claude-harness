// Guard stdout — MCP uses stdio transport
console.log = console.error;

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve, normalize } from 'node:path';
import { initDb } from './storage/db.js';
import { indexVault } from './indexer/pipeline.js';
import { createEmbedder, preWarmModel } from './indexer/embedder.js';
import {
  claimItem,
  completeItem,
  getClaim,
  heartbeatItem,
  listClaims,
  releaseItem,
  reassignItem,
} from './coordination/claims.js';
import {
  checkDispatch,
  closeDispatchRun,
  closeWorker,
  ensureOrchestrator,
  getDispatchRun,
  getOrchestrator,
  getWorker,
  heartbeatOrchestrator,
  heartbeatWorker,
  listDispatchRuns,
  openDispatchRun,
  registerWorker,
} from './coordination/orchestration.js';

const DB_PATH = join(homedir(), '.vault-index', 'index.db');
const VAULT_PATH = join(homedir(), 'Documents', 'Product Ideas');

let db, embedder;

try {
  db = initDb(DB_PATH);
  embedder = createEmbedder();
} catch (err) {
  console.error(`[vault-index] Failed to initialize: ${err.message}`);
  process.exit(1);
}

const server = new McpServer({
  name: 'vault-index',
  version: '0.1.0'
});

// Tool 1: list_vault
server.tool('list_vault',
  'List vault items with structured filtering. Returns compact JSON with frontmatter fields and body excerpt — much cheaper than reading full files. Use this for dashboard views, status checks, and filtered queries.',
  {
    item_id: z.string().optional().describe('Filter by stable vault item id'),
    folder: z.string().optional().describe('Filter by folder: 00-Inbox, 01-Bugs, 02-Tasks, 03-Ideas, 04-In-Progress, 05-Archive'),
    project: z.string().optional().describe('Filter by project name'),
    status: z.string().optional().describe('Filter by status: open, claimed, in-progress, blocked, done, wont-do'),
    type: z.string().optional().describe('Filter by type: bug, task, idea, feature, decision, note'),
    priority: z.string().optional().describe('Filter by priority: critical, high, medium, low'),
    limit: z.number().int().min(1).max(200).optional().default(50).describe('Max results')
  },
  async ({ item_id, folder, project, status, type, priority, limit }) => {
    try {
      let sql = `SELECT id, path, folder, type, priority, project, module, status, complexity,
                        owner_family, owner_instance, branch, worktree_path, claimed_at, completed_at, handoff_from, handoff_note,
                        orchestrator_id, dispatch_run_id, worker_id,
                        created, updated, body_excerpt, blocked_by, related, tags
                 FROM vault_items WHERE 1=1`;
      const params = [];

      if (item_id) { sql += ' AND id = ?'; params.push(item_id); }
      if (folder) { sql += ' AND folder = ?'; params.push(folder); }
      if (project) { sql += ' AND project = ?'; params.push(project); }
      if (status) { sql += ' AND status = ?'; params.push(status); }
      if (type) { sql += ' AND type = ?'; params.push(type); }
      if (priority) { sql += ' AND priority = ?'; params.push(priority); }

      sql += ` ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END, created DESC`;
      sql += ' LIMIT ?';
      params.push(limit);

      const results = db.prepare(sql).all(...params).map(formatVaultItemRow);

      return {
        content: [{ type: 'text', text: JSON.stringify({ count: results.length, items: results }, null, 2) }]
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// Tool 2: search_vault
server.tool('search_vault',
  'Search vault items by keyword (FTS5) or semantic similarity (embeddings). Returns matching items with excerpts and metadata. Use keyword mode for exact terms, semantic mode for conceptual searches.',
  {
    query: z.string().max(500).describe('Search query'),
    mode: z.enum(['keyword', 'semantic']).optional().default('keyword').describe('Search mode: keyword (FTS5) or semantic (embeddings)'),
    folder: z.string().optional().describe('Filter by folder'),
    project: z.string().optional().describe('Filter by project'),
    limit: z.number().int().min(1).max(50).optional().default(10).describe('Max results')
  },
  async ({ query, mode, folder, project, limit }) => {
    try {
      let results;

      if (mode === 'semantic') {
        const queryEmbedding = await embedder.embed(query);
        let sql = `
          SELECT vi.id, vi.path, vi.folder, vi.type, vi.priority, vi.project, vi.module,
                 vi.status, vi.complexity, vi.owner_family, vi.owner_instance, vi.branch, vi.worktree_path, vi.claimed_at, vi.completed_at,
                 vi.orchestrator_id, vi.dispatch_run_id, vi.worker_id,
                 vi.created, vi.updated, vi.body_excerpt, vi.blocked_by, vi.related, vi.tags,
                 ve.distance
          FROM vault_embeddings ve
          JOIN vault_items vi ON vi.rowid = ve.item_id
          WHERE ve.embedding MATCH ? AND k = ?
        `;
        const params = [queryEmbedding, limit * 3];
        const raw = db.prepare(sql).all(...params);

        // Filter by folder/project in JS (vec0 doesn't support WHERE clauses well)
        results = raw
          .filter(r => (!folder || r.folder === folder) && (!project || r.project === project))
          .slice(0, limit)
          .map(r => ({
            ...r,
            similarity: Math.max(0, 1 - r.distance / 2),
          }));
      } else {
        // FTS5 keyword search
        let sql = `
          SELECT vi.id, vi.path, vi.folder, vi.type, vi.priority, vi.project, vi.module,
                 vi.status, vi.complexity, vi.owner_family, vi.owner_instance, vi.branch, vi.worktree_path, vi.claimed_at, vi.completed_at,
                 vi.orchestrator_id, vi.dispatch_run_id, vi.worker_id,
                 vi.created, vi.updated, vi.body_excerpt, vi.blocked_by, vi.related, vi.tags,
                 snippet(vault_fts, 1, '>>>', '<<<', '...', 40) as match_excerpt
          FROM vault_fts
          JOIN vault_items vi ON vi.path = vault_fts.path
          WHERE vault_fts MATCH ?
        `;
        const params = [query];

        if (folder) { sql += ' AND vi.folder = ?'; params.push(folder); }
        if (project) { sql += ' AND vi.project = ?'; params.push(project); }

        sql += ' ORDER BY rank LIMIT ?';
        params.push(limit);

        results = db.prepare(sql).all(...params);
      }

      results = results.map(formatVaultItemRow);

      return {
        content: [{ type: 'text', text: JSON.stringify({ count: results.length, results }, null, 2) }]
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Search error: ${err.message}` }], isError: true };
    }
  }
);

// Tool 3: get_vault_item
server.tool('get_vault_item',
  'Get the full content of a single vault item (frontmatter + body). Use sparingly — prefer list_vault for metadata and search_vault for finding items. Only use this when you need the complete file content.',
  {
    path: z.string().describe('Relative path within the vault (e.g., "01-Bugs/20260317-bug-po-approve.md")')
  },
  async ({ path: relPath }) => {
    try {
      // Security: reject absolute paths, .., and normalize before checking
      if (relPath.startsWith('/') || relPath.includes('..')) {
        return { content: [{ type: 'text', text: 'Error: path outside vault' }], isError: true };
      }
      const fullPath = normalize(resolve(VAULT_PATH, relPath));
      if (!fullPath.startsWith(VAULT_PATH + '/')) {
        return { content: [{ type: 'text', text: 'Error: path outside vault' }], isError: true };
      }

      const content = await readFile(fullPath, 'utf-8');
      const item = db.prepare('SELECT * FROM vault_items WHERE path = ?').get(relPath);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            path: relPath,
            metadata: item ? {
              id: item.id,
              folder: item.folder, type: item.type, priority: item.priority,
              project: item.project, module: item.module, status: item.status,
              owner_family: item.owner_family, owner_instance: item.owner_instance,
              branch: item.branch, worktree_path: item.worktree_path, claimed_at: item.claimed_at,
              orchestrator_id: item.orchestrator_id, dispatch_run_id: item.dispatch_run_id, worker_id: item.worker_id,
              completed_at: item.completed_at, handoff_from: item.handoff_from, handoff_note: item.handoff_note,
              complexity: item.complexity, created: item.created, updated: item.updated,
              blocked_by: safeJsonParse(item.blocked_by, []),
              related: safeJsonParse(item.related, []),
              tags: safeJsonParse(item.tags, [])
            } : null,
            content
          }, null, 2)
        }]
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// Tool 4: index_vault
server.tool('index_vault',
  'Index or re-index the Obsidian vault. Parses frontmatter, builds FTS5 index, and generates embeddings. Incremental mode only processes changed files. Call this after writing new vault files.',
  {
    incremental: z.boolean().optional().default(true).describe('Only re-index changed files (default true)')
  },
  async ({ incremental }) => {
    try {
      const stats = await indexVault({ vaultPath: VAULT_PATH, db, embedder, incremental });
      return {
        content: [{ type: 'text', text: JSON.stringify(stats) }]
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Index error: ${err.message}` }], isError: true };
    }
  }
);

// Tool 5: claim_item
server.tool('claim_item',
  'Atomically claim a vault item for exclusive work ownership. Fails if another live claim already exists.',
  {
    item_id: z.string().describe('Stable vault item id'),
    owner_family: z.enum(['claude', 'codex']).describe('Owning agent family'),
    owner_instance: z.string().describe('Exact owning agent instance, for example codex:session-123'),
    repo_path: z.string().describe('Absolute repo path for the claimed work lane'),
    branch: z.string().describe('Dedicated branch name for this item'),
    worktree_path: z.string().describe('Dedicated worktree path for this item'),
    lease_seconds: z.number().int().min(30).max(86400).optional().default(900).describe('Lease duration in seconds')
  },
  async ({ item_id, owner_family, owner_instance, repo_path, branch, worktree_path, lease_seconds }) => {
    try {
      const claim = claimItem({
        db,
        itemId: item_id,
        ownerFamily: owner_family,
        ownerInstance: owner_instance,
        repoPath: repo_path,
        branch,
        worktreePath: worktree_path,
        now: new Date().toISOString(),
        leaseSeconds: lease_seconds,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, claim }, null, 2) }]
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Claim error: ${err.message}` }], isError: true };
    }
  }
);

// Tool 6: heartbeat_item
server.tool('heartbeat_item',
  'Renew the lease on a claimed vault item. Only the current owner may heartbeat the claim.',
  {
    item_id: z.string().describe('Stable vault item id'),
    owner_instance: z.string().describe('Exact owning agent instance'),
    lease_seconds: z.number().int().min(30).max(86400).optional().default(900).describe('Lease duration in seconds')
  },
  async ({ item_id, owner_instance, lease_seconds }) => {
    try {
      const claim = heartbeatItem({
        db,
        itemId: item_id,
        ownerInstance: owner_instance,
        now: new Date().toISOString(),
        leaseSeconds: lease_seconds,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, claim }, null, 2) }]
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Heartbeat error: ${err.message}` }], isError: true };
    }
  }
);

// Tool 7: release_item
server.tool('release_item',
  'Release a live claim without completing the work. Only the current owner may release the claim.',
  {
    item_id: z.string().describe('Stable vault item id'),
    owner_instance: z.string().describe('Exact owning agent instance'),
    note: z.string().optional().describe('Optional release note')
  },
  async ({ item_id, owner_instance, note }) => {
    try {
      const claim = releaseItem({
        db,
        itemId: item_id,
        ownerInstance: owner_instance,
        now: new Date().toISOString(),
        note: note ?? null,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, claim }, null, 2) }]
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Release error: ${err.message}` }], isError: true };
    }
  }
);

// Tool 8: reassign_item
server.tool('reassign_item',
  'Transfer item ownership explicitly from one agent instance to another.',
  {
    item_id: z.string().describe('Stable vault item id'),
    from_owner_instance: z.string().describe('Current owning instance'),
    to_owner_family: z.enum(['claude', 'codex']).describe('Target owning agent family'),
    to_owner_instance: z.string().describe('Target owning agent instance'),
    repo_path: z.string().optional().describe('Optional repo path override for the new owner'),
    branch: z.string().optional().describe('Optional branch override for the new owner'),
    worktree_path: z.string().optional().describe('Optional worktree path override for the new owner'),
    note: z.string().optional().describe('Human-readable handoff note'),
    lease_seconds: z.number().int().min(30).max(86400).optional().default(900).describe('Lease duration in seconds')
  },
  async ({ item_id, from_owner_instance, to_owner_family, to_owner_instance, repo_path, branch, worktree_path, note, lease_seconds }) => {
    try {
      const claim = reassignItem({
        db,
        itemId: item_id,
        fromOwnerInstance: from_owner_instance,
        toOwnerFamily: to_owner_family,
        toOwnerInstance: to_owner_instance,
        repoPath: repo_path ?? null,
        branch: branch ?? null,
        worktreePath: worktree_path ?? null,
        now: new Date().toISOString(),
        note: note ?? null,
        leaseSeconds: lease_seconds,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, claim }, null, 2) }]
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Reassign error: ${err.message}` }], isError: true };
    }
  }
);

// Tool 9: complete_item
server.tool('complete_item',
  'Mark a claimed item as completed. Only the current owner may complete the claim.',
  {
    item_id: z.string().describe('Stable vault item id'),
    owner_instance: z.string().describe('Exact owning agent instance'),
    note: z.string().optional().describe('Optional completion note')
  },
  async ({ item_id, owner_instance, note }) => {
    try {
      const claim = completeItem({
        db,
        itemId: item_id,
        ownerInstance: owner_instance,
        now: new Date().toISOString(),
        note: note ?? null,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, claim }, null, 2) }]
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Complete error: ${err.message}` }], isError: true };
    }
  }
);

// Tool 10: get_claim
server.tool('get_claim',
  'Get the current claim state for a vault item.',
  {
    item_id: z.string().describe('Stable vault item id')
  },
  async ({ item_id }) => {
    try {
      const claim = getClaim({ db, itemId: item_id });
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, claim }, null, 2) }]
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Get claim error: ${err.message}` }], isError: true };
    }
  }
);

// Tool 11: list_claims
server.tool('list_claims',
  'List live and historical claim rows, optionally filtered by project or state.',
  {
    project: z.string().optional().describe('Optional project filter'),
    state: z.string().optional().describe('Optional state filter, for example claimed or completed')
  },
  async ({ project, state }) => {
    try {
      const claims = listClaims({ db, project: project ?? null, state: state ?? null });
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, count: claims.length, claims }, null, 2) }]
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `List claims error: ${err.message}` }], isError: true };
    }
  }
);

// Tool 12: ensure_orchestrator
server.tool('ensure_orchestrator',
  'Ensure the shared global conductor is registered and leased to the current coordinator instance.',
  {
    profile_name: z.string().describe('Agent-deck profile name, for example LEADER'),
    conductor_name: z.string().describe('Conductor name, for example orchestrator'),
    owner_family: z.enum(['claude', 'codex']).describe('Owning agent family'),
    owner_instance: z.string().describe('Exact owning coordinator instance'),
    agent_deck_session: z.string().optional().describe('Agent-deck session title or id for the conductor'),
    repo_scope: z.string().optional().default('global').describe('Scope label for this orchestrator'),
    lease_seconds: z.number().int().min(30).max(86400).optional().default(900).describe('Lease duration in seconds')
  },
  async ({ profile_name, conductor_name, owner_family, owner_instance, agent_deck_session, repo_scope, lease_seconds }) => {
    try {
      const orchestrator = ensureOrchestrator({
        db,
        profileName: profile_name,
        conductorName: conductor_name,
        ownerFamily: owner_family,
        ownerInstance: owner_instance,
        agentDeckSession: agent_deck_session ?? null,
        repoScope: repo_scope ?? 'global',
        now: new Date().toISOString(),
        leaseSeconds: lease_seconds,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, orchestrator }, null, 2) }]
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Ensure orchestrator error: ${err.message}` }], isError: true };
    }
  }
);

// Tool 13: heartbeat_orchestrator
server.tool('heartbeat_orchestrator',
  'Renew the lease on the shared global orchestrator.',
  {
    orchestrator_id: z.string().describe('Stable orchestrator id'),
    owner_instance: z.string().describe('Exact owning coordinator instance'),
    lease_seconds: z.number().int().min(30).max(86400).optional().default(900).describe('Lease duration in seconds')
  },
  async ({ orchestrator_id, owner_instance, lease_seconds }) => {
    try {
      const orchestrator = heartbeatOrchestrator({
        db,
        orchestratorId: orchestrator_id,
        ownerInstance: owner_instance,
        now: new Date().toISOString(),
        leaseSeconds: lease_seconds,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, orchestrator }, null, 2) }]
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Heartbeat orchestrator error: ${err.message}` }], isError: true };
    }
  }
);

// Tool 14: get_orchestrator
server.tool('get_orchestrator',
  'Get the current orchestrator registry row.',
  {
    profile_name: z.string().optional().describe('Agent-deck profile name'),
    conductor_name: z.string().optional().describe('Conductor name'),
    orchestrator_id: z.string().optional().describe('Stable orchestrator id')
  },
  async ({ profile_name, conductor_name, orchestrator_id }) => {
    try {
      const orchestrator = getOrchestrator({
        db,
        profileName: profile_name ?? null,
        conductorName: conductor_name ?? null,
        orchestratorId: orchestrator_id ?? null,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, orchestrator }, null, 2) }]
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Get orchestrator error: ${err.message}` }], isError: true };
    }
  }
);

// Tool 15: open_dispatch_run
server.tool('open_dispatch_run',
  'Open a registered dispatch run for a single vault item and work lane.',
  {
    orchestrator_id: z.string().describe('Stable orchestrator id'),
    vault_item_id: z.string().describe('Stable vault item id'),
    project: z.string().optional().describe('Project name'),
    repo_path: z.string().describe('Canonical repo root path'),
    branch: z.string().describe('Dedicated branch for this run'),
    worktree_path: z.string().describe('Dedicated worktree for this run'),
    requested_by: z.string().optional().describe('Human or session that requested the run')
  },
  async ({ orchestrator_id, vault_item_id, project, repo_path, branch, worktree_path, requested_by }) => {
    try {
      const run = openDispatchRun({
        db,
        orchestratorId: orchestrator_id,
        vaultItemId: vault_item_id,
        project: project ?? null,
        repoPath: repo_path,
        branch,
        worktreePath: worktree_path,
        requestedBy: requested_by ?? null,
        now: new Date().toISOString(),
      });
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, run }, null, 2) }]
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Open dispatch run error: ${err.message}` }], isError: true };
    }
  }
);

// Tool 16: get_dispatch_run
server.tool('get_dispatch_run',
  'Get a single dispatch run by id.',
  {
    run_id: z.string().describe('Dispatch run id')
  },
  async ({ run_id }) => {
    try {
      const run = getDispatchRun({ db, runId: run_id });
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, run }, null, 2) }]
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Get dispatch run error: ${err.message}` }], isError: true };
    }
  }
);

// Tool 17: list_dispatch_runs
server.tool('list_dispatch_runs',
  'List registered dispatch runs, optionally filtered by project or status.',
  {
    project: z.string().optional().describe('Optional project filter'),
    status: z.string().optional().describe('Optional status filter, for example open or closed')
  },
  async ({ project, status }) => {
    try {
      const runs = listDispatchRuns({ db, project: project ?? null, status: status ?? null });
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, count: runs.length, runs }, null, 2) }]
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `List dispatch runs error: ${err.message}` }], isError: true };
    }
  }
);

// Tool 18: register_worker
server.tool('register_worker',
  'Register the active worker session against an open dispatch run.',
  {
    run_id: z.string().describe('Dispatch run id'),
    vault_item_id: z.string().describe('Stable vault item id'),
    owner_family: z.enum(['claude', 'codex']).describe('Owning agent family'),
    owner_instance: z.string().describe('Exact owning worker instance'),
    agent_deck_session: z.string().optional().describe('Agent-deck session title or id'),
    repo_path: z.string().describe('Canonical repo root path'),
    branch: z.string().describe('Dedicated branch for this worker'),
    worktree_path: z.string().describe('Dedicated worktree for this worker'),
    worker_id: z.string().optional().describe('Optional stable worker id'),
    lease_seconds: z.number().int().min(30).max(86400).optional().default(900).describe('Lease duration in seconds')
  },
  async ({ run_id, vault_item_id, owner_family, owner_instance, agent_deck_session, repo_path, branch, worktree_path, worker_id, lease_seconds }) => {
    try {
      const worker = registerWorker({
        db,
        runId: run_id,
        vaultItemId: vault_item_id,
        ownerFamily: owner_family,
        ownerInstance: owner_instance,
        agentDeckSession: agent_deck_session ?? null,
        repoPath: repo_path,
        branch,
        worktreePath: worktree_path,
        workerId: worker_id ?? null,
        now: new Date().toISOString(),
        leaseSeconds: lease_seconds,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, worker }, null, 2) }]
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Register worker error: ${err.message}` }], isError: true };
    }
  }
);

// Tool 19: get_worker
server.tool('get_worker',
  'Get a registered worker by id.',
  {
    worker_id: z.string().describe('Worker id')
  },
  async ({ worker_id }) => {
    try {
      const worker = getWorker({ db, workerId: worker_id });
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, worker }, null, 2) }]
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Get worker error: ${err.message}` }], isError: true };
    }
  }
);

// Tool 20: heartbeat_worker
server.tool('heartbeat_worker',
  'Renew the lease on a registered worker.',
  {
    worker_id: z.string().describe('Worker id'),
    owner_instance: z.string().describe('Exact owning worker instance'),
    lease_seconds: z.number().int().min(30).max(86400).optional().default(900).describe('Lease duration in seconds')
  },
  async ({ worker_id, owner_instance, lease_seconds }) => {
    try {
      const worker = heartbeatWorker({
        db,
        workerId: worker_id,
        ownerInstance: owner_instance,
        now: new Date().toISOString(),
        leaseSeconds: lease_seconds,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, worker }, null, 2) }]
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Heartbeat worker error: ${err.message}` }], isError: true };
    }
  }
);

// Tool 21: close_worker
server.tool('close_worker',
  'Close a registered worker lease.',
  {
    worker_id: z.string().describe('Worker id'),
    owner_instance: z.string().describe('Exact owning worker instance'),
    status: z.string().optional().default('closed').describe('Terminal worker status')
  },
  async ({ worker_id, owner_instance, status }) => {
    try {
      const worker = closeWorker({
        db,
        workerId: worker_id,
        ownerInstance: owner_instance,
        status,
        now: new Date().toISOString(),
      });
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, worker }, null, 2) }]
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Close worker error: ${err.message}` }], isError: true };
    }
  }
);

// Tool 22: close_dispatch_run
server.tool('close_dispatch_run',
  'Close a dispatch run after all workers have exited.',
  {
    run_id: z.string().describe('Dispatch run id'),
    orchestrator_id: z.string().describe('Owning orchestrator id'),
    status: z.string().optional().default('closed').describe('Terminal run status')
  },
  async ({ run_id, orchestrator_id, status }) => {
    try {
      const run = closeDispatchRun({
        db,
        runId: run_id,
        orchestratorId: orchestrator_id,
        status,
        now: new Date().toISOString(),
      });
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, run }, null, 2) }]
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Close dispatch run error: ${err.message}` }], isError: true };
    }
  }
);

// Tool 23: check_dispatch
server.tool('check_dispatch',
  'Verify that the current lane has a live orchestrator, dispatch run, worker registration, and matching vault claim.',
  {
    profile_name: z.string().describe('Agent-deck profile name'),
    conductor_name: z.string().describe('Conductor name'),
    owner_instance: z.string().optional().describe('Exact owning worker instance'),
    agent_deck_session: z.string().optional().describe('Agent-deck session title or id'),
    repo_path: z.string().describe('Canonical repo root path'),
    branch: z.string().describe('Current branch'),
    worktree_path: z.string().describe('Current worktree path'),
    item_id: z.string().optional().describe('Optional stable vault item id')
  },
  async ({ profile_name, conductor_name, owner_instance, agent_deck_session, repo_path, branch, worktree_path, item_id }) => {
    try {
      const result = checkDispatch({
        db,
        profileName: profile_name,
        conductorName: conductor_name,
        ownerInstance: owner_instance ?? null,
        agentDeckSession: agent_deck_session ?? null,
        repoPath: repo_path,
        branch,
        worktreePath: worktree_path,
        itemId: item_id ?? null,
        now: new Date().toISOString(),
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Check dispatch error: ${err.message}` }], isError: true };
    }
  }
);

// --- Helpers ---

function safeJsonParse(str, fallback) {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

function extractTitle(bodyExcerpt, path) {
  if (bodyExcerpt) {
    const match = bodyExcerpt.match(/^#\s+(.+?)(?:\s*\.\.\.)?$/m);
    if (match) return match[1].trim();
  }
  // Fallback: derive from filename
  const filename = path.split('/').pop().replace(/\.md$/, '');
  // Strip date prefix like 20260317-1110-bug-
  return filename.replace(/^\d{8}-\d{4,6}-\w+-/, '').replace(/-/g, ' ');
}

function formatVaultItemRow(row) {
  if (!row) return null;
  return {
    ...row,
    blocked_by: safeJsonParse(row.blocked_by, []),
    related: safeJsonParse(row.related, []),
    tags: safeJsonParse(row.tags, []),
    title: extractTitle(row.body_excerpt, row.path),
  };
}

// --- Start ---

const transport = new StdioServerTransport();
await server.connect(transport);

// Pre-warm embedding model in background
preWarmModel().catch(err => console.error(`[vault-index] Model pre-warm failed: ${err.message}`));

// Graceful shutdown
process.on('exit', () => { try { db.pragma('wal_checkpoint(TRUNCATE)'); db.close(); } catch {} });
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
