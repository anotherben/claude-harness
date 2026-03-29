import { describe, it, expect } from 'vitest';
import {
  findSourceForPath,
  getSessionSources,
  isAllowedTranscriptPath,
  isPathWithinRoot,
} from '../src/session-sources.js';

describe('session source config', () => {
  it('uses the default Claude and Codex sources when no env override exists', () => {
    const sources = getSessionSources('');
    expect(sources).toHaveLength(2);
    expect(sources[0].platform).toBe('claude');
    expect(sources[0].root).toContain('/.claude/projects');
    expect(sources[1].platform).toBe('codex');
    expect(sources[1].root).toContain('/.codex/archived_sessions');
  });

  it('parses custom multi-platform sources from env format', () => {
    const sources = getSessionSources('claude=/tmp/claude;codex=/tmp/codex');
    expect(sources).toEqual([
      { platform: 'claude', root: '/tmp/claude' },
      { platform: 'codex', root: '/tmp/codex' },
    ]);
  });

  it('matches transcript paths against configured roots', () => {
    const sources = getSessionSources('claude=/tmp/claude;codex=/tmp/codex');
    expect(isPathWithinRoot('/tmp/claude/project/a.jsonl', '/tmp/claude')).toBe(true);
    expect(isAllowedTranscriptPath('/tmp/codex/sessions/x.jsonl', sources)).toBe(true);
    expect(findSourceForPath('/tmp/codex/sessions/x.jsonl', sources)?.platform).toBe('codex');
    expect(isAllowedTranscriptPath('/tmp/other/y.jsonl', sources)).toBe(false);
  });
});
