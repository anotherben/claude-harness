import { readdir, stat } from 'node:fs/promises';
import { join, relative, basename, dirname } from 'node:path';
import { parseVaultFile, bodyExcerpt } from './parser.js';

function ensureArray(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') return val.trim() ? [val.trim()] : [];
  return [];
}

function slugPart(value, fallback) {
  const normalized = String(value || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || fallback;
}

function datePart(value) {
  if (!value) return 'undated';
  const compact = String(value).replace(/[^0-9]/g, '');
  return compact.slice(0, 8) || 'undated';
}

function deriveStableItemId({ frontmatter, existingId, hash }) {
  if (frontmatter.id) return frontmatter.id;
  if (existingId) return existingId;

  return [
    slugPart(frontmatter.type, 'item'),
    slugPart(frontmatter.project, 'general'),
    datePart(frontmatter.created),
    hash.slice(0, 8),
  ].join('_');
}

/**
 * Index (or re-index) the vault directory.
 * @param {object} opts
 * @param {string} opts.vaultPath - Absolute path to vault root
 * @param {import('better-sqlite3').Database} opts.db
 * @param {object} opts.embedder - { embed(text): Promise<Float32Array> }
 * @param {boolean} opts.incremental - Skip unchanged files
 * @returns {{ indexed: number, skipped: number, removed: number, errors: number }}
 */
export async function indexVault({ vaultPath, db, embedder, incremental = true }) {
  const mdFiles = await findMarkdownFiles(vaultPath);
  const stats = { indexed: 0, skipped: 0, removed: 0, errors: 0 };

  // Prepare statements
  const upsertItem = db.prepare(`
    INSERT OR REPLACE INTO vault_items
      (path, id, folder, type, priority, project, module, agent, owner_family, owner_instance, status, branch, worktree_path,
       orchestrator_id, dispatch_run_id, worker_id,
       claimed_at, completed_at, handoff_from, handoff_note, complexity, blocked_by, related, tags, created, updated, body_excerpt, body, file_hash, indexed_at)
    VALUES
      (@path, @id, @folder, @type, @priority, @project, @module, @agent, @owner_family, @owner_instance, @status, @branch, @worktree_path,
       @orchestrator_id, @dispatch_run_id, @worker_id,
       @claimed_at, @completed_at, @handoff_from, @handoff_note, @complexity, @blocked_by, @related, @tags, @created, @updated, @body_excerpt, @body, @file_hash, @indexed_at)
  `);

  const getHash = db.prepare(`
    SELECT id, file_hash, owner_family, owner_instance, branch, worktree_path,
           orchestrator_id, dispatch_run_id, worker_id,
           claimed_at, completed_at, handoff_from, handoff_note
    FROM vault_items
    WHERE path = ?
  `);
  const getIdentityByHash = db.prepare(`
    SELECT id, owner_family, owner_instance, branch, worktree_path,
           orchestrator_id, dispatch_run_id, worker_id,
           claimed_at, completed_at, handoff_from, handoff_note
    FROM vault_items
    WHERE file_hash = ?
    ORDER BY indexed_at DESC
    LIMIT 1
  `);

  const deleteFts = db.prepare('DELETE FROM vault_fts WHERE path = ?');
  const insertFts = db.prepare('INSERT INTO vault_fts (path, body) VALUES (?, ?)');

  const deleteEmbedding = db.prepare('DELETE FROM vault_embeddings WHERE item_id = (SELECT rowid FROM vault_items WHERE path = ?)');
  const insertEmbedding = db.prepare('INSERT INTO vault_embeddings (item_id, embedding) VALUES ((SELECT rowid FROM vault_items WHERE path = ?), ?)');

  // Track which paths we see (for cleanup)
  const seenPaths = new Set();

  for (const filePath of mdFiles) {
    const relPath = relative(vaultPath, filePath);
    seenPaths.add(relPath);

    try {
      const { frontmatter: fm, body, hash } = await parseVaultFile(filePath);

      // Incremental: skip if hash matches
      if (incremental) {
        const existing = getHash.get(relPath);
        if (existing && existing.file_hash === hash) {
          stats.skipped++;
          continue;
        }
      }

      const folder = dirname(relPath).split('/')[0] || '';
      const existingByPath = getHash.get(relPath);
      const existingByHash = existingByPath?.id ? existingByPath : getIdentityByHash.get(hash);
      const itemId = deriveStableItemId({
        frontmatter: fm,
        existingId: existingByPath?.id || existingByHash?.id || null,
        hash,
      });

      upsertItem.run({
        path: relPath,
        id: itemId,
        folder,
        type: fm.type || null,
        priority: fm.priority || null,
        project: fm.project || null,
        module: fm.module || null,
        agent: fm.agent || null,
        owner_family: fm.owner_family || existingByPath?.owner_family || existingByHash?.owner_family || null,
        owner_instance: fm.owner_instance || existingByPath?.owner_instance || existingByHash?.owner_instance || null,
        status: fm.status || null,
        branch: fm.branch || null,
        worktree_path: fm.worktree_path || existingByPath?.worktree_path || existingByHash?.worktree_path || null,
        orchestrator_id: existingByPath?.orchestrator_id || existingByHash?.orchestrator_id || null,
        dispatch_run_id: existingByPath?.dispatch_run_id || existingByHash?.dispatch_run_id || null,
        worker_id: existingByPath?.worker_id || existingByHash?.worker_id || null,
        claimed_at: fm.claimed_at || existingByPath?.claimed_at || existingByHash?.claimed_at || null,
        completed_at: fm.completed_at || existingByPath?.completed_at || existingByHash?.completed_at || null,
        handoff_from: fm.handoff_from || existingByPath?.handoff_from || existingByHash?.handoff_from || null,
        handoff_note: fm.handoff_note || existingByPath?.handoff_note || existingByHash?.handoff_note || null,
        complexity: fm.complexity || null,
        blocked_by: JSON.stringify(ensureArray(fm['blocked-by'])),
        related: JSON.stringify(ensureArray(fm.related)),
        tags: JSON.stringify(ensureArray(fm.tags)),
        created: fm.created || null,
        updated: fm.updated || null,
        body_excerpt: bodyExcerpt(body),
        body,
        file_hash: hash,
        indexed_at: new Date().toISOString(),
      });

      // Update FTS
      deleteFts.run(relPath);
      if (body) {
        insertFts.run(relPath, body);
      }

      // Update embedding (if body has content)
      deleteEmbedding.run(relPath);
      if (body && body.length > 20) {
        try {
          const text = [fm.type, fm.project, fm.module, body.slice(0, 500)].filter(Boolean).join(' ');
          const embedding = await embedder.embed(text);
          insertEmbedding.run(relPath, embedding);
        } catch {
          // Embedding failure is non-fatal
        }
      }

      stats.indexed++;
    } catch (err) {
      console.error(`[vault-index] Error indexing ${relPath}: ${err.message}`);
      stats.errors++;
    }
  }

  // Remove items that no longer exist on disk
  const allPaths = db.prepare('SELECT path FROM vault_items').all();
  for (const row of allPaths) {
    if (!seenPaths.has(row.path)) {
      deleteFts.run(row.path);
      deleteEmbedding.run(row.path);
      db.prepare('DELETE FROM vault_items WHERE path = ?').run(row.path);
      stats.removed++;
    }
  }

  return stats;
}

async function findMarkdownFiles(dir) {
  const results = [];
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return results; }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    // Skip hidden directories
    if (entry.isDirectory() && entry.name.startsWith('.')) continue;
    if (entry.isDirectory()) {
      results.push(...await findMarkdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(fullPath);
    }
  }
  return results;
}
