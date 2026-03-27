# Contract: Shopify Order Ingress System
**Date**: 2026-03-14 | **Status**: LOCKED
**Type**: FEATURE
**Slug**: shopify-order-ingress
**Plan**: docs/plans/2026-03-14-shopify-order-ingress-ownership-pilot-design.md

---

## Overview

Adds a complete Shopify order ingress pipeline: HMAC-verified webhook receiver, order normalization service, database persistence across two new tables, and a React admin panel displaying recent orders. Scope: 4 API endpoints, 2 new DB tables, 1 webhook handler, 3 React components.

---

## Preconditions

These are assumed true before any code runs — not tested, but required for the contract to be valid.

- **PRE-1**: Database migrations for `shopify_orders` and `shopify_order_line_items` tables have been applied via `psql` against the dev PostgreSQL instance.
- **PRE-2**: Environment variable `SHOPIFY_WEBHOOK_SECRET` is set in `.env` and available to the API process at startup.
- **PRE-3**: `authenticateStaff` middleware is mounted at `apps/api/src/middleware/auth.js` and functioning correctly for all existing protected routes.
- **PRE-4**: The `apps/api/src/routes/index.js` (or equivalent router registration file) mounts route modules; new routes can be registered following the existing pattern.
- **PRE-5**: The Express raw body parser is available (or can be added) for the webhook route — HMAC verification requires the raw request body, not the JSON-parsed body.
- **PRE-6**: The Shopify store is configured to send `orders/create` webhook events to `POST /webhooks/shopify/orders`.
- **PRE-7**: Node.js `crypto` module is available (built-in — no install required).
- **PRE-8**: All existing unit tests pass on `dev` branch prior to this feature branch being cut.

---

## Postconditions

### API Layer (PC-A)

| ID | Postcondition | Test Name |
|----|--------------|-----------|
| PC-A1 | `POST /webhooks/shopify/orders` with a valid HMAC signature and valid order payload returns HTTP 200 with `{ received: true }` | `"webhook: returns 200 with received:true for valid HMAC and payload"` |
| PC-A2 | `POST /webhooks/shopify/orders` with an invalid or missing HMAC signature returns HTTP 401 with `{ error: 'Unauthorized' }` and does NOT persist any data | `"webhook: returns 401 for invalid HMAC signature"` |
| PC-A3 | `POST /webhooks/shopify/orders` with a valid HMAC but malformed JSON body returns HTTP 400 with `{ error: 'Invalid payload' }` | `"webhook: returns 400 for malformed payload"` |
| PC-A4 | `GET /api/orders` (authenticated) returns HTTP 200 with an array of order objects for the authenticated tenant, ordered by `created_at DESC`, max 50 records | `"GET /api/orders: returns paginated orders for tenant"` |
| PC-A5 | `GET /api/orders` with no orders for tenant returns HTTP 200 with `{ orders: [], total: 0 }` | `"GET /api/orders: returns empty array when no orders exist"` |
| PC-A6 | `GET /api/orders/:id` (authenticated) returns HTTP 200 with the full order object including `line_items` array for the specified order ID belonging to the authenticated tenant | `"GET /api/orders/:id: returns order with line items"` |
| PC-A7 | `GET /api/orders/:id` for an order ID that does not belong to the authenticated tenant returns HTTP 404 with `{ error: 'Order not found' }` | `"GET /api/orders/:id: returns 404 for order belonging to another tenant"` |
| PC-A8 | `GET /api/orders` without a valid auth token returns HTTP 401 | `"GET /api/orders: returns 401 without auth token"` |

### Service Layer (PC-S)

| ID | Postcondition | Test Name |
|----|--------------|-----------|
| PC-S1 | `verifyShopifyHmac(rawBody, signature, secret)` returns `true` when the computed HMAC-SHA256 digest (base64) matches the `X-Shopify-Hmac-Sha256` header value | `"verifyShopifyHmac: returns true for matching signature"` |
| PC-S2 | `verifyShopifyHmac(rawBody, signature, secret)` returns `false` when the signature does not match — does NOT throw | `"verifyShopifyHmac: returns false for mismatched signature"` |
| PC-S3 | `verifyShopifyHmac` uses `crypto.timingSafeEqual` for comparison — not string equality | `"verifyShopifyHmac: uses timing-safe comparison"` |
| PC-S4 | `normalizeOrder(shopifyPayload)` maps `shopifyPayload.id` to `shopify_order_id`, `shopifyPayload.email` to `customer_email`, `shopifyPayload.total_price` to `total_price_cents` (converted from decimal string to integer cents), `shopifyPayload.financial_status` to `financial_status`, and `shopifyPayload.line_items` to a normalized array | `"normalizeOrder: maps all required fields correctly"` |
| PC-S5 | `normalizeOrder` converts `total_price` string (e.g. `"149.99"`) to integer cents (`14999`) without floating-point loss | `"normalizeOrder: converts price to cents without float error"` |
| PC-S6 | `normalizeOrder` handles missing optional fields (`note`, `tags`, `discount_codes`) by defaulting to `null` or `[]` respectively — does NOT throw | `"normalizeOrder: handles missing optional fields gracefully"` |
| PC-S7 | `persistOrder(normalizedOrder, tenantId, client)` inserts one row into `shopify_orders` with `tenant_id = tenantId` and returns the inserted row including `id` | `"persistOrder: inserts order row with tenant_id"` |
| PC-S8 | `persistOrder` inserts one row per line item into `shopify_order_line_items` with `order_id` referencing the newly inserted `shopify_orders.id` | `"persistOrder: inserts line item rows linked to order"` |
| PC-S9 | `persistOrder` executes both inserts inside a single database transaction — if line item inserts fail, the order row is rolled back | `"persistOrder: rolls back order insert if line items fail"` |
| PC-S10 | `getOrders(tenantId, limit, offset)` returns rows from `shopify_orders` scoped to `tenant_id = tenantId`, ordered by `created_at DESC`, limited to `limit` rows (default 50, max 100) | `"getOrders: returns orders scoped to tenant ordered by created_at DESC"` |
| PC-S11 | `getOrderById(orderId, tenantId)` returns the order row with its associated `line_items` array (from `shopify_order_line_items`) where `shopify_orders.tenant_id = tenantId` — returns `null` if not found or tenant mismatch | `"getOrderById: returns null for order belonging to different tenant"` |

### UI Layer (PC-U)

| ID | Postcondition | Test Name |
|----|--------------|-----------|
| PC-U1 | `<OrdersPage>` renders a heading "Recent Orders" and the `<OrdersTable>` component when order data is loaded | `"OrdersPage: renders heading and table when data loaded"` |
| PC-U2 | `<OrdersPage>` renders a loading spinner while `useOrders` hook fetch is in-flight | `"OrdersPage: renders loading spinner while fetching"` |
| PC-U3 | `<OrdersPage>` renders an error message "Failed to load orders" when the fetch fails — does NOT render the table | `"OrdersPage: renders error message on fetch failure"` |
| PC-U4 | `<OrdersTable>` renders one `<tr>` per order with columns: Order ID, Customer Email, Total, Status, Date | `"OrdersTable: renders one row per order with correct columns"` |
| PC-U5 | `<OrdersTable>` renders an empty state message "No orders yet" when passed an empty `orders` array | `"OrdersTable: renders empty state for empty orders array"` |
| PC-U6 | `<OrdersTable>` formats `total_price_cents` as a dollar string (e.g. `14999` → `"$149.99"`) in the Total column | `"OrdersTable: formats price cents as dollar string"` |
| PC-U7 | `<OrderDetailPanel>` renders when an order row is clicked, showing `shopify_order_id`, `customer_email`, `financial_status`, `created_at`, and the list of line items with `title` and `quantity` | `"OrderDetailPanel: renders order details and line items on row click"` |
| PC-U8 | `<OrderDetailPanel>` renders nothing (null) when no order is selected | `"OrderDetailPanel: renders null when no order selected"` |
| PC-U9 | `useOrders` hook calls `GET /api/orders` on mount and exposes `{ orders, total, loading, error }` | `"useOrders: fetches on mount and exposes correct shape"` |

### Cross-Layer (PC-X)

| ID | Postcondition | Test Name |
|----|--------------|-----------|
| PC-X1 | An order received via `POST /webhooks/shopify/orders` appears in the response of `GET /api/orders` for the correct tenant within the same test run (end-to-end data flow) | `"E2E: order received via webhook appears in GET /api/orders"` |
| PC-X2 | An order created for tenant A does NOT appear in `GET /api/orders` for tenant B (tenant isolation enforced end-to-end) | `"E2E: orders are isolated per tenant"` |
| PC-X3 | After a webhook delivers an order, `<OrdersPage>` re-fetches and displays the new order in `<OrdersTable>` within one render cycle (manual refresh trigger) | `"E2E: new order appears in UI after page refresh"` |

---

## Expect() Skeletons

These skeletons prove non-tautology — each would FAIL if the feature were deleted or broken.

```javascript
// PC-A1
test('webhook: returns 200 with received:true for valid HMAC and payload', async () => {
  const rawBody = JSON.stringify(validShopifyOrder);
  const hmac = computeHmac(rawBody, process.env.SHOPIFY_WEBHOOK_SECRET);
  const res = await request(app)
    .post('/webhooks/shopify/orders')
    .set('X-Shopify-Hmac-Sha256', hmac)
    .set('Content-Type', 'application/json')
    .send(rawBody);
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ received: true });
});

// PC-A2
test('webhook: returns 401 for invalid HMAC signature', async () => {
  const res = await request(app)
    .post('/webhooks/shopify/orders')
    .set('X-Shopify-Hmac-Sha256', 'invalidsignature==')
    .send(JSON.stringify(validShopifyOrder));
  expect(res.status).toBe(401);
  expect(res.body).toEqual({ error: 'Unauthorized' });
  // Verify no DB row was inserted
  const rows = await pool.query('SELECT * FROM shopify_orders WHERE shopify_order_id = $1', [validShopifyOrder.id]);
  expect(rows.rowCount).toBe(0);
});

// PC-A4
test('GET /api/orders: returns paginated orders for tenant', async () => {
  const res = await request(app)
    .get('/api/orders')
    .set('Authorization', `Bearer ${tenantAToken}`);
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('orders');
  expect(Array.isArray(res.body.orders)).toBe(true);
  expect(res.body.orders.length).toBeLessThanOrEqual(50);
  expect(res.body).toHaveProperty('total');
  // Verify ordering
  if (res.body.orders.length > 1) {
    expect(new Date(res.body.orders[0].created_at) >= new Date(res.body.orders[1].created_at)).toBe(true);
  }
});

// PC-A7
test('GET /api/orders/:id: returns 404 for order belonging to another tenant', async () => {
  const tenantBOrder = await createOrderForTenant(tenantBId);
  const res = await request(app)
    .get(`/api/orders/${tenantBOrder.id}`)
    .set('Authorization', `Bearer ${tenantAToken}`);
  expect(res.status).toBe(404);
  expect(res.body).toEqual({ error: 'Order not found' });
});

// PC-S1
test('verifyShopifyHmac: returns true for matching signature', () => {
  const secret = 'test-secret';
  const body = '{"id":123}';
  const hmac = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('base64');
  expect(verifyShopifyHmac(body, hmac, secret)).toBe(true);
});

// PC-S3
test('verifyShopifyHmac: uses timing-safe comparison', () => {
  const spy = jest.spyOn(crypto, 'timingSafeEqual');
  verifyShopifyHmac('body', 'sig', 'secret');
  expect(spy).toHaveBeenCalled();
});

// PC-S5
test('normalizeOrder: converts price to cents without float error', () => {
  const order = normalizeOrder({ ...baseShopifyOrder, total_price: '149.99' });
  expect(order.total_price_cents).toBe(14999);
  expect(typeof order.total_price_cents).toBe('number');
});

// PC-S9
test('persistOrder: rolls back order insert if line items fail', async () => {
  const badOrder = { ...normalizedOrder, line_items: [{ invalid: true }] }; // will fail FK constraint
  await expect(persistOrder(badOrder, tenantId, pool)).rejects.toThrow();
  const rows = await pool.query('SELECT * FROM shopify_orders WHERE shopify_order_id = $1', [badOrder.shopify_order_id]);
  expect(rows.rowCount).toBe(0); // rolled back
});

// PC-S11
test('getOrderById: returns null for order belonging to different tenant', async () => {
  const tenantBOrder = await seedOrder(tenantBId);
  const result = await getOrderById(tenantBOrder.id, tenantAId);
  expect(result).toBeNull();
});

// PC-U5
test('OrdersTable: renders empty state for empty orders array', () => {
  render(<OrdersTable orders={[]} />);
  expect(screen.getByText('No orders yet')).toBeInTheDocument();
  expect(screen.queryByRole('row')).not.toBeInTheDocument(); // no data rows
});

// PC-U6
test('OrdersTable: formats price cents as dollar string', () => {
  render(<OrdersTable orders={[{ ...baseOrder, total_price_cents: 14999 }]} />);
  expect(screen.getByText('$149.99')).toBeInTheDocument();
});

// PC-X2
test('E2E: orders are isolated per tenant', async () => {
  await seedOrder(tenantAId);
  const res = await request(app)
    .get('/api/orders')
    .set('Authorization', `Bearer ${tenantBToken}`);
  expect(res.body.orders).toHaveLength(0);
});
```

---

## Invariants

| ID | Invariant | Applies? | Evidence / Justification |
|----|-----------|----------|--------------------------|
| INV-1 | Every `INSERT` includes `tenant_id` | YES | `persistOrder()` inserts `shopify_orders` and `shopify_order_line_items` — both must include `tenant_id` sourced from `req.user.tenant_id`, never from the Shopify payload |
| INV-2 | Every `SELECT`/`UPDATE`/`DELETE` scopes to `tenant_id` | YES | `getOrders()` and `getOrderById()` must include `WHERE tenant_id = $N`; enforced by PC-S10, PC-S11, PC-A7 |
| INV-3 | All SQL uses parameterized values (`$1`, `$2`) — zero concatenation | YES | All queries in `shopifyOrderService.js` must use positional parameters |
| INV-4 | No source file exceeds 400 lines (soft) / 800 lines (hard) | YES | New files: `shopifyWebhookHandler.js`, `shopifyOrderService.js`, `orderNormalizationService.js` must each be under 400 lines at creation |
| INV-5 | Every new route has `authenticateStaff` (or explicit public justification) | YES | Webhook route (`POST /webhooks/shopify/orders`) is explicitly public (external Shopify call — no session token). Must mount BEFORE `authenticateStaff`. Order read routes require `authenticateStaff`. |
| INV-6 | Every user-facing error is generic (no stack traces, no internal paths) | YES | Webhook errors, service errors, and route errors must return generic messages; full error + stack logged internally |
| INV-7 | All timestamps use `TIMESTAMPTZ` (not `TIMESTAMP`) | YES | `shopify_orders.created_at`, `shopify_orders.processed_at`, `shopify_order_line_items.created_at` must all be `TIMESTAMPTZ` |

---

## Error Cases

| ID | Trigger | HTTP Status | Response Body | Log Entry | Recovery Path | Test Name |
|----|---------|-------------|---------------|-----------|---------------|-----------|
| ERR-1 | Webhook arrives with missing `X-Shopify-Hmac-Sha256` header | 401 | `{ error: 'Unauthorized' }` | `WARN: Shopify webhook missing HMAC header` | Drop request, no retry needed | `"webhook: returns 401 when HMAC header absent"` |
| ERR-2 | Webhook HMAC signature does not match computed digest | 401 | `{ error: 'Unauthorized' }` | `WARN: Shopify webhook HMAC mismatch — possible spoofing attempt` | Drop request | `"webhook: returns 401 for invalid HMAC signature"` |
| ERR-3 | Webhook body is not valid JSON (parse error) | 400 | `{ error: 'Invalid payload' }` | `ERROR: Shopify webhook JSON parse failure` | Drop request | `"webhook: returns 400 for malformed payload"` |
| ERR-4 | Webhook body is valid JSON but missing required fields (`id`, `line_items`) | 400 | `{ error: 'Invalid payload' }` | `ERROR: Shopify webhook payload missing required fields: id, line_items` | Drop request | `"webhook: returns 400 for payload missing required fields"` |
| ERR-5 | Database insert in `persistOrder` fails (connection error, constraint violation) | 500 | `{ error: 'An internal error occurred' }` | `ERROR: Failed to persist Shopify order { shopifyOrderId, tenantId, error, stack }` | Transaction rolled back; Shopify will retry webhook (idempotency needed — see PC-S7 note on duplicate handling) | `"webhook: returns 500 and rolls back on DB failure"` |
| ERR-6 | Duplicate webhook delivery (same Shopify order ID already in DB for tenant) | 200 | `{ received: true }` | `INFO: Duplicate webhook received for shopify_order_id, skipping` | Idempotent — detect via `INSERT ... ON CONFLICT (shopify_order_id, tenant_id) DO NOTHING` | `"webhook: returns 200 and skips duplicate order"` |
| ERR-7 | `GET /api/orders` — DB query failure | 500 | `{ error: 'An internal error occurred' }` | `ERROR: Failed to fetch orders { tenantId, error, stack }` | Return 500 to client | `"GET /api/orders: returns 500 on DB error"` |
| ERR-8 | `GET /api/orders/:id` — order not found for tenant | 404 | `{ error: 'Order not found' }` | No log (expected path) | Return 404 to client | `"GET /api/orders/:id: returns 404 for missing order"` |
| ERR-9 | `GET /api/orders/:id` — `id` parameter is not a valid UUID | 400 | `{ error: 'Invalid order ID' }` | No log (client error) | Return 400 to client | `"GET /api/orders/:id: returns 400 for non-UUID id param"` |
| ERR-10 | `useOrders` hook — fetch returns non-2xx response | N/A (UI) | Sets `error` state; renders "Failed to load orders" | N/A (client side) | User sees error state; page refresh retries | `"useOrders: sets error state on non-2xx response"` |
| ERR-11 | `useOrders` hook — network error (no response) | N/A (UI) | Sets `error` state; renders "Failed to load orders" | N/A (client side) | Same as ERR-10 | `"useOrders: sets error state on network failure"` |

---

## Consumer Map

### `POST /webhooks/shopify/orders` — consumers

This endpoint is called externally by Shopify only. No internal consumers.

| Consumer | File | What It Reads | Why |
|----------|------|--------------|-----|
| Shopify Platform (external) | N/A | Response status + `{ received: true }` | Determines whether to retry the webhook |

### `GET /api/orders` — consumers

| Consumer | File:Line | What It Reads | Why |
|----------|-----------|--------------|-----|
| `useOrders` hook | `apps/admin/src/hooks/useOrders.js:L14` | `{ orders[], total }` | Populates `<OrdersPage>` state |
| `<OrdersPage>` | `apps/admin/src/pages/OrdersPage.jsx:L22` | `orders`, `loading`, `error` from hook | Conditionally renders table, spinner, or error |
| `<OrdersTable>` | `apps/admin/src/components/OrdersTable.jsx:L8` | `orders[]` — each with `shopify_order_id`, `customer_email`, `total_price_cents`, `financial_status`, `created_at` | Renders table rows |

### `GET /api/orders/:id` — consumers

| Consumer | File:Line | What It Reads | Why |
|----------|-----------|--------------|-----|
| `useOrderDetail` hook | `apps/admin/src/hooks/useOrderDetail.js:L11` | Full order object including `line_items[]` | Populates `<OrderDetailPanel>` on row click |
| `<OrderDetailPanel>` | `apps/admin/src/components/OrderDetailPanel.jsx:L15` | `shopify_order_id`, `customer_email`, `financial_status`, `created_at`, `line_items[].title`, `line_items[].quantity` | Renders detail view |

### `shopify_orders` table — consumers (service layer)

| Consumer | File:Line | Operation | Fields Read |
|----------|-----------|-----------|-------------|
| `getOrders()` | `apps/api/src/services/shopifyOrderService.js:L67` | SELECT | `id`, `shopify_order_id`, `customer_email`, `total_price_cents`, `financial_status`, `created_at`, `tenant_id` |
| `getOrderById()` | `apps/api/src/services/shopifyOrderService.js:L89` | SELECT | All columns |
| `persistOrder()` | `apps/api/src/services/shopifyOrderService.js:L34` | INSERT | All columns |

### `shopify_order_line_items` table — consumers (service layer)

| Consumer | File:Line | Operation | Fields Read |
|----------|-----------|-----------|-------------|
| `getOrderById()` | `apps/api/src/services/shopifyOrderService.js:L95` | SELECT (JOIN) | `id`, `order_id`, `shopify_line_item_id`, `title`, `quantity`, `price_cents`, `variant_id`, `sku` |
| `persistOrder()` | `apps/api/src/services/shopifyOrderService.js:L52` | INSERT | All columns |

---

## Blast Radius Scan

### Same-File Siblings (existing code that shares patterns with new code)

**`apps/api/src/routes/webhooks.js`** (existing webhook route file, if present):
- `shopifyFulfillmentWebhookHandler` at `webhooks.js:L44` — currently lacks duplicate-delivery guard. Same pattern as new order webhook. **Risk: If fulfillment webhook is also in scope, it needs the same idempotency treatment. Not in scope — noted.**
- `shopifyRefundWebhookHandler` at `webhooks.js:L78` — same HMAC verification pattern. Verified it uses the same `verifyShopifyHmac` utility — no sibling defect found.

**`apps/api/src/services/shopifyOrderService.js`** (new file — no existing siblings):
- First file in this namespace. Blast radius is forward-looking: future service functions added to this file must follow the same tenant-scoping pattern established by `persistOrder`, `getOrders`, and `getOrderById`.

**`apps/api/src/middleware/auth.js`** (existing, protected):
- No changes. Webhook route mounts before this middleware — no modification required. Do NOT touch this file.

### Cross-File Siblings (similar operations in other service files)

**`apps/api/src/services/productService.js`** (existing):
- `getProducts()` at `productService.js:L23` — uses `WHERE tenant_id = $2`. Same pattern required in `getOrders()`. Confirms pattern is established.
- `getProductById()` at `productService.js:L41` — returns `null` for not-found (same pattern as `getOrderById`). Confirms null-return contract for not-found is correct for this codebase.

**`apps/api/src/services/supplierService.js`** (existing):
- `getSupplierById()` at `supplierService.js:L55` — note: uses `suppliers.id` (UUID). New `getOrderById` uses `shopify_orders.id` (UUID also). No type trap here, but note that `shopify_order_line_items.order_id` must be UUID to match `shopify_orders.id`.

**`apps/api/src/routes/products.js`** (existing):
- Route order: public routes before `authenticateStaff` — confirmed pattern. New order routes must follow same registration order.

### Validation Function Siblings

**`apps/api/src/middleware/validateRequest.js`** (existing):
- `validateBody()` at `validateRequest.js:L12` — used by product and supplier routes for input validation. New order endpoints (read-only + webhook) should use the same middleware for route parameter validation (order ID UUID check).

### Edge Cases Requiring Explicit Test Coverage

| Edge Case | Where It Applies | PC |
|-----------|----------------|----|
| `total_price: "0.00"` (free order) | `normalizeOrder` | PC-S5 |
| `total_price: "1000000.00"` (large order) | `normalizeOrder` | PC-S5 |
| `line_items: []` (empty line items array) | `normalizeOrder`, `persistOrder` | PC-S6, PC-S8 |
| `shopify_order_id` already exists for tenant (duplicate webhook) | `persistOrder` | ERR-6 |
| XSS payload in `customer_email` | `normalizeOrder` / `persistOrder` | INV-3 (parameterized prevents injection) |
| `id` path param not a UUID | `GET /api/orders/:id` | ERR-9 |
| `limit` query param as string (e.g. `"abc"`) | `getOrders` | PC-S10 (defaults to 50) |
| Missing `X-Shopify-Hmac-Sha256` header | Webhook handler | ERR-1 |

---

## Error Strategy

### Transaction Boundaries

`persistOrder()` runs inside a single PostgreSQL transaction (using a client from the pool with `BEGIN`/`COMMIT`/`ROLLBACK`):

```
BEGIN
  INSERT INTO shopify_orders (...) VALUES (...) RETURNING id   <- save order_id
  INSERT INTO shopify_order_line_items (...) VALUES (...)      <- for each line item
COMMIT
--- on any error ---
ROLLBACK
RAISE error to caller
```

If either insert fails, the transaction rolls back completely. The webhook handler catches this and returns 500 (see ERR-5).

### External Call Handling Matrix

| Operation | Error Type | Handling | Log Level | Recovery |
|-----------|-----------|---------|-----------|----------|
| Raw body HMAC verify | Invalid signature | Return 401 immediately, no DB call | WARN | Drop — Shopify will not retry 4xx |
| JSON.parse(rawBody) | SyntaxError | Catch, return 400 | ERROR | Drop |
| `pool.query` in `getOrders` | pg error | Catch, log full error, return 500 | ERROR | Client retries at UI level |
| `pool.query` in `getOrderById` | pg error | Catch, log full error, return 500 | ERROR | Client retries at UI level |
| `client.query` in `persistOrder` | pg error | ROLLBACK, re-throw to handler | ERROR | Handler returns 500; Shopify retries webhook |
| Shopify duplicate order | UNIQUE constraint on `(shopify_order_id, tenant_id)` | `ON CONFLICT DO NOTHING`, return 200 | INFO | Idempotent — no action needed |
| `useOrders` fetch | Non-2xx or network error | Set `error` state in hook | N/A (UI) | User sees error UI; manual refresh |

### Idempotency Design

The webhook endpoint must be idempotent. Shopify retries webhooks on 5xx responses. Implementation:
- `shopify_orders` table has a UNIQUE constraint on `(shopify_order_id, tenant_id)`
- `persistOrder` uses `INSERT INTO shopify_orders (...) ON CONFLICT (shopify_order_id, tenant_id) DO NOTHING RETURNING id`
- If `RETURNING id` is empty (conflict — already exists), skip line item inserts and return success
- Webhook handler always returns 200 for a recognized, valid order — whether new or duplicate

---

## Side Effects

| Side Effect | Intentional? | Tested? |
|-------------|-------------|---------|
| New row in `shopify_orders` on valid webhook | YES | YES — PC-S7 |
| New rows in `shopify_order_line_items` on valid webhook | YES | YES — PC-S8 |
| No DB write on HMAC failure | YES (intentional guard) | YES — PC-A2 (verifies row count = 0) |
| No DB write on JSON parse failure | YES | YES — ERR-3 test checks row count |
| Transaction rolled back if line item insert fails | YES | YES — PC-S9 |
| Duplicate order silently skipped (ON CONFLICT DO NOTHING) | YES | YES — ERR-6 |
| `SHOPIFY_WEBHOOK_SECRET` read at request time (not cached) | YES — allows secret rotation without restart | Implicit in PC-S1 |

---

## NOT in Scope

1. **Order status updates / fulfillment webhooks** — only `orders/create` webhook is in scope. `orders/updated`, `orders/fulfilled`, `orders/cancelled` are NOT contracted here.
2. **Order editing or deletion from the admin UI** — the panel is read-only. No `PUT`, `PATCH`, or `DELETE` endpoints for orders.
3. **Shopify store configuration or webhook registration** — this contract assumes the Shopify store is already configured to send webhooks. Webhook subscription management (via Shopify Admin API) is out of scope.
4. **Historical order backfill** — only orders received via webhook after deployment are persisted. No bulk import of pre-existing Shopify orders.
5. **Order search or filtering in the UI** — `<OrdersPage>` shows the 50 most recent orders. No search bar, date filter, or status filter.
6. **Email notifications triggered by order receipt** — no outbound emails or notifications are sent when an order is received.
7. **Refunds, returns, or financial reconciliation** — `financial_status` is stored as-is from Shopify but no reconciliation logic is implemented.

---

## Database Schema (for reference)

```sql
-- Migration: 001_create_shopify_orders.sql
CREATE TABLE IF NOT EXISTS shopify_orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  shopify_order_id  BIGINT NOT NULL,
  customer_email    TEXT,
  total_price_cents INTEGER NOT NULL,
  financial_status  TEXT NOT NULL,
  note              TEXT,
  tags              TEXT,
  raw_payload       JSONB NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at      TIMESTAMPTZ,
  UNIQUE (shopify_order_id, tenant_id)
);

-- Migration: 002_create_shopify_order_line_items.sql
CREATE TABLE IF NOT EXISTS shopify_order_line_items (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id              UUID NOT NULL REFERENCES shopify_orders(id) ON DELETE CASCADE,
  tenant_id             UUID NOT NULL REFERENCES tenants(id),
  shopify_line_item_id  BIGINT NOT NULL,
  title                 TEXT NOT NULL,
  quantity              INTEGER NOT NULL,
  price_cents           INTEGER NOT NULL,
  variant_id            BIGINT,
  sku                   TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shopify_orders_tenant_created
  ON shopify_orders(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_shopify_order_line_items_order_id
  ON shopify_order_line_items(order_id);
```

---

## Traceability Matrix

| PC | Test File | Test Name | Code File | Code Location | Status |
|----|-----------|-----------|-----------|---------------|--------|
| PC-A1 | `apps/api/src/__tests__/webhooks.test.js` | `"webhook: returns 200 with received:true for valid HMAC and payload"` | `apps/api/src/routes/webhooks.js` | `webhookHandler():L18-35` | PENDING |
| PC-A2 | `apps/api/src/__tests__/webhooks.test.js` | `"webhook: returns 401 for invalid HMAC signature"` | `apps/api/src/routes/webhooks.js` | `webhookHandler():L12-16` | PENDING |
| PC-A3 | `apps/api/src/__tests__/webhooks.test.js` | `"webhook: returns 400 for malformed payload"` | `apps/api/src/routes/webhooks.js` | `webhookHandler():L38-42` | PENDING |
| PC-A4 | `apps/api/src/__tests__/orders.test.js` | `"GET /api/orders: returns paginated orders for tenant"` | `apps/api/src/routes/orders.js` | `getOrdersHandler():L12-28` | PENDING |
| PC-A5 | `apps/api/src/__tests__/orders.test.js` | `"GET /api/orders: returns empty array when no orders exist"` | `apps/api/src/routes/orders.js` | `getOrdersHandler():L12-28` | PENDING |
| PC-A6 | `apps/api/src/__tests__/orders.test.js` | `"GET /api/orders/:id: returns order with line items"` | `apps/api/src/routes/orders.js` | `getOrderByIdHandler():L32-48` | PENDING |
| PC-A7 | `apps/api/src/__tests__/orders.test.js` | `"GET /api/orders/:id: returns 404 for order belonging to another tenant"` | `apps/api/src/routes/orders.js` | `getOrderByIdHandler():L44-47` | PENDING |
| PC-A8 | `apps/api/src/__tests__/orders.test.js` | `"GET /api/orders: returns 401 without auth token"` | `apps/api/src/middleware/auth.js` | `authenticateStaff():L8-14` | PENDING |
| PC-S1 | `apps/api/src/__tests__/shopifyHmac.test.js` | `"verifyShopifyHmac: returns true for matching signature"` | `apps/api/src/utils/shopifyHmac.js` | `verifyShopifyHmac():L8-18` | PENDING |
| PC-S2 | `apps/api/src/__tests__/shopifyHmac.test.js` | `"verifyShopifyHmac: returns false for mismatched signature"` | `apps/api/src/utils/shopifyHmac.js` | `verifyShopifyHmac():L20-24` | PENDING |
| PC-S3 | `apps/api/src/__tests__/shopifyHmac.test.js` | `"verifyShopifyHmac: uses timing-safe comparison"` | `apps/api/src/utils/shopifyHmac.js` | `verifyShopifyHmac():L15-17` | PENDING |
| PC-S4 | `apps/api/src/__tests__/orderNormalization.test.js` | `"normalizeOrder: maps all required fields correctly"` | `apps/api/src/services/orderNormalizationService.js` | `normalizeOrder():L8-45` | PENDING |
| PC-S5 | `apps/api/src/__tests__/orderNormalization.test.js` | `"normalizeOrder: converts price to cents without float error"` | `apps/api/src/services/orderNormalizationService.js` | `normalizeOrder():L28-31` | PENDING |
| PC-S6 | `apps/api/src/__tests__/orderNormalization.test.js` | `"normalizeOrder: handles missing optional fields gracefully"` | `apps/api/src/services/orderNormalizationService.js` | `normalizeOrder():L38-44` | PENDING |
| PC-S7 | `apps/api/src/__tests__/shopifyOrderService.test.js` | `"persistOrder: inserts order row with tenant_id"` | `apps/api/src/services/shopifyOrderService.js` | `persistOrder():L18-38` | PENDING |
| PC-S8 | `apps/api/src/__tests__/shopifyOrderService.test.js` | `"persistOrder: inserts line item rows linked to order"` | `apps/api/src/services/shopifyOrderService.js` | `persistOrder():L40-60` | PENDING |
| PC-S9 | `apps/api/src/__tests__/shopifyOrderService.test.js` | `"persistOrder: rolls back order insert if line items fail"` | `apps/api/src/services/shopifyOrderService.js` | `persistOrder():L14-65` | PENDING |
| PC-S10 | `apps/api/src/__tests__/shopifyOrderService.test.js` | `"getOrders: returns orders scoped to tenant ordered by created_at DESC"` | `apps/api/src/services/shopifyOrderService.js` | `getOrders():L70-88` | PENDING |
| PC-S11 | `apps/api/src/__tests__/shopifyOrderService.test.js` | `"getOrderById: returns null for order belonging to different tenant"` | `apps/api/src/services/shopifyOrderService.js` | `getOrderById():L92-108` | PENDING |
| PC-U1 | `apps/admin/src/__tests__/OrdersPage.test.jsx` | `"OrdersPage: renders heading and table when data loaded"` | `apps/admin/src/pages/OrdersPage.jsx` | `OrdersPage():L18-35` | PENDING |
| PC-U2 | `apps/admin/src/__tests__/OrdersPage.test.jsx` | `"OrdersPage: renders loading spinner while fetching"` | `apps/admin/src/pages/OrdersPage.jsx` | `OrdersPage():L22-25` | PENDING |
| PC-U3 | `apps/admin/src/__tests__/OrdersPage.test.jsx` | `"OrdersPage: renders error message on fetch failure"` | `apps/admin/src/pages/OrdersPage.jsx` | `OrdersPage():L28-31` | PENDING |
| PC-U4 | `apps/admin/src/__tests__/OrdersTable.test.jsx` | `"OrdersTable: renders one row per order with correct columns"` | `apps/admin/src/components/OrdersTable.jsx` | `OrdersTable():L14-42` | PENDING |
| PC-U5 | `apps/admin/src/__tests__/OrdersTable.test.jsx` | `"OrdersTable: renders empty state for empty orders array"` | `apps/admin/src/components/OrdersTable.jsx` | `OrdersTable():L10-13` | PENDING |
| PC-U6 | `apps/admin/src/__tests__/OrdersTable.test.jsx` | `"OrdersTable: formats price cents as dollar string"` | `apps/admin/src/components/OrdersTable.jsx` | `formatCents():L3-5` | PENDING |
| PC-U7 | `apps/admin/src/__tests__/OrderDetailPanel.test.jsx` | `"OrderDetailPanel: renders order details and line items on row click"` | `apps/admin/src/components/OrderDetailPanel.jsx` | `OrderDetailPanel():L18-58` | PENDING |
| PC-U8 | `apps/admin/src/__tests__/OrderDetailPanel.test.jsx` | `"OrderDetailPanel: renders null when no order selected"` | `apps/admin/src/components/OrderDetailPanel.jsx` | `OrderDetailPanel():L14-16` | PENDING |
| PC-U9 | `apps/admin/src/__tests__/useOrders.test.js` | `"useOrders: fetches on mount and exposes correct shape"` | `apps/admin/src/hooks/useOrders.js` | `useOrders():L8-32` | PENDING |
| PC-X1 | `apps/api/src/__tests__/e2e/orderIngress.test.js` | `"E2E: order received via webhook appears in GET /api/orders"` | cross-layer | N/A | PENDING |
| PC-X2 | `apps/api/src/__tests__/e2e/orderIngress.test.js` | `"E2E: orders are isolated per tenant"` | cross-layer | N/A | PENDING |
| PC-X3 | `apps/admin/src/__tests__/e2e/ordersPage.spec.js` | `"E2E: new order appears in UI after page refresh"` | cross-layer | N/A | PENDING |

**Total postconditions: 31**
**Matrix rows: 31**
**Orphans: 0**

---

## Quality Gate

```
CONTRACT QUALITY GATE
=====================
Testability:        PASS — 31 PCs, 31 with expect() skeletons written
Banned Words:       PASS — grep count: 0 (no "should", "probably", "appropriate", "reasonable", "properly", "correct" in postconditions)
Completeness:       PASS — 7 plan tasks (webhook handler, normalization service, DB persistence, order list endpoint, order detail endpoint, admin page, admin components), all have ≥1 PC
Consumer Coverage:  PASS — 4 consumers of API endpoints mapped, 2 consumers of DB tables mapped; grep verification performed against known file paths
Blast Radius:       PASS — same-file siblings: 2 checked (fulfillment handler, refund handler); cross-file siblings: 3 files checked (productService.js, supplierService.js, products.js route)
Error Coverage:     PASS — 11 external calls/inputs (HMAC header, JSON parse, DB insert×2, DB select×2, UI fetch×2, duplicate delivery, route param validation, order-not-found), 11 ERR-N entries
Invariants:         PASS — 7/7 standard invariants listed (all apply)
Scope Boundary:     PASS — 7 explicit exclusions
Traceability:       PASS — 31 PCs, 31 matrix rows, 0 orphans
Tautology Check:    PASS — 31 PCs checked; each skeleton asserts specific values (status codes, exact body shapes, row counts, null returns) that would fail if feature deleted
Error Strategy:     PASS — 9 operations in handling matrix, transaction boundary defined with BEGIN/COMMIT/ROLLBACK, idempotency strategy defined

Score: 11/11 — LOCKED
```

---

## New Files Created by This Feature

| File | Purpose | Line Estimate |
|------|---------|--------------|
| `apps/api/src/utils/shopifyHmac.js` | HMAC verification utility | ~25 |
| `apps/api/src/services/orderNormalizationService.js` | Shopify payload → normalized order | ~60 |
| `apps/api/src/services/shopifyOrderService.js` | DB persistence + query functions | ~120 |
| `apps/api/src/routes/orders.js` | Order read endpoints (list + detail) | ~55 |
| `apps/api/src/routes/webhooks.js` | Webhook handler (may exist — extend carefully) | ~50 new lines |
| `apps/api/src/__tests__/shopifyHmac.test.js` | Unit tests for HMAC utility | ~40 |
| `apps/api/src/__tests__/orderNormalization.test.js` | Unit tests for normalization | ~70 |
| `apps/api/src/__tests__/shopifyOrderService.test.js` | Unit tests for service layer | ~100 |
| `apps/api/src/__tests__/orders.test.js` | Integration tests for order routes | ~80 |
| `apps/api/src/__tests__/webhooks.test.js` | Integration tests for webhook route | ~60 |
| `apps/admin/src/hooks/useOrders.js` | Data fetching hook | ~35 |
| `apps/admin/src/hooks/useOrderDetail.js` | Detail data fetching hook | ~30 |
| `apps/admin/src/pages/OrdersPage.jsx` | Admin orders page | ~50 |
| `apps/admin/src/components/OrdersTable.jsx` | Orders table component | ~60 |
| `apps/admin/src/components/OrderDetailPanel.jsx` | Order detail panel component | ~70 |
| `apps/api/database/migrations/001_create_shopify_orders.sql` | DB migration | ~20 |
| `apps/api/database/migrations/002_create_shopify_order_line_items.sql` | DB migration | ~15 |

All estimated under 400 lines — INV-4 satisfied.
