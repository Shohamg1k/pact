# Technical Specification — Personal Notes API

Contract id: `personal-notes-api` · Architecture schema `arch-contract/v1` (completeness 0.62) · Backend schema `backend/v1` (run `f79ac574`).

This document describes the system as actually specified by the Solution Architect and implemented by the Backend agent. Anything not traceable to those artifacts (or to the QA artifact) is listed under **Known gaps** rather than described.

---

## 1. Overview

A small MERN-stack HTTP API for personal notes. Four features are in scope:

| Feature | Description | Priority |
|---|---|---|
| F-01 | User authentication (register, login, session token) | must |
| F-02 | Create a personal note | must |
| F-03 | List own notes | must |
| F-04 | Delete own note | must |

Every note belongs to exactly one user. There is no sharing, collaboration, tagging, search, attachments, or editing (AS-03, AS-06). Delete is a soft delete (AS-04).

---

## 2. Architecture

### 2.1 Components

| Component | Role | Implements |
|---|---|---|
| Web client (React SPA) | Renders the note list and compose box, stores the JWT, attaches it to every `/api/notes` call. Holds no authorisation logic of its own — the server re-checks everything. **No frontend artifact was delivered; this component is described only in the architecture diagram.** | — |
| Auth module (`routes/auth.js`) | Registration and login. Hashes passwords, enforces email uniqueness, mints the JWT. | F-01, API-01, API-02, C-01 |
| Auth middleware (`middleware/auth.js`) | Sits in front of every `/api/notes` route. Verifies JWT signature and expiry, rejects with 401 before any handler runs, and pins `req.user.id` as the only source of `owner_id`. | BR-01, BR-02 |
| Notes service (`routes/notes.js`) | Create, list, fetch-one, soft-delete. Owner-scoped queries, body validation, pagination. | F-02, F-03, F-04, API-03…API-06, C-02 |
| MongoDB | Single instance holding `users` and `notes`. | C-01, C-02 |
| Node runtime host (`server.js`) | One Node process running the Express app. No queue, cache, or worker tier (AS-05). Stateless thanks to the JWT, so horizontal scaling behind a load balancer is possible if ever needed. | — |

### 2.2 Request flow

```
Note owner → Web client (React SPA)
  ├─ POST /api/auth/register | /api/auth/login  →  Auth module  →  MongoDB (users)
  └─ /api/notes/*  (Authorization: Bearer <jwt>)
        → Auth middleware  — 401 here if token missing/invalid/expired, handler never runs
        → Notes service (receives verified req.user.id)  →  MongoDB (notes)
```

The verified user id — never anything in the request body — becomes `owner_id` on writes and the filter on reads. This makes BR-02 true by construction rather than by discipline.

### 2.3 Source layout

| Path | Kind |
|---|---|
| `server.js` | entry (Express app, JSON parsing at 256 kb, route mounting, 404 + error handlers, Mongo connect, listen) |
| `models/User.js` | Mongoose model for C-01 |
| `models/Note.js` | Mongoose model for C-02, incl. `Note.liveFilter()` |
| `routes/auth.js` | API-01, API-02 |
| `routes/notes.js` | API-03, API-04, API-05, API-06 |
| `middleware/auth.js` | Bearer-token gate |
| `utils/token.js` | JWT sign/verify, TTL constant |
| `utils/validate.js` | All field and pagination validation |

### 2.4 Runtime configuration

| Variable | Required | Default | Notes |
|---|---|---|---|
| `MONGO_URL` | yes | — | Startup fails with `MONGO_URL is not set` if absent. |
| `PORT` | no | `3000` | |
| `JWT_SECRET` | effectively yes | `pact-local-development-secret` | Falls back to a hardcoded development string. Any deployed environment must set this — see Known gaps. |

Dependencies: `express ^5.1.0`, `mongoose ^8.9.5`, `bcryptjs ^2.4.3`, `jsonwebtoken ^9.0.2`.

---

## 3. Data model

### 3.1 `users` (C-01)

| Field | Type | Constraints |
|---|---|---|
| `_id` | ObjectId | primary key |
| `email` | string | required, unique, lowercased, trimmed, indexed |
| `password_hash` | string | required, bcrypt |
| `display_name` | string \| null | optional, max 80, trimmed, defaults to `null` |
| `created_at` | Date | required, defaults to now |

Uniqueness is declared both on the field and as an explicit unique index, so two concurrent registrations of the same email still end in exactly one account.

`toPublic()` projects a user to `{ id, email, display_name }` — `password_hash` is never serialised.

### 3.2 `notes` (C-02)

| Field | Type | Constraints |
|---|---|---|
| `_id` | ObjectId | primary key |
| `owner_id` | ObjectId | required, `ref: users`, indexed |
| `title` | string \| null | optional, max 200, trimmed, defaults to `null` |
| `body` | string | required, 1–10 000 chars, trimmed |
| `created_at` | Date | required, defaults to now |
| `updated_at` | Date | required, defaults to now |
| `deleted_at` | Date \| null | defaults to `null`; non-null means soft-deleted |

**Index:** compound `(owner_id: 1, deleted_at: 1, created_at: -1)` — covers the only read pattern the API has (one owner's live notes, newest first).

**`Note.liveFilter(ownerId, extra)`** returns `{ owner_id, deleted_at: null, ...extra }`. Every read and the delete use it, so ownership scoping and soft-delete exclusion cannot be forgotten independently of each other.

`toPublic()` projects a note to `{ id, title, body, created_at, updated_at }` with ISO-8601 timestamps. `owner_id` and `deleted_at` are never echoed on read paths.

---

## 4. Authentication

- **Password storage:** bcrypt, cost 12 (AS-07).
- **Token:** stateless JWT, payload `{ sub: <user id> }`, signed with `JWT_SECRET`, TTL 86 400 s (24 h).
- **Transport:** `Authorization: Bearer <token>` on every `/api/notes` route. The header is matched case-insensitively against `Bearer <token>`; anything else is a 401.
- **Rejection conditions (all yield an identical 401):** header absent, header not in `Bearer` form, signature invalid, token expired, `sub` missing or not a valid ObjectId.
- There is no logout, refresh, or revocation endpoint — a token is valid until it expires.

---

## 5. API reference

All requests and responses are JSON. The request body must be a JSON object (arrays and non-objects are treated as empty). Bodies are capped at 256 kb by the JSON parser.

### 5.1 Error envelopes

| Status | Shape |
|---|---|
| 401 | `{"error":"unauthorized","message":"A valid bearer token is required."}` (notes routes) / `{"error":"invalid_credentials","message":"Email or password is incorrect."}` (login) |
| 404 | `{"error":"not_found","message":"Note not found."}` (note routes) / `{"error":"not_found","message":"No such endpoint."}` (unknown route) |
| 409 | `{"error":"email_already_registered","message":"That email is already registered."}` |
| 422 | `{"error":"unprocessable_entity","details":[{"field":"<name>","message":"<why>"}]}` |
| 500 | `{"error":"internal_error"}` |

Malformed JSON is converted to a 422 with `details[0].field == "body"` — never a 500.

---

### API-01 · `POST /api/auth/register` (F-01)

**Request**

```json
{ "email": "ada@example.com", "password": "correct-horse", "display_name": "Ada" }
```

| Field | Rules |
|---|---|
| `email` | required, trimmed, lowercased, max 254, must match `<local>@<domain>.<tld>` |
| `password` | required, min 8, max 200 |
| `display_name` | optional; trimmed; blank → `null`; max 80 |

**Response `201 Created`**

```json
{
  "user": { "id": "string", "email": "string", "display_name": "string|null" },
  "token": "<jwt>",
  "expires_in": 86400
}
```

**Errors:** `409` email already registered (both the pre-check and the unique-index race path) · `422` validation failure.

**Rules:** BR-07, AS-07.

---

### API-02 · `POST /api/auth/login` (F-01)

**Request**

```json
{ "email": "ada@example.com", "password": "correct-horse" }
```

Email is normalised the same way as at registration, so login is case-insensitive. Password **length rules are deliberately not enforced here** — an old password that predates a policy change must still sign in, and rejecting on length would leak which passwords are plausible.

**Response `200 OK`**

```json
{ "user": { "id": "string", "email": "string" }, "token": "<jwt>", "expires_in": 86400 }
```

Note: the login response carries `id` and `email` only — no `display_name`.

**Errors:** `401` invalid credentials · `422` missing/malformed field.

**Rules:** BR-08. An unknown email and a wrong password produce the same status and the same body; a dummy bcrypt compare against a fixed invalid hash runs when no user is found, so the two paths also cost roughly the same time.

---

### API-03 · `POST /api/notes` (F-02) — auth required

**Request**

```json
{ "title": "Groceries", "body": "milk, eggs" }
```

| Field | Rules |
|---|---|
| `title` | optional; trimmed; blank → `null`; max 200 |
| `body` | required; trimmed; 1–10 000 chars **after** trimming |

Any `owner_id` in the request body is not read (BR-02).

**Response `201 Created`**

```json
{ "id": "string", "title": "string|null", "body": "string", "created_at": "ISO8601", "updated_at": "ISO8601" }
```

**Errors:** `401` · `422` (`details[].field` is `body` or `title`).

**Rules:** BR-01, BR-02, BR-04.

---

### API-04 · `GET /api/notes` (F-03) — auth required

**Query parameters**

| Param | Rules |
|---|---|
| `page` | optional integer, default 1, range 1–1 000 000 |
| `limit` | optional integer, default 20, range 1–100 |

Out-of-range or non-integer values are a **422, not a silent clamp**.

**Response `200 OK`**

```json
{
  "items": [ { "id": "string", "title": "string|null", "body": "string", "created_at": "ISO8601", "updated_at": "ISO8601" } ],
  "page": 1,
  "limit": 20,
  "total": 0
}
```

`total` counts the caller's live notes only, using the same filter as `items`. Ordering is `created_at` descending. Paging is offset-based (`skip = (page - 1) * limit`).

**Errors:** `401` · `422`.

**Rules:** BR-01, BR-03, BR-05, BR-09.

---

### API-05 · `GET /api/notes/:id` (F-03) — auth required

No request body. `:id` must be a valid ObjectId; if it is not, the request short-circuits to the same 404 as any other miss.

**Response `200 OK`** — same object shape as API-03.

**Errors:** `401` · `404`.

**Rules:** BR-01, BR-03, BR-05. A note owned by someone else, a soft-deleted note, a well-formed id that matches nothing, and a malformed id are all reported identically, so note ids are not enumerable.

---

### API-06 · `DELETE /api/notes/:id` (F-04) — auth required

Performs a single `findOneAndUpdate` against `liveFilter(owner, { _id })`, setting `deleted_at` and `updated_at` to the same timestamp. Because `deleted_at: null` is part of the filter, an already-deleted note matches nothing — no write happens and the original `deleted_at` is never overwritten.

**Response `200 OK`**

```json
{ "id": "string", "deleted_at": "ISO8601" }
```

**Errors:** `401` · `404` (not yours, already deleted, never existed, or malformed id).

**Rules:** BR-01, BR-03, BR-05, BR-06.

---

### Unmatched routes

Any other method/path — including `PUT` or `PATCH /api/notes/:id` — falls through to `404 {"error":"not_found","message":"No such endpoint."}`. There is no update endpoint by design (AS-03).

---

## 6. Enforced constraints

| Rule | Constraint | Enforced at |
|---|---|---|
| BR-01 | Every notes endpoint requires a valid, unexpired bearer token; missing or invalid → 401 with no note data. | `middleware/auth.js`, before any handler |
| BR-02 | `owner_id` comes from the token, never from the request body. | `middleware/auth.js` pins `req.user.id`; `routes/notes.js` reads only that |
| BR-03 | Read and delete filter by `owner_id`; another user's note is a 404, not a 403. | `Note.liveFilter()` in every note query |
| BR-04 | `body` required, 1–10 000 chars after trimming; otherwise 422. | `utils/validate.js#validateBody` + schema `minlength`/`maxlength` |
| BR-05 | Delete sets `deleted_at`; deleted notes are excluded from list, fetch, and delete. | `findOneAndUpdate` + `liveFilter` |
| BR-06 | Deleting an already-deleted or non-existent note returns 404 and changes no state. | `deleted_at: null` in the update filter |
| BR-07 | Email unique, compared case-insensitively; duplicate → 409. | lowercasing in `validateEmail` + unique index + `code === 11000` catch |
| BR-08 | Login failure returns an identical 401 for unknown email and wrong password. | shared response + dummy bcrypt compare |
| BR-09 | List returns the caller's notes only, `created_at` desc, default page size 20, hard cap 100. | `validatePagination` + sort/skip/limit |

### Validation limits (single source of truth: `utils/validate.js`)

| Constant | Value |
|---|---|
| `MAX_BODY` | 10 000 |
| `MAX_TITLE` | 200 |
| `MIN_PASSWORD` | 8 |
| max password | 200 |
| max display name | 80 |
| max email length | 254 |
| `DEFAULT_PAGE_SIZE` | 20 |
| `MAX_PAGE_SIZE` | 100 |
| JWT TTL | 86 400 s |
| bcrypt cost | 12 |
| JSON body limit | 256 kb |

---

## 7. Assumptions of record

The brief was silent on much of the below; these are the architect's recorded assumptions, with confidence, that the implementation follows.

| Id | Assumption | Confidence |
|---|---|---|
| AS-01 | "Personal" implies per-user ownership and isolation; email + password registration with a stateless JWT bearer token. | 0.55 |
| AS-02 | A note is an optional title plus a required free-text body capped at 10 000 characters. | 0.60 |
| AS-03 | No update/edit endpoint — editing is deliberately out of scope, not forgotten. | 0.80 |
| AS-04 | Delete is a soft delete so an accidental delete is recoverable by an operator. | 0.45 |
| AS-05 | Small scale: single Express process, single MongoDB, no cache/queue/workers; listing paginated at 20. | 0.70 |
| AS-06 | No sharing, collaboration, tags, search, or attachments. | 0.75 |
| AS-07 | bcrypt cost 12; JWTs expire after 24 h. | 0.65 |

AS-04 (0.45) and AS-01 (0.55) are the weakest links — if the product owner disagrees with either, the delete semantics or the whole auth model change.

---

## 8. Test coverage

QA delivered **39 test cases (TC-01 … TC-39)** against the API contract. Coverage by area:

| Area | Cases |
|---|---|
| Registration (API-01) | TC-01 … TC-05 — success shape, duplicate/case-insensitive 409, short password, malformed email, bcrypt-hash-not-plaintext |
| Login (API-02) | TC-06 … TC-09 — usable token, wrong password, identical response for unknown email, 422 for missing field |
| Create note (API-03) | TC-10 … TC-19, TC-38 — persistence, optional title, no/garbage/expired token, body-injected `owner_id` ignored, empty & whitespace body, 10 000/10 001 boundary, trimming, over-long title, malformed JSON → 422 |
| List notes (API-04) | TC-20 … TC-27 — ordering and paging metadata, cross-user isolation, soft-deleted exclusion, 401, `limit=101` → 422, `limit=100` boundary, bad paging params, 25-note pagination walk |
| Fetch one (API-05) | TC-28 … TC-32 — own note, other user's note → 404, deleted note → 404, unknown/malformed id indistinguishable, 401 |
| Delete (API-06) | TC-33 … TC-37 — soft delete + timestamp, double delete does not overwrite `deleted_at`, non-existent id, cross-user delete refused, 401 performs no write |
| Scope | TC-39 — `PUT`/`PATCH` on a note return 404 (AS-03) |

QA reported no failing expectations in its artifact; the four items it could not cover are folded into Known gaps below.

---

## 9. Known gaps

1. **No frontend.** The React SPA appears in the architecture diagram but no Frontend or UI/UX artifact was produced — no components, token-storage strategy, routing, or screens exist. Only the server contract is specified.
2. **No product artifact.** No Product Manager output, so there are no personas, success metrics, or prioritisation rationale beyond the four `must` features.
3. **`JWT_SECRET` fallback.** `utils/token.js` falls back to the literal `pact-local-development-secret` when the variable is unset — convenient locally, unsafe anywhere else, and nothing in the artifacts fails startup when it is missing (unlike `MONGO_URL`).
4. **No restore path (AS-04).** Soft-deleted notes survive in MongoDB, but no endpoint exposes recovery; an operator must edit the document directly. QA can assert the surviving `deleted_at` but cannot test recovery end to end.
5. **BR-07 concurrency untested.** The unique index is what decides a race between two simultaneous registrations of the same email; the QA runner issues requests sequentially, so only the sequential 409 path (TC-02) is covered.
6. **BR-08 timing equivalence unasserted.** TC-08 verifies that status and body are identical; the dummy-bcrypt timing half is not asserted because wall-clock timing is too noisy for a deterministic test.
7. **Unspecified operational concerns.** No artifact covers rate limiting or login throttling, TLS termination, CORS, structured logging, health checks, backups, or migrations. Errors currently go to `console.error` and there is no request logging at all.
8. **Offset pagination.** `skip`-based paging is correct at the stated scale (AS-05) but shifts results if notes are created between page fetches; no artifact addresses this.