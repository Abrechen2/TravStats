import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * forgejo#77 — five backup routes answered 500 for conditions that are not
 * server errors: an unknown id, a backup that is not finished, a WebDAV
 * target the operator never switched on. The services now throw with their
 * status and the routes pass it through; this pins the status the client
 * actually receives.
 *
 * WebDAV is off here: the ENV flag is false and the admin_settings column is
 * set to false, which is the state of every instance that never switched it on.
 */
describe("backup routes answer with the honest status (forgejo#77)", () => {
  let adminId: string;
  let adminCookie: string;

  beforeAll(async () => {
    process.env.WEBDAV_SYNC_ENABLED = "false";
    await prisma.adminSettings.updateMany({ data: { webdavSyncEnabled: false } });
    await prisma.user.deleteMany({ where: { username: "backup-status-admin" } });
    const admin = await prisma.user.create({
      data: {
        username: "backup-status-admin",
        passwordHash: await hashPassword("password123"),
        isAdmin: true,
        isActive: true,
      },
    });
    adminId = admin.id;
    adminCookie = `auth_token=${generateToken(admin.id)}`;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: adminId } });
    await prisma.$disconnect();
  });

  it("GET /backup/:id/download answers 404 for an unknown id, like its sibling GET /backup/:id", async () => {
    const res = await request(app)
      .get("/api/v1/backup/does-not-exist/download")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Backup not found" });
  });

  it("POST /backup/:id/restore answers 404 for an unknown id", async () => {
    const res = await request(app)
      .post("/api/v1/backup/does-not-exist/restore")
      .set("Cookie", adminCookie)
      .send({ scope: "full", createBackupBefore: false });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Backup not found" });
  });

  it("POST /backup/:id/sync answers 404 for an unknown id even while WebDAV is off", async () => {
    const res = await request(app)
      .post("/api/v1/backup/does-not-exist/sync")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(404);
  });

  it("GET /backup/cloud/list answers 409, not 500, while WebDAV sync is off", async () => {
    const res = await request(app).get("/api/v1/backup/cloud/list").set("Cookie", adminCookie);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "WebDAV sync is not enabled" });
  });

  it("POST /backup/cloud/download answers 409 while WebDAV sync is off", async () => {
    const res = await request(app)
      .post("/api/v1/backup/cloud/download")
      .set("Cookie", adminCookie)
      .send({ backupName: "backup-2026-01-01.tar.gz" });

    expect(res.status).toBe(409);
  });
});
