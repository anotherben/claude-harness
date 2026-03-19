const fs = require('fs');
const path = require('path');
const os = require('os');
const { Telemetry, estimateTokens, calcCostAvoided, PRICING } = require('../src/telemetry');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-telemetry-'));
}

describe('Telemetry', () => {
  describe('estimateTokens', () => {
    it('estimates tokens using byte_approx (1 token per 4 bytes)', () => {
      // 12 ASCII bytes -> ceil(12/4) = 3 tokens
      expect(estimateTokens('hello world!')).toBe(3);
    });

    it('returns 0 for empty/null input', () => {
      expect(estimateTokens('')).toBe(0);
      expect(estimateTokens(null)).toBe(0);
      expect(estimateTokens(undefined)).toBe(0);
    });

    it('handles multibyte characters correctly', () => {
      // Each emoji is 4 bytes in UTF-8, so 2 emojis = 8 bytes -> ceil(8/4) = 2
      const emoji = '\u{1F600}\u{1F600}';
      const bytes = Buffer.byteLength(emoji, 'utf8');
      expect(estimateTokens(emoji)).toBe(Math.ceil(bytes / 4));
    });

    it('known string produces expected token count', () => {
      // "function foo(x) { return x * 2; }" = 34 bytes -> ceil(34/4) = 9
      const code = 'function foo(x) { return x * 2; }';
      const expectedBytes = Buffer.byteLength(code, 'utf8');
      expect(estimateTokens(code)).toBe(Math.ceil(expectedBytes / 4));
    });
  });

  describe('calcCostAvoided', () => {
    it('calculates cost for all three models', () => {
      const cost = calcCostAvoided(1_000_000); // 1M tokens
      expect(cost.claude_opus_4_6).toBe(15);
      expect(cost.claude_sonnet_4_6).toBe(3);
      expect(cost.claude_haiku_4_5).toBe(0.8);
    });

    it('calculates zero cost for zero tokens', () => {
      const cost = calcCostAvoided(0);
      expect(cost.claude_opus_4_6).toBe(0);
      expect(cost.claude_sonnet_4_6).toBe(0);
      expect(cost.claude_haiku_4_5).toBe(0);
    });

    it('calculates proportional cost for partial tokens', () => {
      const cost = calcCostAvoided(500_000); // 500K tokens
      expect(cost.claude_opus_4_6).toBe(7.5);
      expect(cost.claude_sonnet_4_6).toBe(1.5);
      expect(cost.claude_haiku_4_5).toBe(0.4);
    });
  });

  describe('wrapResult', () => {
    let dir;
    let telemetry;

    beforeEach(() => {
      dir = tmpDir();
      telemetry = new Telemetry(dir);
    });

    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('adds _meta with correct fields to JSON result', () => {
      const result = {
        content: [{ type: 'text', text: JSON.stringify({ symbols: ['foo'] }, null, 2) }],
      };

      const wrapped = telemetry.wrapResult(result, 1000, 200, 5.5);
      const parsed = JSON.parse(wrapped.content[0].text);

      expect(parsed._meta).toBeDefined();
      expect(parsed._meta.timing_ms).toBe(5.5);
      expect(parsed._meta.tokens_saved).toBe(800);
      expect(parsed._meta.estimate_method).toBe('byte_approx');
      expect(parsed._meta.cost_avoided).toBeDefined();
      expect(parsed._meta.cost_avoided.claude_opus_4_6).toBeDefined();
      expect(parsed._meta.cost_avoided.claude_sonnet_4_6).toBeDefined();
      expect(parsed._meta.cost_avoided.claude_haiku_4_5).toBeDefined();
      expect(parsed._meta.total_tokens_saved).toBe(800);
      expect(parsed._meta.total_cost_avoided).toBeDefined();
    });

    it('tokens_saved = fileTokens - responseTokens', () => {
      const result = {
        content: [{ type: 'text', text: JSON.stringify({ data: 'x' }) }],
      };

      const wrapped = telemetry.wrapResult(result, 5000, 500, 1.0);
      const parsed = JSON.parse(wrapped.content[0].text);
      expect(parsed._meta.tokens_saved).toBe(4500);
    });

    it('tokens_saved is never negative', () => {
      const result = {
        content: [{ type: 'text', text: JSON.stringify({ data: 'x' }) }],
      };

      const wrapped = telemetry.wrapResult(result, 100, 500, 1.0);
      const parsed = JSON.parse(wrapped.content[0].text);
      expect(parsed._meta.tokens_saved).toBe(0);
    });

    it('cost_avoided is calculated correctly from tokens_saved', () => {
      const result = {
        content: [{ type: 'text', text: JSON.stringify({ data: 'x' }) }],
      };

      // 1M tokens saved
      const wrapped = telemetry.wrapResult(result, 1_000_000, 0, 1.0);
      const parsed = JSON.parse(wrapped.content[0].text);
      expect(parsed._meta.cost_avoided.claude_opus_4_6).toBe(15);
      expect(parsed._meta.cost_avoided.claude_sonnet_4_6).toBe(3);
      expect(parsed._meta.cost_avoided.claude_haiku_4_5).toBe(0.8);
    });

    it('appends _meta to non-JSON text', () => {
      const result = {
        content: [{ type: 'text', text: 'function foo() { return 42; }' }],
      };

      const wrapped = telemetry.wrapResult(result, 1000, 100, 2.3);
      const text = wrapped.content[0].text;
      expect(text).toContain('function foo()');
      expect(text).toContain('"_meta"');

      // The _meta JSON should be parseable from the appended block
      const metaJson = text.substring(text.indexOf('\n{'));
      const parsed = JSON.parse(metaJson);
      expect(parsed._meta.tokens_saved).toBe(900);
    });
  });

  describe('wrapTimingOnly', () => {
    let dir;
    let telemetry;

    beforeEach(() => {
      dir = tmpDir();
      telemetry = new Telemetry(dir);
    });

    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('adds timing_ms only to JSON result', () => {
      const result = {
        content: [{ type: 'text', text: JSON.stringify({ status: 'ok' }) }],
      };

      const wrapped = telemetry.wrapTimingOnly(result, 3.7);
      const parsed = JSON.parse(wrapped.content[0].text);
      expect(parsed._meta).toBeDefined();
      expect(parsed._meta.timing_ms).toBe(3.7);
      expect(parsed._meta.tokens_saved).toBeUndefined();
    });
  });

  describe('cumulative stats persist and load', () => {
    let dir;

    beforeEach(() => {
      dir = tmpDir();
    });

    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('persists cumulative stats to telemetry.json', () => {
      const t1 = new Telemetry(dir);
      const result = {
        content: [{ type: 'text', text: JSON.stringify({ data: 'x' }) }],
      };
      t1.wrapResult(result, 1000, 200, 1.0);

      // Verify file exists
      const filePath = path.join(dir, '.cortex', 'telemetry.json');
      expect(fs.existsSync(filePath)).toBe(true);

      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      expect(data.total_queries).toBe(1);
      expect(data.total_tokens_saved).toBe(800);
    });

    it('loads cumulative stats on restart', () => {
      // First session
      const t1 = new Telemetry(dir);
      t1.wrapResult(
        { content: [{ type: 'text', text: JSON.stringify({ a: 1 }) }] },
        2000, 500, 1.0,
      );

      // Second session (new Telemetry instance)
      const t2 = new Telemetry(dir);
      t2.wrapResult(
        { content: [{ type: 'text', text: JSON.stringify({ b: 2 }) }] },
        3000, 1000, 1.0,
      );

      const report = t2.getReport();
      expect(report.total_queries).toBe(2);
      expect(report.total_tokens_saved).toBe(1500 + 2000); // 1500 from t1, 2000 from t2
    });

    it('creates .cortex directory if needed', () => {
      const t = new Telemetry(dir);
      t.wrapResult(
        { content: [{ type: 'text', text: JSON.stringify({ x: 1 }) }] },
        100, 10, 1.0,
      );
      expect(fs.existsSync(path.join(dir, '.cortex'))).toBe(true);
    });
  });

  describe('getReport', () => {
    let dir;
    let telemetry;

    beforeEach(() => {
      dir = tmpDir();
      telemetry = new Telemetry(dir);
    });

    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('returns correct report structure', () => {
      const report = telemetry.getReport();
      expect(report).toHaveProperty('total_queries');
      expect(report).toHaveProperty('total_tokens_saved');
      expect(report).toHaveProperty('total_cost_avoided');
      expect(report).toHaveProperty('session_start');
      expect(report).toHaveProperty('avg_tokens_saved_per_query');
    });

    it('calculates average tokens saved per query', () => {
      telemetry.wrapResult(
        { content: [{ type: 'text', text: JSON.stringify({ a: 1 }) }] },
        1000, 0, 1.0,
      );
      telemetry.wrapResult(
        { content: [{ type: 'text', text: JSON.stringify({ b: 2 }) }] },
        3000, 0, 1.0,
      );

      const report = telemetry.getReport();
      expect(report.total_queries).toBe(2);
      expect(report.total_tokens_saved).toBe(4000);
      expect(report.avg_tokens_saved_per_query).toBe(2000);
    });

    it('avg is 0 when no queries', () => {
      const report = telemetry.getReport();
      expect(report.avg_tokens_saved_per_query).toBe(0);
    });
  });
});
