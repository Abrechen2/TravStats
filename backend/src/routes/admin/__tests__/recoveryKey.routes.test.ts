import { KEY_A, SECRETS_DIR } from "./helpers/recoveryKeyEnv";

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import request from "supertest";
import app from "../../../index";
import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { generateToken } from "../../../utils/jwt";
import { installEncryptionKey } from "../../../utils/encryptionKey";
import { resetRecoveryKeyReveals } from "../../../services/backup/recoveryKey";
import { RATE_LIMITS } from "../../../config/constants";
import pino from "pino";
import logger, { pinoConfig, securityLogger } from "../../../utils/logger";

/**
 * The instance recovery key (owner request 2026-11-24): backups carry the
 * credentials encrypted, never the key, so an admin with an off-site backup has
 * to be shown the key once and prove they kept it. Each test names what would
 * go wrong without the guard.
 */

const PASSWORD = "admin-password-1";
const KEY_B = "b2".repeat(32);

/** Every log line the suite produced, as text — the key must never be in it. */
const logged: string[] = [];
function captureLogs(): void {
  for (const target of [logger, securityLogger] as const) {
    for (const level of ["info", "warn", "error", "debug"] as const) {
      const original = target[level].bind(target);
      (target as unknown as Record<string, unknown>)[level] = (...args: unknown[]) => {
        logged.push(JSON.stringify(args));
        return (original as (...a: unknown[]) => void)(...args);
      };
    }
  }
}

describe("admin recovery key (/api/v1/admin/recovery-key)", () => {
  let admin: { id: string };
  let other: { id: string };
  let adminCookie: string;
  let otherCookie: string;
  let rowId: number;

  beforeAll(async () => {
    captureLogs();
    const stamp = Date.now();
    other = await prisma.user.create({
      data: {
        username: `rk-user-${stamp}`,
        passwordHash: await hashPassword(PASSWORD),
        isAdmin: false,
        isActive: true,
      },
    });
    otherCookie = `auth_token=${generateToken(other.id)}`;
    const existing = await prisma.adminSettings.findFirst({ orderBy: { id: "asc" } });
    rowId = existing ? existing.id : (await prisma.adminSettings.create({ data: {} })).id;
  });

  // A fresh admin per test: the limiter is per account, and one shared admin
  // would spend the budget across tests.
  beforeEach(async () => {
    admin = await prisma.user.create({
      data: {
        username: `rk-admin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        passwordHash: await hashPassword(PASSWORD),
        isAdmin: true,
        isActive: true,
      },
    });
    adminCookie = `auth_token=${generateToken(admin.id)}`;
    resetRecoveryKeyReveals();
    installEncryptionKey(KEY_A);
    await prisma.adminSettings.update({
      where: { id: rowId },
      data: {
        webdavSyncEnabled: true,
        webdavUrl: "https://dav.example.test/",
        recoveryKeyConfirmedAt: null,
        recoveryKeyFingerprint: null,
      },
    });
  });

  afterEach(async () => {
    await prisma.user.delete({ where: { id: admin.id } }).catch(() => {});
  });

  afterAll(async () => {
    await prisma.adminSettings.update({
      where: { id: rowId },
      data: {
        webdavSyncEnabled: false,
        webdavUrl: null,
        recoveryKeyConfirmedAt: null,
        recoveryKeyFingerprint: null,
      },
    });
    await prisma.user.deleteMany({ where: { id: other.id } });
    fs.rmSync(SECRETS_DIR, { recursive: true, force: true });
  });

  const status = (cookie = adminCookie) =>
    request(app).get("/api/v1/admin/recovery-key/status").set("Cookie", cookie);
  const reveal = (body: object, cookie = adminCookie) =>
    request(app).post("/api/v1/admin/recovery-key/reveal").set("Cookie", cookie).send(body);
  const confirm = (lastFour: string, cookie = adminCookie) =>
    request(app)
      .post("/api/v1/admin/recovery-key/confirm")
      .set("Cookie", cookie)
      .send({ lastFour });

  it("an unconfirmed key on an instance with a WebDAV target is required", async () => {
    const res = await status();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      backupTargetConfigured: true,
      confirmed: false,
      required: true,
    });
    expect(JSON.stringify(res.body)).not.toContain(KEY_A);
  });

  it("no backup target, no obligation", async () => {
    await prisma.adminSettings.update({ where: { id: rowId }, data: { webdavUrl: null } });
    expect((await status()).body).toMatchObject({ backupTargetConfigured: false, required: false });
  });

  it("a non-admin gets 403 on every recovery-key call and never the key", async () => {
    expect((await status(otherCookie)).status).toBe(403);
    const r = await reveal({ password: PASSWORD }, otherCookie);
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).not.toContain("A1A1");
    expect((await confirm("a1a1", otherCookie)).status).toBe(403);
  });

  it("there is no GET for the key itself", async () => {
    const res = await request(app)
      .get("/api/v1/admin/recovery-key/reveal")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(404);
  });

  it("a wrong password reveals nothing", async () => {
    const res = await reveal({ password: "not-it" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("REAUTH_PASSWORD_INCORRECT");
    expect(res.body.key).toBeUndefined();
  });

  it("no re-authentication at all reveals nothing", async () => {
    const res = await reveal({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("RECOVERY_KEY_REAUTH_REQUIRED");
  });

  it("an account with two-factor needs its code too", async () => {
    await prisma.user.update({
      where: { id: admin.id },
      data: { twoFactorEnabledAt: new Date(), twoFactorSecret: "unused" },
    });
    try {
      const res = await reveal({ password: PASSWORD });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("REAUTH_SECOND_FACTOR_REQUIRED");
    } finally {
      await prisma.user.update({
        where: { id: admin.id },
        data: { twoFactorEnabledAt: null, twoFactorSecret: null },
      });
    }
  });

  it("the right password shows the key once, grouped, never cached", async () => {
    const res = await reveal({ password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toContain("no-store");
    expect(res.body.key).toBe(KEY_A.toUpperCase().match(/.{4}/g)!.join(" "));
    expect(res.body.filename).toMatch(/^travstats-recovery-key-[a-z0-9-]+\.txt$/);
  });

  it("confirming before the key was shown is refused", async () => {
    const res = await confirm("a1a1");
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("RECOVERY_KEY_NOT_REVEALED");
  });

  it("wrong last four characters do not confirm", async () => {
    await reveal({ password: PASSWORD });
    const res = await confirm("ffff");
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("RECOVERY_KEY_CONFIRM_MISMATCH");
    expect((await status()).body.confirmed).toBe(false);
  });

  it("only the last four characters are accepted, never the key", async () => {
    await reveal({ password: PASSWORD });
    const res = await confirm(KEY_A.slice(0, 16));
    expect(res.status).toBe(400);
    expect((await status()).body.confirmed).toBe(false);
  });

  it("the right four characters confirm — until the key changes", async () => {
    await reveal({ password: PASSWORD });
    const res = await confirm(KEY_A.slice(-4).toUpperCase());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ confirmed: true, required: false });
    const row = await prisma.adminSettings.findUniqueOrThrow({ where: { id: rowId } });
    expect(row.recoveryKeyConfirmedAt).not.toBeNull();
    expect(row.recoveryKeyFingerprint).toMatch(/^[0-9a-f]{16}$/);

    installEncryptionKey(KEY_B);
    expect((await status()).body).toMatchObject({
      confirmed: false,
      confirmedForOtherKey: true,
      required: true,
    });
  });

  it("an API token cannot read the key, even with the password", async () => {
    const raw = `ts_pat_${Date.now()}`;
    const res = await request(app)
      .post("/api/v1/admin/recovery-key/reveal")
      .set("Authorization", `Bearer ${raw}`)
      .send({ password: PASSWORD });
    expect([401, 403]).toContain(res.status);
    expect(res.body.key).toBeUndefined();
  });

  it("the key and the confirm characters never reach a log line", async () => {
    await reveal({ password: PASSWORD });
    await confirm(KEY_A.slice(-4));
    const all = logged.join("\n").toLowerCase();
    expect(all).toContain("recovery_key_shown");
    expect(all).toContain("recovery_key_confirmed");
    expect(all).not.toContain(KEY_A);
    expect(all).not.toContain(KEY_A.toUpperCase().match(/.{4}/g)!.join(" ").toLowerCase());
  });

  it("pino redacts a recoveryKey or lastFour field wherever it is logged", () => {
    const lines: string[] = [];
    const probe = pino(pinoConfig, { write: (line: string) => void lines.push(line) });
    probe.info({ recoveryKey: KEY_A, body: { recoveryKey: KEY_A, lastFour: "a1a1" } }, "probe");
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain(KEY_A);
    expect(lines[0]).not.toContain("a1a1");
  });

  it("a restore with a malformed recovery key is refused before any job starts", async () => {
    const res = await request(app)
      .post("/api/v1/backup/00000000-0000-0000-0000-000000000000/restore")
      .set("Cookie", adminCookie)
      .send({ scope: "database", recoveryKey: "not a key" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("RESTORE_RECOVERY_KEY_INVALID");
    expect(JSON.stringify(res.body)).not.toContain("not a key");
  });

  it("the reveal and confirm calls share a strict per-account limit", async () => {
    let last = 0;
    for (let i = 0; i < RATE_LIMITS.RECOVERY_KEY_MAX; i += 1) {
      last = (await (i % 2 ? confirm("0000") : reveal({ password: "not-it" }))).status;
      expect(last).not.toBe(429);
    }
    const limited = await reveal({ password: PASSWORD });
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe("RATE_LIMITED");
    expect(limited.body.key).toBeUndefined();
  });
});
