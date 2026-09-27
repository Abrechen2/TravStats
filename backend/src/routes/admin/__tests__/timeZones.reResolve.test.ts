import request from "supertest";
import type { Express } from "express";

import { reResolveApplySchema, reResolveDryRunSchema } from "../../../schemas/timeMigration";

/**
 * The admin zone re-resolution (ADR 0002 D2), end to end: a dry run lists the
 * rows whose stored zone the resolver now answers differently and by how
 * much the local time moves; apply writes exactly those, only where the
 * stored zone is still the one the dry run saw.
 */

const APP_IMPORT_TIMEOUT_MS = 60_000;
jest.setTimeout(60_000);

let app: Express;
let prisma: typeof import("../../../db").prisma;
let adminId: string;
let userId: string;
let adminCookie: string;
let userCookie: string;
let flightId: string;
let visitId: string;

async function runJob(jobId: string): Promise<Record<string, unknown>> {
  const { settleAllJobs } = await import("../../../services/jobs/jobRegistry");
  await settleAllJobs();
  const res = await request(app).get(`/api/v1/jobs/${jobId}`).set("Cookie", adminCookie);
  expect(res.status).toBe(200);
  return res.body.data as Record<string, unknown>;
}

beforeAll(async () => {
  app = (await import("../../../index")).default;
  prisma = (await import("../../../db")).prisma;
  const { hashPassword } = await import("../../../utils/password");
  const { generateToken } = await import("../../../utils/jwt");
  await prisma.user.deleteMany({ where: { username: { in: ["tmReAdmin", "tmReUser"] } } });
  const passwordHash = await hashPassword("pw123456");
  const admin = await prisma.user.create({
    data: { username: "tmReAdmin", passwordHash, isAdmin: true },
  });
  const user = await prisma.user.create({ data: { username: "tmReUser", passwordHash } });
  adminId = admin.id;
  userId = user.id;
  adminCookie = `auth_token=${generateToken(admin.id)}`;
  userCookie = `auth_token=${generateToken(user.id)}`;

  // Stored with a zone the resolver does not give today.
  flightId = (
    await prisma.flight.create({
      data: {
        userId,
        depIata: "FRA",
        depLat: 50.03,
        depLon: 8.57,
        arrIata: "JFK",
        arrLat: 40.64,
        arrLon: -73.78,
        departureTime: new Date("2027-01-10T08:00:00.000Z"),
        depTimezone: "America/Chicago",
        arrTimezone: "America/New_York",
      },
    })
  ).id;
  const place = await prisma.place.create({
    data: { userId, name: "Pantheon", lat: 41.8986, lon: 12.4769 },
  });
  visitId = (
    await prisma.placeVisit.create({
      data: {
        userId,
        placeId: place.id,
        visitedAt: new Date("2027-01-12T10:00:00.000Z"),
        visitedAtUtc: new Date("2027-01-12T09:00:00.000Z"),
        visitedZone: "Asia/Tokyo",
        visitedPrecision: "minute",
      },
    })
  ).id;
}, APP_IMPORT_TIMEOUT_MS);

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [adminId, userId] } } });
});

describe("POST /api/v1/admin/time-zones/re-resolve", () => {
  it("is refused to a non-admin", async () => {
    const res = await request(app)
      .post("/api/v1/admin/time-zones/re-resolve?dryRun=true")
      .set("Cookie", userCookie);
    expect(res.status).toBe(403);
  });

  it("is refused without dryRun=true", async () => {
    const res = await request(app)
      .post("/api/v1/admin/time-zones/re-resolve")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(400);
  });

  it("dry-runs, then applies only what is still as the dry run saw it", async () => {
    const started = await request(app)
      .post("/api/v1/admin/time-zones/re-resolve?dryRun=true")
      .set("Cookie", adminCookie);
    expect(started.status).toBe(202);
    const job = await runJob(started.body.jobId);
    expect(job.status).toBe("succeeded");
    const progress = job.progress as { done: number; total: number };
    expect(progress.total).toBeGreaterThanOrEqual(2);
    expect(progress.done).toBe(progress.total);
    const dryRun = reResolveDryRunSchema.parse(job.result);

    const mine = dryRun.changes.filter((c) => c.rowId === flightId || c.rowId === visitId);
    expect(mine).toEqual(
      expect.arrayContaining([
        {
          table: "flights",
          rowId: flightId,
          column: "dep_timezone",
          storedZone: "America/Chicago",
          resolvedZone: "Europe/Berlin",
          instant: "2027-01-10T08:00:00.000Z",
          offsetDeltaMinutes: 420,
        },
        {
          table: "place_visits",
          rowId: visitId,
          column: "visited_zone",
          storedZone: "Asia/Tokyo",
          resolvedZone: "Europe/Rome",
          instant: "2027-01-12T09:00:00.000Z",
          offsetDeltaMinutes: -480,
        },
      ])
    );
    expect(mine).toHaveLength(2);
    // The dry run changed nothing.
    const untouched = await prisma.flight.findUniqueOrThrow({ where: { id: flightId } });
    expect(untouched.depTimezone).toBe("America/Chicago");

    // The user corrects the visit in between: apply must not overwrite that.
    await prisma.placeVisit.update({
      where: { id: visitId },
      data: { visitedZone: "Europe/Madrid" },
    });

    const applying = await request(app)
      .post("/api/v1/admin/time-zones/re-resolve/apply")
      .set("Cookie", adminCookie)
      .send({ dryRunId: dryRun.dryRunId });
    expect(applying.status).toBe(202);
    const applied = reResolveApplySchema.parse((await runJob(applying.body.jobId)).result);
    expect(applied.skippedChanged).toBeGreaterThanOrEqual(1);

    const flight = await prisma.flight.findUniqueOrThrow({ where: { id: flightId } });
    expect([flight.depTimezone, flight.arrTimezone, flight.departureTime.toISOString()]).toEqual([
      "Europe/Berlin",
      "America/New_York",
      "2027-01-10T08:00:00.000Z",
    ]);
    const visit = await prisma.placeVisit.findUniqueOrThrow({ where: { id: visitId } });
    expect([visit.visitedZone, visit.visitedAtUtc?.toISOString()]).toEqual([
      "Europe/Madrid",
      "2027-01-12T09:00:00.000Z",
    ]);

    // One dry run, one apply.
    const again = await request(app)
      .post("/api/v1/admin/time-zones/re-resolve/apply")
      .set("Cookie", adminCookie)
      .send({ dryRunId: dryRun.dryRunId });
    expect(again.status).toBe(404);
    expect(again.body.code).toBe("DRY_RUN_NOT_FOUND");
  });
});
