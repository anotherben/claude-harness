/**
 * Indexing pipeline: transcript file → parsed messages → chunks → embeddings → SQLite.
 */

import { readFile } from 'node:fs/promises';
import { parseTranscriptData, chunkMessages } from './chunker.js';
import { createEmbedder } from './embedder.js';
import { findSourceForPath, getSessionSources, isPathWithinRoot } from '../session-sources.js';

const BATCH_SIZE = 32;
const SESSION_SOURCES = getSessionSources();

function needsMetadataRefresh(existing) {
  if (!existing?.indexed_at) return false;

  return (
    !existing.started_at ||
    !existing.ended_at ||
    SESSION_SOURCES.some((source) => isPathWithinRoot(existing.project_path, source.root))
  );
}

/**
 * Index a single session transcript into the vector store.
 * Steps 1-5 are async (file I/O + embedding). Steps 6-9 are a single atomic transaction.
 */
export async function indexSession({ sessionId, transcriptPath, projectPath, sessions, vectors, embedder }) {
  // 1. Read JSONL file
  const jsonlContent = await readFile(transcriptPath, 'utf8');

  // 2. Parse transcript and derive session metadata from real records
  const {
    messages,
    projectPath: transcriptProjectPath,
    startedAt,
    endedAt,
    sessionId: transcriptSessionId,
  } = parseTranscriptData(jsonlContent);
  const effectiveSessionId = transcriptSessionId || sessionId;
  const existing = sessions.get(effectiveSessionId) ?? sessions.get(sessionId);
  if (existing?.indexed_at && !needsMetadataRefresh(existing)) {
    return { indexed: false, skipped: true, chunkCount: 0 };
  }

  const source = findSourceForPath(transcriptPath, SESSION_SOURCES);
  const effectivePlatform = source?.platform ?? existing?.platform ?? 'unknown';
  const effectiveProjectPath = transcriptProjectPath || projectPath;

  // 3. Handle empty transcript
  if (messages.length === 0) {
    sessions.upsert({
      id: effectiveSessionId,
      platform: effectivePlatform,
      projectPath: effectiveProjectPath,
      transcriptPath,
      startedAt,
      endedAt,
      chunkCount: 0,
      indexedAt: new Date().toISOString(),
    });
    return { indexed: true, chunkCount: 0 };
  }

  // 4. Chunk messages and embed (async, before transaction)
  const chunks = chunkMessages(messages, { maxTokens: 200, overlapTokens: 40 });
  const embeddings = [];
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const batchEmbeddings = await embedder.embedBatch(batch.map(c => c.content));
    embeddings.push(...batchEmbeddings);
  }

  // 6-9. All DB operations in a single atomic transaction
  const commitReindex = vectors.db.transaction(() => {
    // 5. Clean up any prior partial data
    vectors.deleteBySession(effectiveSessionId);
    if (effectiveSessionId !== sessionId) {
      vectors.deleteBySession(sessionId);
    }

    // 6. Create/update session record
    sessions.upsert({
      id: effectiveSessionId,
      platform: effectivePlatform,
      projectPath: effectiveProjectPath,
      transcriptPath,
      startedAt,
      endedAt,
      chunkCount: 0,
    });

    // 7. Insert each chunk + embedding
    for (let i = 0; i < chunks.length; i++) {
      vectors.insertChunk({
        sessionId: effectiveSessionId,
        content: chunks[i].content,
        chunkIndex: i,
        timestamp: null,
        tokenCount: chunks[i].tokenCount,
        embedding: embeddings[i],
      });
    }

    // 8. Update session with final chunk count and indexed timestamp
    sessions.upsert({
      id: effectiveSessionId,
      platform: effectivePlatform,
      projectPath: effectiveProjectPath,
      transcriptPath,
      startedAt,
      endedAt,
      chunkCount: chunks.length,
      indexedAt: new Date().toISOString(),
    });
  });

  commitReindex();
  return { indexed: true, chunkCount: chunks.length };
}

// Singleton embedder — reuses the same instance across calls
let _embedder = null;

/**
 * Get or create a configured embedder singleton.
 * @returns {{ embed(text: string): Promise<Float32Array>, embedBatch(texts: string[]): Promise<Float32Array[]> }}
 */
export function getEmbedder() {
  if (!_embedder) {
    _embedder = createEmbedder();
  }
  return _embedder;
}
