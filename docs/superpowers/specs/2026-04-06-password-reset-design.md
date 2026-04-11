# Password Reset — Design Spec

**Date:** 2026-04-06
**Status:** Approved

---

## Overview

Two independent reset paths:
1. **Email reset** — User requests a link (requires SMTP)
2. **Admin reset** — Admin sets the password directly in the admin panel (always available)

Both paths support `mustChangePassword`: the user is forced to change their password on next login.

---

## Data Model

Three new fields on the `User` model (Prisma migration):

```prisma
resetToken         String?   // gehashter Reset-Token (crypto.randomBytes(32))
resetTokenExpiry   DateTime? // 30 Min (Email-Flow) / 24h (Admin-generiert)
mustChangePassword Boolean   @default(false)
```

The token is generated as plaintext hex, stored via `bcrypt.hash()`, and set to `null` after use.

---

## Backend API

**New route file:** `backend/src/routes/passwordReset.ts`
**Mounted in:** `backend/src/index.ts` under `/api/v1/auth`

### Public Endpoints

#### `POST /api/v1/auth/forgot-password`
- Body: `{ username: string }`
- Always returns HTTP 200 (prevents user enumeration)
- If SMTP is not active: returns 200 only, no email
- If SMTP is active and the user exists: generate a reset token, hash it, store it in the DB (expiry: 30 min), send an email with the link
- Link format: `{FRONTEND_URL}/reset-password?token={plainToken}`

#### `POST /api/v1/auth/reset-password`
- Body: `{ token: string, newPassword: string }` (Zod-validated, min 8 characters)
- Verify the token against the DB hash, check expiry
- On success: set the password, clear token + expiry to null, set `mustChangePassword: false`
- Rate limit: 5 attempts / 15 min (new `passwordResetLimiter`)

### Admin Endpoint

#### `POST /api/v1/admin/users/:id/reset-password`
- Auth: `requireAdmin`
- Body: `{ mode: "generate" | "set", password?: string, mustChangePassword?: boolean }`
- `mode: "generate"`: generate a random 12-character password (return the plaintext once), `mustChangePassword` defaults to `true`
- `mode: "set"`: take `password` from the body (min 8 characters), `mustChangePassword` defaults to `false`
- Hash the password, store it in the DB, clear `resetToken`/`resetTokenExpiry`

### Auth Login Addition (`auth.ts`)

After a successful login, check:
```typescript
if (user.mustChangePassword) {
  return res.json({ requiresPasswordChange: true });
  // kein auth_token Cookie gesetzt — User kann App nicht nutzen
}
```

---

## Email Template

Simple plain-text + HTML email via the existing `emailService.ts`:

```
Betreff: TravStats — Passwort zurücksetzen

Hallo {username},

Du hast eine Passwortzurücksetzung angefordert.
Link (gültig 30 Minuten): {resetUrl}

Falls du das nicht angefordert hast, kannst du diese Email ignorieren.
```

New interface `sendPasswordResetEmail(to: string, resetUrl: string, username: string)` in `emailService.ts`.

---

## Frontend

### Login Page (`LoginPage.tsx`)

- "Forgot password?" link below the login form
- Click opens a modal:
  - **SMTP configured**: username input + "Send reset link" button → generic success message
  - **SMTP not configured**: notice "Email not set up — please contact your admin" (no form)
- SMTP status: new public endpoint `GET /api/v1/auth/smtp-status` → `{ smtpEnabled: boolean }`

### New Route `/reset-password`

- Page `ResetPasswordPage.tsx`
- Read the token from the URL parameter
- Form: "New password" + "Confirm password"
- On success: redirect to login with a success message
- On invalid/expired token: error message + link back to "Forgot password"

### Force-Change Flow

After login with `requiresPasswordChange: true`:
- No cookie is set → user lands on login, but with a flag in state
- Redirect to `/change-password` (new page `ForceChangePasswordPage.tsx`)
- Form: only "New password" + "Confirm" (no old password required)
- Edge case: the user is not yet logged in → a one-time token is needed for this action

**Technical solution for force-change without a session:**
The login response with `mustChangePassword: true` returns a temporary `changeToken` (separate from `auth_token`, short validity 10 min). `ForceChangePasswordPage` sends this token along with the new password to `POST /api/v1/auth/force-change-password`.

### Admin Panel (`AdminPage` / user list)

- A "Reset" button in the user row opens a modal
- Modal with two tabs:
  - **"Generate"**: a "Generate temporary password" button → displays the password once in a copyable field. Checkbox "Must change password on next login" (default: on)
  - **"Set manually"**: password input field (min 8 characters). Checkbox "Must change password on next login" (default: off)

---

## New Zod Schemas (`backend/src/schemas/auth.ts`)

```typescript
export const forgotPasswordSchema = z.object({
  username: z.string().min(1),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8).max(100),
});

export const forceChangePasswordSchema = z.object({
  changeToken: z.string().min(1),
  newPassword: z.string().min(8).max(100),
});

export const adminResetPasswordSchema = z.object({
  mode: z.enum(['generate', 'set']),
  password: z.string().min(8).max(100).optional(),
  mustChangePassword: z.boolean().optional(),
});
```

---

## Rate Limiting

New `passwordResetLimiter` in `middleware/rateLimit.ts`:
- 5 attempts / 15 min / IP
- Applies to: `POST /forgot-password`, `POST /reset-password`

Constants in `config/constants.ts`:
```typescript
PASSWORD_RESET_WINDOW_MS: 15 * 60 * 1000,
PASSWORD_RESET_MAX: 5,
```

---

## i18n

New keys in `de` and `en`:
- `login.forgotPassword`, `login.forgotPasswordModal.*`
- `resetPassword.*`
- `forceChangePassword.*`
- `admin.users.resetPassword.*`

---

## Out of Scope (YAGNI)

- Password strength meter (min 8 characters is enough)
- Multiple active reset tokens per user
- SMS or other channels
- Audit log for reset actions
