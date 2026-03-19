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

  // Nested symbol extraction
  describe('nested symbol extraction', () => {
    describe('factory function with nested helpers', () => {
      let result;
      beforeAll(() => {
        const content = fs.readFileSync(path.join(FIXTURES, 'factory.js'), 'utf-8');
        result = parser.parse('factory.js', content);
      });

      it('extracts the factory function itself', () => {
        const factory = result.symbols.find((s) => s.name === 'createUserService');
        expect(factory).toBeDefined();
        expect(factory.kind).toBe('function');
        expect(factory.parentClass).toBeNull();
      });

      it('extracts nested function declarations inside factory', () => {
        const validate = result.symbols.find((s) => s.name === 'validate');
        expect(validate).toBeDefined();
        expect(validate.kind).toBe('function');
        expect(validate.parentClass).toBe('createUserService');
      });

      it('extracts nested arrow functions inside factory', () => {
        const formatName = result.symbols.find((s) => s.name === 'formatName');
        expect(formatName).toBeDefined();
        expect(formatName.kind).toBe('function');
        expect(formatName.parentClass).toBe('createUserService');
      });

      it('extracts nested async functions inside factory', () => {
        const save = result.symbols.find((s) => s.name === 'save');
        expect(save).toBeDefined();
        expect(save.kind).toBe('function');
        expect(save.async).toBe(true);
        expect(save.parentClass).toBe('createUserService');
      });

      it('populates children array on the factory function', () => {
        const factory = result.symbols.find((s) => s.name === 'createUserService');
        expect(factory.children).toBeDefined();
        expect(factory.children.length).toBeGreaterThanOrEqual(3);
        const childNames = factory.children.map((c) => c.name);
        expect(childNames).toContain('validate');
        expect(childNames).toContain('formatName');
        expect(childNames).toContain('save');
      });
    });

    describe('class with nested helper functions', () => {
      let result;
      beforeAll(() => {
        const content = fs.readFileSync(path.join(FIXTURES, 'nested-class.js'), 'utf-8');
        result = parser.parse('nested-class.js', content);
      });

      it('extracts the class', () => {
        const cls = result.symbols.find((s) => s.name === 'OrderProcessor');
        expect(cls).toBeDefined();
        expect(cls.kind).toBe('class');
      });

      it('extracts class methods', () => {
        const process = result.symbols.find((s) => s.name === 'process' && s.kind === 'method');
        expect(process).toBeDefined();
        expect(process.parentClass).toBe('OrderProcessor');
      });

      it('extracts nested function inside method body', () => {
        const calcTax = result.symbols.find((s) => s.name === 'calculateTax');
        expect(calcTax).toBeDefined();
        expect(calcTax.kind).toBe('function');
        expect(calcTax.parentClass).toBe('process');
      });

      it('extracts nested arrow function inside method body', () => {
        const applyDiscount = result.symbols.find((s) => s.name === 'applyDiscount');
        expect(applyDiscount).toBeDefined();
        expect(applyDiscount.kind).toBe('function');
        expect(applyDiscount.parentClass).toBe('process');
      });

      it('extracts nested function inside async method body', () => {
        const serialize = result.symbols.find((s) => s.name === 'serialize');
        expect(serialize).toBeDefined();
        expect(serialize.kind).toBe('function');
        expect(serialize.parentClass).toBe('save');
      });
    });

    describe('arrow function with nested helpers', () => {
      let result;
      beforeAll(() => {
        const content = fs.readFileSync(path.join(FIXTURES, 'arrow-nested.js'), 'utf-8');
        result = parser.parse('arrow-nested.js', content);
      });

      it('extracts the outer arrow function', () => {
        const logger = result.symbols.find((s) => s.name === 'createLogger');
        expect(logger).toBeDefined();
        expect(logger.kind).toBe('function');
        expect(logger.parentClass).toBeNull();
      });

      it('extracts nested arrow inside arrow function', () => {
        const format = result.symbols.find((s) => s.name === 'format');
        expect(format).toBeDefined();
        expect(format.kind).toBe('function');
        expect(format.parentClass).toBe('createLogger');
      });

      it('extracts nested function declaration inside arrow function', () => {
        const timestamp = result.symbols.find((s) => s.name === 'timestamp');
        expect(timestamp).toBeDefined();
        expect(timestamp.kind).toBe('function');
        expect(timestamp.parentClass).toBe('createLogger');
      });

      it('extracts deeply nested arrow inside arrow function', () => {
        const log = result.symbols.find((s) => s.name === 'log');
        expect(log).toBeDefined();
        expect(log.kind).toBe('function');
        expect(log.parentClass).toBe('createLogger');
      });

      it('populates children array on the outer arrow function', () => {
        const logger = result.symbols.find((s) => s.name === 'createLogger');
        expect(logger.children.length).toBeGreaterThanOrEqual(3);
        const childNames = logger.children.map((c) => c.name);
        expect(childNames).toContain('format');
        expect(childNames).toContain('timestamp');
        expect(childNames).toContain('log');
      });
    });
  });

  // TypeScript type extraction
  describe('TypeScript type extraction', () => {
    let result;
    beforeAll(() => {
      const content = fs.readFileSync(path.join(FIXTURES, 'typescript-types.ts'), 'utf-8');
      result = parser.parse('typescript-types.ts', content);
    });

    it('extracts type aliases', () => {
      const userId = result.symbols.find((s) => s.name === 'UserId');
      expect(userId).toBeDefined();
      expect(userId.kind).toBe('type');

      const config = result.symbols.find((s) => s.name === 'Config');
      expect(config).toBeDefined();
      expect(config.kind).toBe('type');
    });

    it('extracts interfaces', () => {
      const userService = result.symbols.find((s) => s.name === 'UserService');
      expect(userService).toBeDefined();
      expect(userService.kind).toBe('interface');
    });

    it('extracts interface methods', () => {
      const getUser = result.symbols.find((s) => s.name === 'getUser' && s.parentClass === 'UserService');
      expect(getUser).toBeDefined();
      expect(getUser.kind).toBe('method');
    });

    it('extracts interface properties', () => {
      const name = result.symbols.find((s) => s.name === 'name' && s.parentClass === 'UserService');
      expect(name).toBeDefined();
      expect(name.kind).toBe('property');
    });

    it('populates children on interface', () => {
      const userService = result.symbols.find((s) => s.name === 'UserService');
      expect(userService.children.length).toBeGreaterThanOrEqual(3);
      const childNames = userService.children.map((c) => c.name);
      expect(childNames).toContain('getUser');
      expect(childNames).toContain('createUser');
      expect(childNames).toContain('name');
    });

    it('extracts enums', () => {
      const status = result.symbols.find((s) => s.name === 'Status');
      expect(status).toBeDefined();
      expect(status.kind).toBe('enum');
    });

    it('extracts enum members', () => {
      const active = result.symbols.find((s) => s.name === 'Active' && s.parentClass === 'Status');
      expect(active).toBeDefined();
      expect(active.kind).toBe('enum_member');
    });

    it('populates children on enum', () => {
      const status = result.symbols.find((s) => s.name === 'Status');
      expect(status.children.length).toBe(3);
      const childNames = status.children.map((c) => c.name);
      expect(childNames).toContain('Active');
      expect(childNames).toContain('Inactive');
      expect(childNames).toContain('Pending');
    });

    it('extracts nested function inside TypeScript function', () => {
      const buildUrl = result.symbols.find((s) => s.name === 'buildUrl');
      expect(buildUrl).toBeDefined();
      expect(buildUrl.kind).toBe('function');
      expect(buildUrl.parentClass).toBe('createService');
    });

    it('extracts multiple interfaces', () => {
      const logger = result.symbols.find((s) => s.name === 'Logger');
      expect(logger).toBeDefined();
      expect(logger.kind).toBe('interface');
      const infoMethod = result.symbols.find((s) => s.name === 'info' && s.parentClass === 'Logger');
      expect(infoMethod).toBeDefined();
      expect(infoMethod.kind).toBe('method');
    });
  });

  // Parent-child relationship integrity
  describe('parent-child relationships', () => {
    it('top-level symbols have null parentClass', () => {
      const content = fs.readFileSync(path.join(FIXTURES, 'simple.js'), 'utf-8');
      const result = parser.parse('simple.js', content);
      for (const sym of result.symbols) {
        expect(sym.parentClass).toBeNull();
      }
    });

    it('class methods have parentClass pointing to class name', () => {
      const content = fs.readFileSync(path.join(FIXTURES, 'classes.js'), 'utf-8');
      const result = parser.parse('classes.js', content);
      const methods = result.symbols.filter((s) => s.kind === 'method');
      for (const m of methods) {
        expect(m.parentClass).toBe('MyClass');
      }
    });

    it('all symbols have children array', () => {
      const content = fs.readFileSync(path.join(FIXTURES, 'factory.js'), 'utf-8');
      const result = parser.parse('factory.js', content);
      for (const sym of result.symbols) {
        expect(Array.isArray(sym.children)).toBe(true);
      }
    });
  });

  // Express route extraction
  describe('route extraction', () => {
    let result;
    beforeAll(() => {
      const content = fs.readFileSync(path.join(FIXTURES, 'routes.js'), 'utf-8');
      result = parser.parse('routes.js', content);
    });

    it('extracts router.get route as a route symbol', () => {
      const route = result.symbols.find((s) => s.name === 'GET /orders');
      expect(route).toBeDefined();
      expect(route.kind).toBe('route');
      expect(route.signature).toBe('GET /orders');
    });

    it('extracts router.post route with middleware', () => {
      const route = result.symbols.find((s) => s.name === 'POST /orders');
      expect(route).toBeDefined();
      expect(route.kind).toBe('route');
    });

    it('extracts route with path parameters', () => {
      const route = result.symbols.find((s) => s.name === 'GET /orders/:id');
      expect(route).toBeDefined();
      expect(route.kind).toBe('route');
      expect(route.signature).toBe('GET /orders/:id');
    });

    it('extracts PUT, DELETE, and PATCH routes', () => {
      expect(result.symbols.find((s) => s.name === 'PUT /orders/:id')).toBeDefined();
      expect(result.symbols.find((s) => s.name === 'DELETE /orders/:id')).toBeDefined();
      expect(result.symbols.find((s) => s.name === 'PATCH /orders/:id/approve')).toBeDefined();
    });

    it('extracts all 6 routes from the fixture', () => {
      const routes = result.symbols.filter((s) => s.kind === 'route');
      expect(routes).toHaveLength(6);
    });

    it('route symbols have correct line ranges', () => {
      const routes = result.symbols.filter((s) => s.kind === 'route');
      for (const route of routes) {
        expect(route.startLine).toBeGreaterThan(0);
        expect(route.endLine).toBeGreaterThanOrEqual(route.startLine);
      }
    });

    it('route handlers are detected as async', () => {
      const route = result.symbols.find((s) => s.name === 'GET /orders');
      expect(route.async).toBe(true);
    });

    it('route symbols have parentClass set to enclosing function', () => {
      const routes = result.symbols.filter((s) => s.kind === 'route');
      for (const route of routes) {
        expect(route.parentClass).toBe('createOrderRoutes');
      }
    });

    it('route symbols appear as children of enclosing function', () => {
      const factory = result.symbols.find((s) => s.name === 'createOrderRoutes');
      expect(factory).toBeDefined();
      const routeChildren = factory.children.filter((c) => c.kind === 'route');
      expect(routeChildren.length).toBe(6);
      const names = routeChildren.map((c) => c.name);
      expect(names).toContain('GET /orders');
      expect(names).toContain('POST /orders');
      expect(names).toContain('PATCH /orders/:id/approve');
    });

    it('does NOT extract non-router calls like console.log', () => {
      const consoleSymbol = result.symbols.find((s) => s.name && s.name.includes('log'));
      expect(consoleSymbol).toBeUndefined();
    });

    it('does NOT extract calls without string path argument', () => {
      // db.connect() has no string first arg, should not be extracted
      const dbSymbol = result.symbols.find((s) => s.name && s.name.includes('connect'));
      expect(dbSymbol).toBeUndefined();
    });

    it('works with inline content (no fixture needed)', () => {
      const code = `
        const router = require('express').Router();
        router.get('/products/:id', async (req, res) => {
          res.json({ id: req.params.id });
        });
      `;
      const r = parser.parse('inline.js', code);
      const route = r.symbols.find((s) => s.name === 'GET /products/:id');
      expect(route).toBeDefined();
      expect(route.kind).toBe('route');
      expect(route.signature).toBe('GET /products/:id');
    });

    it('extracts routes using app.post pattern', () => {
      const code = `
        const app = require('express')();
        app.post('/webhooks', (req, res) => {
          res.sendStatus(200);
        });
      `;
      const r = parser.parse('app.js', code);
      const route = r.symbols.find((s) => s.name === 'POST /webhooks');
      expect(route).toBeDefined();
      expect(route.kind).toBe('route');
    });
  });
});
