# Decisions — restaurant-inventory

Completeness score: **0.7**

## Stack
- MERN (db: mongodb, api: express)

## Assumptions (brief was silent — recorded, not guessed)
- **AS-01** (confidence 0.55, source: brief-silence): Each item has a single reorder_threshold set at creation; the brief says "low-stock alerts" but not who configures the threshold, so it is assumed to be set per-item by whoever adds it, not a global setting.
- **AS-02** (confidence 0.75, source: domain-norm): current_stock is a derived, server-maintained field — never written directly by a client — updated only by posting a stock_movements record, so the audit trail and the live count can never drift apart.
- **AS-03** (confidence 0.5, source: brief-silence): Supplier orders are out of scope for this pass: the brief's "supplier orders" is read as a signal for WHICH items are low, not a requirement to model purchase orders/suppliers as their own entities yet.
- **AS-04** (confidence 0.5, source: brief-silence): Authentication is a bearer token; the brief specifies no auth mechanism for a presumed single-location back-office tool.

## Business rules
- BR-01: Every endpoint requires a valid bearer token; missing or invalid returns 401.
- BR-02: A stock movement of type "out" cannot take current_stock below zero — rejected with 409, nothing is written.
- BR-03: current_stock is only ever changed by creating a stock_movements record (BR-... AS-02); there is no direct PATCH on an item's stock field.
- BR-04: An item name must be unique (case-insensitive) — creating a duplicate returns 409.
- BR-05: The low-stock list (API-04) returns items where current_stock <= reorder_threshold, ordered most-deficient first.

## Gaps (BLOCKED_ON_UPSTREAM — dropped after repair, needs human follow-up)
- BR-01/AS-04: no identity provider is named, so middleware/auth.js uses the same HS256-if-configured, else structurally-valid-token fallback as the other demo projects.
- AS-03: supplier orders are not modelled as their own entity in this pass — the low-stock endpoint (API-04) is the signal a real supplier-ordering feature would consume, not a purchase-order system itself.
