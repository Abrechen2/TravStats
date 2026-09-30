import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { ensureAdminSettingsRow } from "../../services/adminSettingsRow";
import {
  backupZone,
  hostBackupZone,
  resetBackupZoneForTests,
} from "../../shared/time/schedulerZone";
import { stopScheduler } from "../../services/backupScheduler";

/**
 * ADR 0002 phase 2, the settings side:
 * - the server says whether the account HAS a profile zone (owner decision
 *   2026-09-26: ask at the next login) and takes one on its own;
 * - the birthday is a floating day;
 * - the backup's zone is an admin setting whose default is the host zone.
 */
const USER = "settingstimemodel";
const ADMIN = "settingstimemodeladmin";

describe("Settings — time model (phase 2)", () => {
  let cookie: string;
  let adminCookie: string;
  let userId: string;

  const cleanup = async (): Promise<void> => {
    await prisma.userSettings.deleteMany({ where: { user: { username: { in: [USER, ADMIN] } } } });
    await prisma.user.deleteMany({ where: { username: { in: [USER, ADMIN] } } });
  };

  beforeAll(async () => {
    await cleanup();
    const u = await prisma.user.create({
      data: { username: USER, passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    cookie = `auth_token=${generateToken(u.id)}`;
    const a = await prisma.user.create({
      data: { username: ADMIN, passwordHash: await hashPassword("password123"), isAdmin: true },
    });
    adminCookie = `auth_token=${generateToken(a.id)}`;
  });

  afterAll(async () => {
    await prisma.adminSettings.update({
      where: { id: await ensureAdminSettingsRow() },
      data: { backupZone: null },
    });
    stopScheduler();
    resetBackupZoneForTests();
    await cleanup();
    await prisma.$disconnect();
  });

  describe("profile zone", () => {
    it("reports an account without a zone as default-utc, so the web can ask", async () => {
      const res = await request(app).get("/api/v1/settings").set("Cookie", cookie);
      expect(res.status).toBe(200);
      expect(res.body.profileZone).toEqual({
        zone: "UTC",
        source: "default-utc",
        hasProfileZone: false,
        followsDevice: false,
      });
    });

    it("takes the zone on its own without wiping the rest of `display`", async () => {
      await request(app)
        .put("/api/v1/settings")
        .set("Cookie", cookie)
        .send({ display: { theme: "dark", dateFormat: "YYYY-MM-DD" } })
        .expect(200);
      const res = await request(app)
        .put("/api/v1/settings/profile-zone")
        .set("Cookie", cookie)
        .send({ zone: "Asia/Tokyo", followsDevice: true });
      expect(res.status).toBe(200);
      expect(res.body.profileZone).toMatchObject({
        zone: "Asia/Tokyo",
        source: "profile",
        hasProfileZone: true,
        followsDevice: true,
      });
      const row = await prisma.userSettings.findUniqueOrThrow({ where: { userId } });
      expect(row.data).toMatchObject({
        display: { theme: "dark", dateFormat: "YYYY-MM-DD", timezone: "Asia/Tokyo" },
      });
    });

    it("refuses a zone the server does not know with 422 ZONE_UNKNOWN — on both routes", async () => {
      const own = await request(app)
        .put("/api/v1/settings/profile-zone")
        .set("Cookie", cookie)
        .send({ zone: "Mars/Olympus" });
      expect(own.status).toBe(422);
      expect(own.body).toMatchObject({ code: "ZONE_UNKNOWN", field: "zone" });
      const whole = await request(app)
        .put("/api/v1/settings")
        .set("Cookie", cookie)
        .send({ display: { timezone: "Europe/Atlantis" } });
      expect(whole.status).toBe(422);
      expect(whole.body).toMatchObject({ code: "ZONE_UNKNOWN", field: "display.timezone" });
    });
  });

  describe("birthday", () => {
    it("stores a floating day beside the legacy noon anchor", async () => {
      const res = await request(app)
        .put("/api/v1/settings/profile")
        .set("Cookie", cookie)
        .send({ birthdate: "1990-02-28" });
      expect(res.status).toBe(200);
      expect(res.body.birthdate).toBe("1990-02-28");
      const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      expect(user.birthdate?.toISOString()).toBe("1990-02-28T12:00:00.000Z");
      expect(user.birthDay?.toISOString()).toBe("1990-02-28T00:00:00.000Z");
      expect(user.birthPrecision).toBe("day");
    });

    it("refuses an offset-less datetime — the host would pick the day", async () => {
      const res = await request(app)
        .put("/api/v1/settings/profile")
        .set("Cookie", cookie)
        .send({ birthdate: "1990-02-28T23:30" });
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ code: "TIME_SHAPE_REQUIRED", field: "birthdate" });
    });
  });

  describe("backup zone", () => {
    it("defaults to the host zone and says so", async () => {
      const res = await request(app)
        .get("/api/v1/admin/backup-settings")
        .set("Cookie", adminCookie);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        backupZone: null,
        backupZoneEffective: hostBackupZone().zone,
        hostZone: hostBackupZone().zone,
      });
    });

    it("re-schedules in the admin's zone at once, without a restart", async () => {
      const res = await request(app)
        .put("/api/v1/admin/backup-settings")
        .set("Cookie", adminCookie)
        .send({ backupZone: "America/New_York" });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        backupZone: "America/New_York",
        backupZoneEffective: "America/New_York",
      });
      expect(backupZone()).toEqual({ zone: "America/New_York", source: "admin" });
      const health = await request(app).get("/api/v1/health");
      expect(health.body.scheduler.backupZone).toBe("America/New_York");
    });

    it("goes back to the host zone on null and refuses an unknown zone", async () => {
      const bad = await request(app)
        .put("/api/v1/admin/backup-settings")
        .set("Cookie", adminCookie)
        .send({ backupZone: "Mars/Olympus" });
      expect(bad.status).toBe(422);
      expect(bad.body.code).toBe("ZONE_UNKNOWN");
      const res = await request(app)
        .put("/api/v1/admin/backup-settings")
        .set("Cookie", adminCookie)
        .send({ backupZone: null });
      expect(res.status).toBe(200);
      expect(backupZone().source).not.toBe("admin");
    });
  });
});
