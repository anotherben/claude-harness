const Parser = require('../src/parser');
const fs = require('fs');
const path = require('path');

const FIXTURES = path.join(__dirname, 'fixtures');

describe('Parser', () => {
  let parser;

  beforeAll(() => {
    parser = new Parser();
  });

  // PC-7: Parser extracts functions
  describe('function extraction', () => {
    it('extracts function declarations', () => {
      const content = fs.readFileSync(path.join(FIXTURES, 'simple.js'), 'utf-8');
      const result = parser.parse('simple.js', content);
      const foo = result.symbols.find((s) => s.name === 'foo');
      expect(foo).toBeDefined();
      expect(foo.kind).toBe('function');
      expect(foo.async).toBe(false);
      expect(foo.startLine).toBeGreaterThan(0);
      expect(foo.endLine).toBeGreaterThanOrEqual(foo.startLine);
    });

    it('extracts arrow functions', () => {
      const content = fs.readFileSync(path.join(FIXTURES, 'simple.js'), 'utf-8');
      const result = parser.parse('simple.js', content);
      const bar = result.symbols.find((s) => s.name === 'bar');
      expect(bar).toBeDefined();
      expect(bar.kind).toBe('function');
    });

    it('detects async functions', () => {
      const content = fs.readFileSync(path.join(FIXTURES, 'simple.js'), 'utf-8');
      const result = parser.parse('simple.js', content);
      const baz = result.symbols.find((s) => s.name === 'baz');
      expect(baz).toBeDefined();
      expect(baz.async).toBe(true);
    });
  });

  // PC-8: Parser extracts classes
  describe('class extraction', () => {
    it('extracts classes', () => {
      const content = fs.readFileSync(path.join(FIXTURES, 'classes.js'), 'utf-8');
      const result = parser.parse('classes.js', content);
      const cls = result.symbols.find((s) => s.name === 'MyClass');
      expect(cls).toBeDefined();
      expect(cls.kind).toBe('class');
    });

    it('extracts methods', () => {
      const content = fs.readFileSync(path.join(FIXTURES, 'classes.js'), 'utf-8');
      const result = parser.parse('classes.js', content);
      const ctor = result.symbols.find((s) => s.name === 'constructor');
      const method = result.symbols.find((s) => s.name === 'method');
      expect(ctor).toBeDefined();
      expect(ctor.kind).toBe('method');
      expect(method).toBeDefined();
      expect(method.kind).toBe('method');
    });
  });

  // PC-9: Parser extracts imports
  describe('import extraction', () => {
    it('extracts require calls', () => {
      const content = fs.readFileSync(path.join(FIXTURES, 'imports.js'), 'utf-8');
      const result = parser.parse('imports.js', content);
      const expressImport = result.imports.find((i) => i.source === 'express');
      expect(expressImport).toBeDefined();
      expect(expressImport.identifiers).toContain('express');
    });

    it('extracts destructured imports', () => {
      const content = fs.readFileSync(path.join(FIXTURES, 'imports.js'), 'utf-8');
      const result = parser.parse('imports.js', content);
      const dbImport = result.imports.find((i) => i.source === '../db');
      expect(dbImport).toBeDefined();
      expect(dbImport.identifiers).toContain('pool');
    });
  });

  // PC-10: Parser handles .cjs files
  describe('.cjs support', () => {
    it('handles .cjs files', () => {
      const content = fs.readFileSync(path.join(FIXTURES, 'simple.cjs'), 'utf-8');
      const result = parser.parse('simple.cjs', content);
      const names = result.symbols.map((s) => s.name);
      expect(names).toContain('foo');
      expect(names).toContain('bar');
      expect(names).toContain('baz');
    });
  });

  // PC-11: Parser returns empty for unparseable files
  describe('error handling', () => {
    it('returns empty for invalid syntax', () => {
      const result = parser.parse('bad.js', '}{}{');
      expect(result.symbols).toEqual([]);
      expect(result.imports).toEqual([]);
    });
  });
});
