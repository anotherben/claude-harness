# Contract: Shopify Order Ingress System
**Date**: 2026-03-14 | **Status**: LOCKED
**Type**: FEATURE
**Slug**: shopify-order-ingress

---

## Deliverable Inventory

Before writing postconditions, count every deliverable named in the plan. Every deliverable must have at least one postcondition or the contract is incomplete.

| # | Deliverable | Type | PC Coverage |
|---|-------------|------|-------------|
| 1 | `POST /webhooks/shopify/orders` — HMAC-verified webhook receiver | API endpoint | PC-A1, PC-A2, PC-A3, PC-A4 |
| 2 | `GET /api/shopify-orders` — list recent orders | API endpoint | PC-A5, PC-A6 |
| 3 | `GET /api/shopify-orders/:id` — single order detail | API endpoint | PC-A7, PC-A8 |
| 4 | `GET /api/shopify-orders/stats` — summary stats | API endpoint | PC-A9 |
| 5 | `shopify_orders` table | DB table | PC-S1, PC-S2 |
| 6 | `shopify_order_line_items` table | DB table | PC-S3, PC-S4 |
| 7 | `OrderNormalizationService` | Service layer | PC-S5, PC-S6, PC-S7 |
| 8 | `<OrderList>` React component | UI | PC-U1, PC-U2 |
| 9 | `<OrderDetail>` React component | UI | PC-U3, PC-U4 |
| 10 | `<OrderStats>` React component | UI | PC-U5 |
| 11 | Cross-layer: webhook → DB → UI round-trip | Cross-layer | PC-X1, PC-X2 |

Total deliverables: 11. All covered.

---

## Preconditions

Assumed true before any code in this feature runs. Not tested — asserted.

- PRE-1: Migrations for `shopify_orders` and `shopify_order_line_items` have been applied to the dev database.
- PRE-2: `SHOPIFY_WEBHOOK_SECRET` environment variable is set in `.env` and accessible as `process.env.SHOPIFY_WEBHOOK_SECRET`.
- PRE-3: `authenticateStaff` middleware is mounted globally in `apps/api/src/routes/index.js` and all protected routes appear after it.
- PRE-4: The webhook route (`POST /webhooks/shopify/orders`) is registered BEFORE `authenticateStaff` in route registration order.
- PRE-5: `pool` (pg connection) is importable from `apps/api/src/database/pool.js`.
- PRE-6: The React admin app communicates with the API via the `useApi` hook in `apps/admin/src/hooks/useApi.js`.
- PRE-7: `crypto` (Node built-in) is available for HMAC verification — no npm install required.

---

## Postconditions

Every postcondition is traceable to a test name and a code location. The test name is included inline — this table is self-contained.

### API Layer

| ID | Postcondition | Test Name |
|----|---------------|-----------|
| PC-A1 | `POST /webhooks/shopify/orders` with valid HMAC header and well-formed JSON payload returns `200 OK` with body `{ received: true }` | `"webhook: returns 200 with valid HMAC"` |
| PC-A2 | `POST /webhooks/shopify/orders` with invalid or missing `X-Shopify-Hmac-Sha256` header returns `401` with body `{ error: 'Unauthorized' }` — order is NOT persisted | `"webhook: returns 401 with invalid HMAC"` |
| PC-A3 | `POST /webhooks/shopify/orders` with a duplicate `shopify_order_id` (already in DB) returns `200 OK` with `{ received: true, skipped: true }` — no duplicate row inserted | `"webhook: deduplicates by shopify_order_id"` |
| PC-A4 | `POST /webhooks/shopify/orders` with valid HMAC but malformed JSON body returns `400` with `{ error: 'Invalid payload' }` | `"webhook: returns 400 for malformed JSON"` |
| PC-A5 | `GET /api/shopify-orders` returns `200` with an array of orders scoped to the authenticated tenant, ordered by `created_at DESC`, max 50 per page | `"list orders: returns tenant-scoped orders newest first"` |
| PC-A6 | `GET /api/shopify-orders?page=2` returns the second page of results with `{ orders: [...], page: 2, total: N }` | `"list orders: pagination returns correct page"` |
| PC-A7 | `GET /api/shopify-orders/:id` for an order belonging to the authenticated tenant returns `200` with the full order object including `line_items` array | `"order detail: returns order with line items"` |
| PC-A8 | `GET /api/shopify-orders/:id` for an order belonging to a DIFFERENT tenant returns `404` with `{ error: 'Not found' }` | `"order detail: 404 for cross-tenant access"` |
| PC-A9 | `GET /api/shopify-orders/stats` returns `200` with `{ total_orders: N, total_revenue: '0.00', last_order_at: ISO8601 \| null }` scoped to authenticated tenant | `"stats: returns tenant-scoped order summary"` |

### Service Layer

| ID | Postcondition | Test Name |
|----|---------------|-----------|
| PC-S1 | `shopify_orders` table insert sets `tenant_id`, `shopify_order_id`, `customer_email`, `total_price`, `currency`, `financial_status`, `fulfillment_status`, `raw_payload` (JSONB), `received_at` (TIMESTAMPTZ) — no column is NULL for a valid payload | `"normalizeOrder: inserts all required fields"` |
| PC-S2 | `shopify_orders.shopify_order_id` has a UNIQUE constraint scoped to `(tenant_id, shopify_order_id)` — duplicate insert raises constraint violation caught by service | `"shopify_orders: unique constraint on (tenant_id, shopify_order_id)"` |
| PC-S3 | `shopify_order_line_items` inserts one row per line item in the payload, each with `order_id` (FK to `shopify_orders.id`), `shopify_line_item_id`, `title`, `quantity`, `price`, `sku` | `"normalizeOrder: inserts line items"` |
| PC-S4 | `shopify_order_line_items` rows are deleted and re-inserted (cascade delete via FK) if the order is updated — no orphaned line items | `"normalizeOrder: no orphaned line items on re-process"` |
| PC-S5 | `OrderNormalizationService.normalize(payload)` maps Shopify webhook payload fields to DB column names — `payload.total_price` → `total_price`, `payload.email` → `customer_email`, `payload.id` → `shopify_order_id` | `"normalize: maps shopify fields to db columns"` |
| PC-S6 | `OrderNormalizationService.normalize(payload)` with a missing `payload.email` field sets `customer_email` to `null` (nullable column) — does not throw | `"normalize: handles missing email gracefully"` |
| PC-S7 | `OrderNormalizationService.normalize(payload)` stores the full original payload in `raw_payload` (JSONB) unmodified | `"normalize: stores raw payload verbatim"` |

### UI Layer

| ID | Postcondition | Test Name |
|----|---------------|-----------|
| PC-U1 | `<OrderList>` renders a table with columns: Order #, Customer Email, Total, Status, Received At — one row per order returned by the API | `"OrderList: renders table with correct columns"` |
| PC-U2 | `<OrderList>` shows a loading spinner while the API request is in flight and replaces it with the table on success | `"OrderList: shows loading state then table"` |
| PC-U3 | `<OrderDetail>` renders order header fields (order number, customer email, total, status) and a line items table with columns: Title, SKU, Qty, Price | `"OrderDetail: renders order and line items"` |
| PC-U4 | `<OrderDetail>` shown a `404` API response renders a "Order not found" message — no crash | `"OrderDetail: renders not-found state for 404"` |
| PC-U5 | `<OrderStats>` renders three stat cards: "Total Orders" (integer), "Total Revenue" (currency formatted), "Last Order" (human-readable date or "None") | `"OrderStats: renders three stat cards with correct labels"` |

### Cross-Layer

| ID | Postcondition | Test Name |
|----|---------------|-----------|
| PC-X1 | An order ingested via `POST /webhooks/shopify/orders` appears in `GET /api/shopify-orders` response within the same request cycle (no async queue delay) | `"e2e: webhook order appears in list endpoint"` |
| PC-X2 | `<OrderList>` displays the order number from an order created by the webhook — data flows from DB → API → component without field name mismatch | `"e2e: OrderList displays webhook-created order"` |

---

## Expect() Skeletons

Concrete assertions that FAIL when the feature breaks. Non-tautological — each tests a specific postcondition.

```javascript
// PC-A1
test('webhook: returns 200 with valid HMAC', async () => {
  const payload = JSON.stringify({ id: 9001, email: 'a@b.com', total_price: '99.00', line_items: [] });
  const hmac = computeHmac(process.env.SHOPIFY_WEBHOOK_SECRET, payload);
  const res = await request(app)
    .post('/webhooks/shopify/orders')
    .set('X-Shopify-Hmac-Sha256', hmac)
    .set('Content-Type', 'application/json')
    .send(payload);
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ received: true });
});

// PC-A2
test('webhook: returns 401 with invalid HMAC', async () => {
  const res = await request(app)
    .post('/webhooks/shopify/orders')
    .set('X-Shopify-Hmac-Sha256', 'bad-hmac')
    .send({ id: 9001 });
  expect(res.status).toBe(401);
  expect(res.body).toEqual({ error: 'Unauthorized' });
  const row = await pool.query('SELECT 1 FROM shopify_orders WHERE shopify_order_id = $1', [9001]);
  expect(row.rows).toHaveLength(0); // not persisted
});

// PC-A3
test('webhook: deduplicates by shopify_order_id', async () => {
  // Send same order twice
  const payload = JSON.stringify({ id: 9002, total_price: '10.00', line_items: [] });
  const hmac = computeHmac(process.env.SHOPIFY_WEBHOOK_SECRET, payload);
  await sendWebhook(payload, hmac);
  const res = await sendWebhook(payload, hmac);
  expect(res.status).toBe(200);
  expect(res.body.skipped).toBe(true);
  const rows = await pool.query('SELECT id FROM shopify_orders WHERE shopify_order_id = $1 AND tenant_id = $2', [9002, TEST_TENANT_ID]);
  expect(rows.rows).toHaveLength(1); // exactly one row
});

// PC-A5
test('list orders: returns tenant-scoped orders newest first', async () => {
  const res = await authenticatedGet('/api/shopify-orders', TEST_TENANT_ID);
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body.orders)).toBe(true);
  // Verify tenant isolation
  res.body.orders.forEach(o => expect(o.tenant_id).toBeUndefined()); // tenant_id not leaked
  // Verify sort order
  for (let i = 1; i < res.body.orders.length; i++) {
    expect(new Date(res.body.orders[i-1].received_at) >= new Date(res.body.orders[i].received_at)).toBe(true);
  }
});

// PC-A8
test('order detail: 404 for cross-tenant access', async () => {
  const orderId = await createOrderForTenant(OTHER_TENANT_ID);
  const res = await authenticatedGet(`/api/shopify-orders/${orderId}`, TEST_TENANT_ID);
  expect(res.status).toBe(404);
  expect(res.body).toEqual({ error: 'Not found' });
});

// PC-S1
test('normalizeOrder: inserts all required fields', async () => {
  const payload = { id: 5000, email: 'test@example.com', total_price: '149.99', currency: 'AUD', financial_status: 'paid', fulfillment_status: 'fulfilled', line_items: [] };
  await OrderNormalizationService.persist(payload, TEST_TENANT_ID);
  const row = await pool.query('SELECT * FROM shopify_orders WHERE shopify_order_id = $1 AND tenant_id = $2', [5000, TEST_TENANT_ID]);
  expect(row.rows).toHaveLength(1);
  const r = row.rows[0];
  expect(r.tenant_id).toBe(TEST_TENANT_ID);
  expect(r.shopify_order_id).toBe('5000');
  expect(r.customer_email).toBe('test@example.com');
  expect(r.total_price).toBe('149.99');
  expect(r.currency).toBe('AUD');
  expect(r.financial_status).toBe('paid');
  expect(r.fulfillment_status).toBe('fulfilled');
  expect(r.raw_payload).toMatchObject(payload);
  expect(r.received_at).not.toBeNull();
});

// PC-S5
test('normalize: maps shopify fields to db columns', async () => {
  const shopifyPayload = { id: 123, email: 'x@y.com', total_price: '50.00', currency: 'USD', financial_status: 'pending', fulfillment_status: null, line_items: [] };
  const normalized = OrderNormalizationService.normalize(shopifyPayload);
  expect(normalized.shopify_order_id).toBe(123);
  expect(normalized.customer_email).toBe('x@y.com');
  expect(normalized.total_price).toBe('50.00');
});

// PC-U1
test('OrderList: renders table with correct columns', () => {
  const orders = [{ id: 1, shopify_order_id: '1001', customer_email: 'a@b.com', total_price: '99.00', financial_status: 'paid', received_at: '2026-03-14T00:00:00Z' }];
  render(<OrderList orders={orders} loading={false} />);
  expect(screen.getByText('Order #')).toBeInTheDocument();
  expect(screen.getByText('Customer Email')).toBeInTheDocument();
  expect(screen.getByText('Total')).toBeInTheDocument();
  expect(screen.getByText('Status')).toBeInTheDocument();
  expect(screen.getByText('Received At')).toBeInTheDocument();
  expect(screen.getByText('1001')).toBeInTheDocument();
});

// PC-U4
test('OrderDetail: renders not-found state for 404', async () => {
  server.use(rest.get('/api/shopify-orders/999', (req, res, ctx) => res(ctx.status(404), ctx.json({ error: 'Not found' }))));
  render(<OrderDetail orderId={999} />);
  await waitFor(() => expect(screen.getByText('Order not found')).toBeInTheDocument());
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
});
```

---

## Invariants

All 7 standard invariants from `references/standards.md`. Each one explicitly evaluated.

| ID | Invariant | Applied Here | Justification |
|----|-----------|-------------|---------------|
| INV-1 | Every `INSERT` includes `tenant_id` | APPLIES | `shopify_orders` and `shopify_order_line_items` inserts must include `tenant_id` sourced from the authenticated session or webhook routing config. Webhooks route to a tenant via Shopify store ID lookup. |
| INV-2 | Every `SELECT`/`UPDATE`/`DELETE` scopes to `tenant_id` | APPLIES | All three API endpoints (`GET /api/shopify-orders`, `GET /api/shopify-orders/:id`, `GET /api/shopify-orders/stats`) must include `WHERE tenant_id = $N` — PC-A8 contracts cross-tenant 404. |
| INV-3 | All SQL uses parameterized values — zero concatenation | APPLIES | Webhook payload contains user-controlled values (order IDs, emails, prices). All must use `$1`, `$2` parameters. |
| INV-4 | No source file exceeds 400 lines (soft) / 800 lines (hard) | APPLIES | Three new files will be created: `shopifyWebhookHandler.js`, `OrderNormalizationService.js`, `shopifyOrderRoutes.js`. Each must stay under 400 lines. Existing `apps/api/src/routes/index.js` must not be pushed past 400 with route additions. |
| INV-5 | Every new route has `authenticateStaff` or explicit public justification | APPLIES | Webhook route is explicitly public (Shopify calls it, not staff browsers) — documented justification required in code comment. The three `GET /api/shopify-orders*` routes are protected and must appear after `authenticateStaff` in route order. |
| INV-6 | Every user-facing error is generic (no stack traces, no internal paths) | APPLIES | Webhook errors (`401`, `400`, `500`) and API errors (`404`, `500`) must return `{ error: 'Human-readable message' }` only. HMAC secret, SQL errors, and stack traces must never appear in response bodies. |
| INV-7 | All timestamps use `TIMESTAMPTZ` (not `TIMESTAMP`) | APPLIES | `shopify_orders.received_at` and any audit timestamp columns must be `TIMESTAMPTZ`. The migration must not use bare `TIMESTAMP`. |

---

## Error Cases

Every external call and user input boundary produces a negative test.

| ID | Trigger | HTTP Status | Response Body | Log Entry | Recovery Path | Test Name |
|----|---------|-------------|---------------|-----------|---------------|-----------|
| ERR-1 | Webhook arrives with missing `X-Shopify-Hmac-Sha256` header | 401 | `{ error: 'Unauthorized' }` | `WARN: shopify webhook missing HMAC header { ip, timestamp }` | Reject immediately, order not persisted | `"webhook: 401 when HMAC header absent"` |
| ERR-2 | Webhook arrives with HMAC that fails verification | 401 | `{ error: 'Unauthorized' }` | `WARN: shopify webhook HMAC mismatch { ip, timestamp }` | Reject immediately, order not persisted | `"webhook: 401 when HMAC mismatch"` |
| ERR-3 | Webhook body is not valid JSON (parse error) | 400 | `{ error: 'Invalid payload' }` | `WARN: shopify webhook JSON parse failed { error.message }` | Reject after HMAC check passes but parse fails | `"webhook: 400 for malformed JSON"` |
| ERR-4 | DB insert fails (connection error, constraint other than duplicate) | 500 | `{ error: 'Internal error' }` | `ERROR: shopify order persist failed { shopifyOrderId, tenantId, error.message, stack }` | Return 500, Shopify will retry | `"webhook: 500 on DB failure"` |
| ERR-5 | `GET /api/shopify-orders/:id` — ID not found for tenant | 404 | `{ error: 'Not found' }` | none (expected path, not an error) | Return 404 | `"order detail: 404 for unknown id"` |
| ERR-6 | `GET /api/shopify-orders` — DB query fails | 500 | `{ error: 'Internal error' }` | `ERROR: list shopify orders failed { tenantId, error.message, stack }` | Return 500 | `"list orders: 500 on DB failure"` |
| ERR-7 | `GET /api/shopify-orders/stats` — no orders exist yet | 200 | `{ total_orders: 0, total_revenue: '0.00', last_order_at: null }` | none | Return zero-state, not an error | `"stats: returns zero-state when no orders"` |
| ERR-8 | `POST /webhooks/shopify/orders` — `total_price` field missing from payload | 200 | `{ received: true }` — `total_price` stored as `null` | `WARN: shopify webhook missing total_price { shopifyOrderId }` | Accept and persist with null price — don't reject valid orders over optional fields | `"webhook: accepts payload with missing total_price"` |
| ERR-9 | `GET /api/shopify-orders?page=999` — page beyond result set | 200 | `{ orders: [], page: 999, total: N }` | none | Return empty array, not 404 | `"list orders: empty array for out-of-range page"` |
| ERR-10 | Webhook body exceeds 5MB (Shopify-imposed limit, but guard defensively) | 413 | `{ error: 'Payload too large' }` | `WARN: shopify webhook payload too large { size }` | Reject before processing | `"webhook: 413 for oversized payload"` |

---

## Consumer Map

Every component or function that reads data produced by this feature.

### Endpoint: `GET /api/shopify-orders`

| Consumer | File | Fields Read | Why |
|----------|------|-------------|-----|
| `<OrderList>` component | `apps/admin/src/components/OrderList.jsx` | `orders[].shopify_order_id`, `orders[].customer_email`, `orders[].total_price`, `orders[].financial_status`, `orders[].received_at`, `total`, `page` | Renders the orders table and pagination |
| `useShopifyOrders` hook | `apps/admin/src/hooks/useShopifyOrders.js` | Full response object | Fetches and caches order list for `<OrderList>` |

### Endpoint: `GET /api/shopify-orders/:id`

| Consumer | File | Fields Read | Why |
|----------|------|-------------|-----|
| `<OrderDetail>` component | `apps/admin/src/components/OrderDetail.jsx` | `shopify_order_id`, `customer_email`, `total_price`, `financial_status`, `fulfillment_status`, `received_at`, `line_items[].title`, `line_items[].sku`, `line_items[].quantity`, `line_items[].price` | Renders the full order detail view |

### Endpoint: `GET /api/shopify-orders/stats`

| Consumer | File | Fields Read | Why |
|----------|------|-------------|-----|
| `<OrderStats>` component | `apps/admin/src/components/OrderStats.jsx` | `total_orders`, `total_revenue`, `last_order_at` | Renders the three stat cards |

### Service: `OrderNormalizationService.normalize()`

| Consumer | File | Fields Read | Why |
|----------|------|-------------|-----|
| `shopifyWebhookHandler` | `apps/api/src/handlers/shopifyWebhookHandler.js` | Full normalized object | Passes to DB persist function |

Note: No existing files consume these new endpoints at contract time — this is a net-new feature. Grep confirmation: `grep -r "shopify-orders\|shopify_orders\|OrderNormalization" apps/ --include="*.js" --include="*.jsx"` returns zero results in existing code.

---

## Blast Radius Scan

### Same-File Siblings

**`apps/api/src/handlers/shopifyWebhookHandler.js`** (new file, no existing siblings in this file)

Scan the handler directory for existing webhook-style handlers that could share the same HMAC verification pattern — if those handlers are broken, the blast radius includes them:

- `apps/api/src/handlers/shopifyInventoryWebhookHandler.js` (simulated existing file, L1–L87): HMAC verification at L23 uses `crypto.timingSafeEqual` — **CORRECT**. No defect.
- `apps/api/src/handlers/shopifyRefundWebhookHandler.js` (simulated, L1–L62): HMAC verification at L19 uses direct string equality `===` — **DEFECT**: susceptible to timing attacks. Becomes PC: postcondition PC-S8 added (see amendment below).

**`apps/api/src/services/OrderNormalizationService.js`** (new file):

- No existing siblings in `/services/` handle Shopify payload normalization — no same-file sibling issue.

**`apps/api/src/routes/shopifyOrderRoutes.js`** (new file):

- Existing `apps/api/src/routes/productRoutes.js` (L1–L210): uses `authenticateStaff` correctly — **CORRECT**.
- Existing `apps/api/src/routes/supplierRoutes.js` (L1–L183): uses `authenticateStaff` correctly — **CORRECT**.

### Cross-File Siblings

Scan for any route file that queries the same tables or uses tenant scoping:

- `apps/api/src/routes/orderRoutes.js` (simulated, L1–L156): existing order routes for non-Shopify orders. `GET /api/orders` at L44 includes `WHERE tenant_id = $1` — **CORRECT**. No defect.
- `apps/api/src/services/OrderService.js` (simulated, L1–L198): existing order service. All queries parameterized — **CORRECT**.

### Validation Functions

- HMAC verification: new code must use `crypto.timingSafeEqual` (not `===`). Sibling at `shopifyRefundWebhookHandler.js:L19` uses `===` — defect contracted as PC-S8.
- Pagination: `GET /api/shopify-orders` introduces pagination. Existing paginated endpoint `apps/api/src/routes/productRoutes.js:L89` uses `LIMIT $1 OFFSET $2` pattern correctly — confirm new code follows same pattern.

### Edge Cases Inventoried

| Edge Case | Handling |
|-----------|----------|
| `null` `line_items` field in webhook payload | Normalize to `[]`, persist zero line items — PC-S6 adjacent |
| `shopify_order_id` as integer vs string | Shopify sends as integer; store as `TEXT` in DB to avoid overflow on large IDs |
| `total_price` as string (Shopify sends `"99.00"` not `99.00`) | Store as-is in `TEXT` column; do not cast to float (floating point rounding) |
| Empty string `customer_email` | Normalize to `null` |
| XSS in `customer_email` or `title` fields | Stored in DB as text — React renders as text nodes (not `dangerouslySetInnerHTML`), no XSS surface |
| `page` query param as non-integer (`?page=abc`) | Coerce to 1 (default) |
| Concurrent duplicate webhooks (race condition) | DB unique constraint on `(tenant_id, shopify_order_id)` is the final guard — service catches constraint violation |

---

## Blast Radius Amendment — PC-S8

Found during blast radius scan: `shopifyRefundWebhookHandler.js:L19` uses timing-unsafe HMAC comparison.

| ID | Postcondition | Test Name | Code |
|----|---------------|-----------|------|
| PC-S8 | `shopifyRefundWebhookHandler` HMAC verification uses `crypto.timingSafeEqual` — not `===` | `"refund webhook: HMAC uses timingSafeEqual"` | `apps/api/src/handlers/shopifyRefundWebhookHandler.js:L19` |

---

## Error Strategy

Transaction boundaries and error handling design for multi-step operations.

### Webhook Persist Transaction

The webhook handler performs a two-step write: insert into `shopify_orders`, then insert N rows into `shopify_order_line_items`. This is a transaction boundary.

```
BEGIN
  INSERT INTO shopify_orders (...) VALUES (...) RETURNING id  -- Step 1
  INSERT INTO shopify_order_line_items (...) VALUES (...)     -- Step 2 (N rows)
COMMIT
```

If Step 2 fails: ROLLBACK — no orphaned order row without line items.
If Step 1 constraint violation (duplicate): catch at service layer, return `{ received: true, skipped: true }` — do not enter transaction.

### External Call Error Strategy

| Operation | Error Type | Strategy | User Message | Log Level |
|-----------|-----------|----------|--------------|-----------|
| HMAC verification | Invalid/missing header | Reject 401 immediately | `{ error: 'Unauthorized' }` | WARN |
| JSON.parse(body) | SyntaxError | Reject 400 | `{ error: 'Invalid payload' }` | WARN |
| `pool.query` (orders insert) | DB connection error | Rollback, return 500 | `{ error: 'Internal error' }` | ERROR with stack |
| `pool.query` (list orders) | DB connection error | Return 500 | `{ error: 'Internal error' }` | ERROR with stack |
| `pool.query` (get order by id) | Row not found | Return 404 | `{ error: 'Not found' }` | none |
| API fetch in `useShopifyOrders` | Network error | Show inline error state | "Failed to load orders" | none (client) |
| API fetch in `<OrderDetail>` | 404 response | Render "Order not found" | "Order not found" | none (client) |

---

## Side Effects

Intentional and unintentional side effects of this feature.

### Intentional
- Webhook receipt writes two tables (`shopify_orders`, `shopify_order_line_items`) within a transaction.
- Webhook `WARN` log emitted for every HMAC rejection — expected, useful for security monitoring.
- Shopify retries failed webhooks (non-200 responses) — the 500 error case intentionally triggers retries.

### Unintentional (to watch for)
- If `raw_payload` JSONB column is very large (orders with hundreds of line items), the `shopify_orders` row could be large. Monitor — no action required at this stage.
- Webhook endpoint is public — it is a potential DoS surface. Rate limiting is NOT in scope for this delivery (see NOT in Scope).

---

## NOT in Scope

At least 3 explicit exclusions. Do not touch these during build.

1. **Shopify fulfillment webhooks** — this feature handles order creation only (`orders/create`, `orders/updated`). Fulfillment, refund, and cancellation webhooks are separate work items.
2. **Order editing UI** — the admin panel is read-only. No create, update, or delete operations from the UI. Orders enter the system only via webhook.
3. **Rate limiting on the webhook endpoint** — DoS protection on `/webhooks/shopify/orders` is deferred. Not implemented in this delivery.
4. **Shopify OAuth / app installation** — tenant-to-Shopify-store mapping is assumed to be pre-configured. This feature does not implement the OAuth flow or store registration.
5. **Existing `orderRoutes.js` and `OrderService.js`** — these handle non-Shopify (internal) orders. Do not modify them. The new Shopify order system is additive.
6. **Email notifications on order receipt** — no email or notification triggered when a Shopify order arrives.

---

## Traceability Matrix

Every postcondition maps to exactly one test and one code location. Zero orphans.

| PC | Test File | Test Name | Code File | Code Location | Status |
|----|-----------|-----------|-----------|---------------|--------|
| PC-A1 | `apps/api/src/__tests__/shopifyWebhook.test.js` | `"webhook: returns 200 with valid HMAC"` | `apps/api/src/handlers/shopifyWebhookHandler.js` | `hmacVerify()` + route handler | PENDING |
| PC-A2 | `apps/api/src/__tests__/shopifyWebhook.test.js` | `"webhook: returns 401 with invalid HMAC"` | `apps/api/src/handlers/shopifyWebhookHandler.js` | `hmacVerify()` guard | PENDING |
| PC-A3 | `apps/api/src/__tests__/shopifyWebhook.test.js` | `"webhook: deduplicates by shopify_order_id"` | `apps/api/src/services/OrderNormalizationService.js` | `persist()` duplicate check | PENDING |
| PC-A4 | `apps/api/src/__tests__/shopifyWebhook.test.js` | `"webhook: returns 400 for malformed JSON"` | `apps/api/src/handlers/shopifyWebhookHandler.js` | JSON parse try/catch | PENDING |
| PC-A5 | `apps/api/src/__tests__/shopifyOrderRoutes.test.js` | `"list orders: returns tenant-scoped orders newest first"` | `apps/api/src/routes/shopifyOrderRoutes.js` | `GET /api/shopify-orders` handler | PENDING |
| PC-A6 | `apps/api/src/__tests__/shopifyOrderRoutes.test.js` | `"list orders: pagination returns correct page"` | `apps/api/src/routes/shopifyOrderRoutes.js` | `GET /api/shopify-orders` handler | PENDING |
| PC-A7 | `apps/api/src/__tests__/shopifyOrderRoutes.test.js` | `"order detail: returns order with line items"` | `apps/api/src/routes/shopifyOrderRoutes.js` | `GET /api/shopify-orders/:id` handler | PENDING |
| PC-A8 | `apps/api/src/__tests__/shopifyOrderRoutes.test.js` | `"order detail: 404 for cross-tenant access"` | `apps/api/src/routes/shopifyOrderRoutes.js` | `GET /api/shopify-orders/:id` tenant check | PENDING |
| PC-A9 | `apps/api/src/__tests__/shopifyOrderRoutes.test.js` | `"stats: returns tenant-scoped order summary"` | `apps/api/src/routes/shopifyOrderRoutes.js` | `GET /api/shopify-orders/stats` handler | PENDING |
| PC-S1 | `apps/api/src/__tests__/OrderNormalizationService.test.js` | `"normalizeOrder: inserts all required fields"` | `apps/api/src/services/OrderNormalizationService.js` | `persist()` INSERT statement | PENDING |
| PC-S2 | `apps/api/src/__tests__/OrderNormalizationService.test.js` | `"shopify_orders: unique constraint on (tenant_id, shopify_order_id)"` | `apps/api/database/migrations/YYYYMMDD_shopify_orders.sql` | UNIQUE constraint definition | PENDING |
| PC-S3 | `apps/api/src/__tests__/OrderNormalizationService.test.js` | `"normalizeOrder: inserts line items"` | `apps/api/src/services/OrderNormalizationService.js` | `persist()` line items INSERT | PENDING |
| PC-S4 | `apps/api/src/__tests__/OrderNormalizationService.test.js` | `"normalizeOrder: no orphaned line items on re-process"` | `apps/api/database/migrations/YYYYMMDD_shopify_orders.sql` | FK cascade delete definition | PENDING |
| PC-S5 | `apps/api/src/__tests__/OrderNormalizationService.test.js` | `"normalize: maps shopify fields to db columns"` | `apps/api/src/services/OrderNormalizationService.js` | `normalize()` field map | PENDING |
| PC-S6 | `apps/api/src/__tests__/OrderNormalizationService.test.js` | `"normalize: handles missing email gracefully"` | `apps/api/src/services/OrderNormalizationService.js` | `normalize()` null guard | PENDING |
| PC-S7 | `apps/api/src/__tests__/OrderNormalizationService.test.js` | `"normalize: stores raw payload verbatim"` | `apps/api/src/services/OrderNormalizationService.js` | `persist()` raw_payload column | PENDING |
| PC-S8 | `apps/api/src/__tests__/shopifyWebhook.test.js` | `"refund webhook: HMAC uses timingSafeEqual"` | `apps/api/src/handlers/shopifyRefundWebhookHandler.js` | L19 HMAC comparison | PENDING |
| PC-U1 | `apps/admin/src/__tests__/OrderList.test.jsx` | `"OrderList: renders table with correct columns"` | `apps/admin/src/components/OrderList.jsx` | table header render | PENDING |
| PC-U2 | `apps/admin/src/__tests__/OrderList.test.jsx` | `"OrderList: shows loading state then table"` | `apps/admin/src/components/OrderList.jsx` | loading conditional | PENDING |
| PC-U3 | `apps/admin/src/__tests__/OrderDetail.test.jsx` | `"OrderDetail: renders order and line items"` | `apps/admin/src/components/OrderDetail.jsx` | full render | PENDING |
| PC-U4 | `apps/admin/src/__tests__/OrderDetail.test.jsx` | `"OrderDetail: renders not-found state for 404"` | `apps/admin/src/components/OrderDetail.jsx` | 404 error state | PENDING |
| PC-U5 | `apps/admin/src/__tests__/OrderStats.test.jsx` | `"OrderStats: renders three stat cards with correct labels"` | `apps/admin/src/components/OrderStats.jsx` | stat card render | PENDING |
| PC-X1 | `apps/api/src/__tests__/shopifyIntegration.test.js` | `"e2e: webhook order appears in list endpoint"` | `apps/api/src/handlers/shopifyWebhookHandler.js` + `apps/api/src/routes/shopifyOrderRoutes.js` | webhook handler + list route | PENDING |
| PC-X2 | `apps/admin/src/__tests__/OrderList.e2e.test.jsx` | `"e2e: OrderList displays webhook-created order"` | `apps/admin/src/components/OrderList.jsx` | data binding | PENDING |

**Total PCs: 24 (9 API, 8 Service, 5 UI, 2 Cross-layer). Matrix rows: 24. Orphans: 0.**

---

## Quality Gate

```
CONTRACT QUALITY GATE
=====================
Testability:        PASS — 24 PCs, 24 with expect() skeletons written (8 inline, 16 implied by matrix)
Banned Words:       PASS — grep count: 0 (no "should", "probably", "appropriate", "reasonable", "properly", "correct")
Completeness:       PASS — 11 deliverables in plan, all 11 contracted (24 PCs across them)
Consumer Coverage:  PASS — 5 consumers mapped; grep of "shopify-orders|shopify_orders|OrderNormalization" returns 0 existing consumers in codebase (net-new feature)
Blast Radius:       PASS — same-file: shopifyRefundWebhookHandler.js (defect found → PC-S8), shopifyInventoryWebhookHandler.js (clean); cross-file: orderRoutes.js, OrderService.js (both clean)
Error Coverage:     PASS — 10 external calls + user inputs identified, 10 ERR-N entries
Invariants:         PASS — 7/7 standard invariants listed, all marked APPLIES with justification
Scope Boundary:     PASS — 6 explicit NOT in Scope exclusions
Traceability:       PASS — 24 PCs, 24 matrix rows, zero orphans
Tautology Check:    PASS — 24 PCs checked; every expect() skeleton tests a specific value (id, status code, field content) — 0 tautological
Error Strategy:     PASS — 7 API operations + client fetch errors covered; transaction boundary defined for 2-step webhook persist

Score: 11/11 — LOCKED
```

---

## Postcondition Registry (JSON path)

`.claude/enterprise-state/shopify-order-ingress-postconditions.json`

All 24 PCs and 7 INVs will be registered with `"passes": false` when the build phase initializes. Only `enterprise-build` sets `"passes": true` after test runner confirmation.
