import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import adminRoutes from "../index";
import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { generateToken } from "../../../utils/jwt";

/**
 * `GET /admin/export/all-data` calls itself "export all data" and
 * downloads as `travstats-backup-….json`. It used to carry flights,
 * achievements and settings only — cruises, lodging, trips, places, bookings
 * and companions were silently absent, so anyone treating it as a backup lost
 * five domains without being told.
 *
 * Two things are asserted, and the second matters as much as the first: the
 * file must cover every domain, and it must contain NO credential material.
 * `settings: true` used to carry every stored API key into a downloadable
 * file.
 */
describe("GET /api/v1/admin/export/all-data", () => {
  let adminCookie: string;
  const createdUserIds: string[] = [];

  // Mounted slim, NOT via `import app from "../../../index"`. Importing the
  // whole app boots a second server with its schedulers and their own Prisma
  // clients; adding one more of those to the suite pushed Postgres past
  // `max_connections` and turned 3 pre-existing teardown deadlocks into 125
  // "too many clients" failures across unrelated files. Measured both ways.
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use("/api/v1/admin", adminRoutes);

  beforeAll(async () => {
    const admin = await prisma.user.create({
      data: {
        username: `admin-export-test-${Date.now()}`,
        passwordHash: await hashPassword("admin-password"),
        isAdmin: true,
        isActive: true,
        settings: {
          create: {
            baseCurrency: "EUR",
            // `data` is a required Json column on UserSettings.
            data: {},
            // A stored key, so the leak test has something real to find.
            openaiApiKey: "enc:should-never-be-exported",
          },
        },
        trips: { create: [{ name: "Export test trip" }] },
        companions: {
          create: [
            {
              canonicalName: "export test companion",
              displayName: "Export test companion",
              searchName: "export test companion",
            },
          ],
        },
      },
    });
    createdUserIds.push(admin.id);
    adminCookie = `auth_token=${generateToken(admin.id)}`;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  it("covers every domain the instance holds", async () => {
    const res = await request(app)
      .get("/api/v1/admin/export/all-data")
      .set("Cookie", adminCookie)
      .expect(200);

    const user = res.body.users.find((u: { id: string }) => u.id === createdUserIds[0]);
    expect(user).toBeDefined();

    // Every travel domain must be represented as a key, present or empty. A
    // missing KEY is the defect; an empty array is just an empty logbook.
    for (const domain of [
      "flights",
      "cruises",
      "trips",
      "bookings",
      "lodgings",
      "lodgingStays",
      "lodgingMemberships",
      "places",
      "placeVisits",
      "placeLists",
      "companions",
      "userAchievements",
    ]) {
      expect(Object.prototype.hasOwnProperty.call(user, domain)).toBe(true);
    }

    // And the seeded rows actually came through, so the keys are not empty
    // shells from a select that silently matched nothing.
    expect(user.trips).toHaveLength(1);
    expect(user.companions).toHaveLength(1);
  });

  it("carries no credential material of any kind", async () => {
    const res = await request(app)
      .get("/api/v1/admin/export/all-data")
      .set("Cookie", adminCookie)
      .expect(200);

    const serialized = JSON.stringify(res.body);

    // The planted key value must not appear anywhere.
    expect(serialized).not.toContain("should-never-be-exported");

    // Nor may any credential-shaped field name.
    for (const field of [
      "passwordHash",
      "resetToken",
      "changeToken",
      "twoFactorSecret",
      "twoFactorPendingSecret",
      "twoFactorRecoveryCodes",
      "webauthnCredentials",
      "apiTokens",
      "pairingCodes",
      "openaiApiKey",
      "claudeApiKey",
      "airlabsApiKey",
      "aviationstackApiKey",
      "aerodataboxApiKey",
      "openskyClientSecret",
      "openskyPassword",
      "immichApiKey",
    ]) {
      expect(serialized).not.toContain(field);
    }
  });
});
