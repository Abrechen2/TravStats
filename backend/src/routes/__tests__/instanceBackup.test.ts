import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * `GET /settings/instance-backup` (settings rebuild R3): an ordinary account
 * could not learn when the server last backed itself up, because the backup
 * routes are admin-only. It gets that one fact — and only that.
 */

const PATH = "/api/v1/settings/instance-backup";
const USERNAME = "instance-backup-route";

describe("settings — instance backup status", () => {
  let cookie: string;
  let userId: string;

  const backup = (data: {
    status: string;
    completedAt?: Date;
    errorMessage?: string;
    metadata?: object;
  }) =>
    prisma.backup.create({
      data: { backupPath: "/secret/backup.tar.gz", size: BigInt(123), ...data },
    });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    const user = await prisma.user.create({
      data: { username: USERNAME, passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
  });

  beforeEach(async () => {
    await prisma.backup.deleteMany({});
  });

  afterAll(async () => {
    await prisma.backup.deleteMany({});
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("answers an ordinary (non-admin) account with the newest completed backup only", async () => {
    await backup({ status: "completed", completedAt: new Date("2030-01-01T10:00:00Z") });
    await backup({ status: "completed", completedAt: new Date("2030-02-01T10:00:00Z") });
    await backup({
      status: "failed",
      completedAt: new Date("2030-03-01T10:00:00Z"),
      errorMessage: "x",
    });
    const res = await request(app).get(PATH).set("Cookie", cookie).expect(200);
    expect(res.body).toEqual({ completedAt: "2030-02-01T10:00:00.000Z", running: false });
  });

  it("says null and not-running when the server never backed up, and reports a running one", async () => {
    let res = await request(app).get(PATH).set("Cookie", cookie).expect(200);
    expect(res.body).toEqual({ completedAt: null, running: false });
    await backup({ status: "running" });
    res = await request(app).get(PATH).set("Cookie", cookie).expect(200);
    expect(res.body.running).toBe(true);
  });

  it("leaks no path, size or error to a non-admin account", async () => {
    await backup({ status: "completed", completedAt: new Date() });
    const res = await request(app).get(PATH).set("Cookie", cookie).expect(200);
    expect(Object.keys(res.body).sort()).toEqual(["completedAt", "running"]);
  });

  it("does not count a backup imported from the WebDAV share as a run of this server", async () => {
    await backup({ status: "completed", completedAt: new Date("2030-01-01T10:00:00Z") });
    await backup({
      status: "completed",
      completedAt: new Date("2030-04-01T10:00:00Z"),
      metadata: { source: "webdav" },
    });
    const res = await request(app).get(PATH).set("Cookie", cookie).expect(200);
    expect(res.body.completedAt).toBe("2030-01-01T10:00:00.000Z");
  });

  it("needs a session", async () => {
    await request(app).get(PATH).expect(401);
  });
});
