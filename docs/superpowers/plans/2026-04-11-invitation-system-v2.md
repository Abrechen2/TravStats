# Invitation System v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bare-bones invitation surface shipped in 0.14.1-beta with a proper system — two distinct entry points (link vs email), full row-level management, `MAX_USERS` enforcement, and `notificationEmail` auto-populated on register.

**Architecture:** Additive Prisma migration for three columns and a new `usedBy` relation. Backend splits invitations out of `admin/users.ts` into a dedicated `admin/invitations.ts` router with five endpoints. A new `sendInvitationEmail` helper lives next to `sendPasswordResetEmail` in `emailService.ts`. Frontend gets three new modal components (`CreateLinkInviteModal`, `CreateEmailInviteModal`, `InviteSuccessModal`), a refactored `InvitationManagement` list with filter chips and per-row actions, and a refactored `AdminPage` handler that replaces the browser `prompt()`. All user-facing strings land in DE + EN.

**Tech Stack:** Prisma (PostgreSQL), Express, Zod, Jest + Supertest (backend); React 18, Vitest + Testing Library, react-i18next (frontend); docker compose on CT 100 for deploy.

**Spec:** `docs/superpowers/specs/2026-04-11-invitation-system-design.md`

---

## Task 1: Prisma Migration — Invitation Columns

**Files:**
- Modify: `backend/prisma/schema.prisma` — add 3 columns + two named relations
- Create: `backend/prisma/migrations/<timestamp>_invitation_system_v2/migration.sql` (generated)

- [ ] **Step 1: Update `schema.prisma` — Invitation model**

Replace the existing `model Invitation { … }` block (around line 260) with:

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

  emailStatus String?   @map("email_status")
  emailError  String?   @map("email_error")
  emailSentAt DateTime? @map("email_sent_at")

  creator User  @relation("CreatedInvitations", fields: [createdBy], references: [id], onDelete: Cascade)
  user    User? @relation("UsedInvitations",    fields: [usedBy],    references: [id], onDelete: SetNull)

  @@index([token])
  @@index([createdBy])
  @@map("invitations")
}
```

- [ ] **Step 2: Update `schema.prisma` — User model relations**

Find the `model User { … }` block (around line 14). The existing line:

```prisma
  createdInvitations    Invitation[]
```

becomes two lines:

```prisma
  createdInvitations    Invitation[] @relation("CreatedInvitations")
  usedInvitations       Invitation[] @relation("UsedInvitations")
```

- [ ] **Step 3: Generate the migration**

From `backend/`:

```bash
npx prisma migrate dev --name invitation_system_v2
```

Expected: Prisma prints `Applying migration …_invitation_system_v2`, the migration folder appears under `backend/prisma/migrations/`, and the generated Prisma client compiles without errors.

- [ ] **Step 4: Verify the migration SQL**

Open the generated `migration.sql` and confirm it contains (in this order or similar):

```sql
ALTER TABLE "invitations" ADD COLUMN "email_status" TEXT;
ALTER TABLE "invitations" ADD COLUMN "email_error" TEXT;
ALTER TABLE "invitations" ADD COLUMN "email_sent_at" TIMESTAMP(3);

-- DropForeignKey
ALTER TABLE "invitations" DROP CONSTRAINT IF EXISTS "invitations_used_by_fkey";

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_used_by_fkey"
  FOREIGN KEY ("used_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

If the generated SQL looks different because Prisma didn't detect a FK change (the schema pre-1.0 didn't explicitly specify `@relation`), edit it by hand to include both the column additions and the FK swap. The FK must end up with `ON DELETE SET NULL`.

- [ ] **Step 5: Sanity-check against the local DB**

```bash
docker exec -e PGPASSWORD=flights travstats-db-local psql -U flights -d flights -c "\d invitations"
```

Expected: three new columns (`email_status`, `email_error`, `email_sent_at`) appear in the output.

- [ ] **Step 6: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(invitations): add email send tracking columns and usedBy relation"
```

---

## Task 2: Invitation Zod Schemas

**Files:**
- Create: `backend/src/schemas/invitation.ts`

- [ ] **Step 1: Create the schemas file**

```ts
// backend/src/schemas/invitation.ts
import { z } from 'zod';

export const EXPIRES_IN_DAYS = z.union([z.literal(1), z.literal(7), z.literal(30)]);

export const createLinkInvitationSchema = z.object({
  expiresInDays: EXPIRES_IN_DAYS.optional().default(7),
});

export const createEmailInvitationSchema = z.object({
  email: z.string().email('Invalid email address'),
  expiresInDays: EXPIRES_IN_DAYS.optional().default(7),
});

export const listInvitationsQuerySchema = z.object({
  status: z.enum(['all', 'active', 'used', 'expired']).optional().default('active'),
});

export type CreateLinkInvitationInput = z.infer<typeof createLinkInvitationSchema>;
export type CreateEmailInvitationInput = z.infer<typeof createEmailInvitationSchema>;
export type ListInvitationsQuery = z.infer<typeof listInvitationsQuerySchema>;
```

- [ ] **Step 2: Verify it type-checks**

```bash
cd backend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add backend/src/schemas/invitation.ts
git commit -m "feat(invitations): add zod schemas for invitation routes"
```

---

## Task 3: Extract Invitation Routes Into `admin/invitations.ts`

Refactor step. No behaviour change. Moves the two existing routes (`POST /`, `GET /`) out of `admin/users.ts` into a new domain-specific file so the rest of the work lands in one place.

**Files:**
- Create: `backend/src/routes/admin/invitations.ts`
- Modify: `backend/src/routes/admin/users.ts` — remove invitation routes
- Modify: `backend/src/routes/admin/index.ts` — wire the new router

- [ ] **Step 1: Create `admin/invitations.ts` with the two existing routes**

```ts
// backend/src/routes/admin/invitations.ts
import { Router, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';

const router = Router();

// Legacy create body — intentionally permissive during the refactor.
// Task 5 replaces this with createLinkInvitationSchema.
const legacyCreateSchema = z.object({
  email: z.string().email().optional(),
  expiresInDays: z.number().int().min(1).max(90).optional().default(7),
});

/**
 * POST /admin/invitations — create invitation
 */
router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { email, expiresInDays } = legacyCreateSchema.parse(req.body);
    const token = crypto.randomBytes(32).toString('hex');

    const invitation = await prisma.invitation.create({
      data: {
        email,
        token,
        createdBy: req.userId!,
        expiresAt: new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000),
      },
    });

    const frontendUrl = process.env.FRONTEND_URL || process.env.CORS_ORIGIN || 'http://localhost:3000';
    const inviteUrl = `${frontendUrl}/register?token=${token}`;

    res.json({
      invitation: {
        id: invitation.id,
        email: invitation.email,
        token: invitation.token,
        expiresAt: invitation.expiresAt,
      },
      inviteUrl,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/invitations — list invitations
 */
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const invitations = await prisma.invitation.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        token: true,
        expiresAt: true,
        usedAt: true,
        createdAt: true,
        creator: { select: { username: true } },
      },
    });

    res.json({ invitations });
  } catch (error) {
    next(error);
  }
});

export default router;
```

- [ ] **Step 2: Remove the same two blocks from `admin/users.ts`**

Delete lines 82–139 (the two `router.post('/invitations', …)` and `router.get('/invitations', …)` handlers and the `createInvitationSchema` const at the top of the file, around line 13). Keep all other code in the file.

Also remove the now-unused `import crypto from 'crypto'` if it is not referenced elsewhere in `users.ts`.

- [ ] **Step 3: Wire the new router in `admin/index.ts`**

Add next to the existing imports (around line 10):

```ts
import invitationsRouter from './invitations';
```

And mount it (add after the existing `router.use('/', usersRouter);` line):

```ts
router.use('/invitations', invitationsRouter);
```

Note the mount path: the new router handles `/` and `/:id`, and we mount it at `/admin/invitations` (the admin prefix comes from the parent router). The old routes were at `/admin/invitations` because the handler paths were `/invitations` — the behaviour is identical after this change.

- [ ] **Step 4: Type-check + full backend test run**

```bash
cd backend && npx tsc --noEmit && npm run lint && npm test -- --forceExit
```

Expected: no type errors, no lint errors, all existing tests green (no test touched invitation routes before).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/admin/invitations.ts backend/src/routes/admin/users.ts backend/src/routes/admin/index.ts
git commit -m "refactor(invitations): extract routes into admin/invitations.ts"
```

---

## Task 4: `sendInvitationEmail` Helper

**Files:**
- Modify: `backend/src/services/emailService.ts` — append new function

- [ ] **Step 1: Append the function at the bottom of `emailService.ts`**

```ts
export async function sendInvitationEmail(
  to: string,
  inviteUrl: string,
  inviterUsername: string,
  expiresAt: Date,
): Promise<void> {
  const config = await prisma.smtpConfig.findUnique({ where: { id: SMTP_CONFIG_ID } });
  if (!config || !config.enabled) {
    throw new Error('SMTP is not configured on this instance');
  }

  const transporter = createTransporterFromConfig(config);
  const subject = 'TravStats — Einladung';
  const expiresText = expiresAt.toLocaleDateString('de-DE', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #2563eb;">Du wurdest zu TravStats eingeladen</h2>
  <p>Hallo,</p>
  <p><strong>${inviterUsername}</strong> hat dich zu TravStats eingeladen — einer privaten App zur Verwaltung deiner Flugreisen.</p>
  <p>
    <a href="${inviteUrl}" style="display: inline-block; background: #2563eb; color: #fff;
       padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: bold;">
      Konto erstellen
    </a>
  </p>
  <p style="color: #6b7280; font-size: 14px;">Link (gültig bis ${expiresText}): ${inviteUrl}</p>
  <p style="color: #6b7280; font-size: 14px;">Falls du diese Einladung nicht erwartet hast, kannst du diese E-Mail ignorieren.</p>
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
    logger.info({ operation: 'invitation_email_sent', to, inviter: inviterUsername });
  } catch (error) {
    logger.error({
      operation: 'invitation_email_failed',
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
cd backend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/emailService.ts
git commit -m "feat(invitations): add sendInvitationEmail helper to emailService"
```

---

## Task 5: Refactor `POST /` — Link-Only Body + `MAX_USERS` Check

Write the test first. Replace the legacy handler with the new strict one.

**Files:**
- Create: `backend/src/__tests__/admin.invitations.test.ts`
- Modify: `backend/src/routes/admin/invitations.ts`

- [ ] **Step 1: Write the failing test file**

```ts
// backend/src/__tests__/admin.invitations.test.ts
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import request from 'supertest';

// Mock the email service BEFORE importing the app
const mockSendInvitationEmail = jest.fn<
  () => Promise<void>
>();
jest.mock('../services/emailService', () => ({
  sendInvitationEmail: mockSendInvitationEmail,
  // keep other exports passthrough — other services in this file are
  // not touched by invitation tests, and jest.mock replaces the whole
  // module so we stub only what the invitation route imports.
  testSmtpConnection: jest.fn(),
}));

import { app } from '../index';
import { prisma } from '../db';
import { generateToken } from '../utils/jwt';

let adminUserId: string;
let adminToken: string;

async function createAdminUser(): Promise<{ id: string; token: string }> {
  const user = await prisma.user.create({
    data: {
      username: `admin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      passwordHash: 'x',
      isAdmin: true,
    },
  });
  return { id: user.id, token: generateToken(user.id) };
}

describe('admin/invitations — POST /', () => {
  beforeEach(async () => {
    mockSendInvitationEmail.mockReset();
    await prisma.invitation.deleteMany();
    await prisma.user.deleteMany();
    process.env.MAX_USERS = '10';
    const admin = await createAdminUser();
    adminUserId = admin.id;
    adminToken = admin.token;
  });

  afterEach(async () => {
    await prisma.invitation.deleteMany();
    await prisma.user.deleteMany();
  });

  it('creates a link-only invitation with expiresInDays', async () => {
    const res = await request(app)
      .post('/api/v1/admin/invitations')
      .set('Cookie', [`auth_token=${adminToken}`])
      .send({ expiresInDays: 7 });

    expect(res.status).toBe(200);
    expect(res.body.invitation.email).toBeNull();
    expect(res.body.invitation.token).toHaveLength(64);
    expect(res.body.inviteUrl).toContain(`?token=${res.body.invitation.token}`);

    const stored = await prisma.invitation.findUnique({
      where: { id: res.body.invitation.id },
    });
    expect(stored?.createdBy).toBe(adminUserId);
    expect(stored?.email).toBeNull();
  });

  it('rejects expiresInDays outside {1,7,30}', async () => {
    const res = await request(app)
      .post('/api/v1/admin/invitations')
      .set('Cookie', [`auth_token=${adminToken}`])
      .send({ expiresInDays: 14 });

    expect(res.status).toBe(400);
  });

  it('returns 409 when user + active invite count >= MAX_USERS', async () => {
    process.env.MAX_USERS = '2';
    // admin is user #1; create one more via a direct insert to reach the cap
    await prisma.invitation.create({
      data: {
        token: 'placeholder-token-1',
        createdBy: adminUserId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    const res = await request(app)
      .post('/api/v1/admin/invitations')
      .set('Cookie', [`auth_token=${adminToken}`])
      .send({ expiresInDays: 7 });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/user limit reached/i);
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

```bash
cd backend && npx jest src/__tests__/admin.invitations.test.ts --forceExit
```

Expected: all three tests fail (`expiresInDays: 14` currently still passes at 400 for a different reason; the 409 test returns 200 because the limit check doesn't exist).

- [ ] **Step 3: Replace the `POST /` handler in `admin/invitations.ts`**

Replace the `legacyCreateSchema` + `POST /` block with:

```ts
import { createLinkInvitationSchema } from '../../schemas/invitation';
import { AppError } from '../../middleware/errorHandler';

const MAX_USERS_DEFAULT = 10;

async function ensureUserLimitNotReached(tx: Prisma.TransactionClient): Promise<void> {
  const maxUsers = parseInt(process.env.MAX_USERS || String(MAX_USERS_DEFAULT), 10);
  const userCount = await tx.user.count();
  const activeInviteCount = await tx.invitation.count({
    where: {
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
  if (userCount + activeInviteCount >= maxUsers) {
    throw new AppError('User limit reached', 409);
  }
}

function buildInviteUrl(token: string): string {
  const frontendUrl =
    process.env.FRONTEND_URL || process.env.CORS_ORIGIN?.split(',')[0] || 'http://localhost:3000';
  return `${frontendUrl}/register?token=${token}`;
}

router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { expiresInDays } = createLinkInvitationSchema.parse(req.body);
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

    const invitation = await prisma.$transaction(
      async (tx) => {
        await ensureUserLimitNotReached(tx);
        return tx.invitation.create({
          data: {
            token,
            createdBy: req.userId!,
            expiresAt,
          },
        });
      },
      { isolationLevel: 'Serializable' },
    );

    res.json({
      invitation: {
        id: invitation.id,
        email: invitation.email,
        token: invitation.token,
        expiresAt: invitation.expiresAt,
      },
      inviteUrl: buildInviteUrl(invitation.token),
    });
  } catch (error) {
    next(error);
  }
});
```

Add `import { Prisma } from '@prisma/client';` at the top of the file if it is not already imported.

- [ ] **Step 4: Run the test — expect pass**

```bash
cd backend && npx jest src/__tests__/admin.invitations.test.ts --forceExit
```

Expected: all three tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/__tests__/admin.invitations.test.ts backend/src/routes/admin/invitations.ts
git commit -m "feat(invitations): POST / is link-only and enforces MAX_USERS"
```

---

## Task 6: `POST /email` — Create + Send

**Files:**
- Modify: `backend/src/__tests__/admin.invitations.test.ts` — add new describe
- Modify: `backend/src/routes/admin/invitations.ts` — add endpoint

- [ ] **Step 1: Add the failing tests**

Append to the test file (inside the same `describe('admin/invitations …')` or as a new sibling describe):

```ts
describe('admin/invitations — POST /email', () => {
  beforeEach(async () => {
    mockSendInvitationEmail.mockReset();
    await prisma.invitation.deleteMany();
    await prisma.user.deleteMany();
    process.env.MAX_USERS = '10';
    const admin = await createAdminUser();
    adminUserId = admin.id;
    adminToken = admin.token;
  });

  it('creates an invitation and marks emailStatus=sent on SMTP success', async () => {
    mockSendInvitationEmail.mockResolvedValue(undefined);

    const res = await request(app)
      .post('/api/v1/admin/invitations/email')
      .set('Cookie', [`auth_token=${adminToken}`])
      .send({ email: 'jane@example.com', expiresInDays: 7 });

    expect(res.status).toBe(200);
    expect(res.body.emailSent).toBe(true);
    expect(res.body.emailError).toBeNull();
    expect(mockSendInvitationEmail).toHaveBeenCalledTimes(1);

    const stored = await prisma.invitation.findUnique({
      where: { id: res.body.invitation.id },
    });
    expect(stored?.email).toBe('jane@example.com');
    expect(stored?.emailStatus).toBe('sent');
    expect(stored?.emailSentAt).not.toBeNull();
  });

  it('creates an invitation and marks emailStatus=failed on SMTP throw', async () => {
    mockSendInvitationEmail.mockRejectedValue(new Error('SMTP auth failed'));

    const res = await request(app)
      .post('/api/v1/admin/invitations/email')
      .set('Cookie', [`auth_token=${adminToken}`])
      .send({ email: 'jane@example.com', expiresInDays: 7 });

    expect(res.status).toBe(200);
    expect(res.body.emailSent).toBe(false);
    expect(res.body.emailError).toContain('SMTP auth failed');

    const stored = await prisma.invitation.findUnique({
      where: { id: res.body.invitation.id },
    });
    expect(stored?.emailStatus).toBe('failed');
    expect(stored?.emailError).toContain('SMTP auth failed');
  });

  it('rejects invalid email with 400', async () => {
    const res = await request(app)
      .post('/api/v1/admin/invitations/email')
      .set('Cookie', [`auth_token=${adminToken}`])
      .send({ email: 'not-an-email', expiresInDays: 7 });

    expect(res.status).toBe(400);
    expect(mockSendInvitationEmail).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests — expect failure**

```bash
cd backend && npx jest src/__tests__/admin.invitations.test.ts --forceExit
```

Expected: the three new tests return 404 (route not found).

- [ ] **Step 3: Add the endpoint**

Append to `admin/invitations.ts` (after the `POST /` handler):

```ts
import { createEmailInvitationSchema } from '../../schemas/invitation';
import { sendInvitationEmail } from '../../services/emailService';

router.post('/email', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { email, expiresInDays } = createEmailInvitationSchema.parse(req.body);
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

    const invitation = await prisma.$transaction(
      async (tx) => {
        await ensureUserLimitNotReached(tx);
        return tx.invitation.create({
          data: {
            email,
            token,
            createdBy: req.userId!,
            expiresAt,
          },
        });
      },
      { isolationLevel: 'Serializable' },
    );

    const inviteUrl = buildInviteUrl(invitation.token);
    const creator = await prisma.user.findUnique({
      where: { id: req.userId! },
      select: { username: true },
    });

    let emailSent = false;
    let emailError: string | null = null;
    try {
      await sendInvitationEmail(email, inviteUrl, creator?.username ?? 'an admin', expiresAt);
      emailSent = true;
      await prisma.invitation.update({
        where: { id: invitation.id },
        data: { emailStatus: 'sent', emailSentAt: new Date(), emailError: null },
      });
    } catch (err) {
      emailError = err instanceof Error ? err.message : 'Unknown send error';
      await prisma.invitation.update({
        where: { id: invitation.id },
        data: { emailStatus: 'failed', emailError },
      });
    }

    res.json({
      invitation: {
        id: invitation.id,
        email: invitation.email,
        token: invitation.token,
        expiresAt: invitation.expiresAt,
      },
      inviteUrl,
      emailSent,
      emailError,
    });
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 4: Run the tests — expect pass**

```bash
cd backend && npx jest src/__tests__/admin.invitations.test.ts --forceExit
```

Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/__tests__/admin.invitations.test.ts backend/src/routes/admin/invitations.ts
git commit -m "feat(invitations): POST /email creates and sends via SMTP"
```

---

## Task 7: `POST /:id/resend`

**Files:**
- Modify: `backend/src/__tests__/admin.invitations.test.ts` — new describe
- Modify: `backend/src/routes/admin/invitations.ts` — add endpoint

- [ ] **Step 1: Add the failing tests**

```ts
describe('admin/invitations — POST /:id/resend', () => {
  beforeEach(async () => {
    mockSendInvitationEmail.mockReset();
    await prisma.invitation.deleteMany();
    await prisma.user.deleteMany();
    const admin = await createAdminUser();
    adminUserId = admin.id;
    adminToken = admin.token;
  });

  it('resends an active invitation with email', async () => {
    mockSendInvitationEmail.mockResolvedValue(undefined);
    const invitation = await prisma.invitation.create({
      data: {
        email: 'jane@example.com',
        token: 'tok-active-with-email',
        createdBy: adminUserId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        emailStatus: 'failed',
        emailError: 'previous failure',
      },
    });

    const res = await request(app)
      .post(`/api/v1/admin/invitations/${invitation.id}/resend`)
      .set('Cookie', [`auth_token=${adminToken}`])
      .send();

    expect(res.status).toBe(200);
    expect(res.body.emailSent).toBe(true);
    expect(mockSendInvitationEmail).toHaveBeenCalledTimes(1);

    const updated = await prisma.invitation.findUnique({ where: { id: invitation.id } });
    expect(updated?.emailStatus).toBe('sent');
    expect(updated?.emailError).toBeNull();
  });

  it('returns 400 when invitation has no email', async () => {
    const invitation = await prisma.invitation.create({
      data: {
        token: 'tok-no-email',
        createdBy: adminUserId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    const res = await request(app)
      .post(`/api/v1/admin/invitations/${invitation.id}/resend`)
      .set('Cookie', [`auth_token=${adminToken}`])
      .send();

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no email/i);
  });

  it('returns 400 when invitation is already used', async () => {
    const usedBy = (await createAdminUser()).id;
    const invitation = await prisma.invitation.create({
      data: {
        email: 'jane@example.com',
        token: 'tok-used',
        createdBy: adminUserId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        usedAt: new Date(),
        usedBy,
      },
    });

    const res = await request(app)
      .post(`/api/v1/admin/invitations/${invitation.id}/resend`)
      .set('Cookie', [`auth_token=${adminToken}`])
      .send();

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already used/i);
  });

  it('returns 400 when invitation is expired', async () => {
    const invitation = await prisma.invitation.create({
      data: {
        email: 'jane@example.com',
        token: 'tok-expired',
        createdBy: adminUserId,
        expiresAt: new Date(Date.now() - 1000),
      },
    });

    const res = await request(app)
      .post(`/api/v1/admin/invitations/${invitation.id}/resend`)
      .set('Cookie', [`auth_token=${adminToken}`])
      .send();

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/expired/i);
  });

  it('returns 404 on unknown id', async () => {
    const res = await request(app)
      .post('/api/v1/admin/invitations/00000000-0000-0000-0000-000000000000/resend')
      .set('Cookie', [`auth_token=${adminToken}`])
      .send();

    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
cd backend && npx jest src/__tests__/admin.invitations.test.ts --forceExit
```

- [ ] **Step 3: Add the endpoint**

Append to `admin/invitations.ts`:

```ts
router.post('/:id/resend', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const invitation = await prisma.invitation.findUnique({ where: { id } });
    if (!invitation) {
      throw new AppError('Invitation not found', 404);
    }
    if (!invitation.email) {
      throw new AppError('Invitation has no email', 400);
    }
    if (invitation.usedAt) {
      throw new AppError('Invitation already used', 400);
    }
    if (invitation.expiresAt <= new Date()) {
      throw new AppError('Invitation expired', 400);
    }

    const inviteUrl = buildInviteUrl(invitation.token);
    const creator = await prisma.user.findUnique({
      where: { id: invitation.createdBy },
      select: { username: true },
    });

    let emailSent = false;
    let emailError: string | null = null;
    try {
      await sendInvitationEmail(
        invitation.email,
        inviteUrl,
        creator?.username ?? 'an admin',
        invitation.expiresAt,
      );
      emailSent = true;
      await prisma.invitation.update({
        where: { id: invitation.id },
        data: { emailStatus: 'sent', emailSentAt: new Date(), emailError: null },
      });
    } catch (err) {
      emailError = err instanceof Error ? err.message : 'Unknown send error';
      await prisma.invitation.update({
        where: { id: invitation.id },
        data: { emailStatus: 'failed', emailError },
      });
    }

    res.json({ emailSent, emailError });
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 4: Run — expect pass**

```bash
cd backend && npx jest src/__tests__/admin.invitations.test.ts --forceExit
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/__tests__/admin.invitations.test.ts backend/src/routes/admin/invitations.ts
git commit -m "feat(invitations): POST /:id/resend with precondition checks"
```

---

## Task 8: `DELETE /:id`

**Files:**
- Modify: `backend/src/__tests__/admin.invitations.test.ts` — new describe
- Modify: `backend/src/routes/admin/invitations.ts` — add endpoint

- [ ] **Step 1: Add the failing tests**

```ts
describe('admin/invitations — DELETE /:id', () => {
  beforeEach(async () => {
    mockSendInvitationEmail.mockReset();
    await prisma.invitation.deleteMany();
    await prisma.user.deleteMany();
    const admin = await createAdminUser();
    adminUserId = admin.id;
    adminToken = admin.token;
  });

  it('hard-deletes an active invitation', async () => {
    const invitation = await prisma.invitation.create({
      data: {
        token: 'tok-delete-me',
        createdBy: adminUserId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    const res = await request(app)
      .delete(`/api/v1/admin/invitations/${invitation.id}`)
      .set('Cookie', [`auth_token=${adminToken}`])
      .send();

    expect(res.status).toBe(200);

    const stored = await prisma.invitation.findUnique({ where: { id: invitation.id } });
    expect(stored).toBeNull();
  });

  it('returns 404 on unknown id', async () => {
    const res = await request(app)
      .delete('/api/v1/admin/invitations/00000000-0000-0000-0000-000000000000')
      .set('Cookie', [`auth_token=${adminToken}`])
      .send();

    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run — expect failure**

- [ ] **Step 3: Add the endpoint**

Append to `admin/invitations.ts`:

```ts
router.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const result = await prisma.invitation.deleteMany({ where: { id } });
    if (result.count === 0) {
      throw new AppError('Invitation not found', 404);
    }
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 4: Run — expect pass**

```bash
cd backend && npx jest src/__tests__/admin.invitations.test.ts --forceExit
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/__tests__/admin.invitations.test.ts backend/src/routes/admin/invitations.ts
git commit -m "feat(invitations): DELETE /:id hard-deletes the row"
```

---

## Task 9: `GET /` — Status Filter + `include: user`

**Files:**
- Modify: `backend/src/__tests__/admin.invitations.test.ts`
- Modify: `backend/src/routes/admin/invitations.ts`

- [ ] **Step 1: Add the failing tests**

```ts
describe('admin/invitations — GET / with status filter', () => {
  beforeEach(async () => {
    mockSendInvitationEmail.mockReset();
    await prisma.invitation.deleteMany();
    await prisma.user.deleteMany();
    const admin = await createAdminUser();
    adminUserId = admin.id;
    adminToken = admin.token;

    // active
    await prisma.invitation.create({
      data: {
        token: 'tok-active',
        createdBy: adminUserId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    // used
    const usedByUser = await prisma.user.create({
      data: { username: 'usedBy', passwordHash: 'x' },
    });
    await prisma.invitation.create({
      data: {
        token: 'tok-used',
        createdBy: adminUserId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        usedAt: new Date(),
        usedBy: usedByUser.id,
      },
    });
    // expired
    await prisma.invitation.create({
      data: {
        token: 'tok-expired',
        createdBy: adminUserId,
        expiresAt: new Date(Date.now() - 1000),
      },
    });
  });

  it('filters by status=active (default)', async () => {
    const res = await request(app)
      .get('/api/v1/admin/invitations')
      .set('Cookie', [`auth_token=${adminToken}`]);

    expect(res.status).toBe(200);
    expect(res.body.invitations).toHaveLength(1);
    expect(res.body.invitations[0].token).toBe('tok-active');
  });

  it('filters by status=used and includes the registered user', async () => {
    const res = await request(app)
      .get('/api/v1/admin/invitations?status=used')
      .set('Cookie', [`auth_token=${adminToken}`]);

    expect(res.status).toBe(200);
    expect(res.body.invitations).toHaveLength(1);
    expect(res.body.invitations[0].token).toBe('tok-used');
    expect(res.body.invitations[0].user?.username).toBe('usedBy');
  });

  it('filters by status=expired', async () => {
    const res = await request(app)
      .get('/api/v1/admin/invitations?status=expired')
      .set('Cookie', [`auth_token=${adminToken}`]);

    expect(res.status).toBe(200);
    expect(res.body.invitations).toHaveLength(1);
    expect(res.body.invitations[0].token).toBe('tok-expired');
  });

  it('returns all three when status=all', async () => {
    const res = await request(app)
      .get('/api/v1/admin/invitations?status=all')
      .set('Cookie', [`auth_token=${adminToken}`]);

    expect(res.status).toBe(200);
    expect(res.body.invitations).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run — expect failure**

- [ ] **Step 3: Replace the `GET /` handler**

In `admin/invitations.ts`, replace the existing `router.get('/', …)` block with:

```ts
import { listInvitationsQuerySchema } from '../../schemas/invitation';

router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { status } = listInvitationsQuerySchema.parse(req.query);
    const now = new Date();

    const where =
      status === 'active'
        ? { usedAt: null, expiresAt: { gt: now } }
        : status === 'used'
          ? { NOT: { usedAt: null } }
          : status === 'expired'
            ? { usedAt: null, expiresAt: { lte: now } }
            : {};

    const invitations = await prisma.invitation.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        token: true,
        expiresAt: true,
        usedAt: true,
        createdAt: true,
        emailStatus: true,
        emailError: true,
        emailSentAt: true,
        creator: { select: { username: true } },
        user: { select: { username: true } },
      },
    });

    res.json({ invitations });
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 4: Run — expect pass**

```bash
cd backend && npx jest src/__tests__/admin.invitations.test.ts --forceExit
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/__tests__/admin.invitations.test.ts backend/src/routes/admin/invitations.ts
git commit -m "feat(invitations): GET / supports status filter and includes used-by user"
```

---

## Task 10: Register — Auto-Populate `notificationEmail`

**Files:**
- Modify: `backend/src/__tests__/auth.test.ts` (or create `auth.register.invitation.test.ts` if the existing file is already crowded — inspect it first)
- Modify: `backend/src/routes/auth.ts`

- [ ] **Step 1: Add the failing test**

Add inside the existing `auth.test.ts` or the new file:

```ts
describe('POST /auth/register — invitation notificationEmail auto-fill', () => {
  beforeEach(async () => {
    await prisma.invitation.deleteMany();
    await prisma.user.deleteMany();
  });

  it('populates notificationEmail from invitation email', async () => {
    // first user becomes admin automatically
    const admin = await prisma.user.create({
      data: { username: 'admin', passwordHash: 'x', isAdmin: true },
    });
    await prisma.invitation.create({
      data: {
        email: 'jane@example.com',
        token: 'tok-fillemail',
        createdBy: admin.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ username: 'jane', password: 'password1234', invitationToken: 'tok-fillemail' });

    expect(res.status).toBe(201);

    const user = await prisma.user.findUnique({ where: { username: 'jane' } });
    expect(user?.notificationEmail).toBe('jane@example.com');
  });

  it('leaves notificationEmail null when invitation had no email', async () => {
    const admin = await prisma.user.create({
      data: { username: 'admin', passwordHash: 'x', isAdmin: true },
    });
    await prisma.invitation.create({
      data: {
        token: 'tok-noemail',
        createdBy: admin.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ username: 'john', password: 'password1234', invitationToken: 'tok-noemail' });

    expect(res.status).toBe(201);
    const user = await prisma.user.findUnique({ where: { username: 'john' } });
    expect(user?.notificationEmail).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect failure**

- [ ] **Step 3: Modify `routes/auth.ts`**

Find the `prisma.user.create({ … })` call inside `POST /register` (around line 102). Currently it passes `{ username, passwordHash, isAdmin, invitedBy }`. Change to:

```ts
const user = await prisma.user.create({
  data: {
    username,
    passwordHash,
    isAdmin: isFirstUser,
    invitedBy,
    notificationEmail: invitationEmail,
  },
});
```

Declare `invitationEmail` earlier — right next to the existing `invitedBy` block that validates the token:

```ts
let invitedBy: string | undefined;
let invitationEmail: string | undefined;
if (invitationToken) {
  const invitation = await prisma.invitation.findUnique({
    where: { token: invitationToken },
  });
  // … existing validation …
  invitedBy = invitation.createdBy;
  invitationEmail = invitation.email ?? undefined;
}
```

- [ ] **Step 4: Run — expect pass**

```bash
cd backend && npx jest src/__tests__/auth.test.ts --forceExit
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/__tests__/auth.test.ts backend/src/routes/auth.ts
git commit -m "feat(auth): auto-populate notificationEmail from invitation on register"
```

---

## Task 11: Full Backend Verification

Not a code task — a safety net before moving to the frontend.

- [ ] **Step 1: Run tsc + lint + full test suite**

```bash
cd backend && npx tsc --noEmit && npm run lint && npm test -- --forceExit
```

Expected: all green. If any existing test broke, investigate before moving on.

- [ ] **Step 2: No commit required** (unless fixes are needed — commit those with a clear `fix:` subject).

---

## Task 12: Frontend `adminApi` — New Methods

**Files:**
- Modify: `frontend/src/lib/api/admin.ts`

- [ ] **Step 1: Replace the invitation block**

Find the existing `createInvitation` (around line 186) and `getInvitations` (around line 210) methods. Replace them with:

```ts
  createLinkInvitation: async (
    expiresInDays: 1 | 7 | 30 = 7,
  ): Promise<{
    invitation: { id: string; email: string | null; token: string; expiresAt: string };
    inviteUrl: string;
  }> => {
    const { data } = await api.post<{
      invitation: { id: string; email: string | null; token: string; expiresAt: string };
      inviteUrl: string;
    }>("/admin/invitations", { expiresInDays });
    return data;
  },

  createEmailInvitation: async (
    email: string,
    expiresInDays: 1 | 7 | 30 = 7,
  ): Promise<{
    invitation: { id: string; email: string | null; token: string; expiresAt: string };
    inviteUrl: string;
    emailSent: boolean;
    emailError: string | null;
  }> => {
    const { data } = await api.post<{
      invitation: { id: string; email: string | null; token: string; expiresAt: string };
      inviteUrl: string;
      emailSent: boolean;
      emailError: string | null;
    }>("/admin/invitations/email", { email, expiresInDays });
    return data;
  },

  resendInvitationEmail: async (
    id: string,
  ): Promise<{ emailSent: boolean; emailError: string | null }> => {
    const { data } = await api.post<{ emailSent: boolean; emailError: string | null }>(
      `/admin/invitations/${id}/resend`,
    );
    return data;
  },

  revokeInvitation: async (id: string): Promise<{ success: true }> => {
    const { data } = await api.delete<{ success: true }>(`/admin/invitations/${id}`);
    return data;
  },

  getInvitations: async (
    status: "all" | "active" | "used" | "expired" = "active",
  ): Promise<{
    invitations: Array<{
      id: string;
      email: string | null;
      token: string;
      expiresAt: string;
      usedAt: string | null;
      createdAt: string;
      emailStatus: string | null;
      emailError: string | null;
      emailSentAt: string | null;
      creator: { username: string };
      user: { username: string } | null;
    }>;
  }> => {
    const { data } = await api.get<{
      invitations: Array<{
        id: string;
        email: string | null;
        token: string;
        expiresAt: string;
        usedAt: string | null;
        createdAt: string;
        emailStatus: string | null;
        emailError: string | null;
        emailSentAt: string | null;
        creator: { username: string };
        user: { username: string } | null;
      }>;
    }>("/admin/invitations", { params: { status } });
    return data;
  },
```

Delete the old `createInvitation` block entirely. The old `getInvitations` block is replaced by the version above.

- [ ] **Step 2: Type-check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: **type errors in `AdminPage.tsx`** — the old `handleCreateInvitation` still calls `adminApi.createInvitation`, and `InvitationManagement.tsx`'s row rendering references types that have changed. These are fixed in the following tasks. For now, this task leaves a known-broken typecheck — do NOT commit yet.

- [ ] **Step 3: Hold the commit** until Task 17 wires the new callers. This is one of two tasks that lives across task boundaries on purpose — the alternative is to keep a compat shim for `createInvitation` and remove it later, which is more churn.

(If you prefer, copy the diff into a branch file or a staged-but-unstaged state. The cleanest approach is to power through Tasks 13–17 and then run the verification together. Each task still produces isolated file changes that can be reviewed individually in the PR, even though the tree is red in between.)

---

## Task 13: `InviteSuccessModal` Component (TDD)

**Files:**
- Create: `frontend/src/__tests__/components/Admin/InviteSuccessModal.test.tsx`
- Create: `frontend/src/components/Admin/InviteSuccessModal.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/__tests__/components/Admin/InviteSuccessModal.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InviteSuccessModal from "../../../components/Admin/InviteSuccessModal";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "de", changeLanguage: vi.fn() },
    ready: true,
  }),
}));

describe("InviteSuccessModal", () => {
  it("renders the URL and a copy button for link-only mode", () => {
    render(
      <InviteSuccessModal
        inviteUrl="http://localhost:3000/register?token=abc"
        emailSent={undefined}
        emailError={null}
        recipientEmail={null}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText(/abc/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copyLink/i })).toBeInTheDocument();
  });

  it("shows email-sent line when emailSent is true", () => {
    render(
      <InviteSuccessModal
        inviteUrl="http://…/register?token=abc"
        emailSent={true}
        emailError={null}
        recipientEmail="jane@example.com"
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText(/emailSent/i)).toBeInTheDocument();
    expect(screen.getByText(/jane@example.com/)).toBeInTheDocument();
  });

  it("shows amber warning when emailSent is false", () => {
    render(
      <InviteSuccessModal
        inviteUrl="http://…/register?token=abc"
        emailSent={false}
        emailError="SMTP auth failed"
        recipientEmail="jane@example.com"
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText(/emailFailed/i)).toBeInTheDocument();
    expect(screen.getByText(/SMTP auth failed/)).toBeInTheDocument();
  });

  it("fires onClose when Done is clicked", async () => {
    const onClose = vi.fn();
    render(
      <InviteSuccessModal
        inviteUrl="http://…/register?token=abc"
        emailSent={undefined}
        emailError={null}
        recipientEmail={null}
        onClose={onClose}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /done/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — expect failure (file not found)**

```bash
cd frontend && npx vitest --run src/__tests__/components/Admin/InviteSuccessModal.test.tsx
```

- [ ] **Step 3: Create the component**

```tsx
// frontend/src/components/Admin/InviteSuccessModal.tsx
import { useToastStore } from "../../store/toastStore";
import { useTranslation } from "../../hooks/useTranslation";

interface InviteSuccessModalProps {
  inviteUrl: string;
  emailSent: boolean | undefined;
  emailError: string | null;
  recipientEmail: string | null;
  onClose: () => void;
}

export default function InviteSuccessModal({
  inviteUrl,
  emailSent,
  emailError,
  recipientEmail,
  onClose,
}: InviteSuccessModalProps): JSX.Element {
  const { t } = useTranslation(["admin", "common"]);
  const addToast = useToastStore((state) => state.addToast);

  const copyLink = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      addToast("success", t("admin:invitations.success.copiedToClipboard"));
    } catch {
      addToast("error", t("admin:invitations.success.copyFailed"));
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-[var(--bg-surface)] rounded-lg shadow-xl max-w-lg w-full mx-4 p-6">
        <h2 className="text-xl font-semibold mb-4" style={{ color: "var(--text-primary)" }}>
          {t("admin:invitations.success.title")}
        </h2>

        {emailSent === true && recipientEmail && (
          <p
            className="mb-4 text-sm"
            style={{ color: "#16a34a" }}
          >
            ✉ {t("admin:invitations.success.emailSent", { email: recipientEmail })}
          </p>
        )}

        {emailSent === false && (
          <div
            className="mb-4 rounded-lg p-3 text-sm"
            style={{
              background: "rgba(245,158,11,0.12)",
              border: "1px solid rgba(245,158,11,0.4)",
              color: "#d97706",
            }}
          >
            <p>
              <strong>{t("admin:invitations.success.emailFailed")}</strong>
            </p>
            {emailError && <p className="mt-1 font-mono text-xs">{emailError}</p>}
            <p className="mt-2 text-xs">
              {t("admin:invitations.success.emailFailedFallback")}
            </p>
          </div>
        )}

        <div className="mb-4">
          <label className="label">{t("admin:invitations.success.linkLabel")}</label>
          <div
            className="rounded-lg p-3 font-mono text-xs break-all"
            style={{
              background: "var(--bg-elevated)",
              border: "1px solid var(--color-border)",
              color: "var(--text-primary)",
            }}
          >
            {inviteUrl}
          </div>
          <button
            type="button"
            onClick={copyLink}
            className="btn-secondary mt-2 text-sm"
          >
            📋 {t("admin:invitations.success.copyLink")}
          </button>
        </div>

        <div className="flex justify-end">
          <button type="button" onClick={onClose} className="btn-primary">
            {t("admin:invitations.success.done")}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run — expect pass**

```bash
cd frontend && npx vitest --run src/__tests__/components/Admin/InviteSuccessModal.test.tsx
```

- [ ] **Step 5: Hold the commit** until Task 18 — the i18n keys don't exist yet. When the keys are added, the tests still pass because the mock returns the key verbatim. But `npx tsc --noEmit` fails until i18n is in place — intentional.

---

## Task 14: `CreateLinkInviteModal` Component (TDD)

**Files:**
- Create: `frontend/src/__tests__/components/Admin/CreateLinkInviteModal.test.tsx`
- Create: `frontend/src/components/Admin/CreateLinkInviteModal.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/__tests__/components/Admin/CreateLinkInviteModal.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CreateLinkInviteModal from "../../../components/Admin/CreateLinkInviteModal";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "de", changeLanguage: vi.fn() },
    ready: true,
  }),
}));

describe("CreateLinkInviteModal", () => {
  const onCreate = vi.fn();
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders three expiration radio options", () => {
    render(<CreateLinkInviteModal onCreate={onCreate} onClose={onClose} creating={false} />);
    expect(screen.getByLabelText(/expires\.24h/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/expires\.7d/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/expires\.30d/i)).toBeInTheDocument();
  });

  it("calls onCreate with 7 by default", async () => {
    onCreate.mockResolvedValue(undefined);
    render(<CreateLinkInviteModal onCreate={onCreate} onClose={onClose} creating={false} />);
    fireEvent.click(screen.getByRole("button", { name: /createLinkModal\.submit/i }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(7));
  });

  it("calls onCreate with 30 when the user picks 30 days", async () => {
    onCreate.mockResolvedValue(undefined);
    render(<CreateLinkInviteModal onCreate={onCreate} onClose={onClose} creating={false} />);
    fireEvent.click(screen.getByLabelText(/expires\.30d/i));
    fireEvent.click(screen.getByRole("button", { name: /createLinkModal\.submit/i }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(30));
  });

  it("disables the submit button while creating is true", () => {
    render(<CreateLinkInviteModal onCreate={onCreate} onClose={onClose} creating={true} />);
    expect(screen.getByRole("button", { name: /createLinkModal\.submit/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run — expect failure**

- [ ] **Step 3: Create the component**

```tsx
// frontend/src/components/Admin/CreateLinkInviteModal.tsx
import { useState } from "react";
import { useTranslation } from "../../hooks/useTranslation";

type ExpiresInDays = 1 | 7 | 30;

interface CreateLinkInviteModalProps {
  onCreate: (expiresInDays: ExpiresInDays) => Promise<void> | void;
  onClose: () => void;
  creating: boolean;
}

export default function CreateLinkInviteModal({
  onCreate,
  onClose,
  creating,
}: CreateLinkInviteModalProps): JSX.Element {
  const { t } = useTranslation(["admin", "common"]);
  const [expiresInDays, setExpiresInDays] = useState<ExpiresInDays>(7);

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    void onCreate(expiresInDays);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-[var(--bg-surface)] rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
        <h2 className="text-xl font-semibold mb-4" style={{ color: "var(--text-primary)" }}>
          {t("admin:invitations.createLinkModal.title")}
        </h2>
        <p className="mb-4 text-sm" style={{ color: "var(--text-muted)" }}>
          {t("admin:invitations.createLinkModal.description")}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <fieldset>
            <legend className="label mb-2">{t("admin:invitations.expiresLegend")}</legend>
            {([1, 7, 30] as ExpiresInDays[]).map((days) => (
              <label key={days} className="flex items-center gap-2 mb-1">
                <input
                  type="radio"
                  name="expiresInDays"
                  value={days}
                  checked={expiresInDays === days}
                  onChange={() => setExpiresInDays(days)}
                  aria-label={t(`admin:invitations.expires.${days === 1 ? "24h" : days + "d"}`)}
                />
                <span>
                  {t(`admin:invitations.expires.${days === 1 ? "24h" : days + "d"}`)}
                </span>
              </label>
            ))}
          </fieldset>

          <div className="flex gap-2 justify-end">
            <button type="button" onClick={onClose} className="btn-secondary">
              {t("common:buttons.cancel")}
            </button>
            <button type="submit" disabled={creating} className="btn-primary">
              {creating
                ? t("admin:invitations.createLinkModal.creating")
                : t("admin:invitations.createLinkModal.submit")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run — expect pass**

```bash
cd frontend && npx vitest --run src/__tests__/components/Admin/CreateLinkInviteModal.test.tsx
```

- [ ] **Step 5: Hold the commit** — same reason as Task 13.

---

## Task 15: `CreateEmailInviteModal` Component (TDD)

**Files:**
- Create: `frontend/src/__tests__/components/Admin/CreateEmailInviteModal.test.tsx`
- Create: `frontend/src/components/Admin/CreateEmailInviteModal.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/__tests__/components/Admin/CreateEmailInviteModal.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CreateEmailInviteModal from "../../../components/Admin/CreateEmailInviteModal";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "de", changeLanguage: vi.fn() },
    ready: true,
  }),
}));

describe("CreateEmailInviteModal", () => {
  const onCreate = vi.fn();
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("blocks submit when email is empty", async () => {
    render(<CreateEmailInviteModal onCreate={onCreate} onClose={onClose} creating={false} />);
    fireEvent.click(screen.getByRole("button", { name: /createEmailModal\.submit/i }));
    await waitFor(() => {
      expect(screen.getByText(/createEmailModal\.emailRequired/i)).toBeInTheDocument();
    });
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("blocks submit when email is invalid", async () => {
    render(<CreateEmailInviteModal onCreate={onCreate} onClose={onClose} creating={false} />);
    fireEvent.change(screen.getByLabelText(/createEmailModal\.emailLabel/i), {
      target: { value: "not-an-email" },
    });
    fireEvent.click(screen.getByRole("button", { name: /createEmailModal\.submit/i }));
    await waitFor(() => {
      expect(screen.getByText(/createEmailModal\.emailInvalid/i)).toBeInTheDocument();
    });
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("calls onCreate with (email, 7) on valid input", async () => {
    onCreate.mockResolvedValue(undefined);
    render(<CreateEmailInviteModal onCreate={onCreate} onClose={onClose} creating={false} />);
    fireEvent.change(screen.getByLabelText(/createEmailModal\.emailLabel/i), {
      target: { value: "jane@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /createEmailModal\.submit/i }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith("jane@example.com", 7));
  });
});
```

- [ ] **Step 2: Run — expect failure**

- [ ] **Step 3: Create the component**

```tsx
// frontend/src/components/Admin/CreateEmailInviteModal.tsx
import { useState } from "react";
import { z } from "zod";
import { useTranslation } from "../../hooks/useTranslation";

type ExpiresInDays = 1 | 7 | 30;

interface CreateEmailInviteModalProps {
  onCreate: (email: string, expiresInDays: ExpiresInDays) => Promise<void> | void;
  onClose: () => void;
  creating: boolean;
}

const emailSchema = z.string().email();

export default function CreateEmailInviteModal({
  onCreate,
  onClose,
  creating,
}: CreateEmailInviteModalProps): JSX.Element {
  const { t } = useTranslation(["admin", "common"]);
  const [email, setEmail] = useState("");
  const [expiresInDays, setExpiresInDays] = useState<ExpiresInDays>(7);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!email.trim()) {
      setError(t("admin:invitations.createEmailModal.emailRequired"));
      return;
    }
    if (!emailSchema.safeParse(email).success) {
      setError(t("admin:invitations.createEmailModal.emailInvalid"));
      return;
    }
    setError(null);
    void onCreate(email, expiresInDays);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-[var(--bg-surface)] rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
        <h2 className="text-xl font-semibold mb-4" style={{ color: "var(--text-primary)" }}>
          {t("admin:invitations.createEmailModal.title")}
        </h2>
        <p className="mb-4 text-sm" style={{ color: "var(--text-muted)" }}>
          {t("admin:invitations.createEmailModal.description")}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="invite-email" className="label">
              {t("admin:invitations.createEmailModal.emailLabel")}
            </label>
            <input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input w-full"
              placeholder={t("admin:invitations.createEmailModal.emailPlaceholder")}
              autoFocus
            />
            {error && <p className="mt-1 text-sm text-red-500">{error}</p>}
          </div>

          <fieldset>
            <legend className="label mb-2">{t("admin:invitations.expiresLegend")}</legend>
            {([1, 7, 30] as ExpiresInDays[]).map((days) => (
              <label key={days} className="flex items-center gap-2 mb-1">
                <input
                  type="radio"
                  name="expiresInDays"
                  value={days}
                  checked={expiresInDays === days}
                  onChange={() => setExpiresInDays(days)}
                />
                <span>
                  {t(`admin:invitations.expires.${days === 1 ? "24h" : days + "d"}`)}
                </span>
              </label>
            ))}
          </fieldset>

          <div className="flex gap-2 justify-end">
            <button type="button" onClick={onClose} className="btn-secondary">
              {t("common:buttons.cancel")}
            </button>
            <button type="submit" disabled={creating} className="btn-primary">
              {creating
                ? t("admin:invitations.createEmailModal.sending")
                : t("admin:invitations.createEmailModal.submit")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Hold the commit** — same reason as Task 13.

---

## Task 16: `InvitationManagement` — Filter Chips, Columns, Row Actions

Significant refactor. TDD-lite: the existing tests (if any) are extended; the new row-action logic is covered by a focused test.

**Files:**
- Create: `frontend/src/__tests__/components/Admin/InvitationManagement.test.tsx`
- Modify: `frontend/src/components/Admin/InvitationManagement.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/__tests__/components/Admin/InvitationManagement.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import InvitationManagement, {
  Invitation,
} from "../../../components/Admin/InvitationManagement";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "de", changeLanguage: vi.fn() },
    ready: true,
  }),
}));

const BASE_INVITE: Invitation = {
  id: "inv-1",
  email: null,
  token: "abcdef0123456789",
  expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  usedAt: null,
  createdAt: new Date().toISOString(),
  emailStatus: null,
  emailError: null,
  emailSentAt: null,
  creator: { username: "admin" },
  user: null,
};

describe("InvitationManagement", () => {
  const noop = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows Copy + Revoke buttons for an active link invitation", () => {
    render(
      <InvitationManagement
        invitations={[BASE_INVITE]}
        statusFilter="active"
        onStatusFilterChange={noop}
        onCreateLink={noop}
        onCreateEmail={noop}
        onCopyLink={noop}
        onResendEmail={noop}
        onRevoke={noop}
      />,
    );

    expect(screen.getByRole("button", { name: /actions\.copyLink/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /actions\.revoke/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /actions\.sendEmail/i })).not.toBeInTheDocument();
  });

  it("shows Resend button for an active invitation with email", () => {
    render(
      <InvitationManagement
        invitations={[{ ...BASE_INVITE, email: "jane@example.com", emailStatus: "failed", emailError: "SMTP down" }]}
        statusFilter="active"
        onStatusFilterChange={noop}
        onCreateLink={noop}
        onCreateEmail={noop}
        onCopyLink={noop}
        onResendEmail={noop}
        onRevoke={noop}
      />,
    );

    expect(screen.getByRole("button", { name: /actions\.resendEmail/i })).toBeInTheDocument();
  });

  it("fires onRevoke when revoke button clicked", () => {
    const onRevoke = vi.fn();
    render(
      <InvitationManagement
        invitations={[BASE_INVITE]}
        statusFilter="active"
        onStatusFilterChange={noop}
        onCreateLink={noop}
        onCreateEmail={noop}
        onCopyLink={noop}
        onResendEmail={noop}
        onRevoke={onRevoke}
      />,
    );

    // confirm() is called — stub window.confirm for this test
    const originalConfirm = window.confirm;
    window.confirm = vi.fn(() => true);
    fireEvent.click(screen.getByRole("button", { name: /actions\.revoke/i }));
    expect(onRevoke).toHaveBeenCalledWith(BASE_INVITE.id);
    window.confirm = originalConfirm;
  });

  it("renders used-by username for a consumed invitation", () => {
    render(
      <InvitationManagement
        invitations={[
          {
            ...BASE_INVITE,
            usedAt: new Date().toISOString(),
            user: { username: "jane_doe" },
          },
        ]}
        statusFilter="used"
        onStatusFilterChange={noop}
        onCreateLink={noop}
        onCreateEmail={noop}
        onCopyLink={noop}
        onResendEmail={noop}
        onRevoke={noop}
      />,
    );

    expect(screen.getByText(/jane_doe/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — expect failure (current `InvitationManagement` props don't match)**

- [ ] **Step 3: Rewrite `InvitationManagement.tsx`**

Replace the entire file with:

```tsx
// frontend/src/components/Admin/InvitationManagement.tsx
import { format } from "date-fns";
import InlineHelp from "../Help/InlineHelp";
import { useTranslation } from "../../hooks/useTranslation";

export interface Invitation {
  id: string;
  email: string | null;
  token: string;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
  emailStatus: string | null;
  emailError: string | null;
  emailSentAt: string | null;
  creator: { username: string };
  user: { username: string } | null;
}

export type StatusFilter = "all" | "active" | "used" | "expired";

interface InvitationManagementProps {
  invitations: Invitation[];
  statusFilter: StatusFilter;
  onStatusFilterChange: (status: StatusFilter) => void;
  onCreateLink: () => void;
  onCreateEmail: () => void;
  onCopyLink: (invitation: Invitation) => void;
  onResendEmail: (invitation: Invitation) => void;
  onRevoke: (id: string) => void;
}

function isExpired(invitation: Invitation): boolean {
  return new Date(invitation.expiresAt) <= new Date();
}

function rowStatus(invitation: Invitation): "used" | "expired" | "active" {
  if (invitation.usedAt) return "used";
  if (isExpired(invitation)) return "expired";
  return "active";
}

export default function InvitationManagement({
  invitations,
  statusFilter,
  onStatusFilterChange,
  onCreateLink,
  onCreateEmail,
  onCopyLink,
  onResendEmail,
  onRevoke,
}: InvitationManagementProps): JSX.Element {
  const { t } = useTranslation(["admin", "common"]);

  const handleRevoke = (id: string): void => {
    if (window.confirm(t("admin:invitations.confirmRevoke"))) {
      onRevoke(id);
    }
  };

  return (
    <div className="space-y-4">
      <InlineHelp
        title={t("admin:invitations.title")}
        category="advanced"
        content={
          <div className="space-y-2">
            <p>{t("admin:invitations.help.description")}</p>
            <ul className="list-disc list-inside space-y-1 ml-2 text-sm">
              <li>
                <strong>{t("admin:invitations.help.createTitle")}</strong>{" "}
                {t("admin:invitations.help.create")}
              </li>
              <li>
                <strong>{t("admin:invitations.help.expiryTitle")}</strong>{" "}
                {t("admin:invitations.help.expiry")}
              </li>
              <li>
                <strong>{t("admin:invitations.help.oneUseTitle")}</strong>{" "}
                {t("admin:invitations.help.oneUse")}
              </li>
              <li>
                <strong>{t("admin:invitations.help.emailTitle")}</strong>{" "}
                {t("admin:invitations.help.email")}
              </li>
            </ul>
          </div>
        }
      />

      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">
          {t("admin:invitations.invitationLinks")}
        </h2>
        <div className="flex gap-2">
          <button onClick={onCreateLink} className="btn-primary">
            {t("admin:invitations.actions.createLink")}
          </button>
          <button onClick={onCreateEmail} className="btn-secondary">
            {t("admin:invitations.actions.createEmail")}
          </button>
        </div>
      </div>

      <div className="flex gap-2 mb-4" role="group" aria-label={t("admin:invitations.filter.label")}>
        {(["all", "active", "used", "expired"] as StatusFilter[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onStatusFilterChange(s)}
            className={`px-3 py-1 rounded-full text-xs border transition-colors ${
              statusFilter === s
                ? "bg-[var(--accent)]/20 border-[var(--accent)]/50 text-[var(--accent)]"
                : "border-[var(--color-border)] text-[var(--text-muted)]"
            }`}
          >
            {t(`admin:invitations.filter.${s}`)}
          </button>
        ))}
      </div>

      <div className="bg-[var(--bg-surface)] rounded-lg shadow overflow-hidden">
        <table className="w-full">
          <thead className="bg-[var(--bg-base)]">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
                {t("admin:invitations.table.email")}
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
                {t("admin:invitations.table.createdBy")}
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
                {t("admin:invitations.table.expires")}
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
                {t("admin:invitations.table.usedBy")}
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
                {t("admin:invitations.table.status")}
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
                {t("admin:invitations.table.actions")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y" style={{ borderColor: "var(--color-border)" }}>
            {invitations.map((invitation) => {
              const status = rowStatus(invitation);
              const showResend =
                status === "active" &&
                invitation.email !== null &&
                (invitation.emailStatus === null || invitation.emailStatus === "failed");
              return (
                <tr key={invitation.id}>
                  <td className="px-4 py-3 text-sm">
                    {invitation.email ?? <span className="text-[var(--text-muted)]">—</span>}
                  </td>
                  <td className="px-4 py-3 text-sm">{invitation.creator.username}</td>
                  <td className="px-4 py-3 text-sm">
                    {format(new Date(invitation.expiresAt), "MMM d, yyyy")}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {invitation.user?.username ?? (
                      <span className="text-[var(--text-muted)]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {status === "used" ? (
                      <span className="px-2 py-1 text-xs font-semibold rounded-full bg-[var(--bg-elevated)]">
                        {t("admin:invitations.status.usedOn", {
                          date: format(new Date(invitation.usedAt!), "MMM d"),
                        })}
                      </span>
                    ) : status === "expired" ? (
                      <span className="px-2 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-800">
                        {t("admin:invitations.status.expired")}
                      </span>
                    ) : invitation.emailStatus === "failed" ? (
                      <span
                        className="px-2 py-1 text-xs font-semibold rounded-full"
                        style={{
                          background: "rgba(245,158,11,0.2)",
                          color: "#d97706",
                        }}
                        title={invitation.emailError ?? ""}
                      >
                        {t("admin:invitations.status.emailFailed")}
                      </span>
                    ) : (
                      <span className="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">
                        {t("admin:invitations.status.active")}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-sm">
                    <div className="flex items-center justify-end gap-2">
                      {status === "active" && (
                        <button
                          type="button"
                          onClick={() => onCopyLink(invitation)}
                          className="text-blue-600 hover:text-blue-800"
                        >
                          {t("admin:invitations.actions.copyLink")}
                        </button>
                      )}
                      {showResend && (
                        <button
                          type="button"
                          onClick={() => onResendEmail(invitation)}
                          className="text-blue-600 hover:text-blue-800"
                        >
                          {invitation.emailStatus === "failed"
                            ? t("admin:invitations.actions.resendEmail")
                            : t("admin:invitations.actions.sendEmail")}
                        </button>
                      )}
                      {status !== "used" && (
                        <button
                          type="button"
                          onClick={() => handleRevoke(invitation.id)}
                          className="text-red-600 hover:text-red-800"
                        >
                          {t("admin:invitations.actions.revoke")}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run — expect pass**

```bash
cd frontend && npx vitest --run src/__tests__/components/Admin/InvitationManagement.test.tsx
```

- [ ] **Step 5: Hold the commit** — i18n keys and `AdminPage` wiring still pending.

---

## Task 17: `AdminPage` Wiring

**Files:**
- Modify: `frontend/src/pages/AdminPage.tsx`

- [ ] **Step 1: Remove the old handler and add modal state**

Remove `handleCreateInvitation` entirely (lines ~222–234) and the `copiedUrl` state (whoever declared it, usually near the top of the component). Add new state at the same location:

```tsx
const [inviteLinkModalOpen, setInviteLinkModalOpen] = useState(false);
const [inviteEmailModalOpen, setInviteEmailModalOpen] = useState(false);
const [inviteCreating, setInviteCreating] = useState(false);
const [inviteSuccess, setInviteSuccess] = useState<{
  inviteUrl: string;
  emailSent: boolean | undefined;
  emailError: string | null;
  recipientEmail: string | null;
} | null>(null);
const [invitationStatusFilter, setInvitationStatusFilter] = useState<
  "all" | "active" | "used" | "expired"
>("active");
```

- [ ] **Step 2: Update `loadData` to respect the filter**

Find `loadData` (around line 119). Replace the `adminApi.getInvitations()` call with:

```tsx
adminApi.getInvitations(invitationStatusFilter),
```

Add `invitationStatusFilter` to the dependency array of the `useEffect` that calls `loadData()`.

- [ ] **Step 3: Add the five new handlers**

```tsx
const handleCreateLinkInvitation = async (expiresInDays: 1 | 7 | 30): Promise<void> => {
  setInviteCreating(true);
  try {
    const { inviteUrl } = await adminApi.createLinkInvitation(expiresInDays);
    setInviteLinkModalOpen(false);
    setInviteSuccess({
      inviteUrl,
      emailSent: undefined,
      emailError: null,
      recipientEmail: null,
    });
    await loadData();
  } catch (error: unknown) {
    addToast("error", getErrorMessage(error, t("admin:toasts.invitationFailed")));
  } finally {
    setInviteCreating(false);
  }
};

const handleCreateEmailInvitation = async (
  email: string,
  expiresInDays: 1 | 7 | 30,
): Promise<void> => {
  setInviteCreating(true);
  try {
    const { inviteUrl, emailSent, emailError } = await adminApi.createEmailInvitation(
      email,
      expiresInDays,
    );
    setInviteEmailModalOpen(false);
    setInviteSuccess({ inviteUrl, emailSent, emailError, recipientEmail: email });
    await loadData();
  } catch (error: unknown) {
    addToast("error", getErrorMessage(error, t("admin:toasts.invitationFailed")));
  } finally {
    setInviteCreating(false);
  }
};

const handleCopyInvitationLink = async (invitation: Invitation): Promise<void> => {
  const frontendOrigin = window.location.origin;
  const inviteUrl = `${frontendOrigin}/register?token=${invitation.token}`;
  try {
    await navigator.clipboard.writeText(inviteUrl);
    addToast("success", t("admin:invitations.success.copiedToClipboard"));
  } catch {
    addToast("error", t("admin:invitations.success.copyFailed"));
  }
};

const handleResendInvitationEmail = async (invitation: Invitation): Promise<void> => {
  try {
    const { emailSent, emailError } = await adminApi.resendInvitationEmail(invitation.id);
    if (emailSent) {
      addToast("success", t("admin:invitations.toasts.resent"));
    } else {
      addToast("error", `${t("admin:invitations.toasts.resendFailed")}: ${emailError ?? ""}`);
    }
    await loadData();
  } catch (error: unknown) {
    addToast("error", getErrorMessage(error, t("admin:invitations.toasts.resendFailed")));
  }
};

const handleRevokeInvitation = async (id: string): Promise<void> => {
  try {
    await adminApi.revokeInvitation(id);
    addToast("success", t("admin:invitations.toasts.revoked"));
    await loadData();
  } catch (error: unknown) {
    addToast("error", getErrorMessage(error, t("admin:invitations.toasts.revokeFailed")));
  }
};
```

- [ ] **Step 4: Update the JSX — replace the `InvitationManagement` render**

Find the existing `<InvitationManagement … />` render (around line 563) and replace it with:

```tsx
<InvitationManagement
  invitations={invitations}
  statusFilter={invitationStatusFilter}
  onStatusFilterChange={setInvitationStatusFilter}
  onCreateLink={() => setInviteLinkModalOpen(true)}
  onCreateEmail={() => setInviteEmailModalOpen(true)}
  onCopyLink={handleCopyInvitationLink}
  onResendEmail={handleResendInvitationEmail}
  onRevoke={handleRevokeInvitation}
/>

{inviteLinkModalOpen && (
  <CreateLinkInviteModal
    onCreate={handleCreateLinkInvitation}
    onClose={() => setInviteLinkModalOpen(false)}
    creating={inviteCreating}
  />
)}

{inviteEmailModalOpen && (
  <CreateEmailInviteModal
    onCreate={handleCreateEmailInvitation}
    onClose={() => setInviteEmailModalOpen(false)}
    creating={inviteCreating}
  />
)}

{inviteSuccess && (
  <InviteSuccessModal
    inviteUrl={inviteSuccess.inviteUrl}
    emailSent={inviteSuccess.emailSent}
    emailError={inviteSuccess.emailError}
    recipientEmail={inviteSuccess.recipientEmail}
    onClose={() => setInviteSuccess(null)}
  />
)}
```

Add the three imports at the top of `AdminPage.tsx`:

```tsx
import CreateLinkInviteModal from "../components/Admin/CreateLinkInviteModal";
import CreateEmailInviteModal from "../components/Admin/CreateEmailInviteModal";
import InviteSuccessModal from "../components/Admin/InviteSuccessModal";
```

And import the `Invitation` type (if not already exported from the file `InvitationManagement.tsx` is in — the rewrite above exports it):

```tsx
import type { Invitation } from "../components/Admin/InvitationManagement";
```

- [ ] **Step 5: Hold the commit** — i18n keys still missing, typecheck fails on missing `admin:invitations.*` strings only at runtime (vitest mocks return the key). But `tsc` and `lint` should now pass because the source compiles.

---

## Task 18: i18n Keys — DE + EN

**Files:**
- Modify: `frontend/src/i18n/resources/de/admin.json`
- Modify: `frontend/src/i18n/resources/en/admin.json`

- [ ] **Step 1: Locate the existing `invitations` block**

In both files, find the existing `"invitations"` object (created in earlier work, contains `title`, `help.*`, `invitationLinks`, `createButton`, `copiedToClipboard`, `table.*`, `status.*`). This block gets extended.

- [ ] **Step 2: Add the new keys to `de/admin.json`**

Under the existing `"invitations"` object, add:

```jsonc
{
  // …existing keys stay…
  "actions": {
    "createLink": "+ Link erstellen",
    "createEmail": "✉ Einladung per E-Mail",
    "copyLink": "📋 Link kopieren",
    "sendEmail": "✉ Senden",
    "resendEmail": "✉ Nochmal senden",
    "revoke": "🗑 Widerrufen"
  },
  "confirmRevoke": "Diese Einladung wirklich widerrufen? Der Link wird sofort ungültig.",
  "expiresLegend": "Gültig für",
  "expires": {
    "24h": "24 Stunden",
    "7d": "7 Tage",
    "30d": "30 Tage"
  },
  "filter": {
    "label": "Status-Filter",
    "all": "Alle",
    "active": "Aktiv",
    "used": "Verwendet",
    "expired": "Abgelaufen"
  },
  "createLinkModal": {
    "title": "Neuen Einladungs-Link erstellen",
    "description": "Erzeugt einen einmaligen Link, den du frei teilen kannst.",
    "submit": "Link erstellen",
    "creating": "Wird erstellt..."
  },
  "createEmailModal": {
    "title": "Einladung per E-Mail senden",
    "description": "Wir erstellen einen einmaligen Link und schicken ihn direkt an die eingetragene Adresse.",
    "emailLabel": "E-Mail-Adresse",
    "emailPlaceholder": "jane@example.com",
    "emailRequired": "E-Mail ist erforderlich",
    "emailInvalid": "Keine gültige E-Mail-Adresse",
    "submit": "Einladung senden",
    "sending": "Wird versendet..."
  },
  "success": {
    "title": "Einladung erstellt",
    "linkLabel": "Einladungs-Link",
    "copyLink": "Link kopieren",
    "copiedToClipboard": "Link in die Zwischenablage kopiert",
    "copyFailed": "Link konnte nicht kopiert werden",
    "emailSent": "E-Mail an {{email}} versendet",
    "emailFailed": "E-Mail-Versand fehlgeschlagen",
    "emailFailedFallback": "Der Link unten ist trotzdem gültig — du kannst ihn manuell teilen.",
    "done": "Fertig"
  },
  "status": {
    // …existing: active, usedOn, expired
    "emailFailed": "Mail fehlgeschlagen"
  },
  "table": {
    // …existing: email, createdBy, expires, status
    "usedBy": "Verwendet von",
    "actions": "Aktionen"
  },
  "toasts": {
    "resent": "Einladung erneut versendet",
    "resendFailed": "Erneuter Versand fehlgeschlagen",
    "revoked": "Einladung widerrufen",
    "revokeFailed": "Widerrufen fehlgeschlagen"
  }
}
```

Merge these into the existing object — don't overwrite the existing `help`, `title`, `invitationLinks`, etc.

- [ ] **Step 3: Add mirrored keys to `en/admin.json`**

Same structure with English strings:

```jsonc
{
  "actions": {
    "createLink": "+ Create link",
    "createEmail": "✉ Invite by email",
    "copyLink": "📋 Copy link",
    "sendEmail": "✉ Send",
    "resendEmail": "✉ Resend",
    "revoke": "🗑 Revoke"
  },
  "confirmRevoke": "Really revoke this invitation? The link becomes invalid immediately.",
  "expiresLegend": "Valid for",
  "expires": {
    "24h": "24 hours",
    "7d": "7 days",
    "30d": "30 days"
  },
  "filter": {
    "label": "Status filter",
    "all": "All",
    "active": "Active",
    "used": "Used",
    "expired": "Expired"
  },
  "createLinkModal": {
    "title": "Create a new invitation link",
    "description": "Generates a single-use link you can share however you like.",
    "submit": "Create link",
    "creating": "Creating..."
  },
  "createEmailModal": {
    "title": "Invite by email",
    "description": "We create a single-use link and mail it directly to the address you enter.",
    "emailLabel": "Email address",
    "emailPlaceholder": "jane@example.com",
    "emailRequired": "Email is required",
    "emailInvalid": "Not a valid email address",
    "submit": "Send invitation",
    "sending": "Sending..."
  },
  "success": {
    "title": "Invitation created",
    "linkLabel": "Invitation link",
    "copyLink": "Copy link",
    "copiedToClipboard": "Link copied to clipboard",
    "copyFailed": "Could not copy link",
    "emailSent": "Email sent to {{email}}",
    "emailFailed": "Email delivery failed",
    "emailFailedFallback": "The link below is still valid — share it manually.",
    "done": "Done"
  },
  "status": {
    "emailFailed": "Email failed"
  },
  "table": {
    "usedBy": "Used by",
    "actions": "Actions"
  },
  "toasts": {
    "resent": "Invitation resent",
    "resendFailed": "Resend failed",
    "revoked": "Invitation revoked",
    "revokeFailed": "Revoke failed"
  }
}
```

- [ ] **Step 4: Validate JSON**

```bash
python -c "import json; json.load(open('frontend/src/i18n/resources/de/admin.json', encoding='utf-8'))"
python -c "import json; json.load(open('frontend/src/i18n/resources/en/admin.json', encoding='utf-8'))"
```

Both must print nothing (success). If the merge introduced a syntax error, fix it and re-run.

- [ ] **Step 5: Run the inline-help audit**

```bash
node scripts/audit-inline-help.mjs
```

Expected: all green. The existing `admin:invitations.help.*` keys are unchanged, and the new keys under `admin:invitations.*` are not referenced by InlineHelp so they are not tracked by the script — but the script still must exit 0.

---

## Task 19: Full Stack Verification + Commit

Now that all the new files exist and the old callers are replaced, the tree should compile. Land everything in a single commit (or more granular commits if the engineer prefers — but the set of changes is cohesive).

- [ ] **Step 1: Frontend tsc + lint + vitest**

```bash
cd frontend && npx tsc --noEmit && npm run lint && npx vitest --run
```

Expected: no type errors, no lint errors, all 215+ tests green including the four new test files.

- [ ] **Step 2: Backend tsc + lint + tests**

```bash
cd backend && npx tsc --noEmit && npm run lint && npm test -- --forceExit
```

Expected: all green.

- [ ] **Step 3: Commit the entire frontend wave**

```bash
git add frontend/src/lib/api/admin.ts \
        frontend/src/components/Admin/InviteSuccessModal.tsx \
        frontend/src/components/Admin/CreateLinkInviteModal.tsx \
        frontend/src/components/Admin/CreateEmailInviteModal.tsx \
        frontend/src/components/Admin/InvitationManagement.tsx \
        frontend/src/pages/AdminPage.tsx \
        frontend/src/i18n/resources/de/admin.json \
        frontend/src/i18n/resources/en/admin.json \
        frontend/src/__tests__/components/Admin/InviteSuccessModal.test.tsx \
        frontend/src/__tests__/components/Admin/CreateLinkInviteModal.test.tsx \
        frontend/src/__tests__/components/Admin/CreateEmailInviteModal.test.tsx \
        frontend/src/__tests__/components/Admin/InvitationManagement.test.tsx
git commit -m "feat(invitations): frontend for link/email create, row actions, filter chips"
```

---

## Task 20: End-to-End Smoke Test via Playwright

Manual exercise, verifies the whole stack works locally before `/deploy`.

Preconditions: local Postgres (`docker start travstats-db-local`) up, `backend/.env` has `FRONTEND_URL=http://localhost:3000` and `ALLOW_REGISTRATION=false`, dev server running via `npm run dev` (backend 8000, frontend 3000).

- [ ] **Step 1: Log in as admin**

Navigate to `http://localhost:3000/login`, log in as `admin` / `admin123` (or reset the admin password first via the same bcrypt/DB trick used earlier in the session).

- [ ] **Step 2: Create a link-only invitation**

Navigate to `/admin` → Einladungen → click `+ Link erstellen`. Pick `7 Tage`, submit. Confirm: the success modal shows a monospace URL containing `/register?token=…`. Click `Link kopieren`. Check the clipboard contains the URL.

- [ ] **Step 3: Create an email invitation with SMTP disabled**

Click `✉ Einladung per E-Mail`. Enter `jane@example.com`, pick `7 Tage`, submit. Confirm: the success modal shows the amber "Email delivery failed" warning (because SMTP is not configured locally) plus the fallback URL. The invitation still appears in the list.

- [ ] **Step 4: Use a link invitation**

Copy the first invitation URL from Step 2. Log out. Paste the URL into the address bar. Confirm the green "you are registering with an invitation" banner is visible. Fill username `e2e_user` and password `testpass123`, submit. Expect: redirect to `/`, logged in as `e2e_user`.

- [ ] **Step 5: Verify the admin list**

Log out, log back in as admin, navigate to Einladungen. Switch the filter to `Verwendet`. Confirm the used invitation row shows `Verwendet von e2e_user`. Switch to `Aktiv`; the email invitation from Step 3 should still be there.

- [ ] **Step 6: Resend the failed email invitation**

On the email invitation row (status `Mail fehlgeschlagen`), click `✉ Nochmal senden`. Expect: another failure toast (SMTP still down). The row's error tooltip updates.

- [ ] **Step 7: Revoke it**

Click `🗑 Widerrufen` on the same row, confirm the browser confirm dialog. The row disappears from the table. Query the DB to confirm the row is actually deleted:

```bash
docker exec -e PGPASSWORD=flights travstats-db-local psql -U flights -d flights -c "SELECT count(*) FROM invitations WHERE email='jane@example.com';"
```

Expected: `count = 0`.

- [ ] **Step 8: Attempt to re-use the consumed link from Step 2**

Log out. Paste the Step 2 URL into the address bar again. Try to register a second user. Expect: `Invitation token already used` error.

- [ ] **Step 9: Test MAX_USERS enforcement**

Temporarily set `MAX_USERS=2` in `backend/.env`. Restart the backend (`Ctrl+C` then `npm run dev`). As admin, try to create a new link invitation. Expect: `User limit reached` toast. Reset `MAX_USERS` back to `10` and restart again.

- [ ] **Step 10: Clean up test data**

```bash
docker exec -e PGPASSWORD=flights travstats-db-local psql -U flights -d flights -c "DELETE FROM users WHERE username='e2e_user'; DELETE FROM invitations WHERE email='jane@example.com' OR created_at > now() - interval '1 hour';"
```

This task produces no commit — it is a verification gate. If anything fails, stop, investigate, and create a fix commit before running `/deploy`.

---

## Self-Review

### Spec coverage

- ✅ Two entry points (link vs email) — Tasks 5, 6 (backend), 14, 15 (frontend modals), 17 (wiring).
- ✅ Row-level management — Task 8 (delete), Task 7 (resend), Task 16 (copy link + revoke + resend buttons), Task 17 (handlers).
- ✅ `MAX_USERS` enforcement — Task 5 (link-only check); Task 6 reuses the same helper.
- ✅ `notificationEmail` auto-populate — Task 10.
- ✅ SMTP failure surfaced, never blocking — Task 6 (create), Task 7 (resend).
- ✅ Schema migration — Task 1.
- ✅ Zod schemas — Task 2.
- ✅ `sendInvitationEmail` helper — Task 4.
- ✅ Route split — Task 3.
- ✅ Status filter on GET — Task 9.
- ✅ DE + EN translations — Task 18.
- ✅ Tests — Tasks 5–10 (backend), 13–16 (frontend), 20 (E2E smoke).

### Placeholder scan

- No "TBD", "TODO", or vague "add appropriate error handling" phrases.
- Every task has concrete test code and concrete implementation code.
- The "hold the commit" language in Tasks 12–17 is intentional — it explicitly flags the coupling window so the executing engineer is not surprised.

### Type consistency

- `Invitation` type: defined and exported from `InvitationManagement.tsx` in Task 16, imported by `AdminPage.tsx` in Task 17, used by the vitest test in Task 16.
- `StatusFilter` type: defined and exported in Task 16, used in Task 17 state.
- `createLinkInvitation` / `createEmailInvitation` / `resendInvitationEmail` / `revokeInvitation` names are consistent across Task 12 (declaration) and Task 17 (callers).
- `ensureUserLimitNotReached` / `buildInviteUrl` helpers are defined in Task 5 and reused in Task 6. No renames.

### Scope

- 20 tasks, one cohesive feature. Each backend task is committable on its own (with green backend tests). Frontend tasks 12–18 land in a single combined commit in Task 19 because of the deliberate coupling (`adminApi` rename breaks the old `handleCreateInvitation` until the new modals are wired). That is explicitly called out in each hold-the-commit step.
