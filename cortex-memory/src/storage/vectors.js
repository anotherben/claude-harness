/**
 * Vector storage layer for cortex-memory using sqlite-vec.
 */
export class VectorStore {
  #db;
  #stmts;
  #insertChunkTxn;
  #deleteBySessionTxn;

  /**
   * @param {import('better-sqlite3').Database} db
   */
  constructor(db) {
    this.#db = db;

    this.#stmts = {
      insertChunk: db.prepare(`
        INSERT INTO chunks (session_id, content, chunk_index, timestamp, token_count)
        VALUES (@sessionId, @content, @chunkIndex, @timestamp, @tokenCount)
      `),
      insertEmbedding: db.prepare(`
        INSERT INTO chunk_embeddings (chunk_id, embedding)
        VALUES (?, ?)
      `),
      deleteEmbeddingsBySession: db.prepare(`
        DELETE FROM chunk_embeddings WHERE chunk_id IN (SELECT id FROM chunks WHERE session_id = ?)
      `),
      deleteChunksBySession: db.prepare(`
        DELETE FROM chunks WHERE session_id = ?
      `),
      chunkCount: db.prepare('SELECT COUNT(*) as cnt FROM chunks'),
    };

    // Transaction for atomic delete
    this.#deleteBySessionTxn = db.transaction((sessionId) => {
      this.#stmts.deleteEmbeddingsBySession.run(sessionId);
      this.#stmts.deleteChunksBySession.run(sessionId);
    });

    // Transaction for atomic chunk + embedding insert
    this.#insertChunkTxn = db.transaction(({ sessionId, content, chunkIndex, timestamp, tokenCount, embedding }) => {
      const result = this.#stmts.insertChunk.run({
        sessionId,
        content,
        chunkIndex,
        timestamp: timestamp ?? null,
        tokenCount: tokenCount ?? null,
      });
      const chunkId = BigInt(result.lastInsertRowid);
      this.#stmts.insertEmbedding.run(chunkId, new Float32Array(embedding));
      return chunkId;
    });
  }

  /**
   * Insert a chunk with its embedding vector.
   */
  insertChunk(params) {
    return this.#insertChunkTxn(params);
  }

  /**
   * Delete all chunks and embeddings for a session (atomic).
   * Order matters: delete embeddings FIRST (while chunk IDs still exist for subquery).
   */
  deleteBySession(sessionId) {
    this.#deleteBySessionTxn(sessionId);
  }

  /**
   * Search for chunks by vector similarity (cosine distance).
   * @param {Float32Array} queryEmbedding - 384-dim query vector
   * @param {Object} [options]
   * @param {string} [options.project] - Filter by project path
   * @param {string} [options.platform] - Filter by transcript platform
   * @param {number} [options.limit=20] - Max results
   */
  search(queryEmbedding, { project, platform, limit = 20 } = {}) {
    const fetchLimit = project || platform ? limit * 5 : limit;

    const stmt = this.#db.prepare(`
      SELECT
        ce.chunk_id as chunkId,
        c.session_id as sessionId,
        c.content,
        ce.distance,
        s.platform as platform,
        s.project_path as projectPath,
        s.ended_at as endedAt,
        c.chunk_index as chunkIndex
      FROM chunk_embeddings ce
      JOIN chunks c ON c.id = ce.chunk_id
      JOIN sessions s ON s.id = c.session_id
      WHERE ce.embedding MATCH ? AND ce.k = ?
      ORDER BY ce.distance
    `);

    const rows = stmt.all(new Float32Array(queryEmbedding), fetchLimit);

    let filtered = rows;
    if (project) {
      filtered = filtered.filter((row) => row.projectPath === project);
    }
    if (platform) {
      filtered = filtered.filter((row) => row.platform === platform);
    }

    return filtered.slice(0, limit);
  }

  chunkCount() {
    return this.#stmts.chunkCount.get().cnt;
  }

  /** Expose db for outer transaction wrapping (e.g., pipeline reindex). */
  get db() { return this.#db; }
}
