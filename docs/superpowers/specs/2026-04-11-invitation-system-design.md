# Invitation System Design

**Date:** 2026-04-11
**Status:** Approved
**Supersedes:** The partial, broken invitation surface shipped in v0.14.1-beta.

## Context

TravStats already has an `Invitation` model, a pair of admin routes
(`POST /admin/invitations`, `GET /admin/invitations`), and a register
route that consumes an invitation token. After the 0.14.1-beta fixes,
the bare-bones end-to-end flow works: an admin can create an invite,
copy a URL from a toast, share it manually, and the invited user can
register through it.

The system is still unsatisfying in practice because it misses every
piece of the management surface a real deployment needs: the only
way to enter an email is a browser `prompt()`, the generated URL is
only shown once in a transient toast, there is no way to revoke an
invitation that was sent by mistake, there is no way to resend or
copy an existing link, the "used" state doesn't say who used it, the
app never actually sends invitation emails itself even though SMTP
is wired up for password reset, and `MAX_USERS` is just a warning log
instead of a hard cap.

This spec describes a v2 of the invitation system that addresses all
of the above and unifies two parallel use cases: an admin generating
a link to share manually, and an admin triggering an SMTP email to
a named recipient.

## Goals

1. Cover both primary use cases cleanly, with **two distinct entry
   points** (no hidden toggles or checkboxes):
   - **Create link** — generate an invite URL with an expiration
     window. Admin shares it manually.
   - **Create email invite** — same plus automatic SMTP delivery to
     a required recipient address.
2. Make existing invitations fully manageable: revoke, re-copy the
   link, resend the email, and see who used a consumed invitation.
3. Enforce the `MAX_USERS` ceiling at invitation creation time, in a
   single serialisable transaction, so invitations cannot be issued
   past the cap.
4. Auto-populate the new user's `notificationEmail` from the
   invitation email when registering, so password reset works
   immediately.
5. Do not silently swallow SMTP errors — when the email send fails,
   the invitation is still created (link is valid) and the admin
   sees a clear failure reason with a one-click retry.

## Non-goals

- Multi-use invitation codes (a single code used by N people).
- User-initiated "request invite" flow.
- Custom expiration dates — only three presets (24 h / 7 d / 30 d).
- Invitation creation by non-admin users.
- Background retry queue for failed SMTP sends — retry is
  admin-triggered via the "Resend email" button.

## User stories

**Admin:**

- I generate an invitation link and share it myself through Signal,
  another messenger, or a physical note.
- I enter an email address and have the app mail the invitation
  link directly, without copying anything myself.
- I revoke an invitation that was sent to the wrong address, before
  the recipient ever uses it.
- I lost the link I generated earlier; I re-copy it from the admin
  list without creating a second invitation.
- I resend the email on an existing invitation whose first delivery
  went to spam or was deleted.
- I look at a used invitation in the list and see both the creator
  (me) and the user who actually registered through it.
- I cannot create more invitations than the user limit allows — the
  UI tells me why.

**Invited user:**

- I click an invitation link and see a green banner confirming the
  link was picked up.
- I fill in a username and password and land in the app immediately.
- If my invitation had an email attached, that email is already my
  `notificationEmail`, so password reset will work for my account
  without me having to visit settings first.
- If the link is invalid, expired, or already used, I see a clear
  reason on the register page — no silent fall-through to "normal"
  registration.

## Data model

### `Invitation` — new columns only

Three new nullable columns on the existing `invitations` table.
Everything else stays.

```prisma
model Invitation {
  id          String    @id @default(uuid())
  email       String?
  token       String    @unique
  createdBy   String    @map("created_by")
  expiresAt   DateTime  @map("expires_at")
  usedAt      DateTime? @map("used_at")
  usedBy      String?   @map("used_by")
  createdAt   DateTime  @default(now()) @map("created_at")

  // NEW
  emailStatus String?   @map("email_status")   // null | "sent" | "failed"
  emailError  String?   @map("email_error")    // last SMTP error text
  emailSentAt DateTime? @map("email_sent_at")  // last successful send

  creator User  @relation("CreatedInvitations", fields: [createdBy], references: [id], onDelete: Cascade)
  user    User? @relation("UsedInvitations",    fields: [usedBy],    references: [id], onDelete: SetNull)

  @@index([token])
  @@index([createdBy])
  @@map("invitations")
}
```

The `emailStatus` value is `null` for link-only invitations,
`"sent"` after a successful SMTP delivery, and `"failed"` after a
failed attempt. `emailError` is set alongside `"failed"` and cleared
on a successful resend. `emailSentAt` is the timestamp of the most
recent successful send.

### `User` — relation addition

```prisma
model User {
  // …existing fields stay…
  createdInvitations Invitation[] @relation("CreatedInvitations")
  usedInvitations    Invitation[] @relation("UsedInvitations")
}
```

The `usedInvitations` back-relation is what lets `GET /admin/invitations`
`include` the `user` object for each used invitation so the list can
show "used by `<username>`".

### Migration

One Prisma migration, additive only:

```sql
ALTER TABLE invitations
  ADD COLUMN email_status TEXT,
  ADD COLUMN email_error TEXT,
  ADD COLUMN email_sent_at TIMESTAMP;

-- Tighten the used_by FK so a deleted user doesn't delete
-- the invitation row. Old constraint was bare (no onDelete).
ALTER TABLE invitations
  DROP CONSTRAINT IF EXISTS invitations_used_by_fkey,
  ADD  CONSTRAINT invitations_used_by_fkey
    FOREIGN KEY (used_by) REFERENCES users(id) ON DELETE SET NULL;
```

No data backfill: existing rows default to `NULL` on the new
columns, which maps correctly to "link-only, no send history".

## Backend API

All routes live under `/api/v1/admin/invitations` and require the
`authenticate` + `requireAdmin` middleware stack.

### Endpoints

| Method   | Path              | Purpose                                |
|----------|-------------------|----------------------------------------|
| `GET`    | `/`               | List invitations, filtered by status  |
| `POST`   | `/`               | Create a link-only invitation         |
| `POST`   | `/email`          | Create and send an email invitation   |
| `POST`   | `/:id/resend`     | Resend the email on an invitation     |
| `DELETE` | `/:id`            | Hard-delete (revoke) an invitation    |

### `GET /` — list

Query parameter: `status=all|active|used|expired` (default `active`).

- `active`: `usedAt IS NULL AND expiresAt > now()`
- `used`: `usedAt IS NOT NULL`
- `expired`: `usedAt IS NULL AND expiresAt <= now()`
- `all`: no filter

Response shape:

```jsonc
{
  "invitations": [
    {
      "id": "…uuid…",
      "email": "jane@example.com",           // null for link-only
      "token": "…hex…",                      // full token — admin can build URL on demand
      "expiresAt": "2026-04-18T…",
      "usedAt": null,
      "createdAt": "2026-04-11T…",
      "emailStatus": "sent",                 // null | "sent" | "failed"
      "emailError": null,
      "emailSentAt": "2026-04-11T…",
      "creator": { "username": "admin" },
      "user": null                           // populated when usedBy is set
    }
  ]
}
```

The full `token` is included in the list response so the frontend
can rebuild the invitation URL for the "Copy link" action without
round-tripping the server. Tokens are only visible to admins, which
is the same trust level as the create response, so there is no
security regression.

### `POST /` — link-only create

Request body (Zod-validated):

```ts
{ expiresInDays: 1 | 7 | 30 }
```

Logic:

1. Open a serialisable transaction.
2. Count active invitations and users:
   `SELECT count(*) FROM users` + `SELECT count(*) FROM invitations
   WHERE used_at IS NULL AND expires_at > now()`.
3. If `userCount + activeInviteCount >= MAX_USERS` → throw
   `AppError('User limit reached', 409)` and roll back.
4. Otherwise `INSERT` the invitation with the pre-computed `token`
   (`crypto.randomBytes(32).toString('hex')`) and return it.

Response:

```jsonc
{
  "invitation": { "id": "…", "token": "…", "expiresAt": "…" },
  "inviteUrl":  "http://…/register?token=…"
}
```

### `POST /email` — email invite create

Request body:

```ts
{ email: string /* RFC-valid */, expiresInDays: 1 | 7 | 30 }
```

Logic:

1. Same serialisable transaction + limit check as `POST /`. Insert
   the invitation with `email` set. Commit.
2. **Outside the transaction**, call
   `sendInvitationEmail(email, inviteUrl, …)` via the existing
   `emailService` (the same service used by password reset). SMTP
   is slow and must not hold a serialisable transaction open.
3. On success: `UPDATE invitations SET email_status='sent',
   email_sent_at=now()` in its own short transaction.
4. On failure: `UPDATE invitations SET email_status='failed',
   email_error=<error.message>`, same way. The invitation stays
   valid regardless.
5. Return 200 regardless of SMTP result:

```jsonc
{
  "invitation": { "id": "…", "token": "…", "email": "…", "expiresAt": "…" },
  "inviteUrl":  "http://…/register?token=…",
  "emailSent":  true,
  "emailError": null                 // or "SMTP auth failed: …"
}
```

The SMTP failure path deliberately does not surface as a 4xx/5xx
because the *invitation create* succeeded — only the *email send*
failed. The frontend uses the `emailSent` boolean to decide how to
render the success modal.

### `POST /:id/resend`

Pre-conditions (all enforced by the route, each with its own
`AppError`):

- Invitation exists → else `404 Invitation not found`.
- `email` is set → else `400 Invitation has no email`.
- `usedAt` is null → else `400 Invitation already used`.
- `expiresAt > now()` → else `400 Invitation expired`.

On success the same SMTP call runs as in `POST /email`, `email_status`
is updated, and the response shape is `{ emailSent, emailError }`.

### `DELETE /:id`

Hard-delete via `DELETE FROM invitations WHERE id = $1`. 404 if the
row is already gone. Used invitations can also be deleted — this is
explicit: deleting a used invitation does not de-register the user
(cascade is `SET NULL` on `used_by`), it just removes the audit row.
The UI only surfaces the revoke action on `active` and `expired`
rows; `used` rows are immutable from the UI.

### Register-side change

`POST /auth/register` already consumes the invitation token (from
the 0.14.1-beta fix). Add one line inside the existing transaction:

```ts
await prisma.user.create({
  data: {
    username,
    passwordHash,
    isAdmin: isFirstUser,
    invitedBy,
    // NEW: auto-populate notificationEmail from invitation
    notificationEmail: invitation?.email ?? undefined,
  },
});
```

No new endpoint, no extra DB round trip, no behaviour change for
users who registered as the first user (no invitation → no email).

## Frontend

### New components

All under `frontend/src/components/Admin/`:

- **`CreateLinkInviteModal.tsx`** — radio-group (24 h / 7 d / 30 d),
  submit calls `adminApi.createLinkInvitation()`, opens
  `InviteSuccessModal` on success.
- **`CreateEmailInviteModal.tsx`** — email `textbox` with inline
  Zod validation (`z.string().email()`), same radio-group, submit
  calls `adminApi.createEmailInvitation()`, always opens the success
  modal (which branches on `emailSent`).
- **`InviteSuccessModal.tsx`** — takes `{ inviteUrl, emailSent?,
  emailError? }` and renders:
  - Always: the full URL in a monospace block with a "Copy link"
    button.
  - If `emailSent === true`: a green line "Email sent to `<addr>`".
  - If `emailSent === false`: an amber warning "Email delivery
    failed: `<error>`. The link below still works — copy it to
    share manually." The admin closes the modal with a single
    "Done" button.

### Modified component

`InvitationManagement.tsx`:

- Header gets two buttons instead of one:
  `[+ Link erstellen] [✉ Einladung per E-Mail]`.
- A filter chip row above the table:
  `[Alle] [Aktiv] [Verwendet] [Abgelaufen]`, default `Aktiv`.
- The table gets two new columns:
  - **Verwendet von** — empty for active / expired, shows the
    username for used rows.
  - **Aktionen** — context-dependent button group per row.
- Row actions by status:
  - `active`: `[📋 Link kopieren] [✉ Mail senden\|nochmal senden]* [🗑 Widerrufen]`
  - `expired`: `[🗑 Widerrufen]`
  - `used`: no buttons; a small tooltip explains the row is
    immutable because it has been consumed
- The mail button asterisk: only rendered when `email` is non-null
  and `emailStatus ∈ { null, 'failed' }`. Label is "nochmal senden"
  when `emailStatus === 'failed'`.

### New API methods (`frontend/src/lib/api/admin.ts`)

```ts
createLinkInvitation(expiresInDays: 1 | 7 | 30)
createEmailInvitation(email: string, expiresInDays: 1 | 7 | 30)
resendInvitationEmail(id: string)
revokeInvitation(id: string)
```

`getInvitations` gets a new optional `status` argument and keeps its
name. `createInvitation` is removed — its only caller lives in
`AdminPage.tsx` and is replaced in the same change with a call to
either `createLinkInvitation` or `createEmailInvitation`. No alias
is kept, because the old call site vanishes with the new modals.

### `AdminPage.tsx` changes

The current `handleCreateInvitation` is removed entirely along with
its `prompt()` call. Replaced by two modal-toggling state variables
and corresponding handlers (`openLinkModal`, `openEmailModal`) plus
the two new modal components rendered conditionally. The
`setCopiedUrl` boolean banner goes away; the persistent
`InviteSuccessModal` replaces it.

### `RegisterPage.tsx`

No change. The server-side `notificationEmail` auto-populate is
invisible to the page.

### i18n keys

New keys under `admin:invitations.*` in both `de/admin.json` and
`en/admin.json`:

- `actions.createLink`, `actions.createEmail`, `actions.copyLink`,
  `actions.sendEmail`, `actions.resendEmail`, `actions.revoke`
- `filter.all`, `filter.active`, `filter.used`, `filter.expired`
- `createLinkModal.title`, `createLinkModal.description`,
  `createLinkModal.submit`
- `createEmailModal.title`, `createEmailModal.description`,
  `createEmailModal.emailLabel`, `createEmailModal.emailPlaceholder`,
  `createEmailModal.submit`, `createEmailModal.sending`
- `success.title`, `success.linkLabel`, `success.copyLink`,
  `success.emailSent`, `success.emailFailed`, `success.done`
- `expires.24h`, `expires.7d`, `expires.30d`
- `table.usedBy`, `table.actions`
- `status.linkReady`, `status.emailSent`, `status.emailFailed`
- `errors.userLimitReached`, `errors.noEmail`, `errors.alreadyUsed`,
  `errors.alreadyExpired`, `errors.notFound`
- `confirmRevoke` (`confirm()` fallback: "Diese Einladung wirklich
  widerrufen? Der Link wird sofort ungültig.")

## Error handling

**Backend** (all errors thrown as `AppError` and rendered by the
existing `errorHandler` middleware):

| Situation                                          | HTTP | Message                     |
|----------------------------------------------------|------|-----------------------------|
| User limit reached during create                   | 409  | "User limit reached"        |
| `:id` is not a valid UUID                          | 400  | "Invalid invitation id"     |
| `:id` not found on resend or delete                | 404  | "Invitation not found"      |
| Resend on invitation without email                 | 400  | "Invitation has no email"   |
| Resend on used invitation                          | 400  | "Invitation already used"   |
| Resend on expired invitation                       | 400  | "Invitation expired"        |
| Zod validation error on body                       | 400  | Zod error message           |
| SMTP send failure during create or resend          | 200  | — (`emailSent: false`)      |

**Frontend:**

- Every API call is wrapped in try/catch and surfaces through the
  existing `useToastStore` helper with `getErrorMessage(error, …)`.
- Email validation runs inline in `CreateEmailInviteModal` before
  the API call — Zod's `z.string().email().safeParse(value)`.
- The success modal for `POST /email` never shows a toast — the
  modal itself conveys success or SMTP failure. Toasts are only
  used for create-level failures (`409 User limit reached`,
  `400` validation, network errors).
- Row actions show confirmation via the existing `confirm()` helper
  for revoke only; copy / resend are one-click.

## Testing

**Backend** (Jest + Supertest, `backend/src/__tests__/`):

- `admin.invitations.test.ts` — new file:
  - `POST /` creates a link-only invitation and returns the URL.
  - `POST /` rejects `expiresInDays` outside `{1, 7, 30}` with 400.
  - `POST /` returns 409 once `userCount + activeInvitesCount >=
    MAX_USERS`.
  - `POST /email` creates an invitation with `emailStatus='sent'`
    when SMTP is mocked to succeed.
  - `POST /email` returns 200 with `emailSent: false` and
    `emailStatus='failed'` when SMTP is mocked to throw.
  - `POST /:id/resend` succeeds on an active invitation with email.
  - `POST /:id/resend` returns 400 on an active invitation without
    email, on a used invitation, and on an expired one.
  - `POST /:id/resend` returns 404 on an unknown id.
  - `DELETE /:id` hard-deletes the row.
  - `DELETE /:id` returns 404 on an unknown id.
  - `GET /?status=active|used|expired|all` returns the right subset.
- `auth.register.invitation.test.ts` — additions:
  - Register with a valid token whose invitation had an email →
    `user.notificationEmail` equals the invitation email.
  - Register with a valid token whose invitation had no email →
    `user.notificationEmail` stays null.
  - Concurrent race: two register calls with the same token
    resolve as one 201 and one 400 "Invitation already used".

**Frontend** (Vitest + Testing Library, `frontend/src/__tests__/`):

- `CreateLinkInviteModal.test.tsx` — renders the radio group,
  submit calls the API with the chosen `expiresInDays`, success
  opens `InviteSuccessModal`.
- `CreateEmailInviteModal.test.tsx` — inline email validation blocks
  submit on invalid input; valid input calls the API; the success
  modal renders the amber warning when `emailSent === false`.
- `InvitationManagement.test.tsx` — row actions appear based on
  status (active vs used vs expired), revoke confirmation fires the
  API call, resend button disabled for used rows.

**E2E** (Playwright, not required for the first ticket but planned
as a follow-up):

- Smoke flow: admin logs in, opens admin → Einladungen, creates a
  link invite, copies the URL, opens a private tab, registers, logs
  in, goes back to admin and sees the row flip to
  "Verwendet von `<username>`". The same flow is performed manually
  during development verification.

## Rollout

1. Schema migration applies on container start as part of the normal
   Prisma migrate deploy (additive, no downtime).
2. The code ships as a single `feat(invitations):` commit plus its
   follow-up tests, deployed via `/deploy` as `0.15.0-beta`
   (breaking change relative to the old admin-page JS client, hence
   a minor bump, but no data migration required).
3. After deploy, the existing `travstats:0.14.1-beta` invitation
   rows are still valid — they simply show `emailStatus === null`
   ("link-only"), which is exactly right since nothing was ever
   mailed through them.
4. The `MAX_USERS` env default of `10` is kept; the existing
   `test@example.com` seed and demo user count against the new
   limit check — this is intentional.
