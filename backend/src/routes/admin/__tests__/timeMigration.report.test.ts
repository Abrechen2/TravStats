import request from "supertest";
import type { Express } from "express";

import { timeMigrationReportSchema } from "../../../schemas/timeMigration";

/**
 * `GET /admin/time-migration/report` and the inbox side of a time question
 * (ADR 0002 phase 3b), end to end: what the admin page and the inbox receive.
 */

const APP_IMPORT_TIMEOUT_MS = 60_000;

let app: Express;
let prisma: typeof import("../../../db").prisma;
let adminId: string;
let userId: string;
let adminCookie: string;
let userCookie: string;

beforeAll(async () => {
  app = (await import("../../../index")).default;
  prisma = (await import("../../../db")).prisma;
  const { hashPassword } = await import("../../../utils/password");
  const { generateToken } = await import("../../../utils/jwt");
  await prisma.user.deleteMany({ where: { username: { in: ["tmReportAdmin", "tmReportUser"] } } });
  const passwordHash = await hashPassword("pw123456");
  const admin = await prisma.user.create({
    data: { username: "tmReportAdmin", passwordHash, isAdmin: true },
  });
  const user = await prisma.user.create({ data: { username: "tmReportUser", passwordHash } });
  adminId = admin.id;
  userId = user.id;
  adminCookie = `auth_token=${generateToken(admin.id)}`;
  userCookie = `auth_token=${generateToken(user.id)}`;
}, APP_IMPORT_TIMEOUT_MS);

beforeEach(async () => {
  await prisma.timeMigrationLedger.deleteMany({});
});

afterAll(async () => {
  await prisma.timeMigrationLedger.deleteMany({});
  await prisma.user.deleteMany({ where: { id: { in: [adminId, userId] } } });
});

describe("GET /api/v1/admin/time-migration/report", () => {
  it("is refused to a non-admin", async () => {
    const res = await request(app)
      .get("/api/v1/admin/time-migration/report")
      .set("Cookie", userCookie);
    expect(res.status).toBe(403);
  });

  it("counts rows, rules and reasons from the ledger and lists every open row", async () => {
    // The open row must exist: a deleted row answers its question (phase 4).
    const openFlight = await prisma.flight.create({
      data: { userId, depLat: 0, depLon: 0, arrLat: 0, arrLon: 0, status: "flown" },
    });
    await prisma.timeMigrationLedger.createMany({
      data: [
        // One flight converted on both ends, one left open on one end.
        {
          tableName: "flights",
          rowId: "f-ok",
          columnName: "departure",
          rule: "flight.instant_kept",
          status: "resolved",
          userId,
        },
        {
          tableName: "flights",
          rowId: "f-ok",
          columnName: "arrival",
          rule: "flight.instant_kept",
          status: "resolved",
          userId,
        },
        {
          tableName: "flights",
          rowId: openFlight.id,
          columnName: "departure",
          rule: "flight.instant_kept",
          status: "resolved",
          userId,
        },
        {
          tableName: "flights",
          rowId: openFlight.id,
          columnName: "arrival",
          rule: "flight.zone_unresolved",
          status: "open",
          reason: "no_position",
          legacyValue: "2027-05-02T10:00:00.000Z",
          userId,
        },
      ],
    });

    const res = await request(app)
      .get("/api/v1/admin/time-migration/report")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const report = timeMigrationReportSchema.parse(res.body);
    const flights = report.tables.find((t) => t.table === "flights");
    expect(flights).toMatchObject({ converted: 1, open: 1 });
    expect(flights?.reasons).toEqual([{ reason: "no_position", count: 1 }]);
    expect(flights?.rules).toEqual(
      expect.arrayContaining([
        { rule: "flight.instant_kept", status: "resolved", count: 3 },
        { rule: "flight.zone_unresolved", status: "open", count: 1 },
      ])
    );
    expect(report.openRows).toEqual([
      expect.objectContaining({
        table: "flights",
        rowId: openFlight.id,
        column: "arrival",
        reason: "no_position",
        legacyValue: "2027-05-02T10:00:00.000Z",
        userId,
      }),
    ]);
    expect(report.openRowsTruncated).toBe(false);
    expect(report.unchanged.map((u) => u.domain).sort()).toEqual(
      ["country_days", "loyalty", "photos", "tours", "track_windows"].sort()
    );
  });

  it("links an open row to its editor: a tour's stop names the tour and the tour's trip, and its question", async () => {
    const trip = await prisma.trip.create({ data: { userId, name: "Norwegen" } });
    const tour = await prisma.tripRoute.create({
      data: { userId, tripId: trip.id, name: "Küste", mode: "car" },
    });
    const stop = await prisma.tripStop.create({
      data: {
        routeId: tour.id,
        title: "Irgendwo",
        startDate: new Date("2026-05-04T09:00:00.000Z"),
      },
    });
    await prisma.timeMigrationLedger.create({
      data: {
        tableName: "trip_stops",
        rowId: stop.id,
        columnName: "start_date",
        rule: "trip_stop.no_zone",
        status: "open",
        reason: "no_position",
        userId,
      },
    });
    const flag = await prisma.dataQualityFlag.create({
      data: {
        userId,
        entityType: "trip_stop",
        entityId: stop.id,
        kind: "time_zone_unresolved",
        details: { table: "trip_stops", fields: [] },
      },
    });
    try {
      const res = await request(app)
        .get("/api/v1/admin/time-migration/report")
        .set("Cookie", adminCookie);
      const report = timeMigrationReportSchema.parse(res.body);
      expect(report.openRows.find((r) => r.rowId === stop.id)).toMatchObject({
        entityType: "trip_stop",
        parentType: "tour",
        parentId: tour.id,
        tripId: trip.id,
        flagId: flag.id,
        kind: "time_zone_unresolved",
        // The row is named, so the admin can tell twenty open stops apart.
        label: "Irgendwo",
      });
    } finally {
      await prisma.dataQualityFlag.deleteMany({ where: { userId } });
      await prisma.trip.delete({ where: { id: trip.id } });
    }
  });
  it("sends a timeline stop that is also a tour's point to the trip timeline, not the tour", async () => {
    // The trip timeline edits a stop that sits on the trip; the tour editor
    // edits only the tour's own points. A stop that is both is a timeline stop.
    const trip = await prisma.trip.create({ data: { userId, name: "Schottland" } });
    const tour = await prisma.tripRoute.create({
      data: { userId, tripId: trip.id, name: "Highlands", mode: "car" },
    });
    const stop = await prisma.tripStop.create({
      data: { tripId: trip.id, routeId: tour.id, title: "Glencoe", precision: "unknown" },
    });
    await prisma.timeMigrationLedger.create({
      data: {
        tableName: "trip_stops",
        rowId: stop.id,
        columnName: "start_date",
        rule: "trip_stop.no_zone",
        status: "open",
        reason: "writer_unknown",
        userId,
      },
    });
    try {
      const res = await request(app)
        .get("/api/v1/admin/time-migration/report")
        .set("Cookie", adminCookie);
      const report = timeMigrationReportSchema.parse(res.body);
      expect(report.openRows.find((r) => r.rowId === stop.id)).toMatchObject({
        parentType: "trip",
        parentId: trip.id,
        tripId: trip.id,
        kind: "time_precision_unknown",
        flagId: null,
      });
    } finally {
      await prisma.trip.delete({ where: { id: trip.id } });
    }
  });

  it("an open row with a reason this server does not know has no reason and no kind", async () => {
    await prisma.timeMigrationLedger.create({
      data: {
        tableName: "flights",
        rowId: "f-future",
        columnName: "departure",
        rule: "flight.future_rule",
        status: "open",
        reason: "a_reason_from_the_future",
        userId,
      },
    });
    const res = await request(app)
      .get("/api/v1/admin/time-migration/report")
      .set("Cookie", adminCookie);
    const report = timeMigrationReportSchema.parse(res.body);
    expect(report.openRows.find((r) => r.rowId === "f-future")).toMatchObject({
      reason: null,
      kind: null,
      flagId: null,
      // The flight row no longer exists: nothing to name, and no guess.
      label: null,
    });
  });
});

describe("the ledger follows the answers (phase 4)", () => {
  const report = async () => {
    const res = await request(app)
      .get("/api/v1/admin/time-migration/report")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    return timeMigrationReportSchema.parse(res.body);
  };
  const openLedger = (tableName: string, rowId: string, columnName: string, reason: string) =>
    prisma.timeMigrationLedger.create({
      data: { tableName, rowId, columnName, rule: "test.open", status: "open", reason, userId },
    });

  it("counts a question answered through an editor as answered, no longer open", async () => {
    const flight = await prisma.flight.create({
      data: { userId, depLat: 0, depLon: 0, arrLat: 0, arrLon: 0, status: "flown" },
    });
    await openLedger("flights", flight.id, "departure", "no_position");
    expect((await report()).tables.find((t) => t.table === "flights")).toMatchObject({
      open: 1,
      answered: 0,
    });

    // The owner gives the departure its airport through the flight editor.
    const put = await request(app)
      .put(`/api/v1/flights/${flight.id}`)
      .set("Cookie", userCookie)
      .send({
        departure: { iata: "FRA", lat: 50.030241, lon: 8.561096 },
        departureLocal: "2019-05-02T10:00",
      });
    expect(put.status).toBe(200);

    const after = await report();
    expect(after.tables.find((t) => t.table === "flights")).toMatchObject({
      open: 0,
      answered: 1,
    });
    expect(after.openRows.find((r) => r.rowId === flight.id)).toBeUndefined();
    const ledger = await prisma.timeMigrationLedger.findFirstOrThrow({
      where: { rowId: flight.id },
    });
    expect(ledger.status).toBe("resolved");
  });

  it("settles a dismissed question and a deleted row, and keeps an unanswered one open", async () => {
    const trip = await prisma.trip.create({ data: { userId, name: "Ledger" } });
    const kept = await prisma.tripStop.create({
      data: { tripId: trip.id, title: "Still open", precision: "unknown" },
    });
    const dismissed = await prisma.tripStop.create({
      data: { tripId: trip.id, title: "This day is right", precision: "unknown" },
    });
    await openLedger("trip_stops", kept.id, "start_date", "writer_unknown");
    await openLedger("trip_stops", dismissed.id, "start_date", "writer_unknown");
    await openLedger(
      "trip_stops",
      "00000000-0000-0000-0000-000000000000",
      "start_date",
      "writer_unknown"
    );
    await prisma.dataQualityFlag.create({
      data: {
        userId,
        entityType: "trip_stop",
        entityId: dismissed.id,
        kind: "time_precision_unknown",
        status: "dismissed",
        details: { table: "trip_stops", fields: [] },
      },
    });
    try {
      // The inbox pass settles the owner's rows on its own, before any report.
      const { runDataQualityChecks } = await import("../../../services/dataQuality");
      await runDataQualityChecks(userId);
      const rows = await prisma.timeMigrationLedger.findMany({
        where: { tableName: "trip_stops" },
        select: { rowId: true, status: true },
      });
      const statusOf = (id: string) => rows.find((r) => r.rowId === id)?.status;
      expect(statusOf(kept.id)).toBe("open");
      expect(statusOf(dismissed.id)).toBe("resolved");
      expect(statusOf("00000000-0000-0000-0000-000000000000")).toBe("resolved");
      expect((await report()).tables.find((t) => t.table === "trip_stops")).toMatchObject({
        open: 1,
        answered: 2,
      });
    } finally {
      await prisma.dataQualityFlag.deleteMany({ where: { userId } });
      await prisma.trip.delete({ where: { id: trip.id } });
    }
  });
});

describe("a time question in the inbox", () => {
  it("names the row and the record it is edited on", async () => {
    const place = await prisma.place.create({
      data: { userId, name: "Kolosseum", lat: 41.89, lon: 12.49 },
    });
    const visit = await prisma.placeVisit.create({
      data: { userId, placeId: place.id, visitedAt: new Date("2026-08-30T14:00:00.000Z") },
    });
    await prisma.dataQualityFlag.create({
      data: {
        userId,
        entityType: "place_visit",
        entityId: visit.id,
        kind: "time_precision_unknown",
        details: {
          table: "place_visits",
          fields: [
            {
              column: "visited_at",
              reason: "writer_unknown",
              legacyValue: "2026-08-30T14:00:00.000Z",
              keptValue: "2026-08-30",
              zone: "Europe/Rome",
            },
          ],
        },
      },
    });
    try {
      const res = await request(app).get("/api/v1/data-quality-flags").set("Cookie", userCookie);
      expect(res.status).toBe(200);
      const flags = res.body.flags as Array<Record<string, unknown>>;
      expect(flags).toEqual([
        expect.objectContaining({
          kind: "time_precision_unknown",
          subject: {
            entityType: "place_visit",
            entityId: visit.id,
            label: "Kolosseum",
            parentId: place.id,
            parentType: "place",
            tripId: null,
          },
        }),
      ]);
    } finally {
      await prisma.dataQualityFlag.deleteMany({ where: { userId } });
      await prisma.place.delete({ where: { id: place.id } });
    }
  });
});
