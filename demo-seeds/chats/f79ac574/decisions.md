# Decisions — personal-notes-api

Completeness score: **0.62**

## Stack
- MERN (db: mongodb, api: express)

## Assumptions (brief was silent — recorded, not guessed)
- **AS-01** (confidence 0.55, source: brief-silence): "Personal" implies per-user ownership and isolation, so the API needs a notion of an authenticated user; the brief never says how users are created or authenticated, so we assume email + password registration with a stateless JWT bearer token.
- **AS-02** (confidence 0.6, source: domain-norm): A note is a title plus a free-text body; the brief names no fields. Title is optional (may be derived/blank), body is required and capped at 10,000 characters.
- **AS-03** (confidence 0.8, source: brief-silence): There is no update/edit endpoint because the brief says only create, list, delete. Editing is deliberately out of scope rather than forgotten.
- **AS-04** (confidence 0.45, source: brief-silence): Delete is a soft delete (deleted_at timestamp) so an accidental delete is recoverable by an operator; the brief does not say whether deletes must be permanent.
- **AS-05** (confidence 0.7, source: brief-silence): Scale is small ("a small notes API"): single Express process, single MongoDB, no cache, no queue, no background workers. Listing is paginated at 20 per page to keep responses bounded anyway.
- **AS-06** (confidence 0.75, source: brief-silence): No sharing, collaboration, tags, search, or attachments are in scope — the brief describes only personal notes with three operations.
- **AS-07** (confidence 0.65, source: domain-norm): Passwords are stored as bcrypt hashes (cost 12) and JWTs expire after 24h. The brief specifies no security posture.

## Business rules
- BR-01: Every notes endpoint requires a valid, unexpired bearer token; a missing or invalid token returns 401 and no note data.
- BR-02: A note's owner_id is taken from the authenticated token, never from the request body — a client cannot create a note on behalf of another user.
- BR-03: Read and delete operations must filter by owner_id = authenticated user. A note belonging to another user is reported as 404, not 403, so note ids are not enumerable.
- BR-04: Note body is required, must be 1–10,000 characters after trimming; an empty or oversized body returns 422.
- BR-05: Deleting a note sets deleted_at instead of removing the document (AS-04); deleted notes are excluded from every list response and from subsequent fetch/delete.
- BR-06: Deleting an already-deleted or non-existent note returns 404 and does not change stored state.
- BR-07: Email is unique across users, compared case-insensitively; registering an existing email returns 409.
- BR-08: Login failure returns 401 with an identical message whether the email is unknown or the password is wrong, so accounts cannot be probed.
- BR-09: List returns the caller's notes only, sorted by created_at descending, page size 20, capped at 100 per request.

## Gaps (BLOCKED_ON_UPSTREAM — dropped after repair, needs human follow-up)
- UNDERSPECIFIED: proceeding with every low-confidence assumption flagged
