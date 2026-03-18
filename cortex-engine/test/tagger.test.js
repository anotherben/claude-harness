const Tagger = require('../src/tagger');

// Tagger works on pre-parsed symbols + raw source. No Parser dependency needed.
function makeSymbol(name, startLine, endLine, isAsync = false) {
  return { name, kind: 'function', signature: `function ${name}()`, startLine, endLine, exported: false, async: isAsync };
}

describe('Tagger', () => {
  let tagger;

  beforeAll(() => {
    tagger = new Tagger();
  });

  describe('db_read detection', () => {
    it('tags functions containing SELECT queries', () => {
      const code = `function listOrders(tenantId) {\n  const result = pool.query('SELECT * FROM orders WHERE tenant_id = $1', [tenantId]);\n  return result.rows;\n}`;
      const symbols = [makeSymbol('listOrders', 1, 4)];
      const tags = tagger.tagSymbols(symbols, code);
      expect(tags.get('listOrders')).toContain('db_read');
    });
  });

  describe('db_write detection', () => {
    it('tags functions containing INSERT/UPDATE/DELETE', () => {
      const code = `function createOrder(tenantId, data) {\n  pool.query('INSERT INTO orders (tenant_id, status) VALUES ($1, $2)', [tenantId, data.status]);\n}`;
      const symbols = [makeSymbol('createOrder', 1, 3)];
      const tags = tagger.tagSymbols(symbols, code);
      expect(tags.get('createOrder')).toContain('db_write');
    });
  });

  describe('route_handler detection', () => {
    it('tags functions used in router.get/post', () => {
      const code = `router.get('/orders', async (req, res) => {\n  res.json({ orders: [] });\n});`;
      const tags = tagger.tagSource(code);
      expect(tags.some(t => t.tag === 'route_handler')).toBe(true);
    });
  });

  describe('tenant_scoped detection', () => {
    it('detects tenant_id in queries', () => {
      const code = `function getOrder(tenantId, id) {\n  return pool.query('SELECT * FROM orders WHERE tenant_id = $1 AND id = $2', [tenantId, id]);\n}`;
      const symbols = [makeSymbol('getOrder', 1, 3)];
      const tags = tagger.tagSymbols(symbols, code);
      expect(tags.get('getOrder')).toContain('tenant_scoped');
    });
  });

  describe('unscoped_query detection', () => {
    it('flags DB queries missing tenant_id', () => {
      const code = `function getAllOrders() {\n  return pool.query('SELECT * FROM orders');\n}`;
      const symbols = [makeSymbol('getAllOrders', 1, 3)];
      const tags = tagger.tagSymbols(symbols, code);
      expect(tags.get('getAllOrders')).toContain('unscoped_query');
    });
  });

  describe('async detection', () => {
    it('tags async functions', () => {
      const code = `async function fetchData() {\n  const data = await fetch('/api');\n  return data;\n}`;
      const symbols = [makeSymbol('fetchData', 1, 4, true)];
      const tags = tagger.tagSymbols(symbols, code);
      expect(tags.get('fetchData')).toContain('async');
    });
  });

  describe('error_handler detection', () => {
    it('tags functions with try/catch', () => {
      const code = `function safeCall() {\n  try {\n    doSomething();\n  } catch (err) {\n    console.error(err);\n  }\n}`;
      const symbols = [makeSymbol('safeCall', 1, 7)];
      const tags = tagger.tagSymbols(symbols, code);
      expect(tags.get('safeCall')).toContain('error_handler');
    });
  });

  describe('no_error_handling detection', () => {
    it('flags DB calls without try/catch', () => {
      const code = `function unsafeQuery() {\n  const result = pool.query('SELECT 1');\n  return result;\n}`;
      const symbols = [makeSymbol('unsafeQuery', 1, 4)];
      const tags = tagger.tagSymbols(symbols, code);
      expect(tags.get('unsafeQuery')).toContain('no_error_handling');
    });
  });

  describe('exported detection', () => {
    it('tags module.exports symbols', () => {
      const code = `function helper() { return 1; }\nmodule.exports = { helper };`;
      const tags = tagger.tagSource(code);
      expect(tags.some(t => t.tag === 'exported' && t.name === 'helper')).toBe(true);
    });
  });

  describe('configurable rules', () => {
    it('accepts custom tag rules', () => {
      const customTagger = new Tagger({
        customRules: [
          { tag: 'rex_soap', pattern: /rexClient\.call|soap\.createClient/ },
          { tag: 'shopify_api', pattern: /shopifyClient\.|shopify\./ },
        ],
      });
      const code = `function syncInventory() {\n  const result = rexClient.call('GetProducts', {});\n  return result;\n}`;
      const symbols = [makeSymbol('syncInventory', 1, 4)];
      const tags = customTagger.tagSymbols(symbols, code);
      expect(tags.get('syncInventory')).toContain('rex_soap');
    });
  });
});
