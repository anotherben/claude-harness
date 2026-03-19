const Parser = require('../src/parser');
const fs = require('fs');
const path = require('path');

const FIXTURES = path.join(__dirname, 'fixtures');

describe('Java and C# tree-sitter parsing', () => {
  let parser;

  beforeAll(() => {
    parser = new Parser();
  });

  // --- Java ---

  describe('Java', () => {
    let result;

    beforeAll(() => {
      const content = fs.readFileSync(path.join(FIXTURES, 'Sample.java'), 'utf-8');
      result = parser.parse('Sample.java', content);
    });

    it('detects .java as java', () => {
      expect(parser.detectLanguage('Foo.java')).toBe('java');
    });

    it('extracts class', () => {
      const animal = result.symbols.find((s) => s.name === 'Animal' && s.kind === 'class');
      expect(animal).toBeDefined();
      expect(animal.kind).toBe('class');
      expect(animal.startLine).toBeGreaterThan(0);
      expect(animal.endLine).toBeGreaterThan(animal.startLine);
    });

    it('extracts constructor', () => {
      const ctor = result.symbols.find((s) => s.name === 'Animal' && s.kind === 'constructor');
      expect(ctor).toBeDefined();
      expect(ctor.kind).toBe('constructor');
      expect(ctor.parentClass).toBe('Animal');
    });

    it('extracts methods', () => {
      const getName = result.symbols.find((s) => s.name === 'getName' && s.kind === 'method');
      expect(getName).toBeDefined();
      expect(getName.parentClass).toBe('Animal');

      const setName = result.symbols.find((s) => s.name === 'setName' && s.kind === 'method');
      expect(setName).toBeDefined();
      expect(setName.parentClass).toBe('Animal');
    });

    it('extracts fields', () => {
      const name = result.symbols.find((s) => s.name === 'name' && s.kind === 'property');
      expect(name).toBeDefined();
      expect(name.parentClass).toBe('Animal');
    });

    it('extracts interface', () => {
      const runnable = result.symbols.find((s) => s.name === 'Runnable' && s.kind === 'interface');
      expect(runnable).toBeDefined();
      expect(runnable.kind).toBe('interface');
    });

    it('extracts interface methods', () => {
      const run = result.symbols.find((s) => s.name === 'run' && s.parentClass === 'Runnable');
      expect(run).toBeDefined();
      expect(run.kind).toBe('method');

      const getStatus = result.symbols.find((s) => s.name === 'getStatus' && s.parentClass === 'Runnable');
      expect(getStatus).toBeDefined();
    });

    it('extracts enum', () => {
      const color = result.symbols.find((s) => s.name === 'Color' && s.kind === 'enum');
      expect(color).toBeDefined();
      expect(color.kind).toBe('enum');
    });

    it('extracts enum members', () => {
      const red = result.symbols.find((s) => s.name === 'RED' && s.kind === 'enum_member');
      expect(red).toBeDefined();
      expect(red.parentClass).toBe('Color');

      const green = result.symbols.find((s) => s.name === 'GREEN');
      expect(green).toBeDefined();

      const blue = result.symbols.find((s) => s.name === 'BLUE');
      expect(blue).toBeDefined();
    });

    it('extracts annotation type', () => {
      const annotation = result.symbols.find((s) => s.name === 'MyAnnotation' && s.kind === 'annotation');
      expect(annotation).toBeDefined();
    });

    it('extracts imports', () => {
      const listImport = result.imports.find((i) => i.source === 'java.util.List');
      expect(listImport).toBeDefined();
      expect(listImport.identifiers).toContain('List');

      const mapImport = result.imports.find((i) => i.source === 'java.util.Map');
      expect(mapImport).toBeDefined();
    });

    it('does not break existing JS parsing', () => {
      const jsResult = parser.parse('simple.js', 'function foo() {} const bar = () => {};');
      const foo = jsResult.symbols.find((s) => s.name === 'foo');
      expect(foo).toBeDefined();
      expect(foo.kind).toBe('function');
    });
  });

  // --- C# ---

  describe('C#', () => {
    let result;

    beforeAll(() => {
      const content = fs.readFileSync(path.join(FIXTURES, 'Sample.cs'), 'utf-8');
      result = parser.parse('Sample.cs', content);
    });

    it('detects .cs as csharp', () => {
      expect(parser.detectLanguage('Foo.cs')).toBe('csharp');
    });

    it('extracts namespace', () => {
      const ns = result.symbols.find((s) => s.name === 'MyApp.Core' && s.kind === 'namespace');
      expect(ns).toBeDefined();
      expect(ns.kind).toBe('namespace');
    });

    it('extracts class', () => {
      const animal = result.symbols.find((s) => s.name === 'Animal' && s.kind === 'class');
      expect(animal).toBeDefined();
      expect(animal.kind).toBe('class');
      expect(animal.parentClass).toBe('MyApp.Core');
    });

    it('extracts constructor', () => {
      const ctor = result.symbols.find((s) => s.name === 'Animal' && s.kind === 'constructor');
      expect(ctor).toBeDefined();
      expect(ctor.kind).toBe('constructor');
      expect(ctor.parentClass).toBe('Animal');
    });

    it('extracts methods', () => {
      const getName = result.symbols.find((s) => s.name === 'GetName' && s.kind === 'method');
      expect(getName).toBeDefined();
      expect(getName.parentClass).toBe('Animal');

      const setName = result.symbols.find((s) => s.name === 'SetName' && s.kind === 'method');
      expect(setName).toBeDefined();
    });

    it('extracts properties', () => {
      const nameProp = result.symbols.find((s) => s.name === 'Name' && s.kind === 'property');
      expect(nameProp).toBeDefined();
      expect(nameProp.parentClass).toBe('Animal');
    });

    it('extracts interface', () => {
      const iRunnable = result.symbols.find((s) => s.name === 'IRunnable' && s.kind === 'interface');
      expect(iRunnable).toBeDefined();
      expect(iRunnable.kind).toBe('interface');
      expect(iRunnable.parentClass).toBe('MyApp.Core');
    });

    it('extracts interface methods', () => {
      const run = result.symbols.find((s) => s.name === 'Run' && s.parentClass === 'IRunnable');
      expect(run).toBeDefined();
      expect(run.kind).toBe('method');

      const getStatus = result.symbols.find((s) => s.name === 'GetStatus' && s.parentClass === 'IRunnable');
      expect(getStatus).toBeDefined();
    });

    it('extracts enum', () => {
      const color = result.symbols.find((s) => s.name === 'Color' && s.kind === 'enum');
      expect(color).toBeDefined();
      expect(color.kind).toBe('enum');
    });

    it('extracts enum members', () => {
      const red = result.symbols.find((s) => s.name === 'Red' && s.kind === 'enum_member');
      expect(red).toBeDefined();
      expect(red.parentClass).toBe('Color');

      const green = result.symbols.find((s) => s.name === 'Green');
      expect(green).toBeDefined();

      const blue = result.symbols.find((s) => s.name === 'Blue');
      expect(blue).toBeDefined();
    });

    it('extracts struct', () => {
      const point = result.symbols.find((s) => s.name === 'Point' && s.kind === 'class');
      expect(point).toBeDefined();
      expect(point.parentClass).toBe('MyApp.Core');
    });

    it('extracts struct methods', () => {
      const distance = result.symbols.find((s) => s.name === 'Distance' && s.parentClass === 'Point');
      expect(distance).toBeDefined();
      expect(distance.kind).toBe('method');
    });

    it('extracts using directives as imports', () => {
      const sysImport = result.imports.find((i) => i.source === 'System');
      expect(sysImport).toBeDefined();

      const genericImport = result.imports.find((i) => i.source === 'System.Collections.Generic');
      expect(genericImport).toBeDefined();
    });

    it('does not break existing TS parsing', () => {
      const tsResult = parser.parse('types.ts', 'interface Foo { bar: string; } type Baz = number;');
      const foo = tsResult.symbols.find((s) => s.name === 'Foo');
      expect(foo).toBeDefined();
      expect(foo.kind).toBe('interface');
    });
  });
});
