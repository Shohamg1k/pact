# Decisions — leave-management-200

Completeness score: **0.72**

## Stack
- MERN (db: mongodb, api: express)

## Assumptions (brief was silent — recorded, not guessed)
- **AS-01** (confidence 0.55, source: brief-silence): Every employee has exactly one manager, identified by manager_id; the brief gives no org-chart detail beyond "a company of 200 employees", so a flat one-level approval chain is assumed rather than multi-level escalation.
- **AS-02** (confidence 0.5, source: domain-norm): Each employee gets a fixed annual allotment of 20 paid leave days, decremented on approval, not on request — a rejected or pending request never touches the balance.
- **AS-03** (confidence 0.7, source: domain-norm): A request cannot be approved if it would take the balance negative; the API returns 409 rather than silently allowing an overdraw.
- **AS-04** (confidence 0.5, source: brief-silence): Authentication is a bearer token whose payload carries the employee_id and role (employee|manager); the brief specifies no auth mechanism.

## Business rules
- BR-01: Every endpoint requires a valid bearer token; missing or invalid returns 401.
- BR-02: An employee can only see and act on their own requests; a manager can additionally see requests where they are the named manager_id.
- BR-03: A leave request needs a start_date, end_date, and reason; end_date before start_date is 422.
- BR-04: Only a pending request can be approved or rejected; acting on an already-decided request returns 409.
- BR-05: Approving a request that would exceed the remaining balance returns 409 and does not decrement anything.
- BR-06: A manager cannot approve or reject their own request, even if it happens to route through their own manager_id by data error — checked explicitly, not assumed impossible.

## Gaps (BLOCKED_ON_UPSTREAM — dropped after repair, needs human follow-up)
- BR-01/AS-04: no identity provider is named for issuing the bearer token, so middleware/auth.js verifies with HS256 when JWT_SECRET is set, and otherwise falls back to accepting any structurally valid unexpired token carrying employee_id and role — the same documented posture as the notes-api demo project.
