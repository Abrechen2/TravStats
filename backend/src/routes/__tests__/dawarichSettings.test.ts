/**
 * Route-level contract for the Dawarich settings endpoints. Mirrors
 * `immichSettingsRoutes.test.ts` minus the link/import mode toggle, which
 * Dawarich has no equivalent of. The routers assume `authenticate` already
 * ran (their parents mount it), so the harness injects `req.userId` and
 * mounts the sub-router directly.
 */
import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import express from "express";
import request from "supertest";

const userSettingsFindUnique = jest.fn();
const userSettingsUpsert = jest.fn();
const adminSettingsFindFirst = jest.fn();
const adminSettingsUpdate = jest.fn();
const adminSettingsCreate = jest.fn();

jest.mock("../../db", () => ({
  prisma: {
    userSettings: { findUnique: userSettingsFindUnique, upsert: userSettingsUpsert },
    adminSettings: {
      findFirst: adminSettingsFindFirst,
      update: adminSettingsUpdate,
      create: adminSettingsCreate,
    },
  },
}));

jest.mock("../../utils/encryption", () => ({
  encryptApiKey: jest.fn((v: string | null) => (v === null ? null : `enc:${v}`)),
  decryptApiKey: jest.fn((v: string | null) =>
    typeof v === "string" ? v.replace(/^enc:/, "") : null,
  ),
}));

const testDawarichConnection = jest.fn();
jest.mock("../../services/dawarich/dawarichTester", () => ({ testDawarichConnection }));

const getDawarichConnection = jest.fn();
jest.mock("../../services/dawarich/dawarichResolver", () => ({ getDawarichConnection }));

import dawarichSettingsRouter from "../settings/dawarich";
import dawarichAdminRouter from "../admin/dawarich";
import { errorHandler } from "../../middleware/errorHandler";

function makeApp(router: express.Router): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { userId?: string }).userId = "u1";
    next();
  });
  app.use("/dawarich", router);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  getDawarichConnection.mockResolvedValue({
    baseUrl: "https://dawarich.lan",
    apiKey: "k",
    source: "user",
  });
});

describe("GET /settings/dawarich", () => {
  it("returns hasKey but never the key itself", async () => {
    userSettingsFindUnique.mockResolvedValue({
      dawarichBaseUrl: "https://dawarich.lan",
      dawarichApiKey: "enc:super-secret",
    });

    const res = await request(makeApp(dawarichSettingsRouter)).get("/dawarich");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      baseUrl: "https://dawarich.lan",
      hasKey: true,
      source: "user",
      isShared: false,
      hasAccess: true,
    });
    expect(JSON.stringify(res.body)).not.toContain("super-secret");
  });

  it("reports an unconfigured user with defaults", async () => {
    userSettingsFindUnique.mockResolvedValue(null);
    getDawarichConnection.mockResolvedValue(null);

    const res = await request(makeApp(dawarichSettingsRouter)).get("/dawarich");
    expect(res.body).toEqual({
      baseUrl: null,
      hasKey: false,
      source: null,
      isShared: false,
      hasAccess: false,
    });
  });
});

describe("PUT /settings/dawarich", () => {
  it("normalises the URL, encrypts the key and upserts", async () => {
    userSettingsFindUnique.mockResolvedValue({
      dawarichBaseUrl: "https://dawarich.lan",
      dawarichApiKey: "enc:k",
    });

    const res = await request(makeApp(dawarichSettingsRouter))
      .put("/dawarich")
      .send({ baseUrl: "https://dawarich.lan/", apiKey: "k" });

    expect(res.status).toBe(200);
    expect(userSettingsUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "u1" },
        update: {
          dawarichBaseUrl: "https://dawarich.lan",
          dawarichApiKey: "enc:k",
        },
      }),
    );
  });

  it("clears the key when apiKey is explicitly null", async () => {
    userSettingsFindUnique.mockResolvedValue(null);
    await request(makeApp(dawarichSettingsRouter)).put("/dawarich").send({ apiKey: null });

    expect(userSettingsUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { dawarichApiKey: null } }),
    );
  });

  it("rejects a non-http base URL with 400", async () => {
    const res = await request(makeApp(dawarichSettingsRouter))
      .put("/dawarich")
      .send({ baseUrl: "file:///etc/passwd" });

    expect(res.status).toBe(400);
    expect(userSettingsUpsert).not.toHaveBeenCalled();
  });

  it("rejects an unknown field with 400 (strict schema)", async () => {
    const res = await request(makeApp(dawarichSettingsRouter))
      .put("/dawarich")
      .send({ dawarichApiKey: "sneaky" });
    expect(res.status).toBe(400);
  });
});

describe("POST /settings/dawarich/test", () => {
  it("tests the ad-hoc pair from the body", async () => {
    testDawarichConnection.mockResolvedValue({ success: true, message: "Connected to Dawarich" });

    const res = await request(makeApp(dawarichSettingsRouter))
      .post("/dawarich/test")
      .send({ baseUrl: "https://new.lan", apiKey: "new-key" });

    expect(res.status).toBe(200);
    expect(testDawarichConnection).toHaveBeenCalledWith("https://new.lan", "new-key");
  });

  it("falls back to the stored connection when the body is empty", async () => {
    testDawarichConnection.mockResolvedValue({ success: true, message: "Connected to Dawarich" });

    await request(makeApp(dawarichSettingsRouter)).post("/dawarich/test").send({});
    expect(testDawarichConnection).toHaveBeenCalledWith("https://dawarich.lan", "k");
  });

  it("falls back when the card sends an empty-string baseUrl (admin-provided connection)", async () => {
    testDawarichConnection.mockResolvedValue({ success: true, message: "Connected to Dawarich" });

    const res = await request(makeApp(dawarichSettingsRouter))
      .post("/dawarich/test")
      .send({ baseUrl: "" });

    expect(res.status).toBe(200);
    expect(testDawarichConnection).toHaveBeenCalledWith("https://dawarich.lan", "k");
  });

  it("returns 400 + kind=notConfigured when nothing is configured and nothing was sent", async () => {
    getDawarichConnection.mockResolvedValue(null);
    const res = await request(makeApp(dawarichSettingsRouter)).post("/dawarich/test").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("notConfigured");
  });

  it("returns 400 + kind=notConfigured on empty strings when nothing is resolved", async () => {
    getDawarichConnection.mockResolvedValue(null);
    const res = await request(makeApp(dawarichSettingsRouter))
      .post("/dawarich/test")
      .send({ baseUrl: "", apiKey: "" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("notConfigured");
  });

  it("uses an explicitly supplied pair over the stored connection", async () => {
    testDawarichConnection.mockResolvedValue({ success: true, message: "Connected to Dawarich" });

    await request(makeApp(dawarichSettingsRouter))
      .post("/dawarich/test")
      .send({ baseUrl: "https://new.lan", apiKey: "new-key" });

    expect(testDawarichConnection).toHaveBeenCalledWith("https://new.lan", "new-key");
  });
});

describe("GET /admin/dawarich", () => {
  it("masks the stored global key", async () => {
    adminSettingsFindFirst.mockResolvedValue({
      id: 1,
      globalDawarichBaseUrl: "https://dawarich.lan",
      globalDawarichApiKey: "enc:abcdefghijkl",
    });

    const res = await request(makeApp(dawarichAdminRouter)).get("/dawarich");
    expect(res.body).toEqual({ baseUrl: "https://dawarich.lan", apiKey: "abcd****ijkl" });
    expect(JSON.stringify(res.body)).not.toContain("abcdefghijkl");
  });
});

describe("PUT /admin/dawarich", () => {
  it("ignores a masked key round-trip instead of storing the mask", async () => {
    adminSettingsFindFirst.mockResolvedValue({ id: 1, globalDawarichApiKey: "enc:abcdefghijkl" });

    await request(makeApp(dawarichAdminRouter))
      .put("/dawarich")
      .send({ baseUrl: "https://dawarich.lan", apiKey: "abcd****ijkl" });

    expect(adminSettingsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: { globalDawarichBaseUrl: "https://dawarich.lan" },
      }),
    );
  });

  it("encrypts and stores a genuinely new API key", async () => {
    adminSettingsFindFirst
      .mockResolvedValueOnce({ id: 1, globalDawarichApiKey: "enc:old-key" })
      .mockResolvedValueOnce({ id: 1, globalDawarichApiKey: "enc:brand-new-key" });

    await request(makeApp(dawarichAdminRouter)).put("/dawarich").send({ apiKey: "brand-new-key" });

    expect(adminSettingsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: { globalDawarichApiKey: "enc:brand-new-key" },
      }),
    );
  });

  it("clears the stored key when apiKey is explicitly null", async () => {
    adminSettingsFindFirst
      .mockResolvedValueOnce({ id: 1, globalDawarichApiKey: "enc:old-key" })
      .mockResolvedValueOnce({ id: 1, globalDawarichApiKey: null });

    await request(makeApp(dawarichAdminRouter)).put("/dawarich").send({ apiKey: null });

    expect(adminSettingsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: { globalDawarichApiKey: null },
      }),
    );
  });

  it("leaves the stored key untouched when apiKey is omitted", async () => {
    adminSettingsFindFirst
      .mockResolvedValueOnce({ id: 1, globalDawarichApiKey: "enc:existing-key" })
      .mockResolvedValueOnce({ id: 1, globalDawarichApiKey: "enc:existing-key" });

    await request(makeApp(dawarichAdminRouter))
      .put("/dawarich")
      .send({ baseUrl: "https://dawarich.lan" });

    const call = adminSettingsUpdate.mock.calls[0][0];
    expect(call.where).toEqual({ id: 1 });
    expect(call.data).toHaveProperty("globalDawarichBaseUrl", "https://dawarich.lan");
    expect(call.data).not.toHaveProperty("globalDawarichApiKey");
  });
});

describe("POST /admin/dawarich/test", () => {
  it("returns 400 + kind=notConfigured when no global connection exists and nothing was sent", async () => {
    adminSettingsFindFirst.mockResolvedValue(null);
    const res = await request(makeApp(dawarichAdminRouter)).post("/dawarich/test").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("notConfigured");
  });

  it("falls back to the stored global connection on empty-string fields", async () => {
    adminSettingsFindFirst.mockResolvedValue({
      id: 1,
      globalDawarichBaseUrl: "https://global.lan",
      globalDawarichApiKey: "enc:global-key",
    });
    testDawarichConnection.mockResolvedValue({ success: true, message: "Connected to Dawarich" });

    const res = await request(makeApp(dawarichAdminRouter))
      .post("/dawarich/test")
      .send({ baseUrl: "", apiKey: "" });

    expect(res.status).toBe(200);
    expect(testDawarichConnection).toHaveBeenCalledWith("https://global.lan", "global-key");
  });
});
