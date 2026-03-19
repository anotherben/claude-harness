const Store = require('../src/store');

describe('Scored search', () => {
  let store;

  beforeEach(() => {
    store = new Store(':memory:');
    store.migrate();
    const f = store.upsertFile({ path: 'a.js', language: 'javascript', hash: 'a', sizeBytes: 100, lineCount: 10 });
    store.upsertSymbols(f.id, [
      { name: 'listOrders', kind: 'function', signature: 'function listOrders()', startLine: 1, endLine: 3, exported: true, async: false },
      { name: 'listOrderItems', kind: 'function', signature: 'function listOrderItems()', startLine: 5, endLine: 7, exported: true, async: false },
      { name: 'getOrderList', kind: 'function', signature: 'function getOrderList()', startLine: 9, endLine: 11, exported: false, async: false },
      { name: 'unrelated', kind: 'function', signature: 'function unrelated()', startLine: 13, endLine: 15, exported: false, async: false },
    ]);
  });

  afterEach(() => store.close());

  // PC-10: results have score field
  it('returns results with numeric score', () => {
    const results = store.findSymbols({ query: 'listOrders' });
    expect(results.length).toBeGreaterThan(0);
    results.forEach((r) => {
      expect(typeof r.score).toBe('number');
    });
  });

  // PC-11: exact match scores higher than contains
  it('exact match scores highest', () => {
    const results = store.findSymbols({ query: 'listOrders' });
    // Exact match should come first and score at least 100 (word-overlap bonus may raise it further)
    expect(results[0].name).toBe('listOrders');
    expect(results[0].score).toBeGreaterThanOrEqual(100);
    // The exact match must score strictly higher than any non-exact match
    const nonExact = results.filter(r => r.name !== 'listOrders');
    nonExact.forEach(r => expect(results[0].score).toBeGreaterThan(r.score));
    // Now test contains: 'Order' matches all three order functions
    const orderResults = store.findSymbols({ query: 'Order' });
    expect(orderResults.length).toBeGreaterThanOrEqual(3);
    // getOrderList starts with 'get' not 'Order', so prefix match scores higher
    const contained = orderResults.filter(r => r.score < 75);
    expect(contained.length).toBeGreaterThan(0);
  });

  // PC-12: results sorted by score descending
  it('results sorted by score descending', () => {
    const results = store.findSymbols({ query: 'Order' });
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it('prefix match scores higher than contains', () => {
    const results = store.findSymbols({ query: 'list' });
    // listOrders and listOrderItems should score higher than getOrderList
    const listNames = results.filter((r) => r.name.startsWith('list'));
    const containsNames = results.filter((r) => !r.name.startsWith('list'));
    if (containsNames.length > 0) {
      expect(listNames[0].score).toBeGreaterThan(containsNames[0].score);
    }
  });
});
