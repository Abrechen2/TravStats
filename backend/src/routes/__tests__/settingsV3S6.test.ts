import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { encryptApiKey } from "../../utils/encryption";
import { SERVICES } from "../../services/externalServices/catalogue";
import {
  getWebDAVSettings,
  updateWebDAVSettings,
  webdavTurnsOnWhenComplete,
} from "../../services/instanceSettingsService";
import { getLoggingConfig, invalidateCache } from "../../services/loggingConfig";

/**
 * Settings v3 S6: switches the prototype dropped became fixed defaults. Each case
 * here fails on the code before the change: the answer still carried a switch that
 * decided something, or a request that sends the old field changed state.
 */
describe("settings v3 S6 — removed switches", () => {
  let adminCookie: string;
  let adminId: string;
  let rowId: number;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "s6_admin" } });
    const admin = await prisma.user.create({
      data: {
        username: "s6_admin",
        passwordHash: await hashPassword("password123"),
        isAdmin: true,
      },
    });
    adminId = admin.id;
    adminCookie = `auth_token=${generateToken(admin.id)}`;
    const row = await prisma.adminSettings.findFirst({ orderBy: { id: "asc" } });
    rowId = row ? row.id : (await prisma.adminSettings.create({ data: {} })).id;
  });

  afterAll(async () => {
    await prisma.adminSettings.updateMany({
      data: { webdavUrl: null, webdavUsername: null, webdavPasswordEncrypted: null },
    });
    await prisma.smtpConfig.deleteMany({});
    await prisma.user.deleteMany({ where: { id: adminId } });
    await prisma.$disconnect();
  });

  const put = (url: string, body: object) =>
    request(app).put(url).set("Cookie", adminCookie).send(body);

  describe("automatic backup", () => {
    it("is always on: the answer says so and a request that switches it off changes nothing", async () => {
      const res = await put("/api/v1/admin/backup-settings", { backupEnabled: false });
      expect(res.status).toBe(200);
      expect(res.body.backupEnabled).toBe(true);
      const get = await request(app)
        .get("/api/v1/admin/backup-settings")
        .set("Cookie", adminCookie);
      expect(get.body.backupEnabled).toBe(true);
    });
  });

  describe("logging", () => {
    it("the three category switches are fixed on while verbose, and a request that sends them changes nothing", async () => {
      const res = await put("/api/v1/admin/logging/config", {
        logHttpRequests: false,
        logDatabaseQueries: false,
        logParserOperations: false,
        maxLogFiles: 30,
      });
      expect(res.status).toBe(200);
      invalidateCache();
      const config = await getLoggingConfig();
      expect(config).toMatchObject({
        logHttpRequests: true,
        logDatabaseQueries: true,
        logParserOperations: true,
        maxLogFileSize: 10,
        maxLogFiles: 7,
      });
    });
  });

  describe("mail", () => {
    const sender = {
      host: "smtp.example.test",
      port: 587,
      secure: false,
      username: "u",
      password: "p",
      fromEmail: "mail@example.test",
      fromName: "TravStats",
    };

    it("saving a sender without an `enabled` turns mail on (the zod default used to leave it off)", async () => {
      const res = await put("/api/v1/admin/smtp", sender);
      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(true);
      expect((await prisma.smtpConfig.findFirstOrThrow()).enabled).toBe(true);
    });

    it("an `enabled: false` a client still sends is honoured", async () => {
      const res = await put("/api/v1/admin/smtp", { ...sender, enabled: false });
      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(false);
    });
  });

  describe("instance WebDAV copy", () => {
    it("turns on once address, user and password are all present", async () => {
      await prisma.adminSettings.update({
        where: { id: rowId },
        data: {
          webdavSyncEnabled: false,
          webdavUrl: null,
          webdavUsername: null,
          webdavPasswordEncrypted: null,
        },
      });
      await updateWebDAVSettings({ url: "https://dav.example.test/dav", username: "u" });
      expect((await getWebDAVSettings()).enabled).toBe(false);
      await updateWebDAVSettings({ password: "pw-0123456789" });
      expect((await getWebDAVSettings()).enabled).toBe(true);
    });

    it("does not turn on from a save that touches none of the three, and honours an explicit `enabled`", async () => {
      await prisma.adminSettings.update({
        where: { id: rowId },
        data: {
          webdavSyncEnabled: false,
          webdavUrl: "https://dav.example.test/dav",
          webdavUsername: "u",
          webdavPasswordEncrypted: encryptApiKey("pw-0123456789"),
        },
      });
      await updateWebDAVSettings({ backupPath: "/x/" });
      expect((await getWebDAVSettings()).enabled).toBe(false);
      await updateWebDAVSettings({ enabled: true });
      expect((await getWebDAVSettings()).enabled).toBe(true);
      await updateWebDAVSettings({ url: "https://dav2.example.test/dav", enabled: false });
      expect((await getWebDAVSettings()).enabled).toBe(false);
    });

    it("the pure rule: complete after the patch, and the patch touched one of the three", () => {
      const stored = { webdavUrl: "u", webdavUsername: "n", webdavPasswordEncrypted: "p" };
      expect(webdavTurnsOnWhenComplete(stored, {})).toBe(false);
      expect(webdavTurnsOnWhenComplete(stored, { webdavUrl: "v" })).toBe(true);
      expect(webdavTurnsOnWhenComplete(stored, { webdavUrl: null })).toBe(false);
      expect(webdavTurnsOnWhenComplete({}, { webdavUrl: "v" })).toBe(false);
      // A fresh install has no settings row yet: the first save carries all three.
      expect(
        webdavTurnsOnWhenComplete(
          {},
          { webdavUrl: "v", webdavUsername: "n", webdavPasswordEncrypted: "p" }
        )
      ).toBe(true);
    });

    it("the catalogue save path turns it on as well", async () => {
      await prisma.adminSettings.update({
        where: { id: rowId },
        data: {
          webdavSyncEnabled: false,
          webdavUrl: null,
          webdavUsername: null,
          webdavPasswordEncrypted: null,
        },
      });
      const res = await put("/api/v1/admin/external-services/webdav", {
        fields: { url: "https://dav.example.test/dav", username: "u", password: "pw-0123456789" },
      });
      expect(res.status).toBe(200);
      expect((await getWebDAVSettings()).enabled).toBe(true);
    });
  });

  describe("catalogue", () => {
    it("keeps the five expert switches and has no OpenSky username / password", () => {
      const keys = (id: string): string[] => {
        const s = SERVICES.find((x) => x.id === id)!;
        return [...s.fields, ...s.accountFields].map((f) => f.key);
      };
      expect(keys("railTimetables")).toEqual(expect.arrayContaining(["transitous", "dbRest"]));
      expect(keys("logos")).toContain("operatorLogos");
      expect(keys("fx")).toContain("cdnFallback");
      expect(keys("opensky")).not.toContain("username");
      expect(keys("opensky")).not.toContain("password");
    });
  });
});
