/**
 * Transcript parser and message chunker for agent session transcripts.
 *
 * parseTranscript: JSONL string → filtered message objects
 * parseTranscriptData: transcript messages + session metadata
 * chunkMessages: message objects → token-bounded chunks with overlap for embedding
 */

const IGNORED_TEXT_PREFIXES = [
  '<command-name>',
  '<local-command-caveat>',
  '<local-command-stdout>',
  '<local-command-stderr>',
];

/**
 * Estimate token count using ~4 chars per token heuristic.
 */
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

/**
 * Format a message with its role prefix.
 */
function formatMessage(msg) {
  const prefix = msg.role === 'assistant' ? 'Assistant' : 'Human';
  return `${prefix}: ${msg.text}`;
}

function normalizeRole(parsed) {
  if (parsed.type === 'assistant' || parsed.role === 'assistant' || parsed.message?.role === 'assistant') {
    return 'assistant';
  }
  if (
    parsed.type === 'human' ||
    parsed.type === 'user' ||
    parsed.role === 'human' ||
    parsed.role === 'user' ||
    parsed.message?.role === 'human' ||
    parsed.message?.role === 'user'
  ) {
    return 'human';
  }
  return null;
}

function extractTextContent(content) {
  if (typeof content === 'string') {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return '';
  }

  const text = content
    .filter(item => item.type === 'text' && item.text)
    .map(item => item.text)
    .join(' ')
    .trim();

  return text;
}

function shouldIgnoreText(parsed, text) {
  if (parsed.isMeta) return true;
  return IGNORED_TEXT_PREFIXES.some(prefix => text.startsWith(prefix));
}

function getCodexMessageContent(payload) {
  if (payload?.type !== 'message') return null;
  if (payload.role !== 'user' && payload.role !== 'assistant') return null;

  const text = extractTextContent(
    Array.isArray(payload.content)
      ? payload.content.map((item) => {
          if (item.type === 'input_text' || item.type === 'output_text' || item.type === 'text') {
            return { type: 'text', text: item.text };
          }
          return item;
        })
      : payload.content
  );

  if (!text) return null;

  return {
    role: payload.role === 'assistant' ? 'assistant' : 'human',
    text,
  };
}

function normalizeRecord(parsed, metadata) {
  if (parsed.type === 'session_meta') {
    metadata.projectPath ||= parsed.payload?.cwd ?? null;
    metadata.startedAt ||= parsed.payload?.timestamp ?? parsed.timestamp ?? null;
    metadata.sessionId ||= parsed.payload?.id ?? null;
    return null;
  }

  if (parsed.type === 'response_item') {
    const codexMessage = getCodexMessageContent(parsed.payload);
    if (!codexMessage || shouldIgnoreText(parsed, codexMessage.text)) return null;

    metadata.projectPath ||= parsed.payload?.cwd ?? metadata.projectPath ?? null;

    return {
      role: codexMessage.role,
      text: codexMessage.text,
      timestamp: parsed.timestamp,
      cwd: metadata.projectPath ?? undefined,
    };
  }

  const role = normalizeRole(parsed);
  if (!role) return null;

  const text = extractTextContent(parsed.message?.content ?? parsed.content);
  if (!text || shouldIgnoreText(parsed, text)) return null;

  return {
    role,
    text,
    timestamp: parsed.timestamp ?? parsed.message?.timestamp,
    cwd:
      (typeof parsed.cwd === 'string' && parsed.cwd) ||
      (typeof parsed.projectPath === 'string' && parsed.projectPath) ||
      (typeof parsed.project_path === 'string' && parsed.project_path) ||
      undefined,
  };
}

function collectConversationEntries(jsonlContent) {
  const lines = jsonlContent.split('\n');
  const entries = [];
  const metadata = {
    projectPath: null,
    startedAt: null,
    endedAt: null,
    sessionId: null,
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }

    const entry = normalizeRecord(parsed, metadata);
    if (!entry) continue;

    entries.push(entry);
    metadata.projectPath ||= entry.cwd ?? null;
    metadata.startedAt ||= entry.timestamp ?? null;
    metadata.endedAt = entry.timestamp ?? metadata.endedAt;
  }

  if (!metadata.endedAt) {
    const lastTimestamped = [...entries].reverse().find(entry => entry.timestamp);
    metadata.endedAt = lastTimestamped?.timestamp ?? null;
  }

  return { entries, metadata };
}

/**
 * Parse a session transcript into filtered message objects.
 *
 * Each JSONL line is shaped like:
 *   {"type":"human","message":{"content":[{"type":"text","text":"..."}]}}
 *
 * Filters to only human/assistant messages with text content.
 * Skips malformed lines, tool_use, tool_result, system messages.
 *
 * @param {string} jsonlContent - Raw JSONL transcript content
 * @returns {Array<{role: string, text: string, timestamp: string|undefined}>}
 */
export function parseTranscript(jsonlContent) {
  return parseTranscriptData(jsonlContent).messages;
}

/**
 * Parse transcript messages and derive session metadata from conversational records.
 *
 * @param {string} jsonlContent
 * @returns {{messages: Array<{role: string, text: string, timestamp: string|undefined}>, projectPath: string|null, startedAt: string|null, endedAt: string|null, sessionId: string|null}}
 */
export function parseTranscriptData(jsonlContent) {
  const { entries, metadata } = collectConversationEntries(jsonlContent);
  const firstTimestamped = entries.find(entry => entry.timestamp);
  const firstProjectPath = entries.find(entry => entry.cwd)?.cwd ?? metadata.projectPath ?? null;

  return {
    messages: entries.map(({ role, text, timestamp }) => ({ role, text, timestamp })),
    projectPath: firstProjectPath,
    startedAt: metadata.startedAt ?? firstTimestamped?.timestamp ?? null,
    endedAt: metadata.endedAt ?? null,
    sessionId: metadata.sessionId ?? null,
  };
}

/**
 * Chunk messages into token-bounded groups for embedding.
 *
 * - Never splits a message across chunks
 * - Oversized single messages get their own chunk
 * - Overlap re-includes trailing messages from the previous chunk
 *
 * @param {Array<{role: string, text: string}>} messages
 * @param {Object} options
 * @param {number} options.maxTokens - Max tokens per chunk (default 200)
 * @param {number} options.overlapTokens - Overlap tokens between chunks (default 40)
 * @returns {Array<{content: string, tokenCount: number, messageCount: number, startIndex: number, endIndex: number}>}
 */
export function chunkMessages(messages, { maxTokens = 200, overlapTokens = 40 } = {}) {
  if (messages.length === 0) return [];

  // Pre-compute formatted text and token counts for each message
  const formatted = messages.map(msg => formatMessage(msg));
  const tokenCounts = formatted.map(text => estimateTokens(text));

  const chunks = [];
  let i = 0;

  while (i < messages.length) {
    let chunkTokens = 0;
    let chunkStart = i;
    let chunkEnd = i;

    // First message always goes in (even if oversized)
    chunkTokens += tokenCounts[i];
    chunkEnd = i;
    i++;

    // Add more messages while under the limit
    while (i < messages.length) {
      const nextTokens = tokenCounts[i];
      if (chunkTokens + nextTokens > maxTokens) break;
      chunkTokens += nextTokens;
      chunkEnd = i;
      i++;
    }

    // Build chunk
    const chunkFormatted = formatted.slice(chunkStart, chunkEnd + 1);
    chunks.push({
      content: chunkFormatted.join('\n'),
      tokenCount: chunkTokens,
      messageCount: chunkEnd - chunkStart + 1,
      startIndex: chunkStart,
      endIndex: chunkEnd,
    });

    // Calculate overlap: walk backwards from chunkEnd to find messages fitting in overlapTokens
    if (i < messages.length && overlapTokens > 0) {
      let overlapUsed = 0;
      let overlapStart = chunkEnd;

      // Walk backwards from the end of current chunk
      for (let j = chunkEnd; j >= chunkStart; j--) {
        if (overlapUsed + tokenCounts[j] > overlapTokens) break;
        overlapUsed += tokenCounts[j];
        overlapStart = j;
      }

      // Next chunk starts from the overlap point (re-include those messages).
      // Never reset to the entire current chunk, or oversized single-message chunks loop forever.
      if (overlapStart > chunkStart && overlapStart < i) {
        i = overlapStart;
      }
    }
  }

  return chunks;
}
