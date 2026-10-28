import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { createBackup } from "../../services/backupService";
import { generateToken } from "../../utils/jwt";
import { hashPassword } from "../../utils/password";

/**
 * A `replace` import takes a full instance backup first (pg_dump plus every
 * account's uploads). Any account could call it, so a review of 2026-10-27
 * found that the shared demo account on a public preview could start backup
 * after backup and fill the volume. The shared demo account is refused, and a
 * replace never starts a second backup while one is running.
 */

jest.mock("../../services/backupService", () => ({
  ...jest.requireActual("../../services/backupService"),
  createBackup: jest.fn(async () => "backup-id"),
}));

describe("POST /xlsx-import replace — who may start the backup", () => {
  const USERS = ["demo", "xlsx-guard-user"];
  let demoCookie: string;
  let userCookie: string;
  let runningId: string | null = null;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: USERS } } });
    const demo = await prisma.user.create({
      data: { username: "demo", passwordHash: await hashPassword("demo123"), isDemo: true },
    });
    const user = await prisma.user.create({
      data: { username: "xlsx-guard-user", passwordHash: await hashPassword("password123") },
    });
    demoCookie = `auth_token=${generateToken(demo.id)}`;
    userCookie = `auth_token=${generateToken(user.id)}`;
  });

  afterEach(async () => {
    (createBackup as jest.Mock).mockClear();
    if (runningId) await prisma.backup.delete({ where: { id: runningId } });
    runningId = null;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: USERS } } });
    await prisma.$disconnect();
  });

  const replace = (cookie: string) =>
    request(app)
      .post("/api/v1/xlsx-import")
      .set("Cookie", cookie)
      .send({ dryRun: false, mode: "replace", sheets: [{ key: "places", rows: [{}] }] });

  it("refuses the shared demo account before any backup", async () => {
    const res = await replace(demoCookie);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("DEMO_ACCOUNT_FORBIDDEN");
    expect(createBackup).not.toHaveBeenCalled();
  });

  it("does not start a second backup while one is running", async () => {
    const running = await prisma.backup.create({
      data: { type: "full", status: "running", backupPath: "/tmp/running.tar.gz" },
    });
    runningId = running.id;

    const res = await replace(userCookie);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("BACKUP_RUNNING");
    expect(createBackup).not.toHaveBeenCalled();
  });
});
