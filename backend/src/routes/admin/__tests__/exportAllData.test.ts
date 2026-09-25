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
      "documents",
      "railJourneys",
      "tourRoutes",
      "userAchievements",
    ]) {
      expect(Object.prototype.hasOwnProperty.call(user, domain)).toBe(true);
    }

    // And the seeded rows actually came through, so the keys are not empty
    // shells from a select that silently matched nothing.
    expect(user.trips).toHaveLength(1);
    expect(user.companions).toHaveLength(1);
  });

  // Rail (spec 2026-09-25-rail-domain, phase 2b): the rides, and the stations
  // users added — which live outside any user and are not re-seeded.
  it("carries the rail rides and the user-added rail stations", async () => {
    const station = await prisma.railStation.create({
      data: {
        name: `Export Halt ${Date.now()}`,
        searchName: "export halt",
        lat: 50,
        lon: 8,
        isUserAdded: true,
      },
    });
    await prisma.railJourney.create({
      data: {
        userId: createdUserIds[0],
        depStationName: "Frankfurt (Main) Hbf",
        arrStationName: station.name,
        arrStationId: station.id,
        depLat: 50.1,
        depLon: 8.66,
        arrLat: 50,
        arrLon: 8,
        departureTime: new Date("2025-03-01T07:00:00Z"),
        status: "completed",
      },
    });
    try {
      const res = await request(app)
        .get("/api/v1/admin/export/all-data")
        .set("Cookie", adminCookie)
        .expect(200);
      const user = res.body.users.find((u: { id: string }) => u.id === createdUserIds[0]);
      expect(user.railJourneys).toHaveLength(1);
      expect(user.railJourneys[0].arrStationName).toBe(station.name);
      expect(res.body.userAddedRailStations.map((s: { id: number }) => s.id)).toContain(station.id);
    } finally {
      await prisma.railJourney.deleteMany({ where: { userId: createdUserIds[0] } });
      await prisma.railStation.delete({ where: { id: station.id } });
    }
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

  // Tours and roadtrips were not in the export: a trip exported its stops and
  // nothing of the route drawn over them, and a roadtrip or tour with no trip
  // was missing entirely, stations and recordings with it.
  it("carries a standalone roadtrip with its stations, legs and recordings", async () => {
    const route = await prisma.tripRoute.create({
      data: {
        userId: createdUserIds[0],
        name: "Ohne Reise",
        mode: "road",
        kind: "roadtrip",
        vehicle: "campervan",
      },
    });
    await prisma.tripStop.create({
      data: {
        title: "Hirtshals",
        lat: 57.59,
        lon: 9.96,
        routeId: route.id,
        routeOrderIdx: 0,
        overnight: true,
      },
    });
    await prisma.tripRouteTrack.create({
      data: {
        routeId: route.id,
        source: "gpx",
        startedAt: new Date("2026-09-18T08:00:00Z"),
        endedAt: new Date("2026-09-18T12:00:00Z"),
        geometry: [
          [9.96, 57.59],
          [9.9, 57.6],
        ],
        pointCount: 2,
        distanceKm: 5,
        ascentM: 120,
      },
    });

    const res = await request(app).get("/api/v1/admin/export/all-data").set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    const body = typeof res.body === "object" && res.body.users ? res.body : JSON.parse(res.text);
    const me = body.users.find((u: { id: string }) => u.id === createdUserIds[0]);
    expect(me.tourRoutes).toEqual([
      expect.objectContaining({
        name: "Ohne Reise",
        kind: "roadtrip",
        vehicle: "campervan",
        stops: [expect.objectContaining({ title: "Hirtshals", overnight: true })],
        legs: [],
        tracks: [expect.objectContaining({ source: "gpx", ascentM: 120 })],
      }),
    ]);
  });
});
