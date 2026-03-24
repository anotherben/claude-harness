import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

function hasColumn(db, tableName, columnName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all().some((row) => row.name === columnName);
}

function ensureColumn(db, tableName, columnName, definition) {
  if (!hasColumn(db, tableName, columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

export function initDb(dbPath) {
  mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');

  // Load sqlite-vec for semantic search
  sqliteVec.load(db);

  db.exec(`
    CREATE TABLE IF NOT EXISTS vault_items (
      path TEXT PRIMARY KEY,
      id TEXT,
      folder TEXT NOT NULL,
      type TEXT,
      priority TEXT,
      project TEXT,
      module TEXT,
      agent TEXT,
      owner_family TEXT,
      owner_instance TEXT,
      status TEXT,
      branch TEXT,
      worktree_path TEXT,
      orchestrator_id TEXT,
      dispatch_run_id TEXT,
      worker_id TEXT,
      claimed_at TEXT,
      completed_at TEXT,
      handoff_from TEXT,
      handoff_note TEXT,
      complexity TEXT,
      blocked_by TEXT,
      related TEXT,
      tags TEXT,
      created TEXT,
      updated TEXT,
      body_excerpt TEXT,
      body TEXT,
      file_hash TEXT,
      indexed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_vault_project ON vault_items(project);
    CREATE INDEX IF NOT EXISTS idx_vault_status ON vault_items(status);
    CREATE INDEX IF NOT EXISTS idx_vault_folder ON vault_items(folder);
    CREATE INDEX IF NOT EXISTS idx_vault_type ON vault_items(type);
    CREATE INDEX IF NOT EXISTS idx_vault_priority ON vault_items(priority);

    CREATE VIRTUAL TABLE IF NOT EXISTS vault_fts USING fts5(
      path, body, tokenize='porter'
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS vault_embeddings USING vec0(
      item_id INTEGER PRIMARY KEY,
      embedding FLOAT[384] distance_metric=cosine
    );

    CREATE TABLE IF NOT EXISTS vault_claims (
      item_id TEXT PRIMARY KEY,
      owner_family TEXT NOT NULL,
      owner_instance TEXT NOT NULL,
      project TEXT,
      repo_path TEXT,
      branch TEXT,
      worktree_path TEXT,
      claimed_at TEXT NOT NULL,
      lease_expires_at TEXT NOT NULL,
      last_heartbeat_at TEXT NOT NULL,
      state TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_vault_claims_owner_instance ON vault_claims(owner_instance);
    CREATE INDEX IF NOT EXISTS idx_vault_claims_project ON vault_claims(project);
    CREATE INDEX IF NOT EXISTS idx_vault_claims_state ON vault_claims(state);

    CREATE TABLE IF NOT EXISTS vault_handoffs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id TEXT NOT NULL,
      action TEXT NOT NULL,
      from_owner_instance TEXT,
      to_owner_instance TEXT,
      note TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_vault_handoffs_item_id ON vault_handoffs(item_id);

    CREATE TABLE IF NOT EXISTS orchestrators (
      orchestrator_id TEXT PRIMARY KEY,
      profile_name TEXT NOT NULL,
      conductor_name TEXT NOT NULL,
      owner_family TEXT NOT NULL,
      owner_instance TEXT NOT NULL,
      agent_deck_session TEXT,
      state TEXT NOT NULL,
      repo_scope TEXT,
      started_at TEXT NOT NULL,
      lease_expires_at TEXT NOT NULL,
      last_heartbeat_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_orchestrators_profile_conductor
      ON orchestrators(profile_name, conductor_name);
    CREATE INDEX IF NOT EXISTS idx_orchestrators_state ON orchestrators(state);

    CREATE TABLE IF NOT EXISTS dispatch_runs (
      run_id TEXT PRIMARY KEY,
      orchestrator_id TEXT NOT NULL,
      vault_item_id TEXT NOT NULL,
      project TEXT,
      repo_path TEXT NOT NULL,
      branch TEXT NOT NULL,
      worktree_path TEXT NOT NULL,
      requested_by TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      closed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_dispatch_runs_orchestrator_id ON dispatch_runs(orchestrator_id);
    CREATE INDEX IF NOT EXISTS idx_dispatch_runs_vault_item_id ON dispatch_runs(vault_item_id);
    CREATE INDEX IF NOT EXISTS idx_dispatch_runs_status ON dispatch_runs(status);

    CREATE TABLE IF NOT EXISTS workers (
      worker_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      vault_item_id TEXT NOT NULL,
      owner_family TEXT NOT NULL,
      owner_instance TEXT NOT NULL,
      agent_deck_session TEXT,
      repo_path TEXT NOT NULL,
      branch TEXT NOT NULL,
      worktree_path TEXT NOT NULL,
      state TEXT NOT NULL,
      started_at TEXT NOT NULL,
      lease_expires_at TEXT NOT NULL,
      last_heartbeat_at TEXT NOT NULL,
      closed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_workers_run_id ON workers(run_id);
    CREATE INDEX IF NOT EXISTS idx_workers_vault_item_id ON workers(vault_item_id);
    CREATE INDEX IF NOT EXISTS idx_workers_owner_instance ON workers(owner_instance);
    CREATE INDEX IF NOT EXISTS idx_workers_agent_deck_session ON workers(agent_deck_session);
    CREATE INDEX IF NOT EXISTS idx_workers_state ON workers(state);
  `);

  ensureColumn(db, 'vault_items', 'id', 'TEXT');
  ensureColumn(db, 'vault_items', 'owner_family', 'TEXT');
  ensureColumn(db, 'vault_items', 'owner_instance', 'TEXT');
  ensureColumn(db, 'vault_items', 'worktree_path', 'TEXT');
  ensureColumn(db, 'vault_items', 'orchestrator_id', 'TEXT');
  ensureColumn(db, 'vault_items', 'dispatch_run_id', 'TEXT');
  ensureColumn(db, 'vault_items', 'worker_id', 'TEXT');
  ensureColumn(db, 'vault_items', 'claimed_at', 'TEXT');
  ensureColumn(db, 'vault_items', 'completed_at', 'TEXT');
  ensureColumn(db, 'vault_items', 'handoff_from', 'TEXT');
  ensureColumn(db, 'vault_items', 'handoff_note', 'TEXT');

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_vault_item_id ON vault_items(id);
    CREATE INDEX IF NOT EXISTS idx_vault_claims_owner_instance ON vault_claims(owner_instance);
    CREATE INDEX IF NOT EXISTS idx_vault_claims_project ON vault_claims(project);
    CREATE INDEX IF NOT EXISTS idx_vault_claims_state ON vault_claims(state);
    CREATE INDEX IF NOT EXISTS idx_vault_handoffs_item_id ON vault_handoffs(item_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_orchestrators_profile_conductor ON orchestrators(profile_name, conductor_name);
    CREATE INDEX IF NOT EXISTS idx_orchestrators_state ON orchestrators(state);
    CREATE INDEX IF NOT EXISTS idx_dispatch_runs_orchestrator_id ON dispatch_runs(orchestrator_id);
    CREATE INDEX IF NOT EXISTS idx_dispatch_runs_vault_item_id ON dispatch_runs(vault_item_id);
    CREATE INDEX IF NOT EXISTS idx_dispatch_runs_status ON dispatch_runs(status);
    CREATE INDEX IF NOT EXISTS idx_workers_run_id ON workers(run_id);
    CREATE INDEX IF NOT EXISTS idx_workers_vault_item_id ON workers(vault_item_id);
    CREATE INDEX IF NOT EXISTS idx_workers_owner_instance ON workers(owner_instance);
    CREATE INDEX IF NOT EXISTS idx_workers_agent_deck_session ON workers(agent_deck_session);
    CREATE INDEX IF NOT EXISTS idx_workers_state ON workers(state);
  `);

  try { chmodSync(dbPath, 0o600); } catch {}

  return db;
}
