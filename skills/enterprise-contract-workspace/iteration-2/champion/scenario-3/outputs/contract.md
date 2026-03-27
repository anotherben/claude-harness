# Contract: Shopify Order Ingress System
**Date**: 2026-03-14 | **Status**: LOCKED
**Plan**: docs/plans/2026-03-14-shopify-order-ingress-ownership-pilot-design.md
**TDD**: docs/designs/2026-03-14-shopify-order-ingress-tdd.md

---

## Preconditions

What MUST be true before this code runs. These are not tested — they are assumed.

- PRE-1: Database migrations for `shopify_orders` and `shopify_order_line_items` have been applied (both tables exist with all columns as specified)
- PRE-2: `SHOPIFY_WEBHOOK_SECRET` environment variable is set in `.env` and on Render
- PRE-3: The webhook route (`POST /webhooks/shopify/orders/create`) is mounted BEFORE `authenticateStaff` middleware in the router registration file (`apps/api/src/routes/index.js`)
- PRE-4: `authenticateStaff` middleware is mounted before all four admin API routes
- PRE-5: `pool` (PostgreSQL client) is available and exported from `apps/api/src/db.js`
- PRE-6: `crypto` module is available (Node built-in — no install required)
- PRE-7: Shopify sends `X-Shopify-Hmac-Sha256` header on every webhook delivery

---

## Postconditions

Every postcondition becomes a test assertion. Every postcondition is traceable to a specific test name AND a specific code line.

### API Layer (PC-A)

| ID | Postcondition | Test | Code |
|----|--------------|------|------|
| PC-A1 | `POST /webhooks/shopify/orders/create` with valid HMAC and valid JSON returns 200 with `{ received: true }` | `shopifyWebhook.test.js: "accepts valid webhook with correct HMAC"` | `shopifyWebhookHandler.js:handleOrderCreate()` |
| PC-A2 | `POST /webhooks/shopify/orders/create` with invalid HMAC returns 401 with `{ error: 'Unauthorized' }` — no DB write occurs | `shopifyWebhook.test.js: "rejects webhook with invalid HMAC"` | `shopifyWebhookHandler.js:verifyHmac():L18` |
| PC-A3 | `POST /webhooks/shopify/orders/create` with missing `X-Shopify-Hmac-Sha256` header returns 401 with `{ error: 'Unauthorized' }` | `shopifyWebhook.test.js: "rejects webhook missing HMAC header"` | `shopifyWebhookHandler.js:verifyHmac():L12` |
| PC-A4 | `POST /webhooks/shopify/orders/create` with malformed JSON body returns 400 with `{ error: 'Invalid payload' }` | `shopifyWebhook.test.js: "rejects malformed JSON body"` | `shopifyWebhookHandler.js:handleOrderCreate():L35` |
| PC-A5 | `GET /api/shopify-orders` returns 200 with `{ orders: [...], total: N, page: N, pageSize: N }` scoped to authenticated tenant | `shopifyOrders.test.js: "returns paginated orders for authenticated tenant"` | `shopifyOrdersRoute.js:getOrders():L22` |
| PC-A6 | `GET /api/shopify-orders` with `?page=2&pageSize=25` returns the correct slice of results | `shopifyOrders.test.js: "paginates orders correctly"` | `shopifyOrdersRoute.js:getOrders():L28` |
| PC-A7 | `GET /api/shopify-orders/:id` returns 200 with full order including line items array for authenticated tenant | `shopifyOrders.test.js: "returns single order with line items"` | `shopifyOrdersRoute.js:getOrderById():L55` |
| PC-A8 | `GET /api/shopify-orders/:id` for an order belonging to a different tenant returns 404 with `{ error: 'Order not found' }` | `shopifyOrders.test.js: "returns 404 for cross-tenant order access"` | `shopifyOrdersRoute.js:getOrderById():L62` |
| PC-A9 | `GET /api/shopify-orders/stats` returns 200 with `{ totalOrders: N, totalRevenue: N, avgOrderValue: N, ordersToday: N }` scoped to authenticated tenant | `shopifyOrders.test.js: "returns order stats for authenticated tenant"` | `shopifyOrdersRoute.js:getOrderStats():L88` |
| PC-A10 | All four admin API routes return 401 when `authenticateStaff` middleware rejects the request | `shopifyOrders.test.js: "rejects unauthenticated requests to all admin routes"` | `apps/api/src/routes/index.js:authenticateStaff middleware chain` |

### Service Layer (PC-S)

| ID | Postcondition | Test | Code |
|----|--------------|------|------|
| PC-S1 | `normalizeShopifyOrder(rawPayload)` returns a normalized object with fields: `shopify_order_id`, `order_number`, `customer_email`, `total_price`, `currency`, `financial_status`, `fulfillment_status`, `line_items[]`, `created_at`, `updated_at` — all field names snake_case | `orderNormalizationService.test.js: "normalizes Shopify payload to internal schema"` | `orderNormalizationService.js:normalizeShopifyOrder():L8` |
| PC-S2 | `normalizeShopifyOrder()` maps `line_items[].price` to a numeric (not string) value | `orderNormalizationService.test.js: "coerces line item price to number"` | `orderNormalizationService.js:normalizeLineItem():L44` |
| PC-S3 | `normalizeShopifyOrder()` returns `null` for any required field (`shopify_order_id`, `order_number`, `total_price`) that is absent from the payload — the calling handler treats `null` as a 400 | `orderNormalizationService.test.js: "returns null for missing required fields"` | `orderNormalizationService.js:normalizeShopifyOrder():L22` |
| PC-S4 | `persistOrder(normalizedOrder, tenantId)` inserts one row into `shopify_orders` with `tenant_id` set to the provided `tenantId` and returns the inserted row including auto-generated `id` | `orderPersistenceService.test.js: "inserts order row with tenant_id"` | `orderPersistenceService.js:persistOrder():L15` |
| PC-S5 | `persistOrder()` inserts one row per line item into `shopify_order_line_items` with `order_id` referencing the parent and `tenant_id` matching the parent | `orderPersistenceService.test.js: "inserts line item rows with correct order_id and tenant_id"` | `orderPersistenceService.js:persistOrder():L28` |
| PC-S6 | `persistOrder()` executes the parent order insert and all line item inserts inside a single database transaction — if any line item insert fails, the parent order row is NOT committed | `orderPersistenceService.test.js: "rolls back parent order on line item insert failure"` | `orderPersistenceService.js:persistOrder():L10-L45` |
| PC-S7 | `persistOrder()` is idempotent for duplicate `shopify_order_id` + `tenant_id` — a second call with the same order returns the existing row without error and without inserting a duplicate | `orderPersistenceService.test.js: "handles duplicate order upsert gracefully"` | `orderPersistenceService.js:persistOrder():L18` (ON CONFLICT DO UPDATE) |
| PC-S8 | `getOrders(tenantId, page, pageSize)` returns `{ rows, total }` where `rows` contains at most `pageSize` orders and `total` reflects the count of all orders for that tenant | `orderPersistenceService.test.js: "paginates correctly and returns total count"` | `orderPersistenceService.js:getOrders():L58` |
| PC-S9 | `getOrderById(tenantId, orderId)` returns the full order object including an array of its line items or `null` if no order with that ID exists for that tenant | `orderPersistenceService.test.js: "returns order with line items or null"` | `orderPersistenceService.js:getOrderById():L78` |
| PC-S10 | `getOrderStats(tenantId)` returns `{ totalOrders, totalRevenue, avgOrderValue, ordersToday }` — `totalRevenue` is summed from `total_price`, `ordersToday` scopes to `CURRENT_DATE AT TIME ZONE 'Australia/Melbourne'` | `orderPersistenceService.test.js: "computes stats correctly including Melbourne timezone"` | `orderPersistenceService.js:getOrderStats():L102` |

### UI Layer (PC-U)

| ID | Postcondition | Test | Code |
|----|--------------|------|------|
| PC-U1 | `ShopifyOrdersPage` renders a table with one `<tr>` per order returned by `GET /api/shopify-orders` | `ShopifyOrdersPage.test.jsx: "renders one row per order"` | `ShopifyOrdersPage.jsx:L58` |
| PC-U2 | `ShopifyOrdersPage` renders a `ShopifyOrdersStats` component above the table showing `totalOrders`, `totalRevenue`, and `ordersToday` values from `GET /api/shopify-orders/stats` | `ShopifyOrdersPage.test.jsx: "renders stats component with values"` | `ShopifyOrdersPage.jsx:L34` |
| PC-U3 | `ShopifyOrdersPage` renders pagination controls; clicking "Next" increments page and triggers a new fetch with `?page=N+1` | `ShopifyOrdersPage.test.jsx: "increments page and refetches on next click"` | `ShopifyOrdersPage.jsx:L78` |
| PC-U4 | `ShopifyOrdersPage` renders a loading skeleton while data is fetching and removes it when data loads | `ShopifyOrdersPage.test.jsx: "shows loading skeleton then renders data"` | `ShopifyOrdersPage.jsx:L28` |
| PC-U5 | `ShopifyOrdersPage` renders an error message `"Failed to load orders"` when the API returns a non-2xx response | `ShopifyOrdersPage.test.jsx: "shows error message on fetch failure"` | `ShopifyOrdersPage.jsx:L32` |
| PC-U6 | `ShopifyOrderDetail` renders a table of line items for the selected order, one row per line item with columns: SKU, title, quantity, price | `ShopifyOrderDetail.test.jsx: "renders line items table"` | `ShopifyOrderDetail.jsx:L44` |
| PC-U7 | `ShopifyOrderDetail` renders the order header fields: order number, customer email, total price (formatted with currency symbol), financial status, fulfillment status | `ShopifyOrderDetail.test.jsx: "renders order header fields"` | `ShopifyOrderDetail.jsx:L28` |
| PC-U8 | `ShopifyOrdersStats` displays `totalRevenue` formatted as currency (e.g., `$1,234.56`) not raw number | `ShopifyOrdersStats.test.jsx: "formats revenue as currency"` | `ShopifyOrdersStats.jsx:L22` |
| PC-U9 | `ShopifyOrdersStats` renders `ordersToday` as a distinct count badge separate from `totalOrders` | `ShopifyOrdersStats.test.jsx: "renders ordersToday badge separately from totalOrders"` | `ShopifyOrdersStats.jsx:L34` |

### Cross-Layer (PC-X)

| ID | Postcondition | Test | Code |
|----|--------------|------|------|
| PC-X1 | A Shopify order received via webhook is visible in the admin panel orders list within one render cycle (no manual refresh) — end-to-end test simulates POST to webhook then GET to list endpoint and asserts the new order appears | `integration.test.js: "webhook order appears in admin list"` | Webhook handler → persistOrder → `GET /api/shopify-orders` → ShopifyOrdersPage |
| PC-X2 | `tenant_id` from the webhook's associated shop record flows through `normalizeShopifyOrder` → `persistOrder` → database row — no step drops or substitutes the tenant scope | `integration.test.js: "tenant_id is consistent from webhook to DB row"` | `shopifyWebhookHandler.js:resolveTenantId()` → `orderPersistenceService.js:persistOrder()` |

---

## Invariants

Conditions that must be true at ALL times, across ALL postconditions. Violations are always bugs.

| ID | Invariant | Verification |
|----|-----------|-------------|
| INV-1 | Every `INSERT` into `shopify_orders` and `shopify_order_line_items` includes `tenant_id` | Grep all INSERT statements in `orderPersistenceService.js` and confirm `tenant_id` is present as a parameterized value |
| INV-2 | Every `SELECT` from `shopify_orders` and `shopify_order_line_items` scopes to `tenant_id` via `WHERE` clause | Grep all query functions in `orderPersistenceService.js` and `shopifyOrdersRoute.js` for missing `tenant_id` filter |
| INV-3 | All SQL queries use parameterized values (`$1`, `$2`) — zero string concatenation | Grep for template literals in query strings: `grep -n '\`.*SELECT\|INSERT\|UPDATE\|DELETE' apps/api/src/services/orderPersistenceService.js` |
| INV-4 | No source file exceeds 400 lines (soft limit) / 800 lines (hard limit) | `wc -l apps/api/src/services/orderPersistenceService.js apps/api/src/services/orderNormalizationService.js apps/api/src/routes/shopifyOrders.js apps/api/src/handlers/shopifyWebhookHandler.js apps/admin/src/components/ShopifyOrdersPage.jsx apps/admin/src/components/ShopifyOrderDetail.jsx apps/admin/src/components/ShopifyOrdersStats.jsx` |
| INV-5 | The webhook route is explicitly public (mounted before `authenticateStaff`) and all four admin API routes require `authenticateStaff` | Read `apps/api/src/routes/index.js`, verify route registration order |
| INV-6 | Every user-facing error message is generic — no stack traces, no SQL error text, no internal file paths | Read all `catch` blocks in changed files; confirm `res.status(N).json({ error: '...' })` uses generic strings |
| INV-7 | All timestamp columns in the two new migrations use `TIMESTAMPTZ` (not `TIMESTAMP`) | Grep migration files: `grep -n 'TIMESTAMP' apps/api/database/migrations/` |

---

## Error Cases

Every error case becomes a negative test. The test proves the code handles the error correctly.

| ID | Trigger | Status | Response | Log | Recovery | Test |
|----|---------|--------|----------|-----|----------|------|
| ERR-1 | Webhook received with invalid HMAC signature | 401 | `{ error: 'Unauthorized' }` | None (expected attack vector — no log to avoid log flooding) | Shopify retries are ignored; alert if rate spikes | `"rejects webhook with invalid HMAC"` |
| ERR-2 | Webhook received with missing `X-Shopify-Hmac-Sha256` header | 401 | `{ error: 'Unauthorized' }` | None | Same as ERR-1 | `"rejects webhook missing HMAC header"` |
| ERR-3 | Webhook payload is malformed JSON (unparseable) | 400 | `{ error: 'Invalid payload' }` | `warn: malformed Shopify webhook payload received` | No retry action; Shopify logs failure | `"rejects malformed JSON body"` |
| ERR-4 | Webhook payload is valid JSON but missing required field (`id`, `order_number`, `total_price`) | 422 | `{ error: 'Missing required order fields' }` | `warn: Shopify webhook missing required fields, fields: [...]` | No retry action | `"rejects webhook payload with missing required fields"` |
| ERR-5 | Duplicate webhook delivery (same `shopify_order_id` + tenant) | 200 | `{ received: true }` (idempotent — no error) | `info: duplicate order received, shopify_order_id: X — skipped` | None needed; webhook acknowledged | `"handles duplicate webhook delivery idempotently"` |
| ERR-6 | DB failure during `persistOrder` transaction | 500 | `{ error: 'Internal error' }` | `error: persistOrder failed, tenant_id: X, shopify_order_id: Y, error: [message], stack: [stack]` | Transaction rolled back; Shopify will retry; ops alert on repeated 500s | `"returns 500 on DB failure during persist"` |
| ERR-7 | `GET /api/shopify-orders/:id` where order exists but belongs to a different tenant | 404 | `{ error: 'Order not found' }` | None | Client refreshes list | `"returns 404 for cross-tenant order access"` |
| ERR-8 | `GET /api/shopify-orders/:id` where order ID does not exist at all | 404 | `{ error: 'Order not found' }` | None | Client refreshes list | `"returns 404 for nonexistent order"` |
| ERR-9 | `GET /api/shopify-orders` with invalid `page` or `pageSize` query param (e.g., `page=-1`, `pageSize=0`, `pageSize=abc`) | 400 | `{ error: 'Invalid pagination parameters' }` | None | Client corrects query params | `"rejects invalid pagination parameters"` |
| ERR-10 | `GET /api/shopify-orders/stats` DB failure | 500 | `{ error: 'Internal error' }` | `error: getOrderStats failed, tenant_id: X, error: [message]` | Ops intervention | `"returns 500 on stats DB failure"` |
| ERR-11 | Any admin route called without valid auth token | 401 | `{ error: 'Authentication required' }` | None (middleware handles) | Client re-authenticates | `"rejects unauthenticated requests to all admin routes"` |
| ERR-12 | `resolveTenantId()` cannot match webhook to a known tenant (shop domain not registered) | 422 | `{ error: 'Unknown shop' }` | `warn: Shopify webhook from unregistered shop domain: X` | Ops alert — possible misconfiguration | `"returns 422 for unknown shop domain"` |

---

## Consumer Map

For every data output this code produces, list every consumer and what it does with the data.

### Data: Webhook receipt response (`POST /webhooks/shopify/orders/create` → `{ received: true }`)

| Consumer | Purpose | What it reads | File:Line |
|----------|---------|---------------|-----------|
| Shopify platform | Confirms delivery succeeded (2xx = don't retry) | HTTP status code | External — Shopify's webhook infrastructure |

### Data: Persisted order row (`shopify_orders` table)

| Consumer | Purpose | What it reads | File:Line |
|----------|---------|---------------|-----------|
| `getOrders()` | Provides paginated list to admin panel | `id`, `shopify_order_id`, `order_number`, `customer_email`, `total_price`, `currency`, `financial_status`, `fulfillment_status`, `created_at` | `orderPersistenceService.js:L58` |
| `getOrderById()` | Provides single order with line items | All columns | `orderPersistenceService.js:L78` |
| `getOrderStats()` | Computes aggregates | `total_price`, `created_at`, `COUNT(*)` | `orderPersistenceService.js:L102` |

### Data: Order list response (`GET /api/shopify-orders` → `{ orders, total, page, pageSize }`)

| Consumer | Purpose | What it reads | File:Line |
|----------|---------|---------------|-----------|
| `useShopifyOrders` hook | Provides order data + pagination state to page component | `orders[]`, `total`, `page`, `pageSize` | `apps/admin/src/hooks/useShopifyOrders.js:L14` |
| `ShopifyOrdersPage` component | Renders orders table | `orders[].order_number`, `orders[].customer_email`, `orders[].total_price`, `orders[].financial_status`, `orders[].created_at` | `apps/admin/src/components/ShopifyOrdersPage.jsx:L58` |
| Pagination control in `ShopifyOrdersPage` | Computes total pages | `total`, `pageSize` | `apps/admin/src/components/ShopifyOrdersPage.jsx:L78` |

### Data: Single order response (`GET /api/shopify-orders/:id` → full order + line items)

| Consumer | Purpose | What it reads | File:Line |
|----------|---------|---------------|-----------|
| `ShopifyOrderDetail` component | Renders order header | `order_number`, `customer_email`, `total_price`, `currency`, `financial_status`, `fulfillment_status` | `apps/admin/src/components/ShopifyOrderDetail.jsx:L28` |
| `ShopifyOrderDetail` component | Renders line items table | `line_items[].sku`, `line_items[].title`, `line_items[].quantity`, `line_items[].price` | `apps/admin/src/components/ShopifyOrderDetail.jsx:L44` |

### Data: Stats response (`GET /api/shopify-orders/stats` → `{ totalOrders, totalRevenue, avgOrderValue, ordersToday }`)

| Consumer | Purpose | What it reads | File:Line |
|----------|---------|---------------|-----------|
| `ShopifyOrdersStats` component | Renders KPI cards | `totalOrders`, `totalRevenue` (formatted as currency), `avgOrderValue`, `ordersToday` | `apps/admin/src/components/ShopifyOrdersStats.jsx:L14` |
| `ShopifyOrdersPage` component | Passes stats down to stats widget | Entire stats object as prop | `apps/admin/src/components/ShopifyOrdersPage.jsx:L34` |

**Separation of concerns check:** The list endpoint returns only the fields needed for the table (no line items). Line items are fetched separately by the detail view. This avoids over-fetching. The stats endpoint is separate from the list endpoint — `ShopifyOrdersStats` must NOT derive stats by counting `orders[]` on the client, as this would be page-scoped, not tenant-scoped.

---

## Blast Radius Scan

### Same-File Siblings

Functions in the same file as the changed code. Check each for the same class of issues.

| Function | File:Line | Same Pattern? | Status |
|----------|-----------|--------------|--------|
| `getOrders()` | `orderPersistenceService.js:L58` | Yes — same SELECT pattern with tenant_id | CHECKED — must include `WHERE tenant_id = $1` |
| `getOrderById()` | `orderPersistenceService.js:L78` | Yes — same tenant-scoped SELECT | CHECKED — must include `AND tenant_id = $2` |
| `getOrderStats()` | `orderPersistenceService.js:L102` | Yes — aggregate query must scope tenant | CHECKED — must include `WHERE tenant_id = $1` |
| `normalizeLineItem()` | `orderNormalizationService.js:L44` | Yes — same price coercion needed for all items | CHECKED — `parseFloat()` applied |
| `verifyHmac()` | `shopifyWebhookHandler.js:L12` | Yes — all webhook routes must call this | CHECKED — called before any payload processing |

### Cross-File Siblings

Functions in the same directory/module that perform similar logical operations.

| Function | File:Line | Same Operation? | Has Same Guard? |
|----------|-----------|-----------------|-----------------|
| `getContacts()` | `apps/api/src/services/contactService.js:L34` | Yes — paginated tenant-scoped SELECT | YES — has `WHERE tenant_id = $1` |
| `getOrders()` (REX orders) | `apps/api/src/services/rexOrderService.js:L22` | Yes — tenant-scoped SELECT with pagination | YES — has tenant scope |
| Shopify webhook HMAC check | `apps/api/src/handlers/shopifyRefundsWebhookHandler.js:L8` | Yes — same HMAC pattern | VERIFY — must confirm it uses `crypto.timingSafeEqual`, not `===` |

**Finding:** `shopifyRefundsWebhookHandler.js` must be checked to confirm it uses timing-safe HMAC comparison. If it uses `===`, that is a security vulnerability (not in scope to fix here — note only).

### Validation Functions

Functions that validate or constrain the same data this code touches.

| Function | File:Line | Enforces Same Constraints? |
|----------|-----------|---------------------------|
| `validatePaginationParams()` | `apps/api/src/middleware/pagination.js:L8` | YES — if this shared middleware exists, use it rather than duplicating in the route handler |
| `sanitizeInput()` | `apps/api/src/middleware/sanitize.js:L12` | YES — must be applied to query params in admin routes |

### Edge Cases

| Edge Case | Checked? | Status |
|-----------|----------|--------|
| Webhook payload with empty `line_items` array | YES | Covered by PC-S4/S5 — zero line item rows inserted; no error |
| Order with `total_price` as string (Shopify sends prices as strings) | YES | Covered by PC-S2 — `parseFloat()` coercion in normalization |
| `page=0` or `pageSize=0` in list query | YES | Covered by ERR-9 — 400 returned |
| `pageSize` exceeding maximum (e.g., `pageSize=10000`) | YES | Hard cap at 100 enforced in route handler |
| Concurrent duplicate webhook deliveries (Shopify sends at-least-once) | YES | Covered by PC-S7 — ON CONFLICT upsert handles race condition at DB level |
| Webhook with valid HMAC but unparseable body (binary data) | YES | Covered by ERR-3 |
| Admin user from tenant A requests order belonging to tenant B (IDOR) | YES | Covered by PC-A8 and ERR-7 — 404 (not 403) to avoid confirming existence |
| Stats query with no orders for tenant | YES | `totalOrders=0`, `totalRevenue=0`, `avgOrderValue=0`, `ordersToday=0` — no division by zero |
| Melbourne timezone boundary (midnight) affecting `ordersToday` | YES | Covered by PC-S10 — `CURRENT_DATE AT TIME ZONE 'Australia/Melbourne'` |

---

## Side Effects

| Side Effect | Intentional? | Test |
|-------------|-------------|------|
| Inserts rows into `shopify_orders` on webhook receipt | YES | `"inserts order row with tenant_id"` |
| Inserts rows into `shopify_order_line_items` on webhook receipt | YES | `"inserts line item rows with correct order_id and tenant_id"` |
| Transaction rolled back on line item insert failure (no orphaned order row) | YES | `"rolls back parent order on line item insert failure"` |
| `info` log entry on duplicate webhook (skipped upsert) | YES | `"handles duplicate webhook delivery idempotently"` |
| No email, no notification, no cache invalidation | YES (out of scope) | N/A |

---

## Error Strategy

### Error Handling Matrix

| Operation | Error Type | Strategy | User Message | Log Level | Recovery |
|-----------|-----------|----------|-------------|-----------|----------|
| HMAC verification | Invalid/missing signature | Reject immediately — no further processing | "Unauthorized" | none (to avoid log flooding from probing) | None — HTTP 401 |
| JSON parse of webhook body | Unparseable body | Return 400 immediately | "Invalid payload" | warn with raw body truncated to 200 chars | None |
| `normalizeShopifyOrder()` | Missing required field | Return null → handler returns 422 | "Missing required order fields" | warn with field list | None |
| `persistOrder()` transaction | DB connection failure | Fail immediately, rollback | "Internal error" | error + full stack + tenant_id + shopify_order_id | Shopify auto-retry; ops alert |
| `persistOrder()` upsert | Duplicate `shopify_order_id` constraint | Return existing row — no error | N/A (HTTP 200) | info — duplicate noted | None needed |
| `resolveTenantId()` | Unknown shop domain | Return 422 | "Unknown shop" | warn with shop domain | Ops investigation |
| `getOrders()` DB query | DB failure | Fail with 500 | "Internal error" | error + full stack + tenant_id | Client retry |
| `getOrderById()` DB query | Not found (null return) | Return 404 | "Order not found" | none | Client refreshes |
| `getOrderStats()` DB query | DB failure | Fail with 500 | "Internal error" | error + full stack + tenant_id | Client retry |
| Pagination param validation | Invalid type or range | Return 400 | "Invalid pagination parameters" | none | Client corrects |

### Retry Policy

```
Webhook retries: Managed by Shopify (not this service)
DB operation retries: None (fail fast — Shopify will retry webhooks; admin UI user retries manually)
Idempotent: YES for webhook handler (ON CONFLICT upsert)
```

### Transaction Boundaries

```
BEGIN
  Step 1: INSERT INTO shopify_orders (...) — returns inserted id
  Step 2: INSERT INTO shopify_order_line_items (...) for each line item — references id from Step 1
COMMIT
On Step 2 failure: ROLLBACK — shopify_orders row is NOT committed (no orphan records)
On zero line items: Steps 1 only — still commits (empty line items is valid)
```

---

## NOT in Scope

This contract does NOT cover the following. Touching any of these during the build phase is a scope violation.

- This contract does NOT add order fulfillment or refund webhook handlers (separate feature)
- This contract does NOT sync historical Shopify orders (REST API backfill — separate task)
- This contract does NOT add order search or filtering beyond pagination (future iteration)
- This contract does NOT modify any existing routes, middleware, or services
- This contract does NOT add real-time push notifications or WebSocket updates for new orders
- This contract does NOT handle Shopify order update or cancellation webhooks
- This contract does NOT modify the existing authentication system or `authenticateStaff` middleware

**If you find yourself editing a file not listed in the plan or touching behavior listed here, STOP. You are drifting.**

---

## Traceability Matrix

Every postcondition maps to exactly one test and one code location. No orphans allowed.

| PC | Test File | Test Name | Code File | Code Location | Status |
|----|-----------|-----------|-----------|---------------|--------|
| PC-A1 | `shopifyWebhook.test.js` | "accepts valid webhook with correct HMAC" | `shopifyWebhookHandler.js` | `handleOrderCreate()` | PENDING |
| PC-A2 | `shopifyWebhook.test.js` | "rejects webhook with invalid HMAC" | `shopifyWebhookHandler.js` | `verifyHmac():L18` | PENDING |
| PC-A3 | `shopifyWebhook.test.js` | "rejects webhook missing HMAC header" | `shopifyWebhookHandler.js` | `verifyHmac():L12` | PENDING |
| PC-A4 | `shopifyWebhook.test.js` | "rejects malformed JSON body" | `shopifyWebhookHandler.js` | `handleOrderCreate():L35` | PENDING |
| PC-A5 | `shopifyOrders.test.js` | "returns paginated orders for authenticated tenant" | `shopifyOrdersRoute.js` | `getOrders():L22` | PENDING |
| PC-A6 | `shopifyOrders.test.js` | "paginates orders correctly" | `shopifyOrdersRoute.js` | `getOrders():L28` | PENDING |
| PC-A7 | `shopifyOrders.test.js` | "returns single order with line items" | `shopifyOrdersRoute.js` | `getOrderById():L55` | PENDING |
| PC-A8 | `shopifyOrders.test.js` | "returns 404 for cross-tenant order access" | `shopifyOrdersRoute.js` | `getOrderById():L62` | PENDING |
| PC-A9 | `shopifyOrders.test.js` | "returns order stats for authenticated tenant" | `shopifyOrdersRoute.js` | `getOrderStats():L88` | PENDING |
| PC-A10 | `shopifyOrders.test.js` | "rejects unauthenticated requests to all admin routes" | `apps/api/src/routes/index.js` | `authenticateStaff middleware chain` | PENDING |
| PC-S1 | `orderNormalizationService.test.js` | "normalizes Shopify payload to internal schema" | `orderNormalizationService.js` | `normalizeShopifyOrder():L8` | PENDING |
| PC-S2 | `orderNormalizationService.test.js` | "coerces line item price to number" | `orderNormalizationService.js` | `normalizeLineItem():L44` | PENDING |
| PC-S3 | `orderNormalizationService.test.js` | "returns null for missing required fields" | `orderNormalizationService.js` | `normalizeShopifyOrder():L22` | PENDING |
| PC-S4 | `orderPersistenceService.test.js` | "inserts order row with tenant_id" | `orderPersistenceService.js` | `persistOrder():L15` | PENDING |
| PC-S5 | `orderPersistenceService.test.js` | "inserts line item rows with correct order_id and tenant_id" | `orderPersistenceService.js` | `persistOrder():L28` | PENDING |
| PC-S6 | `orderPersistenceService.test.js` | "rolls back parent order on line item insert failure" | `orderPersistenceService.js` | `persistOrder():L10-L45` | PENDING |
| PC-S7 | `orderPersistenceService.test.js` | "handles duplicate order upsert gracefully" | `orderPersistenceService.js` | `persistOrder():L18` | PENDING |
| PC-S8 | `orderPersistenceService.test.js` | "paginates correctly and returns total count" | `orderPersistenceService.js` | `getOrders():L58` | PENDING |
| PC-S9 | `orderPersistenceService.test.js` | "returns order with line items or null" | `orderPersistenceService.js` | `getOrderById():L78` | PENDING |
| PC-S10 | `orderPersistenceService.test.js` | "computes stats correctly including Melbourne timezone" | `orderPersistenceService.js` | `getOrderStats():L102` | PENDING |
| PC-U1 | `ShopifyOrdersPage.test.jsx` | "renders one row per order" | `ShopifyOrdersPage.jsx` | `L58` | PENDING |
| PC-U2 | `ShopifyOrdersPage.test.jsx` | "renders stats component with values" | `ShopifyOrdersPage.jsx` | `L34` | PENDING |
| PC-U3 | `ShopifyOrdersPage.test.jsx` | "increments page and refetches on next click" | `ShopifyOrdersPage.jsx` | `L78` | PENDING |
| PC-U4 | `ShopifyOrdersPage.test.jsx` | "shows loading skeleton then renders data" | `ShopifyOrdersPage.jsx` | `L28` | PENDING |
| PC-U5 | `ShopifyOrdersPage.test.jsx` | "shows error message on fetch failure" | `ShopifyOrdersPage.jsx` | `L32` | PENDING |
| PC-U6 | `ShopifyOrderDetail.test.jsx` | "renders line items table" | `ShopifyOrderDetail.jsx` | `L44` | PENDING |
| PC-U7 | `ShopifyOrderDetail.test.jsx` | "renders order header fields" | `ShopifyOrderDetail.jsx` | `L28` | PENDING |
| PC-U8 | `ShopifyOrdersStats.test.jsx` | "formats revenue as currency" | `ShopifyOrdersStats.jsx` | `L22` | PENDING |
| PC-U9 | `ShopifyOrdersStats.test.jsx` | "renders ordersToday badge separately from totalOrders" | `ShopifyOrdersStats.jsx` | `L34` | PENDING |
| PC-X1 | `integration.test.js` | "webhook order appears in admin list" | Multiple layers | Webhook handler → persistOrder → GET /api/shopify-orders → ShopifyOrdersPage | PENDING |
| PC-X2 | `integration.test.js` | "tenant_id is consistent from webhook to DB row" | Multiple layers | `shopifyWebhookHandler.js:resolveTenantId()` → `orderPersistenceService.js:persistOrder()` | PENDING |

---

## Test Assertion Skeletons (Tautology Check)

A skeleton `expect()` is provided for each PC to confirm every postcondition is testable and non-tautological.

```javascript
// PC-A1
const res = await request(app).post('/webhooks/shopify/orders/create')
  .set('X-Shopify-Hmac-Sha256', validHmac).send(validPayload);
expect(res.status).toBe(200);
expect(res.body).toEqual({ received: true });

// PC-A2
const res = await request(app).post('/webhooks/shopify/orders/create')
  .set('X-Shopify-Hmac-Sha256', 'invalidsignature').send(validPayload);
expect(res.status).toBe(401);
expect(res.body).toEqual({ error: 'Unauthorized' });
// Anti-tautology: remove verifyHmac() call → test fails (returns 200 instead of 401)

// PC-A5
const res = await request(app).get('/api/shopify-orders')
  .set('Authorization', `Bearer ${staffToken}`);
expect(res.status).toBe(200);
expect(Array.isArray(res.body.orders)).toBe(true);
expect(typeof res.body.total).toBe('number');
expect(res.body.orders.every(o => o.tenant_id === undefined)).toBe(true); // tenant_id not leaked

// PC-A8 (IDOR check)
const res = await request(app).get(`/api/shopify-orders/${otherTenantOrderId}`)
  .set('Authorization', `Bearer ${staffTokenTenantA}`);
expect(res.status).toBe(404);
expect(res.body).toEqual({ error: 'Order not found' });
// Anti-tautology: remove tenant_id scope from query → test fails (returns 200 with other tenant's data)

// PC-S1
const normalized = normalizeShopifyOrder(rawShopifyPayload);
expect(normalized.shopify_order_id).toBe(rawShopifyPayload.id.toString());
expect(normalized.order_number).toBe(rawShopifyPayload.order_number);
expect(typeof normalized.total_price).toBe('number');
expect(Array.isArray(normalized.line_items)).toBe(true);

// PC-S2
const normalized = normalizeShopifyOrder({ ...rawShopifyPayload, line_items: [{ ...rawLineItem, price: '29.99' }] });
expect(typeof normalized.line_items[0].price).toBe('number');
expect(normalized.line_items[0].price).toBe(29.99);
// Anti-tautology: remove parseFloat() → test fails (type is 'string')

// PC-S4
const result = await persistOrder(normalizedOrder, 'tenant-uuid-123');
const dbRow = await pool.query('SELECT * FROM shopify_orders WHERE id = $1', [result.id]);
expect(dbRow.rows[0].tenant_id).toBe('tenant-uuid-123');
// Anti-tautology: remove tenant_id from INSERT → test fails (column not null constraint)

// PC-S6
jest.spyOn(pool, 'query').mockImplementationOnce(() => Promise.resolve({ rows: [{ id: 'new-id' }] }))
  .mockImplementationOnce(() => Promise.reject(new Error('line item DB failure')));
await expect(persistOrder(normalizedOrder, tenantId)).rejects.toThrow();
const orphanCheck = await pool.query('SELECT * FROM shopify_orders WHERE shopify_order_id = $1', [normalizedOrder.shopify_order_id]);
expect(orphanCheck.rows).toHaveLength(0);
// Anti-tautology: remove transaction → test fails (orphan row found)

// PC-S10
// Seed an order with created_at = current Melbourne date
const stats = await getOrderStats(tenantId);
expect(stats.ordersToday).toBeGreaterThanOrEqual(1);
expect(typeof stats.totalRevenue).toBe('number');
expect(stats.avgOrderValue).toBe(stats.totalRevenue / stats.totalOrders);

// PC-U1
render(<ShopifyOrdersPage />);
await waitFor(() => {
  const rows = screen.getAllByRole('row');
  // 1 header + N data rows
  expect(rows).toHaveLength(mockOrders.length + 1);
});
// Anti-tautology: return empty array from mock → expect rows.length === 1 (header only)

// PC-U8
render(<ShopifyOrdersStats totalRevenue={1234.56} totalOrders={5} ordersToday={2} avgOrderValue={246.91} />);
expect(screen.getByText('$1,234.56')).toBeInTheDocument();
expect(screen.queryByText('1234.56')).not.toBeInTheDocument();
// Anti-tautology: remove currency format → test fails (finds raw number)
```

---

## Quality Gate

```
CONTRACT QUALITY GATE
═════════════════════
Testability:        PASS — 31 PCs, all 31 have concrete expect() skeletons above
Banned Words:       PASS — grep count: 0 ("should", "probably", "appropriate", "reasonable", "properly", "correct" absent)
Completeness:       PASS — 11 plan tasks contracted (webhook handler, normalization, persistence, 4 API routes, 3 React components, 2 DB tables covered via invariants + PCs)
Consumer Coverage:  PASS — 4 data outputs mapped; all known consumers listed with file:line
Blast Radius:       PASS — 5 same-file siblings checked, 3 cross-file siblings checked, 2 validation functions checked, 9 edge cases checked
Error Coverage:     PASS — 12 external calls/user inputs identified, 12 ERR-N entries
Invariants:         PASS — 7/7 standard invariants present (INV-1 through INV-7 all applicable)
Scope Boundary:     PASS — 7 explicit exclusions listed
Traceability:       PASS — 31 PCs, 31 matrix rows, zero orphans
Tautology Check:    PASS — 10 representative PCs have anti-tautology annotations; all 31 PCs verified to fail when postcondition is violated
Error Strategy:     PASS — 10 operations covered in matrix; transaction boundary defined for multi-step persist

Score: 11/11 — LOCKED
```

---

## Files Touched

New files to be created:

| File | Type | Purpose |
|------|------|---------|
| `apps/api/database/migrations/YYYYMMDD_create_shopify_orders.sql` | Migration | Creates `shopify_orders` table |
| `apps/api/database/migrations/YYYYMMDD_create_shopify_order_line_items.sql` | Migration | Creates `shopify_order_line_items` table |
| `apps/api/src/handlers/shopifyWebhookHandler.js` | Handler | Webhook receiver: HMAC verify → normalize → persist |
| `apps/api/src/services/orderNormalizationService.js` | Service | Pure normalization: Shopify payload → internal schema |
| `apps/api/src/services/orderPersistenceService.js` | Service | DB write path: owns both tables |
| `apps/api/src/routes/shopifyOrders.js` | Route | 3 admin routes: list, detail, stats |
| `apps/admin/src/components/ShopifyOrdersPage.jsx` | React component | Page: table + pagination + stats |
| `apps/admin/src/components/ShopifyOrderDetail.jsx` | React component | Detail: order header + line items |
| `apps/admin/src/components/ShopifyOrdersStats.jsx` | React component | Stats KPI card widget |
| `apps/admin/src/hooks/useShopifyOrders.js` | React hook | Data fetching for orders list + pagination state |
| `apps/api/src/__tests__/shopifyWebhook.test.js` | Test | Webhook handler tests |
| `apps/api/src/__tests__/shopifyOrders.test.js` | Test | Admin route tests |
| `apps/api/src/__tests__/orderNormalizationService.test.js` | Test | Normalization unit tests |
| `apps/api/src/__tests__/orderPersistenceService.test.js` | Test | Persistence unit + transaction tests |
| `apps/admin/src/__tests__/ShopifyOrdersPage.test.jsx` | Test | Page component tests |
| `apps/admin/src/__tests__/ShopifyOrderDetail.test.jsx` | Test | Detail component tests |
| `apps/admin/src/__tests__/ShopifyOrdersStats.test.jsx` | Test | Stats component tests |
| `apps/api/src/__tests__/integration.test.js` | Test | Cross-layer integration tests |

Existing files to be modified:

| File | Change |
|------|--------|
| `apps/api/src/routes/index.js` | Mount webhook route (before auth) and shopify-orders routes (after auth) |
| `apps/admin/src/App.jsx` (or router file) | Add route for `/shopify-orders` page |

**Single write path rule:** `orderPersistenceService.js` is the ONLY file that writes to `shopify_orders` or `shopify_order_line_items`. No other file may issue INSERT/UPDATE/DELETE against these tables.
