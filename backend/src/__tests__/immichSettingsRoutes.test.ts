/**
 * Route-level contract for the Immich settings endpoints. The routers assume
 * `authenticate` already ran (their parents mount it), so the harness injects
 * `req.userId` and mounts the sub-router directly.
 */
import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import express from "express";
import request from "supertest";

const userSettingsFindUnique = jest.fn();
const userSettingsUpsert = jest.fn();
const adminSettingsFindFirst = jest.fn();
const adminSettingsUpdate = jest.fn();
const adminSettingsCreate = jest.fn();

jest.mock("../db", () => ({
  prisma: {
    userSettings: { findUnique: userSettingsFindUnique, upsert: userSettingsUpsert },
    adminSettings: {
      findFirst: adminSettingsFindFirst,
      update: adminSettingsUpdate,
      create: adminSettingsCreate,
    },
  },
}));

jest.mock("../utils/encryption", () => ({
  encryptApiKey: jest.fn((v: string | null) => (v === null ? null : `enc:${v}`)),
  decryptApiKey: jest.fn((v: string | null) =>
    typeof v === "string" ? v.replace(/^enc:/, "") : null,
  ),
}));

const testImmichConnection = jest.fn();
jest.mock("../services/immich/immichTester", () => ({ testImmichConnection }));

const getImmichConnection = jest.fn();
jest.mock("../services/immich/immichResolver", () => ({ getImmichConnection }));

import immichSettingsRouter from "../routes/settings/immich";
import immichAdminRouter from "../routes/admin/immich";
import { errorHandler } from "../middleware/errorHandler";

function makeApp(router: express.Router): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { userId?: string }).userId = "u1";
    next();
  });
  app.use("/immich", router);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  getImmichConnection.mockResolvedValue({
    baseUrl: "https://immich.lan",
    apiKey: "k",
    source: "user",
  });
});

describe("GET /settings/immich", () => {
  it("returns hasKey but never the key itself", async () => {
    userSettingsFindUnique.mockResolvedValue({
      immichBaseUrl: "https://immich.lan",
      immichApiKey: "enc:super-secret",
      immichDefaultMode: "import",
    });

    const res = await request(makeApp(immichSettingsRouter)).get("/immich");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      baseUrl: "https://immich.lan",
      hasKey: true,
      defaultMode: "import",
      source: "user",
      isShared: false,
      hasAccess: true,
    });
    expect(JSON.stringify(res.body)).not.toContain("super-secret");
  });

  it("reports an unconfigured user with defaults", async () => {
    userSettingsFindUnique.mockResolvedValue(null);
    getImmichConnection.mockResolvedValue(null);

    const res = await request(makeApp(immichSettingsRouter)).get("/immich");
    expect(res.body).toEqual({
      baseUrl: null,
      hasKey: false,
      defaultMode: "link",
      source: null,
      isShared: false,
      hasAccess: false,
    });
  });
});

describe("PUT /settings/immich", () => {
  it("normalises the URL, encrypts the key and upserts", async () => {
    userSettingsFindUnique.mockResolvedValue({
      immichBaseUrl: "https://immich.lan",
      immichApiKey: "enc:k",
      immichDefaultMode: "link",
    });

    const res = await request(makeApp(immichSettingsRouter))
      .put("/immich")
      .send({ baseUrl: "https://immich.lan/", apiKey: "k", defaultMode: "import" });

    expect(res.status).toBe(200);
    expect(userSettingsUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "u1" },
        update: {
          immichBaseUrl: "https://immich.lan",
          immichApiKey: "enc:k",
          immichDefaultMode: "import",
        },
      }),
    );
  });

  it("clears the key when apiKey is explicitly null", async () => {
    userSettingsFindUnique.mockResolvedValue(null);
    await request(makeApp(immichSettingsRouter)).put("/immich").send({ apiKey: null });

    expect(userSettingsUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { immichApiKey: null } }),
    );
  });

  it("rejects a non-http base URL with 400", async () => {
    const res = await request(makeApp(immichSettingsRouter))
      .put("/immich")
      .send({ baseUrl: "file:///etc/passwd" });

    expect(res.status).toBe(400);
    expect(userSettingsUpsert).not.toHaveBeenCalled();
  });

  it("rejects an unknown field with 400 (strict schema)", async () => {
    const res = await request(makeApp(immichSettingsRouter))
      .put("/immich")
      .send({ immichApiKey: "sneaky" });
    expect(res.status).toBe(400);
  });
});

describe("POST /settings/immich/test", () => {
  it("tests the ad-hoc pair from the body", async () => {
    testImmichConnection.mockResolvedValue({ success: true, message: "Connected to Immich" });

    const res = await request(makeApp(immichSettingsRouter))
      .post("/immich/test")
      .send({ baseUrl: "https://new.lan", apiKey: "new-key" });

    expect(res.status).toBe(200);
    expect(testImmichConnection).toHaveBeenCalledWith("https://new.lan", "new-key");
  });

  it("falls back to the stored connection when the body is empty", async () => {
    testImmichConnection.mockResolvedValue({ success: true, message: "Connected to Immich" });

    await request(makeApp(immichSettingsRouter)).post("/immich/test").send({});
    expect(testImmichConnection).toHaveBeenCalledWith("https://immich.lan", "k");
  });

  it("falls back when the card sends an empty-string baseUrl (admin-provided connection)", async () => {
    // The real UI always sends baseUrl; with an admin-global connection the
    // user's own field is "". That must resolve the shared connection, NOT 400.
    testImmichConnection.mockResolvedValue({ success: true, message: "Connected to Immich" });

    const res = await request(makeApp(immichSettingsRouter))
      .post("/immich/test")
      .send({ baseUrl: "" });

    expect(res.status).toBe(200);
    expect(testImmichConnection).toHaveBeenCalledWith("https://immich.lan", "k");
  });

  it("falls back when both baseUrl and apiKey are empty strings", async () => {
    testImmichConnection.mockResolvedValue({ success: true, message: "Connected to Immich" });

    const res = await request(makeApp(immichSettingsRouter))
      .post("/immich/test")
      .send({ baseUrl: "", apiKey: "" });

    expect(res.status).toBe(200);
    expect(testImmichConnection).toHaveBeenCalledWith("https://immich.lan", "k");
  });

  it("returns 400 + kind=notConfigured when nothing is configured and nothing was sent", async () => {
    getImmichConnection.mockResolvedValue(null);
    const res = await request(makeApp(immichSettingsRouter)).post("/immich/test").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("notConfigured");
  });

  it("returns 400 + kind=notConfigured on empty strings when nothing is resolved", async () => {
    getImmichConnection.mockResolvedValue(null);
    const res = await request(makeApp(immichSettingsRouter))
      .post("/immich/test")
      .send({ baseUrl: "", apiKey: "" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("notConfigured");
  });

  it("uses an explicitly supplied pair over the stored connection", async () => {
    testImmichConnection.mockResolvedValue({ success: true, message: "Connected to Immich" });

    await request(makeApp(immichSettingsRouter))
      .post("/immich/test")
      .send({ baseUrl: "https://new.lan", apiKey: "new-key" });

    expect(testImmichConnection).toHaveBeenCalledWith("https://new.lan", "new-key");
  });
});

describe("GET /admin/immich", () => {
  it("masks the stored global key", async () => {
    adminSettingsFindFirst.mockResolvedValue({
      id: 1,
      globalImmichBaseUrl: "https://immich.lan",
      globalImmichApiKey: "enc:abcdefghijkl",
    });

    const res = await request(makeApp(immichAdminRouter)).get("/immich");
    expect(res.body).toEqual({ baseUrl: "https://immich.lan", apiKey: "abcd****ijkl" });
  });
});

describe("PUT /admin/immich", () => {
  it("ignores a masked key round-trip instead of storing the mask", async () => {
    adminSettingsFindFirst.mockResolvedValue({ id: 1, globalImmichApiKey: "enc:abcdefghijkl" });

    await request(makeApp(immichAdminRouter))
      .put("/immich")
      .send({ baseUrl: "https://immich.lan", apiKey: "abcd****ijkl" });

    expect(adminSettingsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: { globalImmichBaseUrl: "https://immich.lan" },
      }),
    );
  });

  it("encrypts and stores a genuinely new API key", async () => {
    adminSettingsFindFirst
      .mockResolvedValueOnce({ id: 1, globalImmichApiKey: "enc:old-key" })
      .mockResolvedValueOnce({ id: 1, globalImmichApiKey: "enc:brand-new-key" });

    await request(makeApp(immichAdminRouter)).put("/immich").send({ apiKey: "brand-new-key" });

    expect(adminSettingsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: { globalImmichApiKey: "enc:brand-new-key" },
      }),
    );
  });

  it("clears the stored key when apiKey is explicitly null", async () => {
    adminSettingsFindFirst
      .mockResolvedValueOnce({ id: 1, globalImmichApiKey: "enc:old-key" })
      .mockResolvedValueOnce({ id: 1, globalImmichApiKey: null });

    await request(makeApp(immichAdminRouter)).put("/immich").send({ apiKey: null });

    expect(adminSettingsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: { globalImmichApiKey: null },
      }),
    );
  });

  it("leaves the stored key untouched when apiKey is omitted", async () => {
    adminSettingsFindFirst
      .mockResolvedValueOnce({ id: 1, globalImmichApiKey: "enc:existing-key" })
      .mockResolvedValueOnce({ id: 1, globalImmichApiKey: "enc:existing-key" });

    await request(makeApp(immichAdminRouter))
      .put("/immich")
      .send({ baseUrl: "https://immich.lan" });

    const call = adminSettingsUpdate.mock.calls[0][0];
    expect(call.where).toEqual({ id: 1 });
    expect(call.data).toHaveProperty("globalImmichBaseUrl", "https://immich.lan");
    expect(call.data).not.toHaveProperty("globalImmichApiKey");
  });
});

describe("POST /admin/immich/test", () => {
  it("returns 400 + kind=notConfigured when no global connection exists and nothing was sent", async () => {
    adminSettingsFindFirst.mockResolvedValue(null);
    const res = await request(makeApp(immichAdminRouter)).post("/immich/test").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("notConfigured");
  });

  it("falls back to the stored global connection on empty-string fields", async () => {
    adminSettingsFindFirst.mockResolvedValue({
      id: 1,
      globalImmichBaseUrl: "https://global.lan",
      globalImmichApiKey: "enc:global-key",
    });
    testImmichConnection.mockResolvedValue({ success: true, message: "Connected to Immich" });

    const res = await request(makeApp(immichAdminRouter))
      .post("/immich/test")
      .send({ baseUrl: "", apiKey: "" });

    expect(res.status).toBe(200);
    expect(testImmichConnection).toHaveBeenCalledWith("https://global.lan", "global-key");
  });
});
