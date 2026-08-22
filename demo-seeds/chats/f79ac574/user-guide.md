# Personal Notes — User Guide

## What this is

A small service for keeping private notes. You create an account, write notes, read them back newest-first, and delete the ones you no longer want. Your notes are yours alone — nobody else can see, fetch, or delete them, and you cannot see anybody else's.

This release ships the **server only**: a JSON API that a web or mobile app can be built on. There is no user interface yet — see *What is not included* below.

## Who it is for

The system recognises exactly one kind of person: a **note owner** — someone who keeps their own notes and sees no one else's. There are no admin accounts, no shared workspaces, and no roles.

*(No product-management artifact was provided for this project, so this is the only persona defined anywhere in the delivered work.)*

---

## Getting started

### 1. Create an account

Send your email address and a password to `POST /api/auth/register`. You may also give a display name.

- Your password must be at least 8 characters.
- Your email must be a real-looking address and must not already be registered — capitalisation does not make it a different address, so `Ada@Example.com` and `ada@example.com` are the same account.
- Your display name is optional and can be up to 80 characters.

You get back your account details plus an **access token**.

### 2. Sign in

Already have an account? Send your email and password to `POST /api/auth/login` and you get a fresh token. Your email is not case-sensitive here either.

If your sign-in fails you will be told simply that the email or password is incorrect — the service deliberately does not reveal whether the email exists, so nobody can use it to discover who has an account.

### 3. Use your token

Every token lasts **24 hours**. Send it with each note request as an `Authorization: Bearer <token>` header. When it expires, sign in again to get a new one. There is no sign-out step — a token simply stops working when it expires.

Without a valid token, no note request will work at all, and nothing about your notes is revealed.

---

## Using the features

### Write a note

`POST /api/notes` with the note text.

- **Body** is required: at least 1 character and at most 10 000 after leading and trailing spaces are removed. A blank or spaces-only note is rejected.
- **Title** is optional, up to 200 characters. Leave it out and the note simply has no title.

The saved note comes back with its id and the time it was created.

### See your notes

`GET /api/notes` returns your notes, **newest first**.

- You get 20 notes per page by default. Ask for a different page with `?page=2`, or a different size with `?limit=50`.
- The largest page you may ask for is 100. Asking for more is refused rather than quietly trimmed, so you always know exactly what you received.
- Each response tells you the page, the page size, and the total number of notes you have, so you know how many pages there are.

Only your own notes ever appear here.

### Open a single note

`GET /api/notes/{id}` returns one of your notes in full.

If the id belongs to someone else, was already deleted, or never existed, you get the same *not found* answer in every case. This is intentional: it means nobody can go fishing through ids to learn which notes exist.

### Delete a note

`DELETE /api/notes/{id}` removes one of your notes and confirms the time it was deleted.

After that the note disappears from your list, can no longer be opened, and cannot be deleted again — a second attempt reports *not found*.

**About recovery:** deleted notes are marked as deleted rather than erased outright, so an operator with direct database access can in principle recover one. There is no self-service undo or trash folder in the product, so treat deletion as permanent from your side.

---

## Good to know

| Question | Answer |
|---|---|
| Can I edit a note? | No. Editing is intentionally out of scope in this release — delete the note and write a new one. |
| Can I share a note or collaborate? | No. Notes are strictly personal. |
| Can I search, tag, or attach files? | No. None of these are in this release. |
| How long do I stay signed in? | 24 hours per token. |
| How long can a note be? | Up to 10 000 characters of body text, plus an optional title of up to 200. |
| Is there a trash or undo? | Not for you. See *Delete a note* above. |
| Are my passwords stored safely? | Passwords are never stored as you typed them — only as a one-way scrambled form, and they never appear in any response. |

---

## What is not included

Being clear about the edges of this release:

- **No app or website.** A web client was sketched in the architecture but never built, so today the service is usable only by something that speaks to the API directly.
- **No editing, sharing, tags, search, or attachments.**
- **No self-service password reset, account deletion, or sign-out.**
- **No trash or restore screen** — recovery of a deleted note requires an operator.

---

## When something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| Unauthorized | Your token is missing, malformed, or expired — or your email/password did not match. | Sign in again to get a fresh token, or re-check your credentials. |
| Not found | The note does not exist, is already deleted, or is not yours. | Refresh your list; the note is not available to you. |
| Email already registered | That address already has an account. | Sign in instead, or use a different address. |
| Unprocessable entity | Something you sent breaks a rule — an empty note, a note over 10 000 characters, a title over 200, a password under 8 characters, a malformed email, or a page size over 100. | The response names the exact field at fault; fix it and resend. |

---

## Current state of testing

The API has been covered by **39 written test cases** spanning registration, sign-in, creating notes, listing and paging, opening a single note, and deletion — including the privacy behaviours above (one user never seeing another's notes, and *not found* being used in place of *forbidden*). Because no user interface was built, there is no interface-level testing.