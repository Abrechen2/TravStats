# Two-Factor Authentication (TOTP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user optionally protect their login with a time-based one-time code, with recovery codes, an admin reset and a command-line escape hatch so nobody can be locked out of their own logbook.

**Architecture:** The login endpoint already knows how to answer with a *challenge* instead of a session — that is what `mustChangePassword` does today: it returns `{ requiresPasswordChange: true }` plus a short-lived HttpOnly `change_token` cookie. Two-factor reuses that exact shape: `{ requiresTwoFactor: true }` plus a `twofa_token` cookie, redeemed at `POST /auth/2fa/verify`. Nothing about the session model changes — the same JWT cookie is issued, just one step later. The TOTP secret is stored encrypted with the project's existing `encrypt()` helper; recovery codes are bcrypt-hashed like passwords and single-use.

**Tech Stack:** Express + Prisma + Postgres, `otplib` for TOTP, `bcrypt` (already present) for recovery codes, React + Zustand + react-i18next on the frontend, `qrcode.react` (already a dependency) for the QR code, Jest (backend) and Vitest (frontend).

## Global Constraints

- **Opt-in per user. There is no way to require it.** No admin policy, no instance switch, no nagging banner. A user who never touches the security section must see an unchanged login.
- Users without 2FA must reach `POST /auth/login` and get a session in exactly one request, as today.
- Code, comments and commit messages in English. User-facing copy: German first, English mirrored in the same change.
- `any` is forbidden — `unknown` plus type guards.
- All request bodies validated with Zod, schemas under `backend/src/schemas/`.
- Every auth endpoint carries `authLimiter` (`backend/src/middleware/rateLimit.ts:129`).
- No secrets in logs. Never log a TOTP secret, a recovery code, or a challenge token.
- Prisma migrations via `npx prisma migrate dev` against a worktree-local database, never the shared `flights_dev`.
- Files 200–400 lines, 800 hard maximum.

## Known limitation to state, not solve

**Personal Access Tokens bypass this feature entirely.** `backend/src/middleware/auth.ts:28-41` documents two auth paths, and `Authorization: Bearer ts_pat_…` *wins* over the session cookie. Two-factor protects the browser login and nothing else; a leaked PAT is unaffected. Task 10 therefore shows the user their active tokens during setup instead of pretending the problem does not exist. Revoking tokens stays a manual decision — silently invalidating the mobile app because someone enabled 2FA would be a worse surprise than the gap.

**What this means for the mobile app, which is better than it sounds.** Device pairing is already browser-only: `backend/src/routes/pairing.ts:38-58` hard-403s any PAT-authenticated attempt to mint a pairing code, precisely to close the escalation chain *PAT → pairing code → fresh PAT*. So issuing a new device token inherits two-factor for free, with no change in this plan. Devices paired *before* 2FA was switched on keep working, which is the right default — enabling a protection should not brick someone's phone. The control that actually ends a device's access is revoking its token, and tokens are per-device (`ApiToken.deviceId`). The warning copy in Task 10 therefore points at that list rather than leaving the user with a worry and no lever.

## File Structure

| File | Responsibility |
|---|---|
| `backend/prisma/schema.prisma` | `User` gains four columns; new `TwoFactorRecoveryCode` model |
| `backend/src/services/twoFactor/totpService.ts` | Generate a secret, build the otpauth URL, verify a code. Encryption in/out lives here |
| `backend/src/services/twoFactor/recoveryCodeService.ts` | Generate, hash, verify-and-consume recovery codes |
| `backend/src/schemas/twoFactor.ts` | Zod schemas for every request body in this feature |
| `backend/src/routes/auth/twoFactor.ts` | Setup, activate, verify-at-login, disable. Mounted under `/auth/2fa` |
| `backend/src/routes/auth.ts` | Login gains the challenge branch (modification only) |
| `backend/src/routes/admin/users.ts` | Admin disable endpoint (modification only) |
| `backend/src/scripts/disableTwoFactor.ts` | The command-line escape hatch |
| `frontend/src/lib/api/auth.ts` | `LoginResult` union gains the challenge case; 2FA calls |
| `frontend/src/pages/TwoFactorChallengePage.tsx` | The code prompt after a password |
| `frontend/src/components/settings/SecuritySection.tsx` | Enable, disable, show QR, show recovery codes |
| `frontend/src/i18n/resources/{de,en}/auth.json` | Challenge copy |
| `frontend/src/i18n/resources/{de,en}/settings.json` | Security-section copy |

---

### Task 1: Schema and migration

**Files:**
- Modify: `backend/prisma/schema.prisma` (User model, ~line 12; new model at end of user block)
- Test: none — a migration is verified by Task 2's tests running against it

**Interfaces:**
- Produces: `User.twoFactorSecret`, `User.twoFactorEnabledAt`, `User.twoFactorPendingSecret`, `User.twoFactorToken`, `User.twoFactorTokenExpiry`; model `TwoFactorRecoveryCode { id, userId, codeHash, usedAt, createdAt }`

- [ ] **Step 1: Add the columns to `User`**

Insert after the `changeTokenExpiry` line:

```prisma
  // Two-factor (TOTP). Opt-in per user — null everywhere means "not using it",
  // which is the state every account starts in and most stay in.
  // `twoFactorSecret` is ENCRYPTED at rest via utils/encryption.ts; the pending
  // one holds a secret that has been shown as a QR code but not yet confirmed
  // by a first correct code, so an abandoned setup never locks anyone out.
  twoFactorSecret        String?   @map("two_factor_secret")
  twoFactorPendingSecret String?   @map("two_factor_pending_secret")
  twoFactorEnabledAt     DateTime? @map("two_factor_enabled_at")
  // Short-lived login challenge, hashed like changeToken above: the password
  // was right, the second factor is still outstanding.
  twoFactorToken         String?   @unique @map("two_factor_token")
  twoFactorTokenExpiry   DateTime? @map("two_factor_token_expiry")
  twoFactorRecoveryCodes TwoFactorRecoveryCode[]
```

- [ ] **Step 2: Add the recovery-code model**

Insert after the `PairingCode` model:

```prisma
/// Single-use recovery codes, the way back in when the phone is gone.
///
/// Stored as bcrypt hashes for the same reason passwords are: a database dump
/// must not hand over a working credential. `usedAt` rather than deletion so a
/// user can see that a code was spent, and when.
model TwoFactorRecoveryCode {
  id        String    @id @default(uuid())
  userId    String    @map("user_id")
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  codeHash  String    @map("code_hash")
  usedAt    DateTime? @map("used_at")
  createdAt DateTime  @default(now()) @map("created_at")

  @@index([userId])
  @@map("two_factor_recovery_codes")
}
```

- [ ] **Step 3: Create the migration**

Run (worktree-local database, never `flights_dev`):

```bash
cd backend
DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_2fa" \
SHADOW_DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_shadow" \
npx prisma migrate dev --name two_factor_totp
```

Expected: a new folder under `prisma/migrations/` and "Your database is now in sync".

If `prisma generate` fails with `EPERM … query_engine-windows.dll.node`, a dev server holds the DLL. Rename it and regenerate:

```bash
mv node_modules/.prisma/client/query_engine-windows.dll.node node_modules/.prisma/client/query_engine-windows.dll.node.locked
npx prisma generate
rm -f node_modules/.prisma/client/query_engine-windows.dll.node.locked
```

- [ ] **Step 4: Verify the columns exist**

Run:

```bash
docker exec travstats-db-dev psql -U flights_dev -d flights_2fa -c "\d users" | grep two_factor
docker exec travstats-db-dev psql -U flights_dev -d flights_2fa -c "\d two_factor_recovery_codes"
```

Expected: five `two_factor_*` columns on `users`, and the recovery-code table with a `user_id` index.

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(2fa): schema for TOTP secrets and recovery codes"
```

---

### Task 2: TOTP service

**Files:**
- Create: `backend/src/services/twoFactor/totpService.ts`
- Test: `backend/src/services/twoFactor/__tests__/totpService.test.ts`

**Interfaces:**
- Consumes: `encrypt` / `decrypt` from `backend/src/utils/encryption.ts`
- Produces:
  - `generateSecret(): string` — a base32 secret, plaintext
  - `buildOtpauthUrl(secret: string, username: string, issuer: string): string`
  - `encryptSecret(secret: string): string` / `decryptSecret(stored: string): string`
  - `verifyCode(secret: string, code: string): boolean` — secret is PLAINTEXT

- [ ] **Step 1: Add the dependency**

```bash
cd backend && npm install otplib@^12.0.1
```

- [ ] **Step 2: Write the failing test**

```typescript
import { authenticator } from "otplib";
import {
  generateSecret,
  buildOtpauthUrl,
  encryptSecret,
  decryptSecret,
  verifyCode,
} from "../totpService";

describe("totpService", () => {
  it("generates a base32 secret an authenticator app accepts", () => {
    const secret = generateSecret();
    expect(secret).toMatch(/^[A-Z2-7]{16,}$/);
  });

  it("accepts the code the algorithm currently produces", () => {
    const secret = generateSecret();
    expect(verifyCode(secret, authenticator.generate(secret))).toBe(true);
  });

  it("rejects a wrong code", () => {
    const secret = generateSecret();
    expect(verifyCode(secret, "000000")).toBe(false);
  });

  // A phone clock is never exactly the server's. One step either side is the
  // usual tolerance; more than that widens the window an attacker can guess in.
  //
  // otplib takes the time from `authenticator.options.epoch`, NOT from a second
  // argument to generate() — passing one there is silently ignored and the test
  // would prove nothing. Set the option, generate, then restore it.
  it("accepts the previous and next step, but not two steps away", () => {
    const secret = generateSecret();
    const now = Date.now();
    const at = (offsetSeconds: number): string => {
      const previous = authenticator.options;
      authenticator.options = { ...previous, epoch: now + offsetSeconds * 1000 };
      const token = authenticator.generate(secret);
      authenticator.options = previous;
      return token;
    };
    expect(verifyCode(secret, at(-30))).toBe(true);
    expect(verifyCode(secret, at(30))).toBe(true);
    expect(verifyCode(secret, at(-120))).toBe(false);
  });

  it("survives a code with spaces, which is how people copy it", () => {
    const secret = generateSecret();
    const code = authenticator.generate(secret);
    expect(verifyCode(secret, `${code.slice(0, 3)} ${code.slice(3)}`)).toBe(true);
  });

  it("round-trips a secret through encryption", () => {
    const secret = generateSecret();
    const stored = encryptSecret(secret);
    expect(stored).not.toContain(secret);
    expect(decryptSecret(stored)).toBe(secret);
  });

  it("builds an otpauth URL carrying issuer and account", () => {
    const url = buildOtpauthUrl("JBSWY3DPEHPK3PXP", "alex", "TravStats");
    expect(url.startsWith("otpauth://totp/")).toBe(true);
    expect(url).toContain("issuer=TravStats");
    expect(url).toContain("alex");
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `cd backend && DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_2fa" npx jest src/services/twoFactor/__tests__/totpService.test.ts`
Expected: FAIL — `Cannot find module '../totpService'`.

- [ ] **Step 4: Implement**

```typescript
import { authenticator } from "otplib";
import { encrypt, decrypt } from "../../utils/encryption";

// One step (30s) of tolerance either side. Phone clocks drift; two steps would
// double the guessing window for no practical gain.
authenticator.options = { window: 1 };

export function generateSecret(): string {
  return authenticator.generateSecret();
}

export function buildOtpauthUrl(secret: string, username: string, issuer: string): string {
  return authenticator.keyuri(username, issuer, secret);
}

/** The secret is a credential: it never sits in the database in the clear. */
export function encryptSecret(secret: string): string {
  return encrypt(secret);
}

export function decryptSecret(stored: string): string {
  return decrypt(stored);
}

/**
 * Verify a code against a PLAINTEXT secret. Whitespace is stripped because
 * authenticator apps display codes as "123 456" and people copy them that way.
 */
export function verifyCode(secret: string, code: string): boolean {
  const normalised = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(normalised)) return false;
  try {
    return authenticator.verify({ token: normalised, secret });
  } catch {
    return false;
  }
}
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cd backend && DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_2fa" npx jest src/services/twoFactor/__tests__/totpService.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/src/services/twoFactor
git commit -m "feat(2fa): TOTP secret generation and verification"
```

---

### Task 3: Recovery-code service

**Files:**
- Create: `backend/src/services/twoFactor/recoveryCodeService.ts`
- Test: `backend/src/services/twoFactor/__tests__/recoveryCodeService.test.ts`

**Interfaces:**
- Consumes: `prisma` from `backend/src/db`, `hashPassword` / `comparePassword` from `backend/src/utils/password`
- Produces:
  - `RECOVERY_CODE_COUNT: number` (10)
  - `generateRecoveryCodes(userId: string): Promise<string[]>` — replaces any existing codes, returns PLAINTEXT codes once
  - `consumeRecoveryCode(userId: string, code: string): Promise<boolean>`
  - `countUnusedRecoveryCodes(userId: string): Promise<number>`

- [ ] **Step 1: Write the failing test**

```typescript
import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import {
  RECOVERY_CODE_COUNT,
  generateRecoveryCodes,
  consumeRecoveryCode,
  countUnusedRecoveryCodes,
} from "../recoveryCodeService";

describe("recoveryCodeService", () => {
  let userId: string;

  beforeEach(async () => {
    await prisma.user.deleteMany({ where: { username: "recoveryUser" } });
    const user = await prisma.user.create({
      data: { username: "recoveryUser", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: "recoveryUser" } });
  });

  it("issues ten readable codes", async () => {
    const codes = await generateRecoveryCodes(userId);
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    for (const code of codes) expect(code).toMatch(/^[a-z0-9]{5}-[a-z0-9]{5}$/);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
  });

  it("stores hashes, never the codes themselves", async () => {
    const codes = await generateRecoveryCodes(userId);
    const rows = await prisma.twoFactorRecoveryCode.findMany({ where: { userId } });
    for (const row of rows) expect(codes).not.toContain(row.codeHash);
  });

  it("accepts a code once and never again", async () => {
    const codes = await generateRecoveryCodes(userId);
    expect(await consumeRecoveryCode(userId, codes[0])).toBe(true);
    expect(await consumeRecoveryCode(userId, codes[0])).toBe(false);
  });

  it("rejects a code belonging to somebody else", async () => {
    const codes = await generateRecoveryCodes(userId);
    const other = await prisma.user.create({
      data: { username: "recoveryOther", passwordHash: await hashPassword("password123") },
    });
    expect(await consumeRecoveryCode(other.id, codes[0])).toBe(false);
    await prisma.user.delete({ where: { id: other.id } });
  });

  it("counts what is left", async () => {
    const codes = await generateRecoveryCodes(userId);
    await consumeRecoveryCode(userId, codes[0]);
    expect(await countUnusedRecoveryCodes(userId)).toBe(RECOVERY_CODE_COUNT - 1);
  });

  // Regenerating is how a user reacts to a leaked sheet of codes. The old ones
  // must stop working the moment new ones are shown.
  it("replaces the whole set when regenerated", async () => {
    const first = await generateRecoveryCodes(userId);
    const second = await generateRecoveryCodes(userId);
    expect(await consumeRecoveryCode(userId, first[0])).toBe(false);
    expect(await consumeRecoveryCode(userId, second[0])).toBe(true);
  });

  it("ignores case and surrounding whitespace", async () => {
    const codes = await generateRecoveryCodes(userId);
    expect(await consumeRecoveryCode(userId, `  ${codes[0].toUpperCase()}  `)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_2fa" npx jest src/services/twoFactor/__tests__/recoveryCodeService.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
import crypto from "crypto";
import { prisma } from "../../db";
import { hashPassword, comparePassword } from "../../utils/password";

export const RECOVERY_CODE_COUNT = 10;

// No vowels and no look-alikes: a code gets read off a printout and typed by
// hand, so "0/O" and "1/l" cost support time, and removing vowels avoids
// accidentally spelling something unfortunate.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

function randomChunk(length: number): string {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

function newCode(): string {
  return `${randomChunk(5)}-${randomChunk(5)}`;
}

function normalise(code: string): string {
  return code.trim().toLowerCase();
}

/**
 * Issue a fresh set, replacing any existing one. The plaintext codes are
 * returned exactly once — after this call only hashes remain, so a user who
 * loses the sheet regenerates rather than recovers it.
 */
export async function generateRecoveryCodes(userId: string): Promise<string[]> {
  const codes: string[] = [];
  while (codes.length < RECOVERY_CODE_COUNT) {
    const candidate = newCode();
    if (!codes.includes(candidate)) codes.push(candidate);
  }

  const hashes = await Promise.all(codes.map((code) => hashPassword(code)));

  await prisma.$transaction([
    prisma.twoFactorRecoveryCode.deleteMany({ where: { userId } }),
    prisma.twoFactorRecoveryCode.createMany({
      data: hashes.map((codeHash) => ({ userId, codeHash })),
    }),
  ]);

  return codes;
}

/**
 * Spend a code. Returns false for an unknown code, an already-used one, or a
 * code belonging to another account — the caller cannot tell which, on purpose.
 */
export async function consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
  const candidate = normalise(code);
  const rows = await prisma.twoFactorRecoveryCode.findMany({
    where: { userId, usedAt: null },
  });

  for (const row of rows) {
    if (await comparePassword(candidate, row.codeHash)) {
      // Conditional update: two parallel logins racing on the same code means
      // exactly one of them updates a row that still had usedAt = null.
      const claimed = await prisma.twoFactorRecoveryCode.updateMany({
        where: { id: row.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      return claimed.count === 1;
    }
  }
  return false;
}

export async function countUnusedRecoveryCodes(userId: string): Promise<number> {
  return prisma.twoFactorRecoveryCode.count({ where: { userId, usedAt: null } });
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd backend && DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_2fa" npx jest src/services/twoFactor/__tests__/recoveryCodeService.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/twoFactor
git commit -m "feat(2fa): single-use recovery codes"
```

---

### Task 4: Zod schemas

**Files:**
- Create: `backend/src/schemas/twoFactor.ts`
- Test: `backend/src/schemas/__tests__/twoFactor.test.ts`

**Interfaces:**
- Produces: `activateTwoFactorSchema`, `verifyTwoFactorSchema`, `disableTwoFactorSchema`

- [ ] **Step 1: Write the failing test**

```typescript
import {
  activateTwoFactorSchema,
  verifyTwoFactorSchema,
  disableTwoFactorSchema,
} from "../twoFactor";

describe("two-factor schemas", () => {
  it("accepts a six-digit activation code", () => {
    expect(activateTwoFactorSchema.parse({ code: "123456" }).code).toBe("123456");
  });

  it("rejects anything that is not six digits", () => {
    expect(() => activateTwoFactorSchema.parse({ code: "12345" })).toThrow();
    expect(() => activateTwoFactorSchema.parse({ code: "abcdef" })).toThrow();
  });

  it("takes either a code or a recovery code at login, but not neither", () => {
    expect(verifyTwoFactorSchema.parse({ code: "123456" }).code).toBe("123456");
    expect(verifyTwoFactorSchema.parse({ recoveryCode: "abcde-12345" }).recoveryCode).toBe(
      "abcde-12345",
    );
    expect(() => verifyTwoFactorSchema.parse({})).toThrow();
  });

  it("requires the current password to switch it off", () => {
    expect(disableTwoFactorSchema.parse({ password: "hunter2" }).password).toBe("hunter2");
    expect(() => disableTwoFactorSchema.parse({})).toThrow();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npx jest src/schemas/__tests__/twoFactor.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
import { z } from "zod";

const sixDigits = z
  .string()
  .transform((value) => value.replace(/\s+/g, ""))
  .refine((value) => /^\d{6}$/.test(value), "Code must be six digits");

export const activateTwoFactorSchema = z.object({ code: sixDigits });

/**
 * At login either factor is acceptable: the app's code, or one recovery code
 * off the sheet. Requiring at least one of them here means the route handler
 * never has to answer "what if both are missing".
 */
export const verifyTwoFactorSchema = z
  .object({
    code: sixDigits.optional(),
    recoveryCode: z.string().min(1).max(64).optional(),
  })
  .refine(
    (value) => value.code !== undefined || value.recoveryCode !== undefined,
    "Provide either a code or a recovery code",
  );

/** Switching it off is a security decision, so it costs the password. */
export const disableTwoFactorSchema = z.object({ password: z.string().min(1).max(200) });
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd backend && npx jest src/schemas/__tests__/twoFactor.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/schemas/twoFactor.ts backend/src/schemas/__tests__/twoFactor.test.ts
git commit -m "feat(2fa): request schemas"
```

---

### Task 5: Setup and activation endpoints

**Files:**
- Create: `backend/src/routes/auth/twoFactor.ts`
- Modify: `backend/src/index.ts` (mount the router next to the existing auth router)
- Test: `backend/src/routes/__tests__/twoFactor.setup.test.ts`

**Interfaces:**
- Consumes: Task 2 (`generateSecret`, `buildOtpauthUrl`, `encryptSecret`, `decryptSecret`, `verifyCode`), Task 3 (`generateRecoveryCodes`), Task 4 (`activateTwoFactorSchema`)
- Produces:
  - `POST /api/v1/auth/2fa/setup` → `{ secret: string; otpauthUrl: string }`
  - `POST /api/v1/auth/2fa/activate` → `{ recoveryCodes: string[] }`
  - `GET /api/v1/auth/2fa/status` → `{ enabled: boolean; recoveryCodesLeft: number }`

- [ ] **Step 1: Write the failing test**

```typescript
import request from "supertest";
import { authenticator } from "otplib";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { decryptSecret } from "../../services/twoFactor/totpService";

describe("two-factor setup", () => {
  let cookie: string;
  let userId: string;

  beforeEach(async () => {
    await prisma.user.deleteMany({ where: { username: "setupUser" } });
    const user = await prisma.user.create({
      data: { username: "setupUser", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: "setupUser" } });
  });

  it("reports two-factor as off for a fresh account", async () => {
    const res = await request(app).get("/api/v1/auth/2fa/status").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: false, recoveryCodesLeft: 0 });
  });

  it("hands out a secret and an otpauth URL, and stores the secret as PENDING", async () => {
    const res = await request(app).post("/api/v1/auth/2fa/setup").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.otpauthUrl).toContain("otpauth://totp/");

    const row = await prisma.user.findUnique({ where: { id: userId } });
    expect(row?.twoFactorPendingSecret).toBeTruthy();
    expect(row?.twoFactorSecret).toBeNull();
    expect(row?.twoFactorEnabledAt).toBeNull();
  });

  it("stores the pending secret encrypted", async () => {
    const res = await request(app).post("/api/v1/auth/2fa/setup").set("Cookie", cookie);
    const row = await prisma.user.findUnique({ where: { id: userId } });
    expect(row?.twoFactorPendingSecret).not.toBe(res.body.secret);
    expect(decryptSecret(row!.twoFactorPendingSecret!)).toBe(res.body.secret);
  });

  it("activates on a correct first code and returns recovery codes", async () => {
    const setup = await request(app).post("/api/v1/auth/2fa/setup").set("Cookie", cookie);
    const code = authenticator.generate(setup.body.secret);

    const res = await request(app)
      .post("/api/v1/auth/2fa/activate")
      .set("Cookie", cookie)
      .send({ code });

    expect(res.status).toBe(200);
    expect(res.body.recoveryCodes).toHaveLength(10);

    const row = await prisma.user.findUnique({ where: { id: userId } });
    expect(row?.twoFactorSecret).toBeTruthy();
    expect(row?.twoFactorPendingSecret).toBeNull();
    expect(row?.twoFactorEnabledAt).not.toBeNull();
  });

  // An abandoned setup must not half-enable anything, or the next login asks
  // for a code the user never finished configuring.
  it("stays off when the first code is wrong", async () => {
    await request(app).post("/api/v1/auth/2fa/setup").set("Cookie", cookie);
    const res = await request(app)
      .post("/api/v1/auth/2fa/activate")
      .set("Cookie", cookie)
      .send({ code: "000000" });

    expect(res.status).toBe(400);
    const row = await prisma.user.findUnique({ where: { id: userId } });
    expect(row?.twoFactorSecret).toBeNull();
    expect(row?.twoFactorEnabledAt).toBeNull();
  });

  it("refuses to activate when no setup was started", async () => {
    const res = await request(app)
      .post("/api/v1/auth/2fa/activate")
      .set("Cookie", cookie)
      .send({ code: "123456" });
    expect(res.status).toBe(400);
  });

  it("requires a session", async () => {
    expect((await request(app).post("/api/v1/auth/2fa/setup")).status).toBe(401);
    expect((await request(app).get("/api/v1/auth/2fa/status")).status).toBe(401);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_2fa" npx jest src/routes/__tests__/twoFactor.setup.test.ts`
Expected: FAIL — every route 404s.

- [ ] **Step 3: Implement the router**

```typescript
import { Router, Response, NextFunction } from "express";
import { prisma } from "../../db";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { authLimiter } from "../../middleware/rateLimit";
import { AppError } from "../../middleware/errorHandler";
import { activateTwoFactorSchema } from "../../schemas/twoFactor";
import {
  generateSecret,
  buildOtpauthUrl,
  encryptSecret,
  decryptSecret,
  verifyCode,
} from "../../services/twoFactor/totpService";
import {
  generateRecoveryCodes,
  countUnusedRecoveryCodes,
} from "../../services/twoFactor/recoveryCodeService";
import logger from "../../utils/logger";

const router = Router();

const ISSUER = "TravStats";

router.get("/status", authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorEnabledAt: true },
    });
    const enabled = Boolean(user?.twoFactorEnabledAt);
    res.json({
      enabled,
      recoveryCodesLeft: enabled ? await countUnusedRecoveryCodes(userId) : 0,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Begin setup. The secret is returned once so the page can render a QR code and
 * offer it for manual entry, and stored as PENDING — not active — so an
 * abandoned setup leaves the account exactly as it was.
 */
router.post("/setup", authenticate, authLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { username: true, twoFactorEnabledAt: true },
    });
    if (!user) throw new AppError("User not found", 404);
    if (user.twoFactorEnabledAt) {
      throw new AppError("Two-factor authentication is already enabled", 409);
    }

    const secret = generateSecret();
    await prisma.user.update({
      where: { id: userId },
      data: { twoFactorPendingSecret: encryptSecret(secret) },
    });

    // Deliberately no secret in the log line.
    logger.info({ operation: "two_factor_setup_started", userId });
    res.json({ secret, otpauthUrl: buildOtpauthUrl(secret, user.username, ISSUER) });
  } catch (error) {
    next(error);
  }
});

/** Confirm the app is configured by proving one code, then switch it on. */
router.post("/activate", authenticate, authLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const { code } = activateTwoFactorSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorPendingSecret: true, twoFactorEnabledAt: true },
    });
    if (!user?.twoFactorPendingSecret) {
      throw new AppError("No two-factor setup in progress", 400);
    }
    if (user.twoFactorEnabledAt) {
      throw new AppError("Two-factor authentication is already enabled", 409);
    }

    const secret = decryptSecret(user.twoFactorPendingSecret);
    if (!verifyCode(secret, code)) {
      throw new AppError("That code is not right", 400);
    }

    // Recovery codes FIRST, then the switch. If code generation fails, the
    // account stays exactly as it was — 2FA on with no way back in would be the
    // one outcome this feature must never produce.
    const recoveryCodes = await generateRecoveryCodes(userId);

    await prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorSecret: user.twoFactorPendingSecret,
        twoFactorPendingSecret: null,
        twoFactorEnabledAt: new Date(),
      },
    });
    logger.info({ operation: "two_factor_enabled", userId });
    res.json({ recoveryCodes });
  } catch (error) {
    next(error);
  }
});

export default router;
```

- [ ] **Step 4: Mount it**

In `backend/src/index.ts`, beside the existing auth route registration, add:

```typescript
import twoFactorRoutes from './routes/auth/twoFactor';
```

and, immediately after the line that mounts `/api/v1/auth`:

```typescript
app.use('/api/v1/auth/2fa', twoFactorRoutes);
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cd backend && DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_2fa" npx jest src/routes/__tests__/twoFactor.setup.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/auth backend/src/index.ts backend/src/routes/__tests__/twoFactor.setup.test.ts
git commit -m "feat(2fa): setup, activation and status endpoints"
```

---

### Task 6: The login challenge

**Files:**
- Modify: `backend/src/routes/auth.ts` (the login handler, around the `mustChangePassword` branch at line ~172)
- Modify: `backend/src/routes/auth/twoFactor.ts` (add `POST /verify`)
- Test: `backend/src/routes/__tests__/twoFactor.login.test.ts`

**Interfaces:**
- Consumes: Task 2 (`decryptSecret`, `verifyCode`), Task 3 (`consumeRecoveryCode`), Task 4 (`verifyTwoFactorSchema`)
- Produces: `POST /api/v1/auth/login` may answer `{ requiresTwoFactor: true }` and set a `twofa_token` cookie; `POST /api/v1/auth/2fa/verify` completes the login and sets `auth_token`

- [ ] **Step 1: Write the failing test**

```typescript
import request from "supertest";
import crypto from "crypto";
import { authenticator } from "otplib";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { encryptSecret } from "../../services/twoFactor/totpService";
import { generateRecoveryCodes } from "../../services/twoFactor/recoveryCodeService";

const SECRET = "JBSWY3DPEHPK3PXP";

async function makeUserWithTwoFactor(username: string): Promise<string> {
  await prisma.user.deleteMany({ where: { username } });
  const user = await prisma.user.create({
    data: {
      username,
      passwordHash: await hashPassword("password123"),
      twoFactorSecret: encryptSecret(SECRET),
      twoFactorEnabledAt: new Date(),
    },
  });
  return user.id;
}

const cookiesOf = (res: request.Response): string[] =>
  (res.headers["set-cookie"] as unknown as string[]) ?? [];

describe("login with two-factor", () => {
  let userId: string;

  beforeEach(async () => {
    userId = await makeUserWithTwoFactor("twoFactorLogin");
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: "twoFactorLogin" } });
    await prisma.user.deleteMany({ where: { username: "noTwoFactorLogin" } });
  });

  it("answers the password with a challenge instead of a session", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ username: "twoFactorLogin", password: "password123" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ requiresTwoFactor: true });
    expect(res.body.user).toBeUndefined();

    const cookies = cookiesOf(res).join(";");
    expect(cookies).toContain("twofa_token=");
    expect(cookies).not.toContain("auth_token=");
  });

  it("still rejects a wrong password before ever mentioning two-factor", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ username: "twoFactorLogin", password: "wrong" });
    expect(res.status).toBe(401);
    expect(res.body.requiresTwoFactor).toBeUndefined();
  });

  it("leaves an account without two-factor completely unchanged", async () => {
    await prisma.user.deleteMany({ where: { username: "noTwoFactorLogin" } });
    await prisma.user.create({
      data: { username: "noTwoFactorLogin", passwordHash: await hashPassword("password123") },
    });

    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ username: "noTwoFactorLogin", password: "password123" });

    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe("noTwoFactorLogin");
    expect(cookiesOf(res).join(";")).toContain("auth_token=");
  });

  it("completes the login with a correct code", async () => {
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ username: "twoFactorLogin", password: "password123" });

    const res = await request(app)
      .post("/api/v1/auth/2fa/verify")
      .set("Cookie", cookiesOf(login))
      .send({ code: authenticator.generate(SECRET) });

    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe("twoFactorLogin");
    expect(cookiesOf(res).join(";")).toContain("auth_token=");
  });

  it("refuses a wrong code", async () => {
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ username: "twoFactorLogin", password: "password123" });

    const res = await request(app)
      .post("/api/v1/auth/2fa/verify")
      .set("Cookie", cookiesOf(login))
      .send({ code: "000000" });

    expect(res.status).toBe(401);
    expect(cookiesOf(res).join(";")).not.toContain("auth_token=");
  });

  it("refuses without the challenge cookie, even with a correct code", async () => {
    const res = await request(app)
      .post("/api/v1/auth/2fa/verify")
      .send({ code: authenticator.generate(SECRET) });
    expect(res.status).toBe(401);
  });

  it("accepts a recovery code and spends it", async () => {
    const codes = await generateRecoveryCodes(userId);
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ username: "twoFactorLogin", password: "password123" });

    const first = await request(app)
      .post("/api/v1/auth/2fa/verify")
      .set("Cookie", cookiesOf(login))
      .send({ recoveryCode: codes[0] });
    expect(first.status).toBe(200);

    const login2 = await request(app)
      .post("/api/v1/auth/login")
      .send({ username: "twoFactorLogin", password: "password123" });
    const second = await request(app)
      .post("/api/v1/auth/2fa/verify")
      .set("Cookie", cookiesOf(login2))
      .send({ recoveryCode: codes[0] });
    expect(second.status).toBe(401);
  });

  it("expires the challenge", async () => {
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ username: "twoFactorLogin", password: "password123" });

    await prisma.user.update({
      where: { id: userId },
      data: { twoFactorTokenExpiry: new Date(Date.now() - 1000) },
    });

    const res = await request(app)
      .post("/api/v1/auth/2fa/verify")
      .set("Cookie", cookiesOf(login))
      .send({ code: authenticator.generate(SECRET) });
    expect(res.status).toBe(401);
  });

  // The challenge is one attempt at one login, not a reusable pass.
  it("burns the challenge once it has been redeemed", async () => {
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ username: "twoFactorLogin", password: "password123" });
    const cookies = cookiesOf(login);

    await request(app)
      .post("/api/v1/auth/2fa/verify")
      .set("Cookie", cookies)
      .send({ code: authenticator.generate(SECRET) });

    const again = await request(app)
      .post("/api/v1/auth/2fa/verify")
      .set("Cookie", cookies)
      .send({ code: authenticator.generate(SECRET) });
    expect(again.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_2fa" npx jest src/routes/__tests__/twoFactor.login.test.ts`
Expected: FAIL — login still returns a session.

- [ ] **Step 3: Add the challenge branch to login**

In `backend/src/routes/auth.ts`, **immediately BEFORE the `mustChangePassword` block** (i.e. right after the `isValid` check that throws "Invalid credentials"). Placing it after that block leaves a bypass — see the comment in the code below:

```typescript
    // Two-factor: the password was right, so the session is withheld until the
    // second factor arrives. Same shape as the mustChangePassword branch above —
    // a challenge in an HttpOnly cookie, never in the response body.
    //
    // ORDER MATTERS. This block must sit ABOVE the mustChangePassword branch, not
    // below it. An account carrying both flags would otherwise be handed a
    // change_token on password alone, and POST /force-change-password consumes
    // only that cookie — so an attacker who knows the password could set a new
    // one and never meet the second factor. Two-factor first, always.
    if (user.twoFactorEnabledAt) {
      const plainChallenge = crypto.randomBytes(32).toString('hex');
      const hashedChallenge = crypto.createHash('sha256').update(plainChallenge).digest('hex');

      await prisma.user.update({
        where: { id: user.id },
        data: {
          twoFactorToken: hashedChallenge,
          twoFactorTokenExpiry: new Date(Date.now() + 5 * 60 * 1000), // 5 min
        },
      });

      res.cookie('twofa_token', plainChallenge, {
        httpOnly: true,
        secure: getCookieSecure(req),
        sameSite: 'strict',
        maxAge: 5 * 60 * 1000,
        path: '/',
      });
      return res.json({ requiresTwoFactor: true });
    }
```

- [ ] **Step 4: Add the verify endpoint**

Append to `backend/src/routes/auth/twoFactor.ts`:

```typescript
import crypto from "crypto";
import { getAuthCookieOptions } from "../auth";
import { generateToken } from "../../utils/jwt";
import { verifyTwoFactorSchema } from "../../schemas/twoFactor";
import { consumeRecoveryCode } from "../../services/twoFactor/recoveryCodeService";

/**
 * Redeem the login challenge. Deliberately NOT behind `authenticate` — there is
 * no session yet; the `twofa_token` cookie is the credential, and it is good for
 * ONE successful login or MAX_VERIFY_ATTEMPTS failures, whichever comes first.
 * (An earlier draft of this plan claimed "one attempt"; that was not what the
 * code did, and an unlimited five-minute guessing window is the thing a second
 * factor exists to prevent.)
 */
const MAX_VERIFY_ATTEMPTS = 5;
/** Attempts per challenge hash. In memory: a challenge lives five minutes, and
 *  this instance runs one Node process per container. */
const attemptsByChallenge = new Map<string, number>();
router.post("/verify", authLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const payload = verifyTwoFactorSchema.parse(req.body);
    const challenge = req.cookies?.twofa_token;
    if (typeof challenge !== "string" || challenge.length === 0) {
      throw new AppError("No two-factor challenge in progress", 401);
    }

    const hashed = crypto.createHash("sha256").update(challenge).digest("hex");
    const user = await prisma.user.findUnique({ where: { twoFactorToken: hashed } });
    if (!user || !user.twoFactorTokenExpiry || user.twoFactorTokenExpiry < new Date()) {
      throw new AppError("Two-factor challenge expired", 401);
    }
    if (!user.twoFactorSecret) {
      throw new AppError("Two-factor is not enabled for this account", 401);
    }

    const accepted = payload.code
      ? verifyCode(decryptSecret(user.twoFactorSecret), payload.code)
      : await consumeRecoveryCode(user.id, payload.recoveryCode!);

    if (!accepted) {
      // A wrong code costs an attempt but not the whole challenge — a typo must
      // not force the password to be retyped. After MAX_ATTEMPTS the challenge is
      // destroyed, so the five-minute window is not an unlimited guessing budget.
      const attempts = (attemptsByChallenge.get(hashed) ?? 0) + 1;
      attemptsByChallenge.set(hashed, attempts);
      logger.warn({ operation: "two_factor_verify_failed", userId: user.id, attempts });

      if (attempts >= MAX_VERIFY_ATTEMPTS) {
        attemptsByChallenge.delete(hashed);
        await prisma.user.updateMany({
          where: { id: user.id, twoFactorToken: hashed },
          data: { twoFactorToken: null, twoFactorTokenExpiry: null },
        });
      }
      throw new AppError("That code is not right", 401);
    }
    attemptsByChallenge.delete(hashed);

    // Burn the challenge CONDITIONALLY: `updateMany` scoped to the token value
    // means two requests racing on one challenge produce exactly one winner, the
    // same guarantee consumeRecoveryCode relies on. A plain update would let both
    // proceed and mint two sessions from one challenge.
    const burned = await prisma.user.updateMany({
      where: { id: user.id, twoFactorToken: hashed },
      data: { twoFactorToken: null, twoFactorTokenExpiry: null },
    });
    if (burned.count !== 1) throw new AppError("Two-factor challenge expired", 401);
    res.clearCookie("twofa_token", { path: "/" });
    res.cookie("auth_token", generateToken(user.id), getAuthCookieOptions(req));

    logger.info({ operation: "two_factor_verify_ok", userId: user.id });
    res.json({
      user: {
        id: user.id,
        username: user.username,
        isAdmin: user.isAdmin,
        firstName: user.firstName,
        lastName: user.lastName,
      },
    });
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cd backend && DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_2fa" npx jest src/routes/__tests__/twoFactor.login.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/auth.ts backend/src/routes/auth/twoFactor.ts backend/src/routes/__tests__/twoFactor.login.test.ts
git commit -m "feat(2fa): challenge the login and redeem it with a code"
```

---

### Task 7: Turning it off — self, admin, and the command line

**Files:**
- Modify: `backend/src/routes/auth/twoFactor.ts` (add `POST /disable`, `POST /recovery-codes`)
- Modify: `backend/src/routes/admin/users.ts` (add `POST /users/:id/disable-2fa`)
- Create: `backend/src/scripts/disableTwoFactor.ts`
- Test: `backend/src/routes/__tests__/twoFactor.disable.test.ts`

**Interfaces:**
- Produces:
  - `POST /api/v1/auth/2fa/disable` — body `{ password }`, clears everything for the caller
  - `POST /api/v1/auth/2fa/recovery-codes` — body `{ password }`, returns a fresh set
  - `POST /api/v1/admin/users/:id/disable-2fa` — admin clears it for someone else
  - `disableTwoFactorForUsername(username: string): Promise<boolean>` exported from the script for testing

- [ ] **Step 1: Write the failing test**

```typescript
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { encryptSecret } from "../../services/twoFactor/totpService";
import { generateRecoveryCodes } from "../../services/twoFactor/recoveryCodeService";
import { disableTwoFactorForUsername } from "../../scripts/disableTwoFactor";

const SECRET = "JBSWY3DPEHPK3PXP";

async function makeUser(username: string, isAdmin = false): Promise<string> {
  await prisma.user.deleteMany({ where: { username } });
  const user = await prisma.user.create({
    data: {
      username,
      passwordHash: await hashPassword("password123"),
      isAdmin,
      twoFactorSecret: encryptSecret(SECRET),
      twoFactorEnabledAt: new Date(),
    },
  });
  await generateRecoveryCodes(user.id);
  return user.id;
}

describe("turning two-factor off", () => {
  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { username: { in: ["disableSelf", "disableAdmin", "disableVictim", "disableCli"] } },
    });
  });

  it("clears secret, flag and recovery codes when the password is right", async () => {
    const id = await makeUser("disableSelf");
    const res = await request(app)
      .post("/api/v1/auth/2fa/disable")
      .set("Cookie", `auth_token=${generateToken(id)}`)
      .send({ password: "password123" });

    expect(res.status).toBe(200);
    const row = await prisma.user.findUnique({ where: { id } });
    expect(row?.twoFactorSecret).toBeNull();
    expect(row?.twoFactorEnabledAt).toBeNull();
    expect(await prisma.twoFactorRecoveryCode.count({ where: { userId: id } })).toBe(0);
  });

  it("refuses on a wrong password and leaves it enabled", async () => {
    const id = await makeUser("disableSelf");
    const res = await request(app)
      .post("/api/v1/auth/2fa/disable")
      .set("Cookie", `auth_token=${generateToken(id)}`)
      .send({ password: "wrong" });

    expect(res.status).toBe(401);
    const row = await prisma.user.findUnique({ where: { id } });
    expect(row?.twoFactorEnabledAt).not.toBeNull();
  });

  it("issues a fresh set of recovery codes against the password", async () => {
    const id = await makeUser("disableSelf");
    const res = await request(app)
      .post("/api/v1/auth/2fa/recovery-codes")
      .set("Cookie", `auth_token=${generateToken(id)}`)
      .send({ password: "password123" });

    expect(res.status).toBe(200);
    expect(res.body.recoveryCodes).toHaveLength(10);
  });

  it("lets an admin clear it for somebody else", async () => {
    const adminId = await makeUser("disableAdmin", true);
    const victimId = await makeUser("disableVictim");

    const res = await request(app)
      .post(`/api/v1/admin/users/${victimId}/disable-2fa`)
      .set("Cookie", `auth_token=${generateToken(adminId)}`);

    expect(res.status).toBe(200);
    const row = await prisma.user.findUnique({ where: { id: victimId } });
    expect(row?.twoFactorEnabledAt).toBeNull();
  });

  it("does not let a normal user clear somebody else's", async () => {
    const plainId = await makeUser("disableSelf");
    const victimId = await makeUser("disableVictim");

    const res = await request(app)
      .post(`/api/v1/admin/users/${victimId}/disable-2fa`)
      .set("Cookie", `auth_token=${generateToken(plainId)}`);

    expect(res.status).toBe(403);
    const row = await prisma.user.findUnique({ where: { id: victimId } });
    expect(row?.twoFactorEnabledAt).not.toBeNull();
  });

  it("clears it from the command line by username", async () => {
    const id = await makeUser("disableCli");
    expect(await disableTwoFactorForUsername("disableCli")).toBe(true);

    const row = await prisma.user.findUnique({ where: { id } });
    expect(row?.twoFactorSecret).toBeNull();
    expect(row?.twoFactorEnabledAt).toBeNull();
    expect(await prisma.twoFactorRecoveryCode.count({ where: { userId: id } })).toBe(0);
  });

  it("reports an unknown username instead of pretending it worked", async () => {
    expect(await disableTwoFactorForUsername("nobody-by-that-name")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_2fa" npx jest src/routes/__tests__/twoFactor.disable.test.ts`
Expected: FAIL — routes 404, script module missing.

- [ ] **Step 3: Add the self-service endpoints**

Append to `backend/src/routes/auth/twoFactor.ts`:

```typescript
import { comparePassword } from "../../utils/password";
import { disableTwoFactorSchema } from "../../schemas/twoFactor";

/** Clear everything for the caller. Costs the password, because switching off a
 *  protection is exactly as sensitive as switching it on. */
router.post("/disable", authenticate, authLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const { password } = disableTwoFactorSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError("User not found", 404);
    if (!(await comparePassword(password, user.passwordHash))) {
      throw new AppError("Password is incorrect", 401);
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: {
          twoFactorSecret: null,
          twoFactorPendingSecret: null,
          twoFactorEnabledAt: null,
          twoFactorToken: null,
          twoFactorTokenExpiry: null,
        },
      }),
      prisma.twoFactorRecoveryCode.deleteMany({ where: { userId } }),
    ]);

    logger.info({ operation: "two_factor_disabled", userId });
    res.json({ disabled: true });
  } catch (error) {
    next(error);
  }
});

/** A new sheet of codes — what you do when the old sheet leaked. */
router.post("/recovery-codes", authenticate, authLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const { password } = disableTwoFactorSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError("User not found", 404);
    if (!user.twoFactorEnabledAt) {
      throw new AppError("Two-factor authentication is not enabled", 400);
    }
    if (!(await comparePassword(password, user.passwordHash))) {
      throw new AppError("Password is incorrect", 401);
    }

    const recoveryCodes = await generateRecoveryCodes(userId);
    logger.info({ operation: "two_factor_recovery_codes_regenerated", userId });
    res.json({ recoveryCodes });
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 4: Add the admin endpoint**

In `backend/src/routes/admin/users.ts`, after the `reset-password` route (it is already behind `requireAdmin` via `admin/index.ts`):

```typescript
// POST /users/:id/disable-2fa — the way back in for a user who lost their phone
// AND their recovery codes, without anyone needing a shell. Logged, because an
// admin switching off someone else's protection should leave a trace.
router.post(
  '/users/:id/disable-2fa',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const user = await prisma.user.findUnique({
        where: { id },
        select: { id: true, username: true },
      });
      if (!user) throw new AppError('User not found', 404);

      await prisma.$transaction([
        prisma.user.update({
          where: { id },
          data: {
            twoFactorSecret: null,
            twoFactorPendingSecret: null,
            twoFactorEnabledAt: null,
            twoFactorToken: null,
            twoFactorTokenExpiry: null,
          },
        }),
        prisma.twoFactorRecoveryCode.deleteMany({ where: { userId: id } }),
      ]);

      logger.warn({
        operation: 'admin_two_factor_disabled',
        adminId: req.userId,
        targetUserId: id,
        targetUsername: user.username,
      });
      res.json({ disabled: true });
    } catch (error) {
      next(error);
    }
  },
);
```

- [ ] **Step 5: Write the command-line escape hatch**

Create `backend/src/scripts/disableTwoFactor.ts`:

```typescript
#!/usr/bin/env node
/**
 * Switch two-factor off for one account, from a shell.
 *
 *   docker exec -it TravStats node dist/scripts/disableTwoFactor.js <username>
 *
 * This is deliberately not guarded by a password. Anyone who can run a command
 * inside this container already holds the database: they can read every flight,
 * dump it, or rotate the JWT secret. A command that clears a 2FA flag grants
 * nothing that the shell did not already grant — so it is a way out for the
 * owner, not a way in for an attacker.
 */
import { prisma } from "../db";
import logger from "../utils/logger";

export async function disableTwoFactorForUsername(username: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { username },
    select: { id: true },
  });
  if (!user) return false;

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: {
        twoFactorSecret: null,
        twoFactorPendingSecret: null,
        twoFactorEnabledAt: null,
        twoFactorToken: null,
        twoFactorTokenExpiry: null,
      },
    }),
    prisma.twoFactorRecoveryCode.deleteMany({ where: { userId: user.id } }),
  ]);

  logger.warn({ operation: "two_factor_disabled_via_cli", username });
  return true;
}

async function main(): Promise<void> {
  const username = process.argv[2];
  if (!username) {
    console.error("Usage: node dist/scripts/disableTwoFactor.js <username>");
    process.exit(2);
  }

  const done = await disableTwoFactorForUsername(username);
  if (done) {
    console.log(`Two-factor authentication disabled for "${username}".`);
    console.log("The next login needs the password only.");
  } else {
    console.error(`No user named "${username}".`);
  }
  await prisma.$disconnect();
  process.exit(done ? 0 : 1);
}

// Guarded so importing this module from a test does not run the CLI.
if (require.main === module) {
  void main();
}
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `cd backend && DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_2fa" npx jest src/routes/__tests__/twoFactor.disable.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 7: Commit**

```bash
git add backend/src/routes/auth/twoFactor.ts backend/src/routes/admin/users.ts backend/src/scripts/disableTwoFactor.ts backend/src/routes/__tests__/twoFactor.disable.test.ts
git commit -m "feat(2fa): disable paths — self, admin and command line"
```

---

### Task 8: Frontend API client and the challenge page

**Files:**
- Modify: `frontend/src/lib/api/auth.ts`
- Create: `frontend/src/pages/TwoFactorChallengePage.tsx`
- Modify: `frontend/src/pages/LoginPage.tsx` (the branch at line ~48)
- Modify: `frontend/src/App.tsx` (route registration)
- Test: `frontend/src/__tests__/TwoFactorChallengePage.test.tsx`

**Interfaces:**
- Consumes: Task 6 (`{ requiresTwoFactor: true }`, `POST /auth/2fa/verify`)
- Produces: `LoginResult` gains `{ requiresTwoFactor: true }`; `authApi.verifyTwoFactor(body): Promise<{ user: User }>`

- [ ] **Step 1: Extend the API client**

In `frontend/src/lib/api/auth.ts`, widen the union and add the call:

```typescript
export type LoginResult =
  | { user: User }
  | { requiresPasswordChange: true }
  | { requiresTwoFactor: true };

export async function verifyTwoFactor(
  body: { code: string } | { recoveryCode: string },
): Promise<{ user: User }> {
  const { data } = await client.post<{ user: User }>("/auth/2fa/verify", body);
  return data;
}
```

- [ ] **Step 2: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const verifyTwoFactor = vi.fn();
const navigate = vi.fn();

vi.mock("../lib/api", () => ({ authApi: { verifyTwoFactor: (b: unknown) => verifyTwoFactor(b) } }));
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigate };
});
vi.mock("../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? k }),
}));
vi.mock("../store/authStore", () => ({
  useAuthStore: () => ({ setUser: vi.fn() }),
}));

import TwoFactorChallengePage from "../pages/TwoFactorChallengePage";

const renderPage = () =>
  render(
    <MemoryRouter>
      <TwoFactorChallengePage />
    </MemoryRouter>,
  );

describe("TwoFactorChallengePage", () => {
  beforeEach(() => {
    verifyTwoFactor.mockReset();
    navigate.mockReset();
  });

  it("sends the typed code", async () => {
    verifyTwoFactor.mockResolvedValue({ user: { id: "1", username: "alex" } });
    renderPage();

    fireEvent.change(screen.getByLabelText("auth:twoFactor.codeLabel"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "auth:twoFactor.submit" }));

    await waitFor(() => expect(verifyTwoFactor).toHaveBeenCalledWith({ code: "123456" }));
  });

  it("shows an error instead of navigating when the code is refused", async () => {
    verifyTwoFactor.mockRejectedValue(new Error("nope"));
    renderPage();

    fireEvent.change(screen.getByLabelText("auth:twoFactor.codeLabel"), {
      target: { value: "000000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "auth:twoFactor.submit" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(navigate).not.toHaveBeenCalled();
  });

  it("can switch to a recovery code and sends that instead", async () => {
    verifyTwoFactor.mockResolvedValue({ user: { id: "1", username: "alex" } });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "auth:twoFactor.useRecovery" }));
    fireEvent.change(screen.getByLabelText("auth:twoFactor.recoveryLabel"), {
      target: { value: "abcde-12345" },
    });
    fireEvent.click(screen.getByRole("button", { name: "auth:twoFactor.submit" }));

    await waitFor(() =>
      expect(verifyTwoFactor).toHaveBeenCalledWith({ recoveryCode: "abcde-12345" }),
    );
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `cd frontend && npx vitest --run src/__tests__/TwoFactorChallengePage.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the page**

```tsx
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { authApi } from "../lib/api";
import { useAuthStore } from "../store/authStore";
import { useTranslation } from "../hooks/useTranslation";

/**
 * Second step of a login. The challenge itself is an HttpOnly cookie set by
 * POST /auth/login, so this page holds no credential of its own — reloading it
 * is harmless, and it cannot be reached usefully without having just entered a
 * correct password.
 */
export default function TwoFactorChallengePage(): JSX.Element {
  const { t } = useTranslation(["auth", "common"]);
  const navigate = useNavigate();
  const { setUser } = useAuthStore();

  const [useRecovery, setUseRecovery] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = useRecovery ? { recoveryCode: value.trim() } : { code: value.trim() };
      const result = await authApi.verifyTwoFactor(body);
      setUser(result.user);
      navigate("/dashboard");
    } catch {
      setError(t("auth:twoFactor.rejected", { defaultValue: "Der Code stimmt nicht." }));
    } finally {
      setBusy(false);
    }
  };

  const label = useRecovery ? "auth:twoFactor.recoveryLabel" : "auth:twoFactor.codeLabel";

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4">
        <h1 className="text-xl font-semibold">{t("auth:twoFactor.title")}</h1>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          {t("auth:twoFactor.hint")}
        </p>

        <div>
          <label className="label" htmlFor="twofa-input">
            {t(label)}
          </label>
          <input
            id="twofa-input"
            className="input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoComplete={useRecovery ? "off" : "one-time-code"}
            inputMode={useRecovery ? "text" : "numeric"}
            autoFocus
          />
        </div>

        {error && (
          <div role="alert" className="text-sm" style={{ color: "var(--danger)" }}>
            {error}
          </div>
        )}

        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {t("auth:twoFactor.submit")}
        </button>

        <button
          type="button"
          className="text-sm underline"
          onClick={() => {
            setUseRecovery((previous) => !previous);
            setValue("");
            setError(null);
          }}
        >
          {useRecovery ? t("auth:twoFactor.useCode") : t("auth:twoFactor.useRecovery")}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 5: Route to it from the login page**

In `frontend/src/pages/LoginPage.tsx`, beside the existing `requiresPasswordChange` branch:

```tsx
      if ("requiresTwoFactor" in result && result.requiresTwoFactor) {
        navigate("/2fa");
        return;
      }
```

In `frontend/src/App.tsx`, add the lazy import and the route beside `/login`:

```tsx
const TwoFactorChallengePage = lazy(() => import("./pages/TwoFactorChallengePage"));
```

```tsx
<Route path="/2fa" element={<TwoFactorChallengePage />} />
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `cd frontend && npx vitest --run src/__tests__/TwoFactorChallengePage.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/api/auth.ts frontend/src/pages/TwoFactorChallengePage.tsx frontend/src/pages/LoginPage.tsx frontend/src/App.tsx frontend/src/__tests__/TwoFactorChallengePage.test.tsx
git commit -m "feat(2fa): challenge step in the login flow"
```

---

### Task 9: Security section in settings

**Files:**
- Create: `frontend/src/components/settings/SecuritySection.tsx`
- Modify: `frontend/src/pages/SettingsPage.tsx` (section list at line ~106, and the render switch at line ~494)
- Test: `frontend/src/components/settings/__tests__/SecuritySection.test.tsx`

**Interfaces:**
- Consumes: Task 5 (`/auth/2fa/setup`, `/auth/2fa/activate`, `/auth/2fa/status`), Task 7 (`/auth/2fa/disable`, `/auth/2fa/recovery-codes`)
- Produces: settings section id `"security"`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const api = {
  getTwoFactorStatus: vi.fn(),
  setupTwoFactor: vi.fn(),
  activateTwoFactor: vi.fn(),
  disableTwoFactor: vi.fn(),
};

vi.mock("../../../lib/api", () => ({ twoFactorApi: api }));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? k }),
}));
vi.mock("qrcode.react", () => ({ QRCodeSVG: () => <svg data-testid="qr" /> }));

import SecuritySection from "../SecuritySection";

describe("SecuritySection", () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    api.getTwoFactorStatus.mockResolvedValue({ enabled: false, recoveryCodesLeft: 0 });
  });

  it("offers to switch it on when it is off", async () => {
    render(<SecuritySection />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "settings:security.enable" })).toBeInTheDocument(),
    );
  });

  it("shows a QR code and the secret after starting setup", async () => {
    api.setupTwoFactor.mockResolvedValue({ secret: "JBSWY3DPEHPK3PXP", otpauthUrl: "otpauth://x" });
    render(<SecuritySection />);

    fireEvent.click(await screen.findByRole("button", { name: "settings:security.enable" }));

    await waitFor(() => expect(screen.getByTestId("qr")).toBeInTheDocument());
    expect(screen.getByText("JBSWY3DPEHPK3PXP")).toBeInTheDocument();
  });

  it("shows the recovery codes exactly once, after activation", async () => {
    api.setupTwoFactor.mockResolvedValue({ secret: "S", otpauthUrl: "otpauth://x" });
    api.activateTwoFactor.mockResolvedValue({ recoveryCodes: ["aaaaa-11111", "bbbbb-22222"] });
    render(<SecuritySection />);

    fireEvent.click(await screen.findByRole("button", { name: "settings:security.enable" }));
    fireEvent.change(await screen.findByLabelText("settings:security.codeLabel"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "settings:security.activate" }));

    await waitFor(() => expect(screen.getByText("aaaaa-11111")).toBeInTheDocument());
    expect(screen.getByText("bbbbb-22222")).toBeInTheDocument();
  });

  it("warns that API tokens are not covered", async () => {
    api.getTwoFactorStatus.mockResolvedValue({ enabled: true, recoveryCodesLeft: 7 });
    render(<SecuritySection />);
    await waitFor(() =>
      expect(screen.getByText(/settings:security.tokenWarning/)).toBeInTheDocument(),
    );
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd frontend && npx vitest --run src/components/settings/__tests__/SecuritySection.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the section**

```tsx
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { SectionCard, SectionTitle } from "./SettingsShared";
import { twoFactorApi } from "../../lib/api";
import { useTranslation } from "../../hooks/useTranslation";

type Stage = "loading" | "off" | "setup" | "codes" | "on";

export default function SecuritySection(): JSX.Element {
  const { t } = useTranslation(["settings", "common"]);
  const [stage, setStage] = useState<Stage>("loading");
  const [secret, setSecret] = useState("");
  const [otpauthUrl, setOtpauthUrl] = useState("");
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [codesLeft, setCodesLeft] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void twoFactorApi.getTwoFactorStatus().then((status) => {
      setCodesLeft(status.recoveryCodesLeft);
      setStage(status.enabled ? "on" : "off");
    });
  }, []);

  const startSetup = async (): Promise<void> => {
    setError(null);
    const result = await twoFactorApi.setupTwoFactor();
    setSecret(result.secret);
    setOtpauthUrl(result.otpauthUrl);
    setStage("setup");
  };

  const activate = async (): Promise<void> => {
    setError(null);
    try {
      const result = await twoFactorApi.activateTwoFactor(code);
      setRecoveryCodes(result.recoveryCodes);
      setStage("codes");
    } catch {
      setError(t("settings:security.wrongCode", { defaultValue: "Der Code stimmt nicht." }));
    }
  };

  return (
    <SectionCard>
      <SectionTitle
        title={t("settings:security.title")}
        description={t("settings:security.description")}
      />

      {stage === "on" && (
        <div className="space-y-2">
          <p className="text-sm">{t("settings:security.enabled", { count: codesLeft })}</p>
          {/* Stated plainly rather than hidden: a token bypasses this entirely. */}
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {t("settings:security.tokenWarning")}
          </p>
        </div>
      )}

      {stage === "off" && (
        <button className="btn-primary" onClick={() => void startSetup()}>
          {t("settings:security.enable")}
        </button>
      )}

      {stage === "setup" && (
        <div className="space-y-3">
          <QRCodeSVG value={otpauthUrl} size={168} />
          <p className="text-xs font-mono">{secret}</p>
          <label className="label" htmlFor="activate-code">
            {t("settings:security.codeLabel")}
          </label>
          <input
            id="activate-code"
            className="input"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="numeric"
          />
          {error && (
            <div role="alert" className="text-sm" style={{ color: "var(--danger)" }}>
              {error}
            </div>
          )}
          <button className="btn-primary" onClick={() => void activate()}>
            {t("settings:security.activate")}
          </button>
        </div>
      )}

      {stage === "codes" && (
        <div className="space-y-2">
          <p className="text-sm">{t("settings:security.saveCodes")}</p>
          <ul className="font-mono text-sm">
            {recoveryCodes.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
          <button className="btn-secondary" onClick={() => setStage("on")}>
            {t("common:buttons.done", { defaultValue: "Fertig" })}
          </button>
        </div>
      )}
    </SectionCard>
  );
}
```

- [ ] **Step 4: Register the section**

In `frontend/src/pages/SettingsPage.tsx`, add to the section list after `"profile"`:

```typescript
      { id: "security", label: t("settings:security.title") || "Security" },
```

and in the render switch beside the profile case:

```tsx
            {activeSection === "security" && <SecuritySection />}
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cd frontend && npx vitest --run src/components/settings/__tests__/SecuritySection.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/settings/SecuritySection.tsx frontend/src/pages/SettingsPage.tsx frontend/src/components/settings/__tests__/SecuritySection.test.tsx
git commit -m "feat(2fa): security section in settings"
```

---

### Task 10: Copy, in both languages

**Files:**
- Modify: `frontend/src/i18n/resources/de/auth.json`, `frontend/src/i18n/resources/en/auth.json`
- Modify: `frontend/src/i18n/resources/de/settings.json`, `frontend/src/i18n/resources/en/settings.json`

- [ ] **Step 1: Add the challenge copy**

`de/auth.json`, new `twoFactor` block:

```json
  "twoFactor": {
    "title": "Bestätigung in zwei Schritten",
    "hint": "Gib den sechsstelligen Code aus deiner Authenticator-App ein.",
    "codeLabel": "Code",
    "recoveryLabel": "Wiederherstellungscode",
    "submit": "Bestätigen",
    "useRecovery": "Ich habe mein Gerät nicht — Wiederherstellungscode benutzen",
    "useCode": "Doch den Code aus der App benutzen",
    "rejected": "Der Code stimmt nicht."
  }
```

`en/auth.json`, mirrored:

```json
  "twoFactor": {
    "title": "Two-step verification",
    "hint": "Enter the six-digit code from your authenticator app.",
    "codeLabel": "Code",
    "recoveryLabel": "Recovery code",
    "submit": "Confirm",
    "useRecovery": "I don't have my device — use a recovery code",
    "useCode": "Use the app code after all",
    "rejected": "That code is not right."
  }
```

- [ ] **Step 2: Add the settings copy**

`de/settings.json`, new `security` block:

```json
  "security": {
    "title": "Sicherheit",
    "description": "Schütze deine Anmeldung zusätzlich mit einem Einmal-Code. Freiwillig — ohne diese Einstellung bleibt alles wie bisher.",
    "enable": "Bestätigung in zwei Schritten einrichten",
    "codeLabel": "Code aus der App",
    "activate": "Aktivieren",
    "wrongCode": "Der Code stimmt nicht.",
    "saveCodes": "Bewahre diese Wiederherstellungscodes auf. Jeder funktioniert genau einmal, und sie werden dir nur jetzt angezeigt.",
    "enabled": "Aktiv. Noch {{count}} Wiederherstellungscodes übrig.",
    "tokenWarning": "API-Token der Mobil-App gelten weiterhin ohne zweiten Schritt. Wenn du dir bei einem Token unsicher bist, zieh ihn unter API-Token zurück."
  }
```

`en/settings.json`, mirrored:

```json
  "security": {
    "title": "Security",
    "description": "Add a one-time code to your login. Optional — leave it alone and nothing changes.",
    "enable": "Set up two-step verification",
    "codeLabel": "Code from the app",
    "activate": "Activate",
    "wrongCode": "That code is not right.",
    "saveCodes": "Keep these recovery codes. Each works once, and this is the only time they are shown.",
    "enabled": "Active. {{count}} recovery codes left.",
    "tokenWarning": "API tokens used by the mobile app keep working without a second step. If you are unsure about a token, revoke it under API Tokens."
  }
```

- [ ] **Step 3: Verify both files parse and the keys match**

Run:

```bash
cd frontend && node -e "
const de = require('./src/i18n/resources/de/settings.json');
const en = require('./src/i18n/resources/en/settings.json');
const a = Object.keys(de.security).sort().join(',');
const b = Object.keys(en.security).sort().join(',');
if (a !== b) { console.error('key mismatch\n' + a + '\n' + b); process.exit(1); }
console.log('security keys match:', a);
"
```

Expected: `security keys match: activate,codeLabel,description,enable,enabled,saveCodes,title,tokenWarning,wrongCode`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/i18n/resources
git commit -m "feat(2fa): German and English copy"
```

---

### Task 11: Full gates and a browser pass

- [ ] **Step 1: Run every gate**

```bash
cd backend && npx tsc --noEmit && npm run lint && \
  DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_2fa" npm test -- --forceExit
cd ../frontend && npx tsc --noEmit && npm run lint && npx vitest --run
```

Expected: all green. If a suite fails, check whether it also fails with this work stashed before blaming it on this feature.

- [ ] **Step 2: Walk it in a browser**

Green tests do not show a QR code that fails to scan. With a dev server on the worktree database:

1. Settings → Security → set up. Scan the QR with a real authenticator app.
2. Enter the code. The recovery codes appear. Copy one.
3. Log out, log in: the password is accepted, then the code page appears.
4. Enter the app code — dashboard.
5. Log out, log in, choose "use a recovery code", paste the copied one — dashboard.
6. Log out, log in, try that same recovery code again — refused.
7. Run the escape hatch and confirm the next login needs only the password:

```bash
docker exec -it <container> node dist/scripts/disableTwoFactor.js <username>
```

- [ ] **Step 3: Commit anything the walk-through corrected**

```bash
git commit -am "fix(2fa): corrections from the browser walk-through"
```

---

## Self-Review

**Spec coverage:** TOTP (Tasks 2, 5, 6) · recovery codes (Tasks 3, 6, 7) · CLI escape hatch (Task 7) · admin reset (Task 7) · opt-in only, login unchanged without it (Task 6, second and third test) · UI to switch on and off (Tasks 8, 9) · both languages (Task 10). The PAT gap is documented and surfaced in the UI (Task 9) rather than silently left open.

**Placeholders:** none — every step carries the code or the command it needs.

**Type consistency:** `verifyCode(secret, code)` takes a plaintext secret in Tasks 2, 5 and 6. `generateRecoveryCodes(userId)` returns `string[]` in Tasks 3, 5 and 7. `LoginResult` gains `{ requiresTwoFactor: true }` in Task 8 and is produced in Task 6. The settings section id `"security"` is used in Tasks 9 and 10.

**Out of scope, deliberately:** passkeys — see `2026-08-09-passkeys.md`. They are a different credential model with an origin constraint this codebase has to answer first, and bundling them would hold up everything above.
