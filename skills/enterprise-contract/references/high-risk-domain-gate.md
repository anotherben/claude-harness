# High-Risk Domain Gate

Before locking a contract for high-risk work, identify the repo's source-of-truth docs for the affected domain.

Typical high-risk domains:

- money movement, refunds, billing, or payouts
- orders, fulfillment, inventory, or external sync
- auth, session, permissions, or tenant isolation
- privacy, regulated data, audit, or compliance scope
- user safety, irreversible mutation flows, or destructive repair/replay paths

Then answer these explicitly in the contract:

1. What is the proof-scope label?
2. Which mutation or control-flow legs are directly traced?
3. Which downstream consumers are directly checked?
4. Which return legs, replay paths, or rollback paths are directly checked?
5. What governing docs exist, and what remains inferred or deferred?
6. Which current source files and consumers were read?
7. Which real DB/live integration tests prove schema/query behavior without mocks?
8. Which E2E/headless browser checks prove user-visible workflows, including upload or PDF flows?

If any required leg remains untraced, the enterprise claim is `FAIL`.
