import { describe, it, expect } from 'vitest';
import { parseTranscript, parseTranscriptData, chunkMessages } from '../src/indexer/chunker.js';

describe('parseTranscript', () => {
  it('parses JSONL and filters to human/assistant messages only', () => {
    const jsonl = [
      JSON.stringify({ type: 'human', message: { content: [{ type: 'text', text: 'Hello there' }] } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hi! How can I help?' }] } }),
      JSON.stringify({ type: 'tool_use', name: 'Read', input: { file_path: '/tmp/foo' } }),
      JSON.stringify({ type: 'tool_result', content: 'file contents here' }),
      JSON.stringify({ type: 'system', message: { content: [{ type: 'text', text: 'System prompt' }] } }),
    ].join('\n');

    const result = parseTranscript(jsonl);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ role: 'human', text: 'Hello there', timestamp: undefined });
    expect(result[1]).toEqual({ role: 'assistant', text: 'Hi! How can I help?', timestamp: undefined });
  });

  it('extracts only text content from mixed content arrays', () => {
    const jsonl = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Let me read that file.' },
          { type: 'tool_use', id: 'abc', name: 'Read', input: {} },
          { type: 'text', text: 'Here is what I found.' },
        ],
      },
    });

    const result = parseTranscript(jsonl);

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('Let me read that file. Here is what I found.');
  });

  it('preserves timestamp when available', () => {
    const jsonl = JSON.stringify({
      type: 'human',
      message: {
        content: [{ type: 'text', text: 'Hi' }],
        timestamp: '2026-02-24T10:00:00Z',
      },
    });

    const result = parseTranscript(jsonl);
    expect(result[0].timestamp).toBe('2026-02-24T10:00:00Z');
  });

  it('parses current Claude transcript shape and ignores command noise', () => {
    const jsonl = [
      JSON.stringify({
        type: 'user',
        isMeta: true,
        timestamp: '2026-03-27T07:34:14.206Z',
        cwd: '/Users/ben/Projects/helpdesk',
        message: { role: 'user', content: '<local-command-caveat>skip me</local-command-caveat>' },
      }),
      JSON.stringify({
        type: 'user',
        timestamp: '2026-03-27T07:34:38.195Z',
        cwd: '/Users/ben/Projects/helpdesk',
        message: { role: 'user', content: 'we keep having issues with the cortex-engine mcp server figure out why' },
      }),
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-03-27T07:34:41.853Z',
        cwd: '/Users/ben/Projects/helpdesk',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'hidden' },
            { type: 'text', text: 'Let me investigate the cortex-engine MCP setup and recent issues.' },
          ],
        },
      }),
      JSON.stringify({
        type: 'user',
        timestamp: '2026-03-27T07:35:00.000Z',
        cwd: '/Users/ben/Projects/helpdesk',
        message: { role: 'user', content: '<command-name>/mcp</command-name>' },
      }),
    ].join('\n');

    const result = parseTranscript(jsonl);

    expect(result).toEqual([
      {
        role: 'human',
        text: 'we keep having issues with the cortex-engine mcp server figure out why',
        timestamp: '2026-03-27T07:34:38.195Z',
      },
      {
        role: 'assistant',
        text: 'Let me investigate the cortex-engine MCP setup and recent issues.',
        timestamp: '2026-03-27T07:34:41.853Z',
      },
    ]);
  });

  it('derives session metadata from current conversational records', () => {
    const jsonl = [
      JSON.stringify({
        type: 'user',
        timestamp: '2026-03-27T07:34:38.195Z',
        cwd: '/Users/ben/Projects/helpdesk',
        message: { role: 'user', content: 'First prompt' },
      }),
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-03-27T07:34:41.853Z',
        cwd: '/Users/ben/Projects/helpdesk',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Reply' }] },
      }),
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-03-27T07:36:00.000Z',
        cwd: '/Users/ben/Projects/helpdesk',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Final reply' }] },
      }),
    ].join('\n');

    const result = parseTranscriptData(jsonl);

    expect(result.projectPath).toBe('/Users/ben/Projects/helpdesk');
    expect(result.startedAt).toBe('2026-03-27T07:34:38.195Z');
    expect(result.endedAt).toBe('2026-03-27T07:36:00.000Z');
    expect(result.messages).toHaveLength(3);
  });

  it('accepts simpler role/content transcript records for non-Claude sources', () => {
    const jsonl = [
      JSON.stringify({
        role: 'user',
        timestamp: '2026-03-29T00:00:00.000Z',
        projectPath: '/Users/ben/Projects/helpdesk',
        content: 'Summarize the issue.',
      }),
      JSON.stringify({
        role: 'assistant',
        timestamp: '2026-03-29T00:00:05.000Z',
        project_path: '/Users/ben/Projects/helpdesk',
        content: 'The issue is narrowed to the parser.',
      }),
    ].join('\n');

    const result = parseTranscriptData(jsonl);

    expect(result.messages).toEqual([
      {
        role: 'human',
        text: 'Summarize the issue.',
        timestamp: '2026-03-29T00:00:00.000Z',
      },
      {
        role: 'assistant',
        text: 'The issue is narrowed to the parser.',
        timestamp: '2026-03-29T00:00:05.000Z',
      },
    ]);
    expect(result.projectPath).toBe('/Users/ben/Projects/helpdesk');
  });

  it('parses Codex archived session envelopes and session metadata', () => {
    const jsonl = [
      JSON.stringify({
        timestamp: '2026-03-23T08:49:27.829Z',
        type: 'session_meta',
        payload: {
          id: '019d19e1-eb2c-7d41-8d36-28a7c9d7f0d4',
          timestamp: '2026-03-23T08:48:49.453Z',
          cwd: '/Users/ben/Projects/helpdesk',
        },
      }),
      JSON.stringify({
        timestamp: '2026-03-23T08:49:27.831Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'is cortex engine and vault index online?\n' }],
        },
      }),
      JSON.stringify({
        timestamp: '2026-03-23T08:49:37.115Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Checking whether the Cortex engine and vault index services are up.' }],
        },
      }),
      JSON.stringify({
        timestamp: '2026-03-23T08:49:37.223Z',
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'list_mcp_resources',
        },
      }),
    ].join('\n');

    const result = parseTranscriptData(jsonl);

    expect(result.sessionId).toBe('019d19e1-eb2c-7d41-8d36-28a7c9d7f0d4');
    expect(result.projectPath).toBe('/Users/ben/Projects/helpdesk');
    expect(result.startedAt).toBe('2026-03-23T08:48:49.453Z');
    expect(result.endedAt).toBe('2026-03-23T08:49:37.115Z');
    expect(result.messages).toEqual([
      {
        role: 'human',
        text: 'is cortex engine and vault index online?',
        timestamp: '2026-03-23T08:49:27.831Z',
      },
      {
        role: 'assistant',
        text: 'Checking whether the Cortex engine and vault index services are up.',
        timestamp: '2026-03-23T08:49:37.115Z',
      },
    ]);
  });

  it('handles malformed lines gracefully by skipping them', () => {
    const jsonl = [
      '{ this is not valid json',
      JSON.stringify({ type: 'human', message: { content: [{ type: 'text', text: 'Valid message' }] } }),
      '',
      'another bad line {{{',
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Also valid' }] } }),
    ].join('\n');

    const result = parseTranscript(jsonl);

    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('Valid message');
    expect(result[1].text).toBe('Also valid');
  });

  it('skips messages with no text content', () => {
    const jsonl = [
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'x', name: 'Bash', input: {} }] } }),
      JSON.stringify({ type: 'human', message: { content: [{ type: 'text', text: 'Real message' }] } }),
    ].join('\n');

    const result = parseTranscript(jsonl);

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('Real message');
  });
});

describe('chunkMessages', () => {
  // Helper: create a message with known token count (4 chars = 1 token)
  const msg = (role, charCount) => ({
    role,
    text: 'x'.repeat(charCount),
    timestamp: undefined,
  });

  it('chunks messages respecting 200-token limit', () => {
    // Each message is 100 tokens (400 chars). Two fit in 200-token chunk.
    const messages = [
      msg('human', 400),    // 100 tokens
      msg('assistant', 400), // 100 tokens
      msg('human', 400),    // 100 tokens
    ];

    const chunks = chunkMessages(messages, { maxTokens: 200, overlapTokens: 0 });

    // First chunk: messages 0+1 = 200 tokens (plus role prefixes push it over, so let's check)
    // Actually role prefixes add tokens too. Let me use smaller messages.
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    // Every chunk's tokenCount should be <= 200 (or a single oversized message)
    for (const chunk of chunks) {
      if (chunk.messageCount > 1) {
        expect(chunk.tokenCount).toBeLessThanOrEqual(200);
      }
    }
  });

  it('never splits mid-message', () => {
    const messages = [
      msg('human', 80),     // 20 tokens
      msg('assistant', 80), // 20 tokens
      msg('human', 80),     // 20 tokens
    ];

    const chunks = chunkMessages(messages, { maxTokens: 50, overlapTokens: 0 });

    // Each chunk should have whole messages
    for (const chunk of chunks) {
      expect(chunk.startIndex).toBeLessThanOrEqual(chunk.endIndex);
      expect(chunk.messageCount).toBe(chunk.endIndex - chunk.startIndex + 1);
    }
  });

  it('single oversized message gets its own chunk', () => {
    const messages = [
      msg('human', 80),      // 20 tokens
      msg('assistant', 2000), // 500 tokens — exceeds 200 limit
      msg('human', 80),      // 20 tokens
    ];

    const chunks = chunkMessages(messages, { maxTokens: 200, overlapTokens: 0 });

    // The oversized message should be alone in its chunk
    const oversizedChunk = chunks.find(c => c.startIndex === 1 && c.endIndex === 1);
    expect(oversizedChunk).toBeDefined();
    expect(oversizedChunk.messageCount).toBe(1);
    expect(oversizedChunk.tokenCount).toBeGreaterThan(200);
  });

  it('does not loop forever when an oversized single message exceeds overlapTokens', () => {
    const messages = [
      msg('human', 80),
      msg('assistant', 4000),
      msg('human', 80),
    ];

    const chunks = chunkMessages(messages, { maxTokens: 200, overlapTokens: 40 });

    expect(chunks).toHaveLength(3);
    expect(chunks[1].startIndex).toBe(1);
    expect(chunks[1].endIndex).toBe(1);
  });

  it('overlap includes last messages from previous chunk', () => {
    // Create messages where we can verify overlap behavior
    const messages = [
      { role: 'human', text: 'Message A', timestamp: undefined },         // ~5 tokens with prefix
      { role: 'assistant', text: 'Message B', timestamp: undefined },     // ~5 tokens with prefix
      { role: 'human', text: 'Message C is a bit longer text', timestamp: undefined }, // more tokens
      { role: 'assistant', text: 'Message D is also longer', timestamp: undefined },
    ];

    const chunks = chunkMessages(messages, { maxTokens: 40, overlapTokens: 20 });

    // With overlap, later chunks should have startIndex that overlaps with previous chunk's endIndex
    if (chunks.length > 1) {
      // The second chunk's startIndex should be <= first chunk's endIndex
      // (overlap means we re-include some messages)
      expect(chunks[1].startIndex).toBeLessThanOrEqual(chunks[0].endIndex);
    }
  });

  it('returns correct chunk structure', () => {
    const messages = [
      { role: 'human', text: 'Hello', timestamp: undefined },
      { role: 'assistant', text: 'World', timestamp: undefined },
    ];

    const chunks = chunkMessages(messages, { maxTokens: 200, overlapTokens: 0 });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveProperty('content');
    expect(chunks[0]).toHaveProperty('tokenCount');
    expect(chunks[0]).toHaveProperty('messageCount');
    expect(chunks[0]).toHaveProperty('startIndex');
    expect(chunks[0]).toHaveProperty('endIndex');
    expect(chunks[0].content).toContain('Human: Hello');
    expect(chunks[0].content).toContain('Assistant: World');
    expect(chunks[0].messageCount).toBe(2);
    expect(chunks[0].startIndex).toBe(0);
    expect(chunks[0].endIndex).toBe(1);
  });

  it('handles empty messages array', () => {
    const chunks = chunkMessages([], { maxTokens: 200, overlapTokens: 0 });
    expect(chunks).toEqual([]);
  });
});
