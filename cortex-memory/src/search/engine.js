/**
 * Search engine with composite scoring.
 * Groups vector search results by session and ranks them using
 * a weighted combination of similarity, recency, and breadth.
 */
export class SearchEngine {
  #vectorStore;
  #sessionStore;

  constructor(vectorStore, sessionStore) {
    this.#vectorStore = vectorStore;
    this.#sessionStore = sessionStore;
  }

  /**
   * Compute a recency score based on session age.
   * @param {string|null|undefined} endedAt - ISO date string
   * @returns {number} Score between 0.1 and 1.0
   */
  recencyScore(endedAt) {
    if (!endedAt) return 0.1;
    const ageDays = (Date.now() - new Date(endedAt).getTime()) / (24 * 60 * 60 * 1000);
    if (ageDays < 1) return 1.0;
    if (ageDays < 7) return 0.7;
    if (ageDays < 30) return 0.4;
    if (ageDays < 90) return 0.2;
    return 0.1;
  }

  /**
   * Group raw vector search results by session and compute composite scores.
   * Composite = 0.5 * similarity + 0.3 * recency + 0.2 * breadth
   *
   * Cosine distance from sqlite-vec ranges [0, 2]. Convert: similarity = 1 - distance/2
   */
  groupAndScore(rawResults) {
    if (!rawResults || rawResults.length === 0) return [];

    const totalChunks = rawResults.length;
    const groups = new Map();

    for (const row of rawResults) {
      if (!groups.has(row.sessionId)) {
        groups.set(row.sessionId, {
          sessionId: row.sessionId,
          platform: row.platform,
          endedAt: row.endedAt,
          projectPath: row.projectPath,
          chunks: [],
        });
      }
      groups.get(row.sessionId).chunks.push(row);
    }

    const scored = [];
    for (const [, group] of groups) {
      const bestDistance = Math.min(...group.chunks.map((c) => c.distance));
      // Cosine distance [0, 2] → similarity [0, 1]
      const similarity = Math.max(0, 1 - bestDistance / 2);
      const recency = this.recencyScore(group.endedAt);
      const breadth = group.chunks.length / totalChunks;
      const score = 0.5 * similarity + 0.3 * recency + 0.2 * breadth;

      scored.push({
        sessionId: group.sessionId,
        score,
        similarity,
        recency,
        breadth,
        platform: group.platform,
        projectPath: group.projectPath,
        endedAt: group.endedAt,
        excerpts: group.chunks
          .sort((a, b) => a.distance - b.distance)
          .map((c) => ({ content: c.content, distance: c.distance, chunkIndex: c.chunkIndex })),
      });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored;
  }

  /**
   * Search for relevant sessions using vector similarity + composite scoring.
   */
  search(queryEmbedding, { project, platform, limit = 5, rawLimit = 200 } = {}) {
    const rawResults = this.#vectorStore.search(queryEmbedding, { project, platform, limit: rawLimit });
    const grouped = this.groupAndScore(rawResults);
    return grouped.slice(0, limit);
  }
}
