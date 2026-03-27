# Execution Transcript: Scenario 3 — Shopify Order Ingress Contract

**Date**: 2026-03-14
**Skill**: enterprise-contract (challenger iteration-1)
**Scenario**: New feature — Shopify order ingress system

---

## Step 1: Read the Skill and References

**Skill section followed**: "Before You Start" (steps 1–5)

Read four documents in parallel:
1. `SKILL.md` — understood the full contract pipeline: Before You Start, Contract Structure, Quality Gate, Locking
2. `references/standards.md` — extracted the 7 standard invariants (INV-1 through INV-7) and the route-order rule (public routes before `authenticateStaff`)
3. `references/quality-gate.md` — extracted all 11 quality gate checks and their pass criteria
4. `references/bugfix-contract-template.md` — confirmed this scenario is a **feature** (not a bug fix), so the bugfix template does not apply

Key decisions made at this stage:
- This is a feature contract, not a bug fix contract → use standard contract structure
- The webhook route is explicitly public (HMAC-verified) → must mount before `authenticateStaff` → INV-5 applies with justification
- Shopify sends prices as strings → do not coerce to number in normalisation
- The prompt specifies 4 API endpoints, 2 tables, 1 webhook handler, 3 React components — these are the coverage targets for the Completeness check

---

## Step 2: Understand the Scope (simulated plan read)

**Skill section followed**: "Before You Start" step 1 (Read the plan)

Since no actual plan file exists (simulation), I derived the plan structure from the prompt description:

| Plan Task | Component |
|-----------|-----------|
| T1 | DB migration: `shopify_orders` table |
| T2 | DB migration: `shopify_order_line_items` table |
| T3 | Webhook receiver `POST /webhooks/shopify/orders` with HMAC verification |
| T4 | Order normalisation service (`shopifyOrderService.normalizeOrder`) |
| T5 | DB persistence service (`shopifyOrderService.persistOrder`) |
| T6 | `GET /api/orders` — list endpoint |
| T7 | `GET /api/orders/:id` — detail endpoint |
| T8 | `GET /api/orders/:id/line-items` — line items endpoint |
| T9 | `POST /api/orders/:id/resync` — resync endpoint |
| T10 | React: `OrdersPanel`, `OrderDetailDrawer`, `OrderLineItemsTable` |

10 tasks total → 10 contracted → Completeness check PASSES.

---

## Step 3: Blast Radius Scan

**Skill section followed**: "Blast Radius Scan" section

Since there is no actual codebase to grep, I simulated the grep by reasoning about the architecture from the prompt and the CLAUDE.md project context (Express 4.18, PostgreSQL, React + Vite, multi-tenant).

**Same-file siblings identified**:
- `shopifyOrderService.js` will contain 6 functions; all 6 share the tenant-scoping pattern → each must be independently contracted
- Noted that any future webhook handlers in `apps/api/src/routes/webhooks/` inherit the same HMAC-verify obligation

**Cross-file siblings identified**:
- Existing services (e.g. `productService.js`) use the same `pool.query` + `tenant_id` pattern → new service must match
- Existing panel components (e.g. `ProductsPanel`) set the loading/error/empty-state convention → new components must match

**Validation functions**:
- `verifyShopifyHmac` middleware must use `crypto.timingSafeEqual` (not `===`) — this is a security requirement, not a style preference
- Pagination validation must be strict (parseInt + range check), not silent coercion

**Edge cases enumerated**: 9 edge cases covering duplicate webhooks, zero line items, string prices, invalid UUIDs, XSS payloads, null email, resync-after-delete, and boundary pagination values.

---

## Step 4: Write Preconditions

**Skill section followed**: "Preconditions" section

Listed 9 preconditions covering:
- DB migrations applied (both tables)
- `SHOPIFY_WEBHOOK_SECRET` env var set
- `authenticateStaff` middleware mounted
- Webhook route mounted BEFORE auth middleware (critical for INV-5 justification)
- HMAC middleware exported correctly
- Shopify configured to POST to the correct URL
- React admin can reach API

Decision: Preconditions are "not tested, assumed" per the skill — they document the environment requirements, not contract obligations.

---

## Step 5: Write Postconditions by Layer

**Skill section followed**: "Postconditions" section, including the table of layers (PC-A, PC-S, PC-U, PC-X)

Worked through each layer independently, per the skill's instruction: "Write postconditions for each layer independently."

**API layer (PC-A1–PC-A13)**: 13 postconditions
- Covered all 4 endpoints (list, detail, line items, resync) + webhook handler
- Each PC specifies exact HTTP status + exact response body shape — no vague language
- Cross-tenant access returns 404 (not 403) to avoid confirming record existence — security decision documented in PC-A8

**Service layer (PC-S1–PC-S9)**: 9 postconditions
- `persistOrder` transaction (PC-S3) — explicit rollback postcondition
- UPSERT on duplicate (PC-S4) — critical for webhook idempotency; Shopify retries on 5xx
- `normalizeOrder` is pure/side-effect-free (PC-S8) — contracts the absence of side effects
- `getLineItems` ownership delegation to `getOrderById` (PC-S7) — contracts the correct ownership check path

**UI layer (PC-U1–PC-U9)**: 9 postconditions
- Each component gets loading, error, and empty states contracted (PC-U2, PC-U3)
- Resync button success and failure paths contracted separately (PC-U8)
- Null guard on `orderId` contracted explicitly (PC-U9) — prevents fetch on drawer close

**Cross-layer (PC-X1–PC-X3)**: 3 postconditions
- PC-X1: same-transaction visibility (no eventual consistency)
- PC-X2: tenant isolation end-to-end
- PC-X3: cascade delete from orders to line items

Total: 32 postconditions.

---

## Step 6: Write Invariants

**Skill section followed**: "Invariants" section — "Read the 7 standard invariants (INV-1 through INV-7)... Include all 7."

All 7 applied to this feature. Key justifications:
- INV-5: Webhook route is public but justified (HMAC replaces session auth) → explicitly documented
- INV-7: Four TIMESTAMPTZ columns confirmed in the migration schema design

No invariants were marked N/A — all apply.

---

## Step 7: Write Error Cases

**Skill section followed**: "Error Cases" section — "For each: trigger, HTTP status, response body, log entry, recovery path, and test name."

Enumerated 13 error cases (ERR-1 through ERR-13):
- HMAC missing / mismatch (ERR-1, ERR-2) — returns 401 so Shopify does NOT retry (correct webhook behavior)
- Webhook JSON parse failure (ERR-3)
- DB transaction failure on persist (ERR-4) — returns 500 so Shopify DOES retry; UPSERT makes retries safe
- DB query failures for list/detail (ERR-5)
- 404 cases for all endpoints (ERR-6, ERR-7, ERR-8, ERR-12)
- Shopify API failures during resync (ERR-9 4xx, ERR-10 timeout, ERR-11 post-fetch DB fail)
- Invalid pagination params (ERR-12)
- UI-side resync failure (ERR-13) — documents the toast message text exactly

Decision on ERR-7 (cross-tenant access): Log a WARN (not ERROR) with tenant IDs — this is a security audit event but not an application error.

---

## Step 8: Write Consumer Map

**Skill section followed**: "Consumer Map" section — "For every data output, list every consumer... Every consumer found must appear in the map."

Identified 5 data outputs:
1. `POST /webhooks/shopify/orders` — write-only, no downstream consumers
2. `GET /api/orders` → consumed by `OrdersPanel` (list render + pagination)
3. `GET /api/orders/:id` → consumed by `OrderDetailDrawer`
4. `GET /api/orders/:id/line-items` → consumed by `OrderLineItemsTable`
5. `POST /api/orders/:id/resync` → consumed by `OrderDetailDrawer` resync handler

Also documented internal consumers of `shopifyOrderService` functions (the route handlers that call into the service). This prevents the "service changes, route breaks silently" failure mode.

---

## Step 9: Write Error Strategy

**Skill section followed**: "Error Strategy" section — "For every external call, user input, and state transition: error type, handling strategy, user message, log level, recovery path."

Defined:
- 2 transaction boundaries (webhook persist, resync)
- External call handling matrix (Shopify REST API + PostgreSQL pool)
- 4 user input validation points (page, limit, :id UUID, webhook body)

Key decision: Resync keeps the Shopify API call outside the DB transaction. If the API call fails, nothing is written. If the API call succeeds but the DB write fails, the order remains at its old version. This is the correct trade-off (no partial state) and is documented as intentional.

---

## Step 10: Write Side Effects

**Skill section followed**: "Side Effects" section

Listed 6 intentional side effects. Explicitly noted what does NOT have side effects (GET endpoints, normalizeOrder) — this is as important as documenting what does.

---

## Step 11: Write NOT in Scope

**Skill section followed**: "NOT in Scope" section — "At least 3 explicit exclusions."

Listed 6 exclusions (skill requires minimum 3):
1. Shopify OAuth / shop installation
2. Fulfillment updates back to Shopify
3. Real-time push (WebSockets/SSE)
4. `orders/delete` and `orders/cancelled` webhook topics
5. Bulk historical import
6. Refund line items and discount codes

These were chosen because they are the most likely scope-creep vectors during implementation — items that an engineer might "just add while they're in there."

---

## Step 12: Write Traceability Matrix

**Skill section followed**: "Traceability Matrix" section — "Every postcondition maps to exactly one test and one code location. Zero orphans."

Produced 32 rows in the matrix — one per postcondition. Each row specifies:
- Test file path
- Exact test name (usable as `test('...')` argument)
- Code file path
- Code location (line estimate and brief description)
- Status: PENDING (correct for a new feature pre-build)

All 32 PCs have matrix entries → zero orphans.

---

## Step 13: Run Quality Gate

**Skill section followed**: "Quality Gate" section — "Run all 11 objective checks... All 11 must pass."

| Check | Result | Evidence |
|-------|--------|---------|
| 1. Testability | PASS | All 32 PCs have named test assertions with concrete expected values (status codes, field names, exact strings) |
| 2. No Banned Words | PASS | Reviewed all postconditions — zero instances of "should", "probably", "appropriate", "reasonable", "properly", "correct" |
| 3. Completeness | PASS | 10 plan tasks → 10 contracted (all layers represented) |
| 4. Consumer Coverage | PASS | 5 data outputs; all consumers listed with file:line |
| 5. Blast Radius | PASS | 6 same-file function names + line estimates; 3 cross-file sibling categories; both sections populated |
| 6. Error Coverage | PASS | 7 external inputs/calls → 13 ERR-N entries (exceeds minimum) |
| 7. Invariants | PASS | 7/7 standard invariants listed, all marked APPLIES with justification |
| 8. Scope Boundary | PASS | 6 explicit NOT in Scope exclusions (exceeds minimum of 3) |
| 9. Traceability | PASS | 32 PCs → 32 matrix rows, zero orphans |
| 10. Tautology Check | PASS | All PCs assert specific field values/status codes; none would pass if the feature were deleted |
| 11. Error Strategy | PASS | 4 external calls + 4 user inputs = 8 operations; all in Error Strategy matrix |

Score: 11/11 → Contract LOCKED.

---

## Step 14: Lock the Contract

**Skill section followed**: "Locking the Contract" section

1. Status set to `LOCKED` in the contract header
2. Contract saved to `scenario-3/outputs/contract.md`
3. (Simulated) Memory save: contract `shopify-order-ingress-ownership-pilot` LOCKED, 32 postconditions, 13 error cases, 7 invariants
4. (Simulated) Postcondition registry JSON would be generated at `.claude/enterprise-state/shopify-order-ingress-ownership-pilot-postconditions.json`
5. (Simulated) Pipeline state JSON would be updated to mark contract stage complete

---

## Key Decisions Made During Execution

| Decision | Rationale |
|----------|-----------|
| Cross-tenant access returns 404 not 403 | Avoids confirming record existence to attackers; consistent with OWASP guidance |
| Webhook 401 on HMAC failure (not 200) | Shopify does not retry on 4xx — correct for auth failures. Shopify retries on 5xx — correct for transient DB failures (ERR-4) |
| UPSERT on duplicate `shopify_order_id` | Shopify guarantees at-least-once delivery; idempotency is required |
| Resync DB transaction excludes the Shopify API call | Avoids long-held transactions; DB atomicity covers only the write phase |
| `normalizeOrder` contracted as pure (PC-S8) | Isolates Shopify payload parsing from DB concerns; enables unit testing without DB |
| `getLineItems` delegates ownership check to `getOrderById` (PC-S7) | Single path for ownership verification; avoids duplicating the WHERE clause |
| Prices stored as strings (not numbers) | Shopify sends price as string (`"99.99"`); coercing to float risks precision loss |
| 6 NOT in Scope exclusions | Chose highest-probability scope-creep vectors to make the boundary explicit for the build phase |
