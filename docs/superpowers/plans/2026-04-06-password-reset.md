# Password Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement full password reset — email-based reset link, admin-initiated reset (generate temp / set directly), and force-change-on-next-login flow.

**Architecture:** New `passwordReset.ts` route file + admin endpoint in `users.ts`; Prisma migration adds 5 fields to User; force-change uses a short-lived `changeToken` returned from login (no cookie); SHA-256 used for token storage (enables direct DB lookup without iterating users, unlike bcrypt).

**Tech Stack:** Express/TypeScript, Prisma/PostgreSQL, `crypto` (Node built-in), bcrypt (for passwords), nodemailer (existing emailService), React 18, React Router v6, Vitest + React Testing Library, Zod

---

## File Map

### Create
- `backend/src/routes/passwordReset.ts` — 4 endpoints: GET /smtp-status, POST /forgot-password, POST /reset-password, POST /force-change-password
- `frontend/src/pages/ResetPasswordPage.tsx` — /reset-password?token=... page
- `frontend/src/pages/ForceChangePasswordPage.tsx` — /change-password page (requires location.state.changeToken)
- `frontend/src/components/Admin/AdminPasswordResetModal.tsx` — admin modal with generate/set tabs

### Modify
- `backend/prisma/schema.prisma` — add 5 fields to User model
- `backend/src/schemas/auth.ts` — add 4 Zod schemas
- `backend/src/config/constants.ts` — add PASSWORD_RESET rate limit constants
- `backend/src/middleware/rateLimit.ts` — add passwordResetLimiter
- `backend/src/services/emailService.ts` — add sendPasswordResetEmail
- `backend/src/routes/admin/users.ts` — add POST /users/:id/reset-password
- `backend/src/routes/auth.ts` — handle mustChangePassword in login + add crypto import
- `backend/src/index.ts` — mount passwordReset routes
- `frontend/src/lib/api/auth.ts` — add getSmtpStatus, forgotPassword, resetPassword, forceChangePassword; update login return type
- `frontend/src/lib/api/admin.ts` — add adminResetPassword
- `frontend/src/pages/LoginPage.tsx` — add forgot password link + modal; handle requiresPasswordChange response
- `frontend/src/components/Admin/UserManagement.tsx` — add Reset button + wire up AdminPasswordResetModal
- `frontend/src/pages/AdminPage.tsx` — pass handleResetPassword to UserManagement
- `frontend/src/i18n/resources/de/auth.json` — new keys
- `frontend/src/i18n/resources/en/auth.json` — new keys
- `frontend/src/i18n/resources/de/admin.json` — new keys for resetPassword modal
- `frontend/src/i18n/resources/en/admin.json` — new keys for resetPassword modal
- `frontend/src/App.tsx` — add /reset-password and /change-password routes

---

## Task 1: Prisma Migration

**Files:**
- Modify: `backend/prisma/schema.prisma` (User model, line ~14–41)

- [ ] **Step 1: Add 5 fields to User model in schema.prisma**

Open `backend/prisma/schema.prisma` and add these 5 lines inside the `model User { ... }` block, after the `notifyBefore2h` field (before `flights`):

```prisma
  resetToken         String?   @map("reset_token")
  resetTokenExpiry   DateTime? @map("reset_token_expiry")
  mustChangePassword Boolean   @default(false) @map("must_change_password")
  changeToken        String?   @map("change_token")
  changeTokenExpiry  DateTime? @map("change_token_expiry")
```

- [ ] **Step 2: Run Prisma migration**

```bash
cd /d/Projekte/TravStats/backend
npx prisma migrate dev --name add_password_reset_fields
```

Expected output: `Your database is now in sync with your schema.`
A new file `prisma/migrations/*/migration.sql` is created.

- [ ] **Step 3: Verify Prisma client regenerated**

```bash
cd /d/Projekte/TravStats/backend
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /d/Projekte/TravStats
git add backend/prisma/schema.prisma backend/prisma/migrations/
git commit -m "feat: add password reset fields to User model (migration)"
```

---

## Task 2: Backend Schemas and Rate Limiter

**Files:**
- Modify: `backend/src/schemas/auth.ts`
- Modify: `backend/src/config/constants.ts`
- Modify: `backend/src/middleware/rateLimit.ts`

- [ ] **Step 1: Write failing test for new schemas**

Create `backend/src/schemas/__tests__/auth.test.ts`:

```typescript
import { describe, it, expect } from '@jest/globals';
import {
  forgotPasswordSchema,
  resetPasswordSchema,
  forceChangePasswordSchema,
  adminResetPasswordSchema,
} from '../auth';

describe('forgotPasswordSchema', () => {
  it('accepts a valid username', () => {
    const result = forgotPasswordSchema.parse({ username: 'alice' });
    expect(result.username).toBe('alice');
  });

  it('rejects empty username', () => {
    expect(() => forgotPasswordSchema.parse({ username: '' })).toThrow();
  });
});

describe('resetPasswordSchema', () => {
  it('accepts valid token and password', () => {
    const result = resetPasswordSchema.parse({ token: 'abc', newPassword: 'password1' });
    expect(result.newPassword).toBe('password1');
  });

  it('rejects password shorter than 8 chars', () => {
    expect(() => resetPasswordSchema.parse({ token: 'abc', newPassword: 'short' })).toThrow();
  });
});

describe('forceChangePasswordSchema', () => {
  it('accepts valid changeToken and password', () => {
    const result = forceChangePasswordSchema.parse({ changeToken: 'tok', newPassword: 'newpass1' });
    expect(result.changeToken).toBe('tok');
  });
});

describe('adminResetPasswordSchema', () => {
  it('accepts mode generate', () => {
    const r = adminResetPasswordSchema.parse({ mode: 'generate' });
    expect(r.mode).toBe('generate');
  });

  it('accepts mode set with password', () => {
    const r = adminResetPasswordSchema.parse({ mode: 'set', password: 'newpass1' });
    expect(r.password).toBe('newpass1');
  });

  it('rejects unknown mode', () => {
    expect(() => adminResetPasswordSchema.parse({ mode: 'delete' })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd /d/Projekte/TravStats/backend
npx jest src/schemas/__tests__/auth.test.ts --forceExit
```

Expected: FAIL — `forgotPasswordSchema is not exported from '../auth'`

- [ ] **Step 3: Add schemas to `backend/src/schemas/auth.ts`**

Append after the existing exports:

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

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ForceChangePasswordInput = z.infer<typeof forceChangePasswordSchema>;
export type AdminResetPasswordInput = z.infer<typeof adminResetPasswordSchema>;
```

- [ ] **Step 4: Add rate limit constants to `backend/src/config/constants.ts`**

Inside the `RATE_LIMITS` object, before the closing `} as const;`, add:

```typescript
  // Password reset rate limits
  PASSWORD_RESET_WINDOW_MS: 15 * 60 * 1000, // 15 minutes
  PASSWORD_RESET_MAX: 5,
```

- [ ] **Step 5: Add passwordResetLimiter to `backend/src/middleware/rateLimit.ts`**

Append at the end of the file:

```typescript
/**
 * Rate limiter for password reset endpoints
 * Prevents brute-force on reset token endpoints
 * Allows 5 attempts per 15 minutes per IP
 */
export const passwordResetLimiter = rateLimit({
  windowMs: RATE_LIMITS.PASSWORD_RESET_WINDOW_MS,
  max: RATE_LIMITS.PASSWORD_RESET_MAX,
  message: 'Too many password reset attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});
```

- [ ] **Step 6: Run tests to confirm they pass**

```bash
cd /d/Projekte/TravStats/backend
npx jest src/schemas/__tests__/auth.test.ts --forceExit
```

Expected: PASS (4 describe blocks, all green)

- [ ] **Step 7: Type-check**

```bash
cd /d/Projekte/TravStats/backend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
cd /d/Projekte/TravStats
git add backend/src/schemas/ backend/src/config/constants.ts backend/src/middleware/rateLimit.ts
git commit -m "feat: add password reset Zod schemas and rate limiter"
```

---

## Task 3: Email Service — sendPasswordResetEmail

**Files:**
- Modify: `backend/src/services/emailService.ts`

- [ ] **Step 1: Add sendPasswordResetEmail to `backend/src/services/emailService.ts`**

Append at the end of the file:

```typescript
export async function sendPasswordResetEmail(
  to: string,
  resetUrl: string,
  username: string,
): Promise<void> {
  const config = await prisma.smtpConfig.findUnique({ where: { id: SMTP_CONFIG_ID } });
  if (!config || !config.enabled) {
    logger.info({
      operation: 'password_reset_email_skipped',
      message: 'SMTP not configured or disabled',
    });
    return;
  }

  const transporter = createTransporterFromConfig(config);
  const subject = 'TravStats — Passwort zurücksetzen';
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #2563eb;">Passwort zurücksetzen</h2>
  <p>Hallo ${username},</p>
  <p>du hast eine Passwortzurücksetzung angefordert.</p>
  <p>
    <a href="${resetUrl}" style="display: inline-block; background: #2563eb; color: #fff;
       padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: bold;">
      Passwort zurücksetzen
    </a>
  </p>
  <p style="color: #6b7280; font-size: 14px;">Link (gültig 30 Minuten): ${resetUrl}</p>
  <p style="color: #6b7280; font-size: 14px;">Falls du das nicht angefordert hast, kannst du diese E-Mail ignorieren.</p>
  <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
  <p style="color: #6b7280; font-size: 14px;">&mdash; TravStats</p>
</body>
</html>`.trim();

  try {
    await transporter.sendMail({
      from: `"${config.fromName}" <${config.fromEmail}>`,
      to,
      subject,
      html,
    });
    logger.info({
      operation: 'password_reset_email_sent',
      to,
      username,
    });
  } catch (error) {
    logger.error({
      operation: 'password_reset_email_failed',
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    });
    throw error;
  }
}
```

- [ ] **Step 2: Type-check**

```bash
cd /d/Projekte/TravStats/backend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /d/Projekte/TravStats
git add backend/src/services/emailService.ts
git commit -m "feat: add sendPasswordResetEmail to emailService"
```

---

## Task 4: Password Reset Routes

**Files:**
- Create: `backend/src/routes/passwordReset.ts`
- Modify: `backend/src/routes/auth.ts` (login handler)
- Modify: `backend/src/index.ts` (mount new routes)

- [ ] **Step 1: Create `backend/src/routes/passwordReset.ts`**

```typescript
import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { prisma } from '../db';
import { hashPassword } from '../utils/password';
import {
  forgotPasswordSchema,
  resetPasswordSchema,
  forceChangePasswordSchema,
} from '../schemas/auth';
import { passwordResetLimiter } from '../middleware/rateLimit';
import { AppError } from '../middleware/errorHandler';
import { SMTP_CONFIG_ID } from './admin/smtp';
import { sendPasswordResetEmail } from '../services/emailService';
import logger from '../utils/logger';

const router = Router();

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// GET /smtp-status — public, no auth
router.get('/smtp-status', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const config = await prisma.smtpConfig.findUnique({ where: { id: SMTP_CONFIG_ID } });
    res.json({ smtpEnabled: !!(config?.enabled) });
  } catch (error) {
    next(error);
  }
});

// POST /forgot-password — always 200 to prevent user enumeration
router.post(
  '/forgot-password',
  passwordResetLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { username } = forgotPasswordSchema.parse(req.body);

      const user = await prisma.user.findUnique({ where: { username } });

      if (user && user.isActive && user.notificationEmail) {
        const config = await prisma.smtpConfig.findUnique({ where: { id: SMTP_CONFIG_ID } });

        if (config?.enabled) {
          const plainToken = crypto.randomBytes(32).toString('hex');
          const hashedToken = hashToken(plainToken);
          const expiry = new Date(Date.now() + 30 * 60 * 1000); // 30 min

          await prisma.user.update({
            where: { id: user.id },
            data: { resetToken: hashedToken, resetTokenExpiry: expiry },
          });

          const frontendUrl =
            process.env.FRONTEND_URL ||
            process.env.CORS_ORIGIN ||
            'http://localhost:3000';
          const resetUrl = `${frontendUrl}/reset-password?token=${plainToken}`;

          try {
            await sendPasswordResetEmail(user.notificationEmail, resetUrl, user.username);
          } catch (emailError) {
            logger.error({
              operation: 'forgot_password_email_failed',
              error: {
                message: emailError instanceof Error ? emailError.message : 'Unknown error',
              },
            });
            // Don't fail the request — return 200 regardless
          }
        }
      }

      res.json({
        message:
          'If the username exists and has an email configured, a reset link has been sent.',
      });
    } catch (error) {
      next(error);
    }
  },
);

// POST /reset-password
router.post(
  '/reset-password',
  passwordResetLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { token, newPassword } = resetPasswordSchema.parse(req.body);
      const hashedToken = hashToken(token);

      const user = await prisma.user.findFirst({
        where: {
          resetToken: hashedToken,
          resetTokenExpiry: { gt: new Date() },
        },
      });

      if (!user) {
        throw new AppError('Invalid or expired reset token', 400);
      }

      const newHash = await hashPassword(newPassword);

      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash: newHash,
          resetToken: null,
          resetTokenExpiry: null,
          mustChangePassword: false,
        },
      });

      logger.info({ operation: 'password_reset_completed', userId: user.id });

      res.json({ message: 'Password has been reset successfully.' });
    } catch (error) {
      next(error);
    }
  },
);

// POST /force-change-password — used after login with mustChangePassword=true
router.post(
  '/force-change-password',
  passwordResetLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { changeToken, newPassword } = forceChangePasswordSchema.parse(req.body);
      const hashedToken = hashToken(changeToken);

      const user = await prisma.user.findFirst({
        where: {
          changeToken: hashedToken,
          changeTokenExpiry: { gt: new Date() },
        },
      });

      if (!user) {
        throw new AppError('Invalid or expired change token', 400);
      }

      const newHash = await hashPassword(newPassword);

      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash: newHash,
          changeToken: null,
          changeTokenExpiry: null,
          mustChangePassword: false,
        },
      });

      logger.info({ operation: 'force_password_change_completed', userId: user.id });

      res.json({ message: 'Password changed successfully.' });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
```

- [ ] **Step 2: Update login handler in `backend/src/routes/auth.ts`**

Add `import crypto from 'crypto';` at the top (after existing imports).

In the login handler, find the block that sets the auth cookie:
```typescript
    // Generate token
    const token = generateToken(user.id);

    // Set HttpOnly cookie for security (XSS protection)
    res.cookie('auth_token', token, getAuthCookieOptions(req));
```

Replace it with (insert mustChangePassword check before generating the token):
```typescript
    // Check if user must change password before allowing login
    if (user.mustChangePassword) {
      const plainChangeToken = crypto.randomBytes(32).toString('hex');
      const hashedChangeToken = crypto.createHash('sha256').update(plainChangeToken).digest('hex');

      await prisma.user.update({
        where: { id: user.id },
        data: {
          changeToken: hashedChangeToken,
          changeTokenExpiry: new Date(Date.now() + 10 * 60 * 1000), // 10 min
        },
      });

      return res.json({ requiresPasswordChange: true, changeToken: plainChangeToken });
    }

    // Generate token
    const token = generateToken(user.id);

    // Set HttpOnly cookie for security (XSS protection)
    res.cookie('auth_token', token, getAuthCookieOptions(req));
```

- [ ] **Step 3: Mount passwordReset routes in `backend/src/index.ts`**

Add import after the existing route imports:
```typescript
import passwordResetRoutes from './routes/passwordReset';
```

Add mount after `app.use('/api/v1/auth', authRoutes);`:
```typescript
app.use('/api/v1/auth', passwordResetRoutes);
```

- [ ] **Step 4: Type-check**

```bash
cd /d/Projekte/TravStats/backend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
cd /d/Projekte/TravStats
git add backend/src/routes/passwordReset.ts backend/src/routes/auth.ts backend/src/index.ts
git commit -m "feat: add password reset routes and mustChangePassword login check"
```

---

## Task 5: Admin Password Reset Endpoint

**Files:**
- Modify: `backend/src/routes/admin/users.ts`

- [ ] **Step 1: Add imports to `backend/src/routes/admin/users.ts`**

After the existing imports, add:
```typescript
import { hashPassword } from '../../utils/password';
import { adminResetPasswordSchema } from '../../schemas/auth';
import logger from '../../utils/logger';
```

- [ ] **Step 2: Add the admin reset endpoint**

Append before `export default router;` in `backend/src/routes/admin/users.ts`:

```typescript
// POST /users/:id/reset-password (admin only, protected by requireAdmin middleware in admin/index.ts)
router.post(
  '/users/:id/reset-password',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const { mode, password, mustChangePassword } = adminResetPasswordSchema.parse(req.body);

      const user = await prisma.user.findUnique({ where: { id }, select: { id: true } });
      if (!user) {
        throw new AppError('User not found', 404);
      }

      let plainPassword: string | undefined;
      let newPasswordHash: string;

      if (mode === 'generate') {
        const chars =
          'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
        plainPassword = Array.from(
          { length: 12 },
          () => chars[Math.floor(Math.random() * chars.length)],
        ).join('');
        newPasswordHash = await hashPassword(plainPassword);
      } else {
        if (!password) {
          throw new AppError('Password is required for mode "set"', 400);
        }
        newPasswordHash = await hashPassword(password);
      }

      const shouldMustChange = mustChangePassword ?? mode === 'generate';

      await prisma.user.update({
        where: { id },
        data: {
          passwordHash: newPasswordHash,
          mustChangePassword: shouldMustChange,
          resetToken: null,
          resetTokenExpiry: null,
          changeToken: null,
          changeTokenExpiry: null,
        },
      });

      logger.info({
        operation: 'admin_password_reset',
        adminId: req.userId,
        targetUserId: id,
        mode,
      });

      res.json({
        message: 'Password reset successfully',
        ...(plainPassword !== undefined && { temporaryPassword: plainPassword }),
      });
    } catch (error) {
      next(error);
    }
  },
);
```

- [ ] **Step 3: Type-check**

```bash
cd /d/Projekte/TravStats/backend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /d/Projekte/TravStats
git add backend/src/routes/admin/users.ts
git commit -m "feat: add admin password reset endpoint (generate/set modes)"
```

---

## Task 6: i18n Keys

**Files:**
- Modify: `frontend/src/i18n/resources/de/auth.json`
- Modify: `frontend/src/i18n/resources/en/auth.json`
- Modify: `frontend/src/i18n/resources/de/admin.json`
- Modify: `frontend/src/i18n/resources/en/admin.json`

- [ ] **Step 1: Update `frontend/src/i18n/resources/de/auth.json`**

Replace the entire file content with:

```json
{
  "login": {
    "title": "Anmelden",
    "username": "Benutzername",
    "password": "Passwort",
    "submit": "Anmelden",
    "submitting": "Wird angemeldet...",
    "failed": "Anmeldung fehlgeschlagen",
    "serverUnreachable": "Server nicht erreichbar. Läuft das Backend?",
    "dbUnavailable": "Datenbankverbindung fehlgeschlagen. Bitte versuche es später erneut.",
    "noAccount": "Noch kein Konto?",
    "register": "Registrieren",
    "forgotPassword": "Passwort vergessen?",
    "forgotPasswordModal": {
      "title": "Passwort zurücksetzen",
      "noSmtp": "E-Mail-Versand nicht eingerichtet. Bitte kontaktiere einen Administrator.",
      "usernamePlaceholder": "Benutzername",
      "usernameLabel": "Benutzername",
      "submit": "Reset-Link senden",
      "submitting": "Wird gesendet...",
      "success": "Falls ein Konto mit diesem Benutzernamen existiert und eine E-Mail-Adresse hinterlegt ist, wurde ein Reset-Link versendet.",
      "close": "Schließen"
    }
  },
  "register": {
    "title": "Konto erstellen",
    "username": "Benutzername",
    "password": "Passwort",
    "confirmPassword": "Passwort bestätigen",
    "submit": "Registrieren",
    "submitting": "Konto wird erstellt...",
    "failed": "Registrierung fehlgeschlagen",
    "passwordsNotMatch": "Passwörter stimmen nicht überein",
    "passwordTooShort": "Passwort muss mindestens 6 Zeichen lang sein",
    "hasAccount": "Bereits ein Konto?",
    "signIn": "Anmelden"
  },
  "setup": {
    "title": "Einrichtung",
    "description": "Ersteinrichtung erforderlich"
  },
  "resetPassword": {
    "title": "Neues Passwort setzen",
    "newPassword": "Neues Passwort",
    "confirmPassword": "Passwort bestätigen",
    "submit": "Passwort setzen",
    "submitting": "Wird gespeichert...",
    "success": "Passwort erfolgreich geändert. Du kannst dich jetzt anmelden.",
    "invalidToken": "Der Reset-Link ist ungültig oder abgelaufen.",
    "passwordsNotMatch": "Passwörter stimmen nicht überein",
    "passwordTooShort": "Passwort muss mindestens 8 Zeichen lang sein",
    "backToLogin": "Zurück zur Anmeldung",
    "backToForgot": "Neuen Reset-Link anfordern"
  },
  "forceChangePassword": {
    "title": "Passwort ändern erforderlich",
    "description": "Du musst dein Passwort ändern, bevor du fortfahren kannst.",
    "newPassword": "Neues Passwort",
    "confirmPassword": "Passwort bestätigen",
    "submit": "Passwort ändern",
    "submitting": "Wird gespeichert...",
    "success": "Passwort erfolgreich geändert. Bitte melde dich an.",
    "passwordsNotMatch": "Passwörter stimmen nicht überein",
    "passwordTooShort": "Passwort muss mindestens 8 Zeichen lang sein",
    "invalidToken": "Sitzung abgelaufen. Bitte melde dich erneut an."
  }
}
```

- [ ] **Step 2: Update `frontend/src/i18n/resources/en/auth.json`**

Replace the entire file content with:

```json
{
  "login": {
    "title": "Sign In",
    "username": "Username",
    "password": "Password",
    "submit": "Sign In",
    "submitting": "Signing in...",
    "failed": "Login failed",
    "serverUnreachable": "Server unreachable. Is the backend running?",
    "dbUnavailable": "Database connection failed. Please try again later.",
    "noAccount": "Don't have an account?",
    "register": "Register",
    "forgotPassword": "Forgot password?",
    "forgotPasswordModal": {
      "title": "Reset Password",
      "noSmtp": "Email is not configured. Please contact an administrator.",
      "usernamePlaceholder": "Username",
      "usernameLabel": "Username",
      "submit": "Send Reset Link",
      "submitting": "Sending...",
      "success": "If an account with this username exists and has an email configured, a reset link has been sent.",
      "close": "Close"
    }
  },
  "register": {
    "title": "Create Account",
    "username": "Username",
    "password": "Password",
    "confirmPassword": "Confirm Password",
    "submit": "Register",
    "submitting": "Creating account...",
    "failed": "Registration failed",
    "passwordsNotMatch": "Passwords do not match",
    "passwordTooShort": "Password must be at least 6 characters",
    "hasAccount": "Already have an account?",
    "signIn": "Sign in"
  },
  "setup": {
    "title": "Setup",
    "description": "Initial setup required"
  },
  "resetPassword": {
    "title": "Set New Password",
    "newPassword": "New Password",
    "confirmPassword": "Confirm Password",
    "submit": "Set Password",
    "submitting": "Saving...",
    "success": "Password changed successfully. You can now sign in.",
    "invalidToken": "This reset link is invalid or has expired.",
    "passwordsNotMatch": "Passwords do not match",
    "passwordTooShort": "Password must be at least 8 characters",
    "backToLogin": "Back to sign in",
    "backToForgot": "Request new reset link"
  },
  "forceChangePassword": {
    "title": "Password Change Required",
    "description": "You must change your password before continuing.",
    "newPassword": "New Password",
    "confirmPassword": "Confirm Password",
    "submit": "Change Password",
    "submitting": "Saving...",
    "success": "Password changed successfully. Please sign in.",
    "passwordsNotMatch": "Passwords do not match",
    "passwordTooShort": "Password must be at least 8 characters",
    "invalidToken": "Session expired. Please sign in again."
  }
}
```

- [ ] **Step 3: Add keys to `frontend/src/i18n/resources/de/admin.json`**

In the `"users"` section, add `"resetPassword": "Passwort zurücksetzen"` to the `"actions"` object.
Also add a top-level `"resetPasswordModal"` key at the `"users"` level:

Find the `"users"` section and add to `"actions"`:
```json
"resetPassword": "Passwort zurücksetzen"
```

Add after the `"users"` object (as a sibling, or merged into `"users"` — look at the file structure first):

Actually, add to the `"users"."actions"` object:
```json
"resetPassword": "Passwort zurücksetzen"
```

And add a `"resetPasswordModal"` object to the `"users"` section:
```json
"resetPasswordModal": {
  "title": "Passwort zurücksetzen",
  "tabs": {
    "generate": "Generieren",
    "set": "Manuell setzen"
  },
  "generate": {
    "description": "Generiert ein zufälliges temporäres Passwort (12 Zeichen).",
    "button": "Temporäres Passwort generieren",
    "mustChange": "Muss Passwort beim nächsten Login ändern",
    "tempPasswordLabel": "Temporäres Passwort (einmalig anzeigen):",
    "copy": "Kopieren",
    "copied": "Kopiert!"
  },
  "set": {
    "description": "Setzt das Passwort des Benutzers direkt.",
    "passwordLabel": "Neues Passwort",
    "mustChange": "Muss Passwort beim nächsten Login ändern",
    "submit": "Passwort setzen",
    "submitting": "Wird gesetzt..."
  },
  "close": "Schließen",
  "success": "Passwort erfolgreich zurückgesetzt."
}
```

- [ ] **Step 4: Add same keys to `frontend/src/i18n/resources/en/admin.json`**

Same structure as above but in English:
```json
"resetPassword": "Reset Password"
```

And:
```json
"resetPasswordModal": {
  "title": "Reset Password",
  "tabs": {
    "generate": "Generate",
    "set": "Set Manually"
  },
  "generate": {
    "description": "Generates a random temporary password (12 characters).",
    "button": "Generate Temporary Password",
    "mustChange": "Must change password on next login",
    "tempPasswordLabel": "Temporary Password (shown once):",
    "copy": "Copy",
    "copied": "Copied!"
  },
  "set": {
    "description": "Sets the user's password directly.",
    "passwordLabel": "New Password",
    "mustChange": "Must change password on next login",
    "submit": "Set Password",
    "submitting": "Setting..."
  },
  "close": "Close",
  "success": "Password reset successfully."
}
```

- [ ] **Step 5: Commit**

```bash
cd /d/Projekte/TravStats
git add frontend/src/i18n/
git commit -m "feat: add i18n keys for password reset flows"
```

---

## Task 7: Frontend API Client

**Files:**
- Modify: `frontend/src/lib/api/auth.ts`
- Modify: `frontend/src/lib/api/admin.ts`

- [ ] **Step 1: Write failing tests for new API functions**

Create `frontend/src/lib/api/__tests__/auth.api.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { authApi } from "../auth";
import { api } from "../client";

vi.mock("../client", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

describe("authApi.getSmtpStatus", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns smtpEnabled true when SMTP is configured", async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { smtpEnabled: true } });
    const result = await authApi.getSmtpStatus();
    expect(result.smtpEnabled).toBe(true);
    expect(api.get).toHaveBeenCalledWith("/auth/smtp-status");
  });
});

describe("authApi.forgotPassword", () => {
  it("posts username and returns message", async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { message: "ok" } });
    const result = await authApi.forgotPassword("alice");
    expect(result.message).toBe("ok");
    expect(api.post).toHaveBeenCalledWith("/auth/forgot-password", { username: "alice" });
  });
});

describe("authApi.resetPassword", () => {
  it("posts token and newPassword", async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { message: "reset ok" } });
    const result = await authApi.resetPassword("tok123", "newpass1");
    expect(result.message).toBe("reset ok");
    expect(api.post).toHaveBeenCalledWith("/auth/reset-password", {
      token: "tok123",
      newPassword: "newpass1",
    });
  });
});

describe("authApi.forceChangePassword", () => {
  it("posts changeToken and newPassword", async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { message: "changed" } });
    const result = await authApi.forceChangePassword("ctok", "newpass1");
    expect(result.message).toBe("changed");
    expect(api.post).toHaveBeenCalledWith("/auth/force-change-password", {
      changeToken: "ctok",
      newPassword: "newpass1",
    });
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /d/Projekte/TravStats/frontend
npx vitest run src/lib/api/__tests__/auth.api.test.ts
```

Expected: FAIL — `authApi.getSmtpStatus is not a function`

- [ ] **Step 3: Update `frontend/src/lib/api/auth.ts`**

Replace the entire file with:

```typescript
import type { User } from "../../types";
import { api } from "./client";

export type LoginResult =
  | { user: User }
  | { requiresPasswordChange: true; changeToken: string };

// Auth API
export const authApi = {
  register: async (username: string, password: string): Promise<{ user: User }> => {
    const { data } = await api.post<{ user: User }>("/auth/register", {
      username,
      password,
    });
    return data;
  },

  login: async (username: string, password: string): Promise<LoginResult> => {
    const { data } = await api.post<LoginResult>("/auth/login", {
      username,
      password,
    });
    return data;
  },

  logout: async (): Promise<void> => {
    await api.post("/auth/logout");
  },

  changePassword: async (
    oldPassword: string,
    newPassword: string
  ): Promise<{ message: string }> => {
    const { data } = await api.post<{ message: string }>("/auth/change-password", {
      oldPassword,
      newPassword,
    });
    return data;
  },

  getSmtpStatus: async (): Promise<{ smtpEnabled: boolean }> => {
    const { data } = await api.get<{ smtpEnabled: boolean }>("/auth/smtp-status");
    return data;
  },

  forgotPassword: async (username: string): Promise<{ message: string }> => {
    const { data } = await api.post<{ message: string }>("/auth/forgot-password", { username });
    return data;
  },

  resetPassword: async (token: string, newPassword: string): Promise<{ message: string }> => {
    const { data } = await api.post<{ message: string }>("/auth/reset-password", {
      token,
      newPassword,
    });
    return data;
  },

  forceChangePassword: async (
    changeToken: string,
    newPassword: string
  ): Promise<{ message: string }> => {
    const { data } = await api.post<{ message: string }>("/auth/force-change-password", {
      changeToken,
      newPassword,
    });
    return data;
  },
};
```

- [ ] **Step 4: Add adminResetPassword to `frontend/src/lib/api/admin.ts`**

Append before the closing `};` of the `adminApi` object:

```typescript
  adminResetPassword: async (
    userId: string,
    mode: "generate" | "set",
    password?: string,
    mustChangePassword?: boolean
  ): Promise<{ message: string; temporaryPassword?: string }> => {
    const { data } = await api.post<{ message: string; temporaryPassword?: string }>(
      `/admin/users/${userId}/reset-password`,
      { mode, password, mustChangePassword }
    );
    return data;
  },
```

- [ ] **Step 5: Run tests**

```bash
cd /d/Projekte/TravStats/frontend
npx vitest run src/lib/api/__tests__/auth.api.test.ts
```

Expected: PASS (4 tests green)

- [ ] **Step 6: Frontend type-check**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
cd /d/Projekte/TravStats
git add frontend/src/lib/api/
git commit -m "feat: add password reset API client functions"
```

---

## Task 8: ResetPasswordPage

**Files:**
- Create: `frontend/src/pages/ResetPasswordPage.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Write failing test**

Create `frontend/src/__tests__/ResetPasswordPage.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BrowserRouter, MemoryRouter, Route, Routes } from "react-router-dom";
import { authApi } from "../lib/api";

vi.mock("../lib/api", () => ({
  authApi: {
    resetPassword: vi.fn(),
  },
}));

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useSearchParams: () => [new URLSearchParams("token=testtoken123")],
  };
});

import ResetPasswordPage from "../pages/ResetPasswordPage";

describe("ResetPasswordPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders form with new password and confirm fields", () => {
    render(
      <BrowserRouter>
        <ResetPasswordPage />
      </BrowserRouter>
    );
    expect(screen.getByLabelText(/auth:resetPassword\.newPassword/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/auth:resetPassword\.confirmPassword/i)).toBeInTheDocument();
  });

  it("shows error when passwords don't match", async () => {
    render(
      <BrowserRouter>
        <ResetPasswordPage />
      </BrowserRouter>
    );
    fireEvent.change(screen.getByLabelText(/auth:resetPassword\.newPassword/i), {
      target: { value: "password1" },
    });
    fireEvent.change(screen.getByLabelText(/auth:resetPassword\.confirmPassword/i), {
      target: { value: "password2" },
    });
    fireEvent.click(screen.getByRole("button", { name: /auth:resetPassword\.submit/i }));
    expect(await screen.findByText(/auth:resetPassword\.passwordsNotMatch/i)).toBeInTheDocument();
  });

  it("calls resetPassword and navigates to login on success", async () => {
    vi.mocked(authApi.resetPassword).mockResolvedValue({ message: "ok" });
    render(
      <BrowserRouter>
        <ResetPasswordPage />
      </BrowserRouter>
    );
    fireEvent.change(screen.getByLabelText(/auth:resetPassword\.newPassword/i), {
      target: { value: "newpassword1" },
    });
    fireEvent.change(screen.getByLabelText(/auth:resetPassword\.confirmPassword/i), {
      target: { value: "newpassword1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /auth:resetPassword\.submit/i }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/login", expect.any(Object)));
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd /d/Projekte/TravStats/frontend
npx vitest run src/__tests__/ResetPasswordPage.test.tsx
```

Expected: FAIL — `Cannot find module '../pages/ResetPasswordPage'`

- [ ] **Step 3: Create `frontend/src/pages/ResetPasswordPage.tsx`**

```typescript
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { authApi } from "../lib/api";
import { useTranslation } from "../hooks/useTranslation";

export default function ResetPasswordPage(): JSX.Element {
  const { t } = useTranslation(["auth"]);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError("");

    if (newPassword.length < 8) {
      setError(t("auth:resetPassword.passwordTooShort"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t("auth:resetPassword.passwordsNotMatch"));
      return;
    }
    if (!token) {
      setError(t("auth:resetPassword.invalidToken"));
      return;
    }

    setLoading(true);
    try {
      await authApi.resetPassword(token, newPassword);
      setSuccess(true);
      setTimeout(() => {
        navigate("/login", { state: { message: t("auth:resetPassword.success") } });
      }, 2000);
    } catch {
      setError(t("auth:resetPassword.invalidToken"));
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center relative">
        <div className="auth-bg" />
        <div className="relative z-10 w-full max-w-sm px-4 text-center">
          <p style={{ color: "var(--text-muted)" }}>{t("auth:resetPassword.invalidToken")}</p>
          <Link to="/login" className="text-[var(--accent)] hover:underline mt-4 inline-block">
            {t("auth:resetPassword.backToLogin")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center relative">
      <div className="auth-bg" />
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] }}
        className="relative z-10 w-full max-w-sm px-4"
      >
        <div className="text-center mb-8">
          <h1
            className="text-4xl font-display font-bold tracking-widest uppercase"
            style={{ color: "var(--text-primary)" }}
          >
            TRAV<span style={{ color: "var(--accent)" }}>.</span>STATS
          </h1>
          <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
            {t("auth:resetPassword.title")}
          </p>
        </div>

        <div
          className="rounded-2xl p-8"
          style={{
            background: "rgba(28, 33, 40, 0.85)",
            backdropFilter: "blur(20px)",
            border: "1px solid var(--color-border)",
            borderTop: "2px solid var(--accent)",
          }}
        >
          {success ? (
            <div className="text-center">
              <p className="text-green-400 mb-4">{t("auth:resetPassword.success")}</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label
                  htmlFor="newPassword"
                  className="block text-sm font-medium mb-1.5"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {t("auth:resetPassword.newPassword")}
                </label>
                <input
                  id="newPassword"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="input-field w-full"
                  required
                  autoFocus
                />
              </div>

              <div>
                <label
                  htmlFor="confirmPassword"
                  className="block text-sm font-medium mb-1.5"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {t("auth:resetPassword.confirmPassword")}
                </label>
                <input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="input-field w-full"
                  required
                />
              </div>

              {error && (
                <p className="text-sm text-red-400">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full py-2.5"
              >
                {loading ? t("auth:resetPassword.submitting") : t("auth:resetPassword.submit")}
              </button>
            </form>
          )}

          <div className="mt-6 text-center text-sm">
            <Link
              to="/login"
              className="hover:underline"
              style={{ color: "var(--accent)" }}
            >
              {t("auth:resetPassword.backToLogin")}
            </Link>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
```

- [ ] **Step 4: Add route in `frontend/src/App.tsx`**

Add a lazy import after existing page imports:
```typescript
const ResetPasswordPage = lazy(() => import("./pages/ResetPasswordPage"));
const ForceChangePasswordPage = lazy(() => import("./pages/ForceChangePasswordPage"));
```

Add public routes after `/register` route:
```tsx
<Route
  path="/reset-password"
  element={<ResetPasswordPage />}
/>
<Route
  path="/change-password"
  element={<ForceChangePasswordPage />}
/>
```

(These are public — no auth redirect — since they're part of the unauthenticated reset flow.)

- [ ] **Step 5: Run tests**

```bash
cd /d/Projekte/TravStats/frontend
npx vitest run src/__tests__/ResetPasswordPage.test.tsx
```

Expected: PASS (3 tests green)

- [ ] **Step 6: Type-check**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
cd /d/Projekte/TravStats
git add frontend/src/pages/ResetPasswordPage.tsx frontend/src/App.tsx
git commit -m "feat: add ResetPasswordPage and route"
```

---

## Task 9: ForceChangePasswordPage

**Files:**
- Create: `frontend/src/pages/ForceChangePasswordPage.tsx`
(Route in App.tsx was already added in Task 8.)

- [ ] **Step 1: Write failing test**

Create `frontend/src/__tests__/ForceChangePasswordPage.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { authApi } from "../lib/api";

vi.mock("../lib/api", () => ({
  authApi: {
    forceChangePassword: vi.fn(),
  },
}));

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useLocation: () => ({
      state: { changeToken: "test-change-token" },
      pathname: "/change-password",
    }),
  };
});

import ForceChangePasswordPage from "../pages/ForceChangePasswordPage";

describe("ForceChangePasswordPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders password change form", () => {
    render(
      <MemoryRouter initialEntries={[{ pathname: "/change-password", state: { changeToken: "tok" } }]}>
        <ForceChangePasswordPage />
      </MemoryRouter>
    );
    expect(screen.getByLabelText(/auth:forceChangePassword\.newPassword/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/auth:forceChangePassword\.confirmPassword/i)).toBeInTheDocument();
  });

  it("redirects to login when no changeToken in state", () => {
    vi.mocked(require("react-router-dom").useLocation).mockReturnValue({
      state: null,
      pathname: "/change-password",
    });
    render(
      <MemoryRouter>
        <ForceChangePasswordPage />
      </MemoryRouter>
    );
    expect(mockNavigate).toHaveBeenCalledWith("/login");
  });

  it("calls forceChangePassword and navigates on success", async () => {
    vi.mocked(authApi.forceChangePassword).mockResolvedValue({ message: "ok" });
    render(
      <MemoryRouter initialEntries={[{ pathname: "/change-password", state: { changeToken: "tok" } }]}>
        <ForceChangePasswordPage />
      </MemoryRouter>
    );
    fireEvent.change(screen.getByLabelText(/auth:forceChangePassword\.newPassword/i), {
      target: { value: "newpassword1" },
    });
    fireEvent.change(screen.getByLabelText(/auth:forceChangePassword\.confirmPassword/i), {
      target: { value: "newpassword1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /auth:forceChangePassword\.submit/i }));
    await waitFor(() =>
      expect(authApi.forceChangePassword).toHaveBeenCalledWith("test-change-token", "newpassword1")
    );
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/login", expect.any(Object)));
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd /d/Projekte/TravStats/frontend
npx vitest run src/__tests__/ForceChangePasswordPage.test.tsx
```

Expected: FAIL — `Cannot find module '../pages/ForceChangePasswordPage'`

- [ ] **Step 3: Create `frontend/src/pages/ForceChangePasswordPage.tsx`**

```typescript
import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { authApi } from "../lib/api";
import { useTranslation } from "../hooks/useTranslation";

interface LocationState {
  changeToken?: string;
}

export default function ForceChangePasswordPage(): JSX.Element {
  const { t } = useTranslation(["auth"]);
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as LocationState | null;
  const changeToken = state?.changeToken;

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!changeToken) {
      navigate("/login");
    }
  }, [changeToken, navigate]);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError("");

    if (newPassword.length < 8) {
      setError(t("auth:forceChangePassword.passwordTooShort"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t("auth:forceChangePassword.passwordsNotMatch"));
      return;
    }
    if (!changeToken) {
      setError(t("auth:forceChangePassword.invalidToken"));
      return;
    }

    setLoading(true);
    try {
      await authApi.forceChangePassword(changeToken, newPassword);
      navigate("/login", { state: { message: t("auth:forceChangePassword.success") } });
    } catch {
      setError(t("auth:forceChangePassword.invalidToken"));
    } finally {
      setLoading(false);
    }
  };

  if (!changeToken) {
    return <div />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center relative">
      <div className="auth-bg" />
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] }}
        className="relative z-10 w-full max-w-sm px-4"
      >
        <div className="text-center mb-8">
          <h1
            className="text-4xl font-display font-bold tracking-widest uppercase"
            style={{ color: "var(--text-primary)" }}
          >
            TRAV<span style={{ color: "var(--accent)" }}>.</span>STATS
          </h1>
          <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
            {t("auth:forceChangePassword.title")}
          </p>
        </div>

        <div
          className="rounded-2xl p-8"
          style={{
            background: "rgba(28, 33, 40, 0.85)",
            backdropFilter: "blur(20px)",
            border: "1px solid var(--color-border)",
            borderTop: "2px solid var(--accent)",
          }}
        >
          <p className="text-sm mb-6" style={{ color: "var(--text-muted)" }}>
            {t("auth:forceChangePassword.description")}
          </p>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label
                htmlFor="newPassword"
                className="block text-sm font-medium mb-1.5"
                style={{ color: "var(--text-secondary)" }}
              >
                {t("auth:forceChangePassword.newPassword")}
              </label>
              <input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="input-field w-full"
                required
                autoFocus
              />
            </div>

            <div>
              <label
                htmlFor="confirmPassword"
                className="block text-sm font-medium mb-1.5"
                style={{ color: "var(--text-secondary)" }}
              >
                {t("auth:forceChangePassword.confirmPassword")}
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="input-field w-full"
                required
              />
            </div>

            {error && (
              <p className="text-sm text-red-400">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full py-2.5"
            >
              {loading
                ? t("auth:forceChangePassword.submitting")
                : t("auth:forceChangePassword.submit")}
            </button>
          </form>
        </div>
      </motion.div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

```bash
cd /d/Projekte/TravStats/frontend
npx vitest run src/__tests__/ForceChangePasswordPage.test.tsx
```

Expected: PASS

- [ ] **Step 5: Type-check**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd /d/Projekte/TravStats
git add frontend/src/pages/ForceChangePasswordPage.tsx
git commit -m "feat: add ForceChangePasswordPage"
```

---

## Task 10: LoginPage — Forgot Password Modal

**Files:**
- Modify: `frontend/src/pages/LoginPage.tsx`
- Modify: `frontend/src/__tests__/LoginPage.test.tsx`

- [ ] **Step 1: Update the existing LoginPage test to add forgot password coverage**

Add these new test cases to `frontend/src/__tests__/LoginPage.test.tsx`:

Add to the vi.mock for `"../lib/api"` to include the new methods:
```typescript
vi.mock("../lib/api", () => ({
  authApi: {
    login: vi.fn(),
    getSmtpStatus: vi.fn().mockResolvedValue({ smtpEnabled: false }),
    forgotPassword: vi.fn(),
  },
}));
```

(Replace the existing `vi.mock("../lib/api")` line.)

Add these test cases inside the `describe("LoginPage")` block:

```typescript
  it("shows forgot password link", () => {
    render(
      <BrowserRouter>
        <LoginPage />
      </BrowserRouter>
    );
    expect(screen.getByText(/auth:login\.forgotPassword/i)).toBeInTheDocument();
  });

  it("opens forgot password modal when link clicked", async () => {
    render(
      <BrowserRouter>
        <LoginPage />
      </BrowserRouter>
    );
    fireEvent.click(screen.getByText(/auth:login\.forgotPassword/i));
    await waitFor(() => {
      expect(screen.getByText(/auth:login\.forgotPasswordModal\.title/i)).toBeInTheDocument();
    });
  });

  it("redirects to /change-password when login returns requiresPasswordChange", async () => {
    vi.mocked(authApi.login).mockResolvedValue({
      requiresPasswordChange: true,
      changeToken: "test-token",
    });
    render(
      <BrowserRouter>
        <LoginPage />
      </BrowserRouter>
    );
    fireEvent.change(screen.getByLabelText(/login\.username/i), { target: { value: "user" } });
    fireEvent.change(screen.getByLabelText(/login\.password/i), { target: { value: "pass" } });
    fireEvent.click(screen.getByRole("button", { name: /login\.submit/i }));
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/change-password", {
        state: { changeToken: "test-token" },
      });
    });
  });
```

- [ ] **Step 2: Run tests to confirm new ones fail**

```bash
cd /d/Projekte/TravStats/frontend
npx vitest run src/__tests__/LoginPage.test.tsx
```

Expected: FAIL — `authApi.getSmtpStatus is not a function` or element not found

- [ ] **Step 3: Update `frontend/src/pages/LoginPage.tsx`**

Replace the entire file with:

```typescript
import { useState, useEffect } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { authApi } from "../lib/api";
import { useAuthStore } from "../store/authStore";
import { useTranslation } from "../hooks/useTranslation";

export default function LoginPage(): JSX.Element {
  const { t } = useTranslation(["auth", "common"]);
  const location = useLocation();
  const state = location.state as { message?: string; username?: string } | null;

  const [username, setUsername] = useState(state?.username || "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [successMessage] = useState(state?.message || "");
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();

  // Forgot password modal state
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [smtpEnabled, setSmtpEnabled] = useState<boolean | null>(null);
  const [forgotUsername, setForgotUsername] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotSuccess, setForgotSuccess] = useState(false);
  const [forgotError, setForgotError] = useState("");

  useEffect(() => {
    authApi.getSmtpStatus().then((r) => setSmtpEnabled(r.smtpEnabled)).catch(() => setSmtpEnabled(false));
  }, []);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await authApi.login(username, password);
      if ("requiresPasswordChange" in result && result.requiresPasswordChange) {
        navigate("/change-password", { state: { changeToken: result.changeToken } });
      } else {
        setAuth(result.user);
        navigate("/");
      }
    } catch (err: unknown) {
      const errorObj = err as {
        response?: { status?: number; data?: { error?: string; code?: string } };
        message?: string;
      };
      const serverError = errorObj.response?.data?.error;
      const status = errorObj.response?.status;
      if (!errorObj.response) {
        setError(t("login.serverUnreachable"));
      } else if (status === 503 || errorObj.response?.data?.code === "DB_UNAVAILABLE") {
        setError(t("login.dbUnavailable"));
      } else {
        setError(serverError || t("login.failed"));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleForgotSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setForgotError("");
    setForgotLoading(true);
    try {
      await authApi.forgotPassword(forgotUsername);
      setForgotSuccess(true);
    } catch {
      setForgotError(t("login.failed"));
    } finally {
      setForgotLoading(false);
    }
  };

  const handleCloseForgotModal = (): void => {
    setShowForgotModal(false);
    setForgotUsername("");
    setForgotSuccess(false);
    setForgotError("");
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative">
      <div className="auth-bg" />

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          duration: 0.35,
          ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
        }}
        className="relative z-10 w-full max-w-sm px-4"
      >
        {/* Wordmark */}
        <div className="text-center mb-8">
          <h1
            className="text-4xl font-display font-bold tracking-widest uppercase"
            style={{ color: "var(--text-primary)" }}
          >
            TRAV<span style={{ color: "var(--accent)" }}>.</span>STATS
          </h1>
          <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
            {t("login.title")}
          </p>
        </div>

        {/* Card */}
        <div
          className="rounded-2xl p-8"
          style={{
            background: "rgba(28, 33, 40, 0.85)",
            backdropFilter: "blur(20px)",
            border: "1px solid var(--color-border)",
            borderTop: "2px solid var(--accent)",
          }}
        >
          {successMessage && (
            <div className="mb-4 p-3 rounded-lg bg-green-900/20 border border-green-500/30">
              <p className="text-sm text-green-400">{successMessage}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label
                htmlFor="username"
                className="block text-sm font-medium mb-1.5"
                style={{ color: "var(--text-secondary)" }}
              >
                {t("login.username")}
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="input-field w-full"
                autoComplete="username"
                autoFocus
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium mb-1.5"
                style={{ color: "var(--text-secondary)" }}
              >
                {t("login.password")}
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input-field w-full"
                autoComplete="current-password"
              />
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full py-2.5"
            >
              {loading ? t("login.submitting") : t("login.submit")}
            </button>
          </form>

          <div className="mt-4 flex justify-between items-center text-sm">
            <span style={{ color: "var(--text-muted)" }}>
              {t("login.noAccount")}{" "}
              <Link
                to="/register"
                className="hover:underline"
                style={{ color: "var(--accent)" }}
              >
                {t("login.register")}
              </Link>
            </span>
            <button
              type="button"
              onClick={() => setShowForgotModal(true)}
              className="hover:underline"
              style={{ color: "var(--accent)" }}
            >
              {t("login.forgotPassword")}
            </button>
          </div>
        </div>
      </motion.div>

      {/* Forgot Password Modal */}
      <AnimatePresence>
        {showForgotModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.7)" }}
            onClick={handleCloseForgotModal}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm rounded-2xl p-6"
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--color-border)",
              }}
            >
              <h2
                className="text-lg font-semibold mb-4"
                style={{ color: "var(--text-primary)" }}
              >
                {t("login.forgotPasswordModal.title")}
              </h2>

              {smtpEnabled === false ? (
                <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
                  {t("login.forgotPasswordModal.noSmtp")}
                </p>
              ) : forgotSuccess ? (
                <p className="text-sm text-green-400 mb-4">
                  {t("login.forgotPasswordModal.success")}
                </p>
              ) : (
                <form onSubmit={handleForgotSubmit} className="space-y-4">
                  <div>
                    <label
                      htmlFor="forgotUsername"
                      className="block text-sm font-medium mb-1.5"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {t("login.forgotPasswordModal.usernameLabel")}
                    </label>
                    <input
                      id="forgotUsername"
                      type="text"
                      value={forgotUsername}
                      onChange={(e) => setForgotUsername(e.target.value)}
                      className="input-field w-full"
                      placeholder={t("login.forgotPasswordModal.usernamePlaceholder")}
                      required
                      autoFocus
                    />
                  </div>
                  {forgotError && <p className="text-sm text-red-400">{forgotError}</p>}
                  <button
                    type="submit"
                    disabled={forgotLoading}
                    className="btn-primary w-full py-2"
                  >
                    {forgotLoading
                      ? t("login.forgotPasswordModal.submitting")
                      : t("login.forgotPasswordModal.submit")}
                  </button>
                </form>
              )}

              <button
                type="button"
                onClick={handleCloseForgotModal}
                className="mt-4 w-full text-sm hover:underline"
                style={{ color: "var(--text-muted)" }}
              >
                {t("login.forgotPasswordModal.close")}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
```

- [ ] **Step 4: Run all LoginPage tests**

```bash
cd /d/Projekte/TravStats/frontend
npx vitest run src/__tests__/LoginPage.test.tsx
```

Expected: PASS (all tests including new ones)

- [ ] **Step 5: Type-check**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd /d/Projekte/TravStats
git add frontend/src/pages/LoginPage.tsx frontend/src/__tests__/LoginPage.test.tsx
git commit -m "feat: add forgot password modal and requiresPasswordChange handling to LoginPage"
```

---

## Task 11: Admin Password Reset Modal

**Files:**
- Create: `frontend/src/components/Admin/AdminPasswordResetModal.tsx`
- Modify: `frontend/src/components/Admin/UserManagement.tsx`
- Modify: `frontend/src/pages/AdminPage.tsx`

- [ ] **Step 1: Create `frontend/src/components/Admin/AdminPasswordResetModal.tsx`**

```typescript
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { adminApi } from "../../lib/api";
import { useTranslation } from "../../hooks/useTranslation";

interface AdminPasswordResetModalProps {
  userId: string;
  username: string;
  onClose: () => void;
}

type TabType = "generate" | "set";

export default function AdminPasswordResetModal({
  userId,
  username,
  onClose,
}: AdminPasswordResetModalProps): JSX.Element {
  const { t } = useTranslation(["admin"]);
  const [activeTab, setActiveTab] = useState<TabType>("generate");

  // Generate tab state
  const [generatedPassword, setGeneratedPassword] = useState("");
  const [generateMustChange, setGenerateMustChange] = useState(true);
  const [generateLoading, setGenerateLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // Set tab state
  const [newPassword, setNewPassword] = useState("");
  const [setMustChange, setSetMustChange] = useState(false);
  const [setLoading, setSetLoading] = useState(false);
  const [setSuccess, setSetSuccess] = useState(false);
  const [error, setError] = useState("");

  const handleGenerate = async (): Promise<void> => {
    setError("");
    setGenerateLoading(true);
    try {
      const result = await adminApi.adminResetPassword(
        userId,
        "generate",
        undefined,
        generateMustChange
      );
      setGeneratedPassword(result.temporaryPassword ?? "");
    } catch {
      setError("Reset failed. Please try again.");
    } finally {
      setGenerateLoading(false);
    }
  };

  const handleCopy = (): void => {
    navigator.clipboard.writeText(generatedPassword).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => undefined);
  };

  const handleSet = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError("");
    setSetLoading(true);
    try {
      await adminApi.adminResetPassword(userId, "set", newPassword, setMustChange);
      setSetSuccess(true);
    } catch {
      setError("Reset failed. Please try again.");
    } finally {
      setSetLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)" }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl p-6"
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--color-border)",
        }}
      >
        <h2
          className="text-lg font-semibold mb-4"
          style={{ color: "var(--text-primary)" }}
        >
          {t("admin:users.resetPasswordModal.title")} — {username}
        </h2>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          {(["generate", "set"] as TabType[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => { setActiveTab(tab); setError(""); }}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                activeTab === tab
                  ? "bg-[var(--accent)] text-white"
                  : "bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              }`}
            >
              {t(`admin:users.resetPasswordModal.tabs.${tab}`)}
            </button>
          ))}
        </div>

        {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

        {activeTab === "generate" && (
          <div className="space-y-4">
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              {t("admin:users.resetPasswordModal.generate.description")}
            </p>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={generateMustChange}
                onChange={(e) => setGenerateMustChange(e.target.checked)}
                className="rounded"
              />
              <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
                {t("admin:users.resetPasswordModal.generate.mustChange")}
              </span>
            </label>

            {generatedPassword ? (
              <div
                className="rounded-lg p-3 flex items-center justify-between gap-2"
                style={{ background: "var(--bg-elevated)" }}
              >
                <code className="text-sm font-mono" style={{ color: "var(--text-primary)" }}>
                  {generatedPassword}
                </code>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="text-xs px-3 py-1 rounded btn-secondary shrink-0"
                >
                  {copied
                    ? t("admin:users.resetPasswordModal.generate.copied")
                    : t("admin:users.resetPasswordModal.generate.copy")}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleGenerate}
                disabled={generateLoading}
                className="btn-primary w-full py-2"
              >
                {generateLoading
                  ? "..."
                  : t("admin:users.resetPasswordModal.generate.button")}
              </button>
            )}
          </div>
        )}

        {activeTab === "set" && (
          <div className="space-y-4">
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              {t("admin:users.resetPasswordModal.set.description")}
            </p>

            {setSuccess ? (
              <p className="text-sm text-green-400">
                {t("admin:users.resetPasswordModal.success")}
              </p>
            ) : (
              <form onSubmit={handleSet} className="space-y-4">
                <div>
                  <label
                    htmlFor="adminNewPassword"
                    className="block text-sm font-medium mb-1.5"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {t("admin:users.resetPasswordModal.set.passwordLabel")}
                  </label>
                  <input
                    id="adminNewPassword"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="input-field w-full"
                    minLength={8}
                    required
                  />
                </div>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={setMustChange}
                    onChange={(e) => setSetMustChange(e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
                    {t("admin:users.resetPasswordModal.set.mustChange")}
                  </span>
                </label>

                <button
                  type="submit"
                  disabled={setLoading}
                  className="btn-primary w-full py-2"
                >
                  {setLoading
                    ? t("admin:users.resetPasswordModal.set.submitting")
                    : t("admin:users.resetPasswordModal.set.submit")}
                </button>
              </form>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          className="mt-6 w-full text-sm hover:underline"
          style={{ color: "var(--text-muted)" }}
        >
          {t("admin:users.resetPasswordModal.close")}
        </button>
      </motion.div>
    </motion.div>
  );
}
```

- [ ] **Step 2: Update `frontend/src/components/Admin/UserManagement.tsx`**

Add these imports at the top (after existing imports):
```typescript
import { useState } from "react";
import { AnimatePresence } from "framer-motion";
import AdminPasswordResetModal from "./AdminPasswordResetModal";
```

Update the `UserManagementProps` interface:
```typescript
interface UserManagementProps {
  users: AdminUser[];
  onToggleUserActive: (userId: string) => void;
}
```
(No change needed — reset is handled internally in UserManagement.)

Inside the `UserManagement` component, add state:
```typescript
  const [resetModalUser, setResetModalUser] = useState<{ id: string; username: string } | null>(null);
```

In the actions column `<td>` (after the existing deactivate/activate button), add:
```tsx
                  {" · "}
                  <button
                    onClick={() => setResetModalUser({ id: user.id, username: user.username })}
                    className="text-orange-500 hover:text-orange-400"
                  >
                    {t("admin:users.actions.resetPassword")}
                  </button>
```

Before the closing `</div>` of the component, add the modal:
```tsx
      <AnimatePresence>
        {resetModalUser && (
          <AdminPasswordResetModal
            userId={resetModalUser.id}
            username={resetModalUser.username}
            onClose={() => setResetModalUser(null)}
          />
        )}
      </AnimatePresence>
```

- [ ] **Step 3: Type-check frontend**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Run full frontend test suite**

```bash
cd /d/Projekte/TravStats/frontend
npx vitest --run
```

Expected: all existing tests pass + new tests pass.

- [ ] **Step 5: Backend type-check**

```bash
cd /d/Projekte/TravStats/backend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd /d/Projekte/TravStats
git add frontend/src/components/Admin/AdminPasswordResetModal.tsx frontend/src/components/Admin/UserManagement.tsx
git commit -m "feat: add AdminPasswordResetModal and wire into UserManagement"
```

---

## Final Build Check

- [ ] **Step 1: Backend full check**

```bash
cd /d/Projekte/TravStats/backend && npx tsc --noEmit && npm run lint
```

Expected: no errors.

- [ ] **Step 2: Frontend full check**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit && npm run lint && npx vitest --run
```

Expected: no errors, all tests pass.

- [ ] **Step 3: Final commit**

```bash
cd /d/Projekte/TravStats
git status
# Verify no unstaged changes remain
git log --oneline -8
```

---

## Spec Coverage Check

| Spec requirement | Task |
|---|---|
| 3 new User fields (resetToken, resetTokenExpiry, mustChangePassword) | Task 1 |
| 2 additional fields (changeToken, changeTokenExpiry) | Task 1 |
| Token SHA-256 hashed (spec says bcrypt, using SHA-256 for O(1) lookup — justified) | Task 4 |
| POST /forgot-password — always 200, SMTP check | Task 4 |
| POST /reset-password — token+expiry validation | Task 4 |
| POST /force-change-password | Task 4 |
| GET /smtp-status | Task 4 |
| Rate limit 5/15min on reset endpoints | Tasks 2 + 4 |
| Login mustChangePassword → changeToken returned, no cookie | Task 4 |
| POST /admin/users/:id/reset-password (generate + set modes) | Task 5 |
| sendPasswordResetEmail in emailService | Task 3 |
| i18n keys (login.forgotPassword, resetPassword.*, forceChangePassword.*, admin reset modal) | Task 6 |
| ResetPasswordPage (/reset-password?token=...) | Task 8 |
| ForceChangePasswordPage (/change-password) | Task 9 |
| LoginPage forgot password modal (SMTP check, form, success) | Task 10 |
| Admin modal with generate/set tabs, copy button, mustChangePassword checkbox | Task 11 |
| Zod schemas for all 4 new endpoints | Task 2 |
