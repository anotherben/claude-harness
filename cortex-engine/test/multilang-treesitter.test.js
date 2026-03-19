const Parser = require('../src/parser');
const fs = require('fs');
const path = require('path');

const FIXTURES = path.join(__dirname, 'fixtures');

describe('Multi-language tree-sitter parsing', () => {
  let parser;

  beforeAll(() => {
    parser = new Parser();
  });

  // --- Python ---

  describe('Python', () => {
    let result;

    beforeAll(() => {
      const content = fs.readFileSync(path.join(FIXTURES, 'sample.py'), 'utf-8');
      result = parser.parse('sample.py', content);
    });

    it('detects .py as python', () => {
      expect(parser.detectLanguage('foo.py')).toBe('python');
    });

    it('extracts classes', () => {
      const animal = result.symbols.find((s) => s.name === 'Animal' && s.kind === 'class');
      expect(animal).toBeDefined();
      expect(animal.kind).toBe('class');

      const dog = result.symbols.find((s) => s.name === 'Dog' && s.kind === 'class');
      expect(dog).toBeDefined();
    });

    it('extracts methods inside classes', () => {
      const init = result.symbols.find((s) => s.name === '__init__' && s.parentClass === 'Animal');
      expect(init).toBeDefined();
      expect(init.kind).toBe('method');
      expect(init.parentClass).toBe('Animal');

      const speak = result.symbols.find((s) => s.name === 'speak' && s.parentClass === 'Animal');
      expect(speak).toBeDefined();
      expect(speak.kind).toBe('method');
    });

    it('extracts async methods', () => {
      const fetchData = result.symbols.find((s) => s.name === 'fetch_data');
      expect(fetchData).toBeDefined();
      expect(fetchData.async).toBe(true);
      expect(fetchData.parentClass).toBe('Animal');
    });

    it('extracts Dog methods with correct parent', () => {
      const dogSpeak = result.symbols.find((s) => s.name === 'speak' && s.parentClass === 'Dog');
      expect(dogSpeak).toBeDefined();
      expect(dogSpeak.kind).toBe('method');

      const fetch = result.symbols.find((s) => s.name === 'fetch' && s.parentClass === 'Dog');
      expect(fetch).toBeDefined();
    });

    it('extracts decorated standalone functions', () => {
      const decorated = result.symbols.find((s) => s.name === 'decorated_function');
      expect(decorated).toBeDefined();
      expect(decorated.kind).toBe('function');
      expect(decorated.signature).toContain('@staticmethod');
    });

    it('extracts async standalone functions', () => {
      const asyncFn = result.symbols.find((s) => s.name === 'async_standalone');
      expect(asyncFn).toBeDefined();
      expect(asyncFn.async).toBe(true);
      expect(asyncFn.kind).toBe('function');
      expect(asyncFn.parentClass).toBeNull();
    });

    it('extracts imports', () => {
      const osImport = result.imports.find((i) => i.source === 'os');
      expect(osImport).toBeDefined();

      const pathlibImport = result.imports.find((i) => i.source === 'pathlib');
      expect(pathlibImport).toBeDefined();
      expect(pathlibImport.identifiers).toContain('Path');
    });

    it('nested symbols link children to parents', () => {
      const animal = result.symbols.find((s) => s.name === 'Animal' && s.kind === 'class');
      expect(animal.children.length).toBeGreaterThanOrEqual(3); // __init__, speak, fetch_data
      const childNames = animal.children.map((c) => c.name);
      expect(childNames).toContain('__init__');
      expect(childNames).toContain('speak');
      expect(childNames).toContain('fetch_data');
    });

    it('has correct line numbers', () => {
      const animal = result.symbols.find((s) => s.name === 'Animal' && s.kind === 'class');
      expect(animal.startLine).toBeGreaterThan(0);
      expect(animal.endLine).toBeGreaterThanOrEqual(animal.startLine);
    });
  });

  // --- Go ---

  describe('Go', () => {
    let result;

    beforeAll(() => {
      const content = fs.readFileSync(path.join(FIXTURES, 'sample.go'), 'utf-8');
      result = parser.parse('sample.go', content);
    });

    it('detects .go as go', () => {
      expect(parser.detectLanguage('main.go')).toBe('go');
    });

    it('extracts struct types', () => {
      const animal = result.symbols.find((s) => s.name === 'Animal' && s.kind === 'class');
      expect(animal).toBeDefined();
      expect(animal.signature).toContain('struct');
    });

    it('extracts interface types', () => {
      const speaker = result.symbols.find((s) => s.name === 'Speaker' && s.kind === 'interface');
      expect(speaker).toBeDefined();
      expect(speaker.signature).toContain('interface');
    });

    it('extracts interface methods', () => {
      const speak = result.symbols.find((s) => s.name === 'Speak' && s.parentClass === 'Speaker');
      expect(speak).toBeDefined();
      expect(speak.kind).toBe('method');

      const listen = result.symbols.find((s) => s.name === 'Listen' && s.parentClass === 'Speaker');
      expect(listen).toBeDefined();
    });

    it('extracts methods on structs', () => {
      const speak = result.symbols.find((s) => s.name === 'Speak' && s.parentClass === 'Animal');
      expect(speak).toBeDefined();
      expect(speak.kind).toBe('method');
      expect(speak.parentClass).toBe('Animal');

      const setName = result.symbols.find((s) => s.name === 'SetName' && s.parentClass === 'Animal');
      expect(setName).toBeDefined();
    });

    it('extracts standalone functions', () => {
      const newAnimal = result.symbols.find((s) => s.name === 'NewAnimal');
      expect(newAnimal).toBeDefined();
      expect(newAnimal.kind).toBe('function');
      expect(newAnimal.parentClass).toBeNull();

      const formatName = result.symbols.find((s) => s.name === 'FormatName');
      expect(formatName).toBeDefined();
      expect(formatName.kind).toBe('function');
    });

    it('extracts constants', () => {
      const maxSize = result.symbols.find((s) => s.name === 'MaxSize');
      expect(maxSize).toBeDefined();
      expect(maxSize.kind).toBe('constant');
    });

    it('extracts variables', () => {
      const globalVar = result.symbols.find((s) => s.name === 'GlobalVar');
      expect(globalVar).toBeDefined();
      expect(globalVar.kind).toBe('variable');
    });

    it('extracts imports', () => {
      const fmtImport = result.imports.find((i) => i.source === 'fmt');
      expect(fmtImport).toBeDefined();

      const stringsImport = result.imports.find((i) => i.source === 'strings');
      expect(stringsImport).toBeDefined();
    });

    it('links methods as children of structs', () => {
      const animal = result.symbols.find((s) => s.name === 'Animal' && s.kind === 'class');
      expect(animal.children.length).toBeGreaterThanOrEqual(2); // Speak, SetName
      const childNames = animal.children.map((c) => c.name);
      expect(childNames).toContain('Speak');
      expect(childNames).toContain('SetName');
    });
  });

  // --- Rust ---

  describe('Rust', () => {
    let result;

    beforeAll(() => {
      const content = fs.readFileSync(path.join(FIXTURES, 'sample.rs'), 'utf-8');
      result = parser.parse('sample.rs', content);
    });

    it('detects .rs as rust', () => {
      expect(parser.detectLanguage('lib.rs')).toBe('rust');
    });

    it('extracts structs', () => {
      const animal = result.symbols.find((s) => s.name === 'Animal' && s.kind === 'class');
      expect(animal).toBeDefined();
      expect(animal.signature).toContain('struct');
    });

    it('extracts impl blocks', () => {
      const impl = result.symbols.find((s) => s.name === 'Animal' && s.kind === 'impl');
      expect(impl).toBeDefined();
      expect(impl.signature).toBe('impl Animal');
    });

    it('extracts methods inside impl blocks', () => {
      const newFn = result.symbols.find((s) => s.name === 'new' && s.parentClass === 'Animal');
      expect(newFn).toBeDefined();
      expect(newFn.kind).toBe('method');

      const speak = result.symbols.find((s) => s.name === 'speak' && s.parentClass === 'Animal');
      expect(speak).toBeDefined();
      expect(speak.kind).toBe('method');

      const setName = result.symbols.find((s) => s.name === 'set_name' && s.parentClass === 'Animal');
      expect(setName).toBeDefined();
      expect(setName.exported).toBe(true); // pub fn
    });

    it('extracts trait impl blocks', () => {
      // impl fmt::Display for Animal
      const displayImpl = result.symbols.find(
        (s) => s.kind === 'impl' && s.signature.includes('Display') && s.signature.includes('Animal')
      );
      expect(displayImpl).toBeDefined();

      const fmtMethod = result.symbols.find(
        (s) => s.name === 'fmt' && s.parentClass === 'Animal'
      );
      expect(fmtMethod).toBeDefined();
    });

    it('extracts enums with variants', () => {
      const color = result.symbols.find((s) => s.name === 'Color' && s.kind === 'enum');
      expect(color).toBeDefined();

      const red = result.symbols.find((s) => s.name === 'Red' && s.parentClass === 'Color');
      expect(red).toBeDefined();
      expect(red.kind).toBe('enum_member');

      const blue = result.symbols.find((s) => s.name === 'Blue' && s.parentClass === 'Color');
      expect(blue).toBeDefined();
    });

    it('extracts traits with method signatures', () => {
      const drawable = result.symbols.find((s) => s.name === 'Drawable' && s.kind === 'trait');
      expect(drawable).toBeDefined();

      const draw = result.symbols.find((s) => s.name === 'draw' && s.parentClass === 'Drawable');
      expect(draw).toBeDefined();
      expect(draw.kind).toBe('method');

      const area = result.symbols.find((s) => s.name === 'area' && s.parentClass === 'Drawable');
      expect(area).toBeDefined();
      expect(area.signature).toContain('f64');
    });

    it('extracts standalone functions', () => {
      const fn = result.symbols.find((s) => s.name === 'standalone_function');
      expect(fn).toBeDefined();
      expect(fn.kind).toBe('function');
      expect(fn.parentClass).toBeNull();
    });

    it('extracts type aliases', () => {
      const point = result.symbols.find((s) => s.name === 'Point');
      expect(point).toBeDefined();
      expect(point.kind).toBe('type');
    });

    it('extracts constants and statics', () => {
      const maxSize = result.symbols.find((s) => s.name === 'MAX_SIZE');
      expect(maxSize).toBeDefined();
      expect(maxSize.kind).toBe('constant');

      const globalName = result.symbols.find((s) => s.name === 'GLOBAL_NAME');
      expect(globalName).toBeDefined();
      expect(globalName.kind).toBe('variable');
    });

    it('extracts macro definitions', () => {
      const macro = result.symbols.find((s) => s.name === 'say_hello');
      expect(macro).toBeDefined();
      expect(macro.kind).toBe('macro');
    });

    it('extracts use declarations as imports', () => {
      const hashMapImport = result.imports.find((i) => i.source.includes('HashMap'));
      expect(hashMapImport).toBeDefined();

      const fmtImport = result.imports.find((i) => i.source.includes('fmt'));
      expect(fmtImport).toBeDefined();
    });

    it('links impl methods as children of struct', () => {
      const animal = result.symbols.find((s) => s.name === 'Animal' && s.kind === 'class');
      // Should have children from both impl blocks (Animal and Display)
      expect(animal.children.length).toBeGreaterThanOrEqual(3); // new, speak, set_name
      const childNames = animal.children.map((c) => c.name);
      expect(childNames).toContain('new');
      expect(childNames).toContain('speak');
      expect(childNames).toContain('set_name');
    });

    it('links enum variants as children of enum', () => {
      const color = result.symbols.find((s) => s.name === 'Color' && s.kind === 'enum');
      expect(color.children.length).toBe(3); // Red, Green, Blue
    });

    it('links trait methods as children of trait', () => {
      const drawable = result.symbols.find((s) => s.name === 'Drawable' && s.kind === 'trait');
      expect(drawable.children.length).toBe(2); // draw, area
    });
  });

  // --- Language detection for new extensions ---

  describe('extension detection', () => {
    it('detects .go files', () => {
      expect(parser.detectLanguage('main.go')).toBe('go');
    });

    it('detects .rs files', () => {
      expect(parser.detectLanguage('lib.rs')).toBe('rust');
    });

    it('detects .py files', () => {
      expect(parser.detectLanguage('app.py')).toBe('python');
    });
  });
});
