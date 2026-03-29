/**
 * Session storage layer for cortex-memory.
 */
export class SessionStore {
  #db;
  #stmts;

  /**
   * @param {import('better-sqlite3').Database} db
   */
  constructor(db) {
    this.#db = db;

    this.#stmts = {
      insertOrUpdate: db.prepare(`
        INSERT INTO sessions (id, platform, project_path, transcript_path, started_at, ended_at, chunk_count, indexed_at, summary)
        VALUES (@id, @platform, @projectPath, @transcriptPath, @startedAt, @endedAt, @chunkCount, @indexedAt, @summary)
        ON CONFLICT(id) DO UPDATE SET
          platform = COALESCE(excluded.platform, sessions.platform),
          project_path = COALESCE(excluded.project_path, sessions.project_path),
          transcript_path = COALESCE(excluded.transcript_path, sessions.transcript_path),
          started_at = COALESCE(excluded.started_at, sessions.started_at),
          ended_at = COALESCE(excluded.ended_at, sessions.ended_at),
          chunk_count = COALESCE(excluded.chunk_count, sessions.chunk_count),
          indexed_at = COALESCE(excluded.indexed_at, sessions.indexed_at),
          summary = COALESCE(excluded.summary, sessions.summary)
      `),
      get: db.prepare('SELECT * FROM sessions WHERE id = ?'),
      isIndexed: db.prepare('SELECT indexed_at FROM sessions WHERE id = ?'),
      listByProject: db.prepare('SELECT * FROM sessions WHERE project_path = ? ORDER BY ended_at DESC LIMIT ?'),
      listRecent: db.prepare('SELECT * FROM sessions ORDER BY ended_at DESC LIMIT ?'),
      listSince: db.prepare('SELECT * FROM sessions WHERE indexed_at >= ? ORDER BY ended_at DESC LIMIT ?'),
      count: db.prepare('SELECT COUNT(*) as cnt FROM sessions'),
    };
  }

  /**
   * Insert or update a session record (preserves existing non-null fields).
   */
  upsert({ id, platform = 'claude', projectPath, transcriptPath, startedAt = null, endedAt = null, chunkCount = null, indexedAt = null, summary = null }) {
    this.#stmts.insertOrUpdate.run({ id, platform, projectPath, transcriptPath, startedAt, endedAt, chunkCount, indexedAt, summary });
  }

  get(id) {
    return this.#stmts.get.get(id) ?? null;
  }

  isIndexed(id) {
    const row = this.#stmts.isIndexed.get(id);
    return row ? row.indexed_at !== null : false;
  }

  listByProject(projectPath, limit = 20) {
    return this.#stmts.listByProject.all(projectPath, limit);
  }

  listRecent(limit = 20) {
    return this.#stmts.listRecent.all(limit);
  }

  listSince(sinceIso, limit = 100) {
    return this.#stmts.listSince.all(sinceIso, limit);
  }

  count() {
    return this.#stmts.count.get().cnt;
  }
}
