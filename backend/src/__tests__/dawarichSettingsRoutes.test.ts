/**
 * Route-level contract for the Dawarich settings endpoint, mirroring
 * `immichSettingsRoutes.test.ts`. The router assumes `authenticate` already
 * ran (its parent mounts it), so the harness injects `req.userId` and mounts
 * the sub-router directly.
 *
 * This file exists because the Dawarich settings router had no route-level
 * test at all, while carrying the same credential-binding rule as the Immich
 * one (AUD-087). An invariant asserted on one of two identical routers is an
 * invariant held by luck.
 */
import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import express from "express";
import request from "supertest";

const userSettingsFindUnique = jest.fn();
const userSettingsUpsert = jest.fn();

jest.mock("../db", () => ({
  prisma: {
    userSettings: { findUnique: userSettingsFindUnique, upsert: userSettingsUpsert },
  },
}));

jest.mock("../utils/encryption", () => ({
  encryptApiKey: jest.fn((v: string | null) => (v === null ? null : `enc:${v}`)),
  decryptApiKey: jest.fn((v: string | null) =>
    typeof v === "string" ? v.replace(/^enc:/, "") : null,
  ),
}));

const testDawarichConnection = jest.fn();
jest.mock("../services/dawarich/dawarichTester", () => ({ testDawarichConnection }));

const getDawarichConnection = jest.fn();
jest.mock("../services/dawarich/dawarichResolver", () => ({ getDawarichConnection }));

import dawarichSettingsRouter from "../routes/settings/dawarich";
import { errorHandler } from "../middleware/errorHandler";

function makeApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { userId?: string }).userId = "u1";
    next();
  });
  app.use("/dawarich", dawarichSettingsRouter);
  app.use(errorHandler);
  return app;
}

const SHARED = {
  baseUrl: "https://dawarich.lan",
  apiKey: "instance-wide-secret",
  source: "global",
};

beforeEach(() => {
  jest.clearAllMocks();
  userSettingsFindUnique.mockResolvedValue(null);
  getDawarichConnection.mockResolvedValue({ ...SHARED, source: "user" });
});

describe("POST /settings/dawarich/test", () => {
  it("falls back to the stored connection when the body is empty", async () => {
    testDawarichConnection.mockResolvedValue({ success: true, message: "Connected" });

    const res = await request(makeApp()).post("/dawarich/test").send({});

    expect(res.status).toBe(200);
    expect(testDawarichConnection).toHaveBeenCalledWith(
      "https://dawarich.lan",
      "instance-wide-secret",
    );
  });

  it("returns 400 + kind=notConfigured when nothing resolves", async () => {
    getDawarichConnection.mockResolvedValue(null);

    const res = await request(makeApp()).post("/dawarich/test").send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("notConfigured");
  });

  /**
   * AUD-087, the Dawarich half. The prior code filled a missing key from the
   * resolved connection whatever the target, so a normal signed-in user could
   * name their own server and have the instance-wide key posted to it.
   */
  describe("a shared key stays bound to the target it was configured for", () => {
    it("refuses to spend an admin-global key on a target the caller chose", async () => {
      getDawarichConnection.mockResolvedValue(SHARED);

      const res = await request(makeApp())
        .post("/dawarich/test")
        .send({ baseUrl: "https://attacker.example" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("keyRequired");
      // The key must not leave the instance at all — a non-200 alone would
      // not establish that.
      expect(testDawarichConnection).not.toHaveBeenCalled();
    });

    it("refuses an ENV-provided key just the same", async () => {
      getDawarichConnection.mockResolvedValue({ ...SHARED, source: "env" });

      const res = await request(makeApp())
        .post("/dawarich/test")
        .send({ baseUrl: "https://attacker.example" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("keyRequired");
      expect(testDawarichConnection).not.toHaveBeenCalled();
    });

    it("still tests the shared connection at its OWN address", async () => {
      getDawarichConnection.mockResolvedValue(SHARED);
      testDawarichConnection.mockResolvedValue({ success: true, message: "Connected" });

      const res = await request(makeApp())
        .post("/dawarich/test")
        .send({ baseUrl: "https://dawarich.lan/" });

      expect(res.status).toBe(200);
      expect(testDawarichConnection).toHaveBeenCalledWith(
        "https://dawarich.lan",
        "instance-wide-secret",
      );
    });

    it("allows a different target once the caller supplies their own key", async () => {
      getDawarichConnection.mockResolvedValue(SHARED);
      testDawarichConnection.mockResolvedValue({ success: true, message: "Connected" });

      const res = await request(makeApp())
        .post("/dawarich/test")
        .send({ baseUrl: "https://mine.example", apiKey: "my-own-key" });

      expect(res.status).toBe(200);
      expect(testDawarichConnection).toHaveBeenCalledWith("https://mine.example", "my-own-key");
    });

    it("does not restrict the caller's OWN stored key", async () => {
      getDawarichConnection.mockResolvedValue({ ...SHARED, source: "user" });
      testDawarichConnection.mockResolvedValue({ success: true, message: "Connected" });

      const res = await request(makeApp())
        .post("/dawarich/test")
        .send({ baseUrl: "https://my-new-box.lan" });

      expect(res.status).toBe(200);
      expect(testDawarichConnection).toHaveBeenCalledWith(
        "https://my-new-box.lan",
        "instance-wide-secret",
      );
    });

    it("rejects a malformed target with invalidUrl rather than keyRequired", async () => {
      getDawarichConnection.mockResolvedValue(SHARED);

      const res = await request(makeApp())
        .post("/dawarich/test")
        .send({ baseUrl: "not-a-url" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalidUrl");
      expect(testDawarichConnection).not.toHaveBeenCalled();
    });
  });
});
