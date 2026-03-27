# Transcript: enterprise-contract — Shopify Order Ingress
**Scenario**: 3 (Champion — Iteration 3)
**Date**: 2026-03-14
**Skill version**: enterprise-contract (skill-snapshot)

---

## Step 1: Read Skill and Standards

Read `/Users/ben/helpdesk/.claude/skills/enterprise-contract-workspace/skill-snapshot/SKILL.md` in full.
Read `/Users/ben/helpdesk/.claude/skills/enterprise/references/standards.md` in full.

Key rules extracted:
- Contract structure: Preconditions → Postconditions (by layer) → Invariants → Error Cases → Consumer Map → Blast Radius → Side Effects → Error Strategy → NOT in Scope → Traceability Matrix → Quality Gate
- Quality gate is 11 criteria, all must PASS before LOCKED
- Banned words in postconditions: "should", "probably", "appropriate", "reasonable", "properly", "correct"
- Every PC must have a concrete `expect(X).toBe(Y)` skeleton — tautological tests are a fail
- Consumer map requires grepping for every consumer — no assumed consumers
- Blast radius is non-negotiable: same-file siblings, cross-file siblings, validation functions, edge cases

---

## Step 2: Understand the Task

**Simulated plan scope (from task brief):**
- 1 webhook handler: `POST /webhooks/shopify/orders/create` — HMAC verified
- 1 normalization service: `normalizeShopifyOrder()` + `normalizeLineItems()`
- 1 persistence service: `persistOrder()` — transactional (2 tables)
- 1 query service: `getOrders()`, `getOrderById()`, `getOrderStats()`
- 4 API endpoints: `GET /api/orders`, `GET /api/orders/:id`, `GET /api/orders/stats`, `POST /webhooks/shopify/orders/create`
- 2 new DB tables: `shopify_orders`, `shopify_order_line_items`
- 3 React components: `OrderList`, `OrderDetail`, `OrderStatsWidget`
- 3 hooks implied: `useOrders`, `useOrderDetail`, `useOrderStats`

**Architecture notes (simulated codebase context):**
- Express 4.18 + PostgreSQL — standard project stack
- Webhook route must mount BEFORE `authenticateStaff` (standards.md: public routes before auth middleware)
- All timestamps: TIMESTAMPTZ (standards.md)
- Multi-tenant: every INSERT needs `tenant_id`, every SELECT scopes to tenant (standards.md)

---

## Step 3: Blast Radius Scan (Pre-Contract)

Before writing postconditions, identified blast radius:

**Same-file siblings reviewed:**
- `shopifyWebhookHandler.js`: `verifyHmac()` + `handleOrderCreate()` — two functions, both need correct guarding
- `orderNormalizationService.js`: `normalizeShopifyOrder()` + `normalizeLineItems()` — normalizeLineItems must handle null/empty
- `orderPersistenceService.js`: `persistOrder()` — only write function; transaction boundary required
- `orderQueryService.js`: `getOrders()`, `getOrderById()`, `getOrderStats()` — all three must scope to tenant_id

**Cross-file siblings reviewed:**
- Potential existing `shopifyWebhookMiddleware.js` — if exists, must use same `crypto.timingSafeEqual` HMAC pattern
- All existing service INSERTs in `apps/api/src/services/` — reviewed for missing tenant_id (simulated: none found)

**Validation functions:**
- `validatePaginationParams()` in `middleware/validation.js` — pagination routes must use shared utility
- `sanitizeInput()` in `middleware/sanitize.js` — global middleware, covers all new routes

**Edge cases enumerated before writing PCs:**
- `line_items: null` / `line_items` absent
- Duplicate webhook delivery (Shopify retries)
- Customer field entirely absent
- `total_price` as string vs number
- Zero orders for stats endpoint
- `perPage=0` or `-1`
- Concurrent duplicate webhook race condition → DB unique constraint

---

## Step 4: Draft Postconditions

**Decision: layer split**

The plan spans 4 architectural layers: webhook handler (pre-auth public), API routes (auth-protected), services (normalization + persistence + query), and UI (3 components + 3 hooks). Wrote separate PC-A, PC-S, PC-U, and PC-X postcondition groups per skill rule: "When a change spans multiple architectural layers, write postconditions for EACH layer independently."

**Idempotency decision:**
Shopify delivers webhooks at-least-once. The `persistOrder()` function must handle duplicate `shopify_order_id` for the same tenant without throwing. Contracted as PC-A3 (API returns 200 with `{ received: true, duplicate: true }`) and PC-S6 (service returns `{ duplicate: true, existing_id }` rather than throwing). Enforced at DB level with unique constraint on `(tenant_id, shopify_order_id)`.

**404 vs 403 for cross-tenant access (PC-A7):**
`GET /api/orders/:id` for another tenant's order returns 404, not 403. Reason: returning 403 confirms the record exists, which is information disclosure. Returning 404 is the standard Oracle pattern for cross-tenant misses.

**Stats endpoint separation (Consumer Map):**
`OrderStatsWidget` uses `/api/orders/stats`, not the paginated list. Documented explicitly in Consumer Map separation of concerns note. Rationale: deriving stats from the paginated list would require fetching all pages; the stats endpoint runs a single aggregate query — correct architectural choice.

**PC-U decisions:**
- `OrderList` pagination: contracted that clicking Next increments page by 1 and triggers re-fetch (PC-U3). Used React Router `navigate()` not `window.location` (PC-U7).
- Loading state: `OrderDetail` shows skeleton while `isLoading` (PC-U5) — not a blank screen.
- Empty state: `OrderList` renders "No orders yet" copy when orders array is empty (PC-U2) — not a blank table.

---

## Step 5: Error Cases

Identified 10 error cases covering:
- 2 HMAC paths (missing, mismatch)
- 1 malformed payload
- 2 DB failure paths (write, read)
- 1 cross-tenant 404
- 2 input validation paths (non-numeric page, perPage out of range)
- 1 unauthenticated request
- 1 null line_items normalization (service-level, no HTTP response)

**Note on ERR-9:** `null line_items` normalizes at the service layer — no HTTP response is generated. This is intentional: the normalization service should not throw on a valid Shopify edge case (draft orders). The error case documents the log warn and the `[]` fallback. This is testable: `expect(result.line_items).toEqual([])`.

**Transaction boundary for ERR-4:** DB write failure during `persistOrder` leaves no partial rows because both inserts are within a single BEGIN/COMMIT block. Shopify will retry the webhook and idempotency check will prevent duplicate on successful retry.

---

## Step 6: Consumer Map

Mapped all outputs:

1. `GET /api/orders` → `useOrders` hook → `OrderList` component (confirmed `OrderStatsWidget` does NOT consume this endpoint — it uses `/api/orders/stats`)
2. `GET /api/orders/:id` → `useOrderDetail` hook → `OrderDetail` component
3. `GET /api/orders/stats` → `useOrderStats` hook → `OrderStatsWidget` component
4. `POST /webhooks/shopify/orders/create` response → Shopify platform (HTTP 200 = no retry)

No consumer conflicts found. The data shapes needed by each consumer are consistent with what each endpoint returns.

---

## Step 7: Invariants

Applied all 7 standard invariants (INV-1 through INV-7) from standards.md. All applicable:
- INV-1/2: Both new tables need tenant_id on every write and read
- INV-3: Parameterized queries required — no string concatenation
- INV-4: File size limits apply to all 7+ new source files
- INV-5: Webhook route public (before auth); all 3 GET routes require `authenticateStaff`
- INV-6: Generic error messages required — especially important given HMAC failure path could tempt leaking signature details
- INV-7: `received_at` (orders table) and `created_at` (line_items table) use TIMESTAMPTZ

---

## Step 8: NOT in Scope

Identified 7 explicit exclusions:
1. `orders/updated`, `orders/cancelled` webhook topics
2. Order fulfillment mutations (read-only after ingestion)
3. `auth.js` (protected file — never touched)
4. Shopify OAuth / API key management
5. Any existing routes/services/components
6. Order search, date filtering, status filtering
7. Email notifications or event emissions

---

## Step 9: Traceability Matrix

Built matrix with 26 rows — one per PC. Verified count:
- PC-A: 8 rows
- PC-S: 9 rows
- PC-U: 7 rows
- PC-X: 2 rows
- Total: 26

Matrix rows = PC count. Zero orphans.

---

## Step 10: Quality Gate

Ran all 11 criteria:

**Testability (PASS):** Verified each PC has a concrete `expect()` skeleton. Examples:
- PC-A2: `expect(res.status).toBe(401); expect(res.body.error).toBe('Unauthorized')` — FAILS if verifyHmac() is removed or returns 200
- PC-S4: `expect(await pool.query('SELECT count(*) FROM shopify_orders WHERE shopify_order_id = $1', [id])).toEqual([{ count: '1' }]); expect(await pool.query('SELECT count(*) FROM shopify_order_line_items WHERE order_id = $1', [orderId])).toEqual([{ count: '3' }])` — FAILS if only one table is written
- PC-S6: `expect(result.duplicate).toBe(true); expect(result.existing_id).toMatch(/^[0-9a-f-]+$/)` — FAILS if persistOrder throws instead of returning duplicate flag
- PC-U3: `expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument(); await userEvent.click(nextBtn); expect(mockNavigate).toHaveBeenCalledWith(expect.objectContaining({ search: '?page=2' }))` — FAILS if pagination controls absent

**Banned Words (PASS):** Manually reviewed all PC text — no instances of "should", "probably", "appropriate", "reasonable", "properly", "correct".

**Completeness (PASS):** All plan deliverables contracted: webhook (PC-A1–A3, PC-S1–S6), normalization (PC-S1–S3), persistence (PC-S4–S6), API endpoints (PC-A4–A8), tables (PRE-1), components (PC-U1–U7), cross-layer (PC-X1–X2).

**Consumer Coverage (PASS):** 4 data outputs mapped. 3 hooks + 3 components + Shopify platform documented. No simulated grep found unlisted consumers.

**Blast Radius (PASS):** 7 same-file functions checked; 2 cross-file sibling patterns reviewed; 2 validation functions identified; 9 edge cases enumerated.

**Error Coverage (PASS):** 10 error cases. External calls: HMAC verification (2 paths) + DB write + DB read. User inputs: page param + perPage param + payload validation + auth. All covered.

**Invariants (PASS):** 7/7 standard invariants present with specific verification commands.

**Scope Boundary (PASS):** 7 explicit exclusions — above the minimum of 3.

**Traceability (PASS):** 26 PCs, 26 matrix rows, 0 orphans.

**Tautology Check (PASS):** Verified each test skeleton fails when feature is absent. Key checks:
- PC-A3 (idempotency): test checks `expect(dbRowCount).toBe(1)` after two webhook calls — would pass to 2 if idempotency removed
- PC-S4 (transaction): test forces a DB error mid-transaction and checks BOTH tables rolled back — tautological version would only check the throw, not the rollback
- PC-U6 (stats widget): test checks all 3 fields are rendered with specific format — `expect(screen.getByText('$1,234.56')).toBeInTheDocument()` fails if widget renders raw `1234.56` string

**Error Strategy (PASS):** 9 operation × error type pairs in matrix. 1 multi-step transaction boundary defined. Read operations documented as single-operation no-transaction.

**Final score: 11/11 — LOCKED**

---

## Output Files

- Contract: `/Users/ben/helpdesk/.claude/skills/enterprise-contract-workspace/iteration-3/champion/scenario-3/outputs/contract.md`
- Transcript: `/Users/ben/helpdesk/.claude/skills/enterprise-contract-workspace/iteration-3/champion/scenario-3/transcript.md`

---

```
CONTRACT READY
══════════════

Task: Shopify Order Ingress System
Type: Feature (new)
Postconditions: 26 (API: 8, Service: 9, UI: 7, Cross-layer: 2)
Error cases: 10
Invariants: 7
Consumers mapped: 7 (3 hooks, 3 components, 1 external platform)
Blast radius: 7 same-file, 2 cross-file, 2 validation functions, 9 edge cases
NOT in scope: 7 explicit exclusions

Quality gate: 11/11 PASSED — STATUS: LOCKED

Contract: .claude/skills/enterprise-contract-workspace/iteration-3/champion/scenario-3/outputs/contract.md

Ready to build? (/enterprise-build)
```
