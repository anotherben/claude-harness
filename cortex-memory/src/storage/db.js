import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Initialize the SQLite database with sqlite-vec extension and create tables.
 * @param {string} dbPath - Path to the database file
 * @returns {import('better-sqlite3').Database} The database instance
 */
export function initDb(dbPath) {
  // Ensure directory exists with restricted permissions
  mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });

  const db = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  // Verify FK enforcement took effect (silently ignored inside transactions or after changes)
  const fkStatus = db.pragma('foreign_keys', { simple: true });
  if (fkStatus !== 1) {
    throw new Error('Failed to enable foreign key enforcement');
  }

  // Load sqlite-vec extension
  sqliteVec.load(db);

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY CHECK(length(id) > 0),
      platform TEXT NOT NULL DEFAULT 'claude',
      project_path TEXT NOT NULL,
      transcript_path TEXT NOT NULL,
      started_at TEXT,
      ended_at TEXT,
      chunk_count INTEGER DEFAULT 0,
      indexed_at TEXT,
      summary TEXT
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      content TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      timestamp TEXT,
      token_count INTEGER
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS chunk_embeddings USING vec0(
      chunk_id INTEGER PRIMARY KEY,
      embedding FLOAT[384] distance_metric=cosine
    );

    CREATE INDEX IF NOT EXISTS idx_chunks_session ON chunks(session_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_chunks_session_index ON chunks(session_id, chunk_index);
    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_path);
    CREATE INDEX IF NOT EXISTS idx_sessions_ended ON sessions(ended_at);
  `);

  const sessionColumns = db.prepare('PRAGMA table_info(sessions)').all();
  if (!sessionColumns.some((column) => column.name === 'platform')) {
    db.exec("ALTER TABLE sessions ADD COLUMN platform TEXT NOT NULL DEFAULT 'claude'");
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_platform ON sessions(platform)');

  // Restrict database file permissions
  try { chmodSync(dbPath, 0o600); } catch { /* may not exist yet on first create */ }

  return db;
}
