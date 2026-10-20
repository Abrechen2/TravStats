import { afterAll, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";
import request from "supertest";
import app from "../../../index";
import { prisma } from "../../../db";
import { RATE_LIMITS } from "../../../config/constants";
import { documentUploadLimiter } from "../../../middleware/rateLimit";
import { resetImportModeCache } from "../../../services/importMode";
import { generateToken } from "../../../utils/jwt";

/**
 * Import mode (forgejo#304): an admin lifts the upload and import limits for
 * 24 hours, for every account or for one. Driven through the real document
 * upload route, whose 100-an-hour limit stopped the 835-original import.
 */
describe("admin import mode (/api/v1/admin/import-mode)", () => {
  let admin: { id: string };
  let user: { id: string };
  let other: { id: string };
  const cookie = (id: string) => `auth_token=${generateToken(id)}`;

  const make = (name: string, isAdmin = false) =>
    prisma.user.create({
      data: { username: `${name}-${Date.now()}`, passwordHash: "unused-test-hash", isAdmin },
    });
  /** An upload without a file: 400 once past the limiter, 429 when stopped by it. */
  const upload = (id: string) =>
    request(app).post("/api/v1/documents").set("Cookie", cookie(id)).send({});
  const spendLimit = async (id: string) => {
    for (let i = 0; i < RATE_LIMITS.DOCUMENT_UPLOAD_MAX; i++) await upload(id);
  };
  const setMode = (body: object) =>
    request(app).put("/api/v1/admin/import-mode").set("Cookie", cookie(admin.id)).send(body);

  beforeAll(async () => {
    admin = await make("import-mode-admin", true);
    user = await make("import-mode-user");
    other = await make("import-mode-other");
  });

  beforeEach(async () => {
    await prisma.adminSettings.updateMany({
      data: { importModeUntil: null, importModeUserId: null },
    });
    resetImportModeCache();
    for (const u of [user, other]) await documentUploadLimiter.resetKey(`user:${u.id}`);
  });

  afterAll(async () => {
    await prisma.adminSettings.updateMany({
      data: { importModeUntil: null, importModeUserId: null },
    });
    await prisma.user.deleteMany({ where: { id: { in: [admin.id, user.id, other.id] } } });
  });

  it("is admin-only", async () => {
    const res = await request(app)
      .put("/api/v1/admin/import-mode")
      .set("Cookie", cookie(user.id))
      .send({ enabled: true });
    expect(res.status).toBe(403);
  });

  it("keeps the upload limit while it is off", async () => {
    await spendLimit(user.id);
    expect((await upload(user.id)).status).toBe(429);
  });

  it("lifts the limit for 24 hours, then ends on its own", async () => {
    const before = Date.now();
    const res = await setMode({ enabled: true });
    expect(res.status).toBe(200);
    expect(res.body.userId).toBeNull();
    const until = Date.parse(res.body.until);
    expect(until - before).toBeGreaterThanOrEqual(24 * 3_600_000 - 1000);
    expect(until - before).toBeLessThanOrEqual(24 * 3_600_000 + 60_000);

    await spendLimit(user.id);
    expect((await upload(user.id)).status).toBe(400);

    // Its time is up: the limit applies again without anyone switching it off.
    await prisma.adminSettings.updateMany({ data: { importModeUntil: new Date(Date.now() - 1) } });
    resetImportModeCache();
    // Uploads made during import mode were not counted, so the hour starts afresh.
    await spendLimit(user.id);
    expect((await upload(user.id)).status).toBe(429);
    const state = await request(app)
      .get("/api/v1/admin/import-mode")
      .set("Cookie", cookie(admin.id));
    expect(state.body).toMatchObject({ until: null, userId: null, hours: 24 });
  });

  it("covers only the account it names", async () => {
    expect((await setMode({ enabled: true, userId: user.id })).status).toBe(200);
    await spendLimit(user.id);
    await spendLimit(other.id);
    expect((await upload(user.id)).status).toBe(400);
    expect((await upload(other.id)).status).toBe(429);
  });

  it("can be ended early", async () => {
    await setMode({ enabled: true });
    const off = await setMode({ enabled: false });
    expect(off.body).toMatchObject({ until: null, userId: null });
    await spendLimit(user.id);
    expect((await upload(user.id)).status).toBe(429);
  });

  it("refuses an account that does not exist and a malformed body", async () => {
    expect(
      (await setMode({ enabled: true, userId: "00000000-0000-4000-8000-000000000000" })).status
    ).toBe(404);
    expect((await setMode({ enabled: "yes" })).status).toBe(400);
  });
});
