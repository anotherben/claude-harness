const Store = require('../src/store');

describe('Nested symbols', () => {
  let store;

  beforeEach(() => {
    store = new Store(':memory:');
    store.migrate();
  });

  afterEach(() => store.close());

  // PC-13: getOutline returns classes with children array
  it('outline groups methods under parent class', () => {
    const f = store.upsertFile({ path: 'a.js', language: 'javascript', hash: 'a', sizeBytes: 100, lineCount: 30 });
    store.upsertSymbols(f.id, [
      { name: 'MyClass', kind: 'class', signature: 'class MyClass', startLine: 1, endLine: 20, exported: false, async: false },
      { name: 'constructor', kind: 'method', signature: 'constructor()', startLine: 2, endLine: 5, exported: false, async: false, parentClass: 'MyClass' },
      { name: 'getData', kind: 'method', signature: 'getData()', startLine: 6, endLine: 10, exported: false, async: true, parentClass: 'MyClass' },
      { name: 'freeFunction', kind: 'function', signature: 'function freeFunction()', startLine: 22, endLine: 25, exported: false, async: false },
    ]);

    const outline = store.getOutlineNested(f.id);
    // MyClass should have children
    const cls = outline.find((s) => s.name === 'MyClass');
    expect(cls).toBeDefined();
    expect(cls.children).toBeDefined();
    expect(cls.children).toHaveLength(2);
    expect(cls.children.map((c) => c.name)).toContain('constructor');
    expect(cls.children.map((c) => c.name)).toContain('getData');

    // freeFunction should be top-level, no children
    const free = outline.find((s) => s.name === 'freeFunction');
    expect(free).toBeDefined();
    expect(free.children).toBeUndefined();
  });

  // PC-14: methods still individually searchable
  it('methods searchable via findSymbols', () => {
    const f = store.upsertFile({ path: 'a.js', language: 'javascript', hash: 'a', sizeBytes: 100, lineCount: 20 });
    store.upsertSymbols(f.id, [
      { name: 'MyClass', kind: 'class', signature: 'class MyClass', startLine: 1, endLine: 15, exported: false, async: false },
      { name: 'getData', kind: 'method', signature: 'getData()', startLine: 3, endLine: 8, exported: false, async: false, parentClass: 'MyClass' },
    ]);

    const results = store.findSymbols({ query: 'getData' });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].name).toBe('getData');
  });
});
