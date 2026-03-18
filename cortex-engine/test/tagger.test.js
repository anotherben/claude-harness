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

  // ── TypeScript-aware additions ──────────────────────────────────────────────

  describe('TS decorator route_handler detection', () => {
    it('tags @Get decorator as route_handler', () => {
      const code = `@Get('/users')\nasync getUsers(@Query() query: ListUsersDto) {\n  return this.usersService.findAll(query);\n}`;
      const tags = tagger.tagSource(code);
      expect(tags.some(t => t.tag === 'route_handler')).toBe(true);
    });

    it('tags @Post decorator as route_handler', () => {
      const code = `@Post('/users')\nasync createUser(@Body() dto: CreateUserDto) {\n  return this.usersService.create(dto);\n}`;
      const tags = tagger.tagSource(code);
      expect(tags.some(t => t.tag === 'route_handler' && t.name === 'POST route')).toBe(true);
    });

    it('tags @Delete decorator as route_handler', () => {
      const code = `@Delete('/users/:id')\nasync deleteUser(@Param('id') id: string) {\n  return this.usersService.remove(id);\n}`;
      const tags = tagger.tagSource(code);
      expect(tags.some(t => t.tag === 'route_handler')).toBe(true);
    });

    it('tags mixed JS and TS route patterns in same source', () => {
      const code = [
        `router.get('/orders', (req, res) => res.json([]));`,
        `@Post('/orders')`,
        `async createOrder(@Body() dto: CreateOrderDto) {}`,
      ].join('\n');
      const tags = tagger.tagSource(code);
      const routeTags = tags.filter(t => t.tag === 'route_handler');
      expect(routeTags.length).toBe(2);
    });
  });

  describe('Prisma ORM db_read detection', () => {
    it('tags prisma.*.findMany as db_read', () => {
      const code = `async function listUsers(tenantId) {\n  return prisma.user.findMany({ where: { tenantId } });\n}`;
      const symbols = [makeSymbol('listUsers', 1, 3, true)];
      const tags = tagger.tagSymbols(symbols, code);
      expect(tags.get('listUsers')).toContain('db_read');
    });

    it('tags prisma.*.findFirst as db_read', () => {
      const code = `async function getUser(id) {\n  return prisma.user.findFirst({ where: { id } });\n}`;
      const symbols = [makeSymbol('getUser', 1, 3, true)];
      const tags = tagger.tagSymbols(symbols, code);
      expect(tags.get('getUser')).toContain('db_read');
    });

    it('tags prisma.*.create as db_write', () => {
      const code = `async function createUser(data) {\n  return prisma.user.create({ data });\n}`;
      const symbols = [makeSymbol('createUser', 1, 3, true)];
      const tags = tagger.tagSymbols(symbols, code);
      expect(tags.get('createUser')).toContain('db_write');
    });

    it('flags prisma calls missing tenant_id as unscoped_query', () => {
      const code = `async function allUsers() {\n  return prisma.user.findMany();\n}`;
      const symbols = [makeSymbol('allUsers', 1, 3, true)];
      const tags = tagger.tagSymbols(symbols, code);
      expect(tags.get('allUsers')).toContain('unscoped_query');
    });
  });

  describe('broader pool/client/db.query detection', () => {
    it('tags client.query SELECT as db_read', () => {
      const code = `async function getItems() {\n  return client.query('SELECT * FROM items');\n}`;
      const symbols = [makeSymbol('getItems', 1, 3, true)];
      const tags = tagger.tagSymbols(symbols, code);
      expect(tags.get('getItems')).toContain('db_read');
    });

    it('tags db.query INSERT as db_write', () => {
      const code = `async function addItem(name) {\n  return db.query('INSERT INTO items (name) VALUES ($1)', [name]);\n}`;
      const symbols = [makeSymbol('addItem', 1, 3, true)];
      const tags = tagger.tagSymbols(symbols, code);
      expect(tags.get('addItem')).toContain('db_write');
    });

    it('tags connection.query SELECT as db_read', () => {
      const code = `async function fetchRow(id) {\n  return connection.query('SELECT * FROM rows WHERE id=$1', [id]);\n}`;
      const symbols = [makeSymbol('fetchRow', 1, 3, true)];
      const tags = tagger.tagSymbols(symbols, code);
      expect(tags.get('fetchRow')).toContain('db_read');
    });
  });

  describe('configurable tagRules.customRules from cortex.config.js', () => {
    it('accepts customRules array and fires matching tags', () => {
      const configTagger = new Tagger({
        customRules: [
          { tag: 'stripe_call', pattern: /stripe\.\w+\.create/ },
          { tag: 'sendgrid_mail', pattern: /sgMail\.send\s*\(/ },
        ],
      });
      const code = `async function chargeCard(amount) {\n  return stripe.paymentIntents.create({ amount, currency: 'usd' });\n}`;
      const symbols = [makeSymbol('chargeCard', 1, 3, true)];
      const tags = configTagger.tagSymbols(symbols, code);
      expect(tags.get('chargeCard')).toContain('stripe_call');
      expect(tags.get('chargeCard')).not.toContain('sendgrid_mail');
    });
  });
});
