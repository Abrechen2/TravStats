/**
 * Answering inbox findings (spec 2026-10-25 C3) against real Postgres, through
 * the router: resolve/dismiss with an undo window, `keep` and `merge` for a
 * duplicate, and the contract's stable error codes.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, jest } from "@jest/globals";
import express from "express";
import request from "supertest";

let mockUserId = "";
jest.mock("../../../middleware/auth", () => {
  const actual = jest.requireActual<typeof import("../../../middleware/auth")>(
    "../../../middleware/auth"
  );
  return {
    ...actual,
    authenticate: (req: unknown, _res: unknown, next: () => void) => {
      (req as { userId?: string }).userId = mockUserId;
      next();
    },
  };
});

import { prisma } from "../../../db";
import dataQualityFlagsRouter from "../../../routes/dataQualityFlags";
import { errorHandler } from "../../../middleware/errorHandler";
import { runDataQualityChecks } from "../runner";
import { listFlags } from "../flagService";
import { FINDING_UNDO_WINDOW_MS } from "../findingActions";

const NOW = new Date("2026-10-10T12:00:00Z");
const day = (d: string) => new Date(`${d}T00:00:00Z`);

const FLIGHT = {
  airline: "Lufthansa",
  flightNumber: "LH400",
  depIata: "FRA",
  depLat: 50.03,
  depLon: 8.57,
  arrIata: "JFK",
  arrLat: 40.64,
  arrLon: -73.78,
  status: "flown",
  depTimeSemantics: "UTC",
  arrTimeSemantics: "UTC",
  depTimezone: "Europe/Berlin",
  arrTimezone: "America/New_York",
  departureTime: new Date("2026-03-10T08:00:00Z"),
  arrivalTime: new Date("2026-03-10T16:00:00Z"),
};

function makeApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/data-quality-flags", dataQualityFlagsRouter);
  app.use(errorHandler);
  return app;
}

const post = (path: string, body?: object) =>
  request(makeApp())
    .post(`/api/v1/data-quality-flags${path}`)
    .send(body ?? {});

async function seedFlights(userId: string) {
  const trip = await prisma.trip.create({
    data: {
      userId,
      name: "New York",
      status: "completed",
      startDay: day("2026-03-09"),
      endDay: day("2026-03-12"),
    },
  });
  const typed = await prisma.flight.create({
    data: { ...FLIGHT, userId, dataSource: "manual", createdAt: new Date("2026-03-01T00:00:00Z") },
  });
  const mail = await prisma.flight.create({
    data: {
      ...FLIGHT,
      userId,
      tripId: trip.id,
      dataSource: "email_import",
      createdAt: new Date("2026-03-02T00:00:00Z"),
    },
  });
  return { trip, typed, mail };
}

async function seedStays(userId: string) {
  const lodging = await prisma.lodging.create({ data: { userId, name: "Hotel Roma" } });
  const stay = (createdAt: string) =>
    prisma.lodgingStay.create({
      data: {
        userId,
        lodgingId: lodging.id,
        createdAt: new Date(createdAt),
        checkIn: day("2026-06-10"),
        checkOut: day("2026-06-13"),
        checkInDate: day("2026-06-10"),
        checkOutDate: day("2026-06-13"),
      },
    });
  const first = await stay("2026-05-01T00:00:00Z");
  const second = await stay("2026-05-02T00:00:00Z");
  return { lodging, first, second };
}

async function duplicateFlag(userId: string, entityType: string) {
  const flag = (await listFlags(userId, { kind: "duplicate_candidate" })).find(
    (f) => f.entityType === entityType
  );
  if (!flag) throw new Error(`expected a duplicate question on ${entityType}`);
  return flag;
}

describe("answering findings (spec C3)", () => {
  let userId: string;

  beforeEach(async () => {
    const user = await prisma.user.create({
      data: {
        username: `dq-c3-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        passwordHash: "x",
      },
    });
    userId = user.id;
    mockUserId = userId;
  });

  afterEach(async () => {
    jest.useRealTimers();
    await prisma.user.delete({ where: { id: userId } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("serves the duplicate with the contract's evidence, undo window and actions", async () => {
    const { typed, mail } = await seedFlights(userId);
    await runDataQualityChecks(userId, NOW);
    const flag = await duplicateFlag(userId, "flight");

    expect(flag.entityId).toBe(mail.id);
    expect(flag.undoUntil).toBeNull();
    expect(flag.actions).toEqual(["keep", "merge"]);
    expect(flag.evidence).toMatchObject({
      entityType: "flight",
      ids: [mail.id, typed.id],
      keptId: typed.id,
      keptReason: "oldest",
      matchedFields: ["departureDay", "departureTime", "flightNumber", "route"],
    });
    // `details` stays for the clients that read it.
    expect(flag.details).toMatchObject({ copies: [{ entityId: typed.id }] });
  });

  it("dismisses with an undo window, and undo re-opens", async () => {
    await seedFlights(userId);
    await runDataQualityChecks(userId, NOW);
    const flag = await duplicateFlag(userId, "flight");

    const dismissed = await post(`/${flag.id}/dismiss`);
    expect(dismissed.status).toBe(200);
    expect(dismissed.body.success).toBe(true);
    expect(dismissed.body.data.status).toBe("dismissed");
    const until = new Date(dismissed.body.data.undoUntil).getTime();
    expect(until - Date.now()).toBeGreaterThan(FINDING_UNDO_WINDOW_MS - 60_000);
    expect(until - Date.now()).toBeLessThanOrEqual(FINDING_UNDO_WINDOW_MS);

    const undone = await post(`/${flag.id}/undo`);
    expect(undone.status).toBe(200);
    expect(undone.body.data).toMatchObject({ status: "open", undoUntil: null, resolvedAt: null });
  });

  it("resolves without a body as before, and that answer can be undone too", async () => {
    await seedFlights(userId);
    await runDataQualityChecks(userId, NOW);
    const flag = await duplicateFlag(userId, "flight");

    const resolved = await post(`/${flag.id}/resolve`);
    expect(resolved.body.data.status).toBe("resolved");
    expect((await post(`/${flag.id}/undo`)).body.data.status).toBe("open");
  });

  it("answers 409 undoExpired once the window has passed", async () => {
    await seedFlights(userId);
    await runDataQualityChecks(userId, NOW);
    const flag = await duplicateFlag(userId, "flight");
    await post(`/${flag.id}/dismiss`);
    await prisma.dataQualityFlag.update({
      where: { id: flag.id },
      data: { undoUntil: new Date(Date.now() - 1000) },
    });

    const res = await post(`/${flag.id}/undo`);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "undoExpired" });
  });

  it("answers 409 staleFinding for an undo of a flag that is open again", async () => {
    await seedFlights(userId);
    await runDataQualityChecks(userId, NOW);
    const flag = await duplicateFlag(userId, "flight");
    await post(`/${flag.id}/resolve`);
    // A re-run finds the copies still there and re-opens the question.
    await runDataQualityChecks(userId, NOW);

    const res = await post(`/${flag.id}/undo`);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "staleFinding" });
  });

  it("answers notFound for another account's flag, and invalidAction with a reason", async () => {
    await seedFlights(userId);
    await runDataQualityChecks(userId, NOW);
    const flag = await duplicateFlag(userId, "flight");

    expect((await post(`/${flag.id}/resolve`, { action: "explode" })).body).toEqual({
      error: "invalidAction",
      reason: "unknownAction",
    });
    expect((await post(`/${flag.id}/resolve`, { action: "link" })).body).toEqual({
      error: "invalidAction",
      reason: "notOffered",
    });

    mockUserId = "00000000-0000-4000-8000-000000000000";
    const foreign = await post(`/${flag.id}/dismiss`);
    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual({ error: "notFound" });
  });

  it("keep dismisses the pair for good; a re-run does not ask again, undo re-opens", async () => {
    await seedFlights(userId);
    await runDataQualityChecks(userId, NOW);
    const flag = await duplicateFlag(userId, "flight");

    const kept = await post(`/${flag.id}/resolve`, { action: "keep" });
    expect(kept.status).toBe(200);
    expect(kept.body.data.status).toBe("dismissed");
    const rerun = await runDataQualityChecks(userId, NOW);
    expect(rerun).toMatchObject({ opened: 0, reopened: 0 });
    expect(await prisma.flight.count({ where: { userId } })).toBe(2);

    expect((await post(`/${flag.id}/undo`)).body.data.status).toBe("open");
  });

  it("keep answers every flag over the same copies, and undo restores them all", async () => {
    await seedFlights(userId);
    const third = await prisma.flight.create({
      data: { ...FLIGHT, userId, createdAt: new Date("2026-03-03T00:00:00Z") },
    });
    await runDataQualityChecks(userId, NOW);
    const flags = await listFlags(userId, { kind: "duplicate_candidate" });
    expect(flags).toHaveLength(2);
    const [one, other] = flags;

    await post(`/${one.id}/resolve`, { action: "keep" });
    expect(
      await prisma.dataQualityFlag.count({
        where: { userId, status: "open", kind: "duplicate_candidate" },
      })
    ).toBe(0);

    await post(`/${one.id}/undo`);
    const after = await prisma.dataQualityFlag.findMany({
      where: { id: { in: [one.id, other.id] } },
    });
    expect(after.map((f) => f.status)).toEqual(["open", "open"]);
    expect(third.id).toBeTruthy();
  });

  it("merge keeps the oldest flight, moves its document, companion and trip, deletes the copy", async () => {
    const { typed, mail, trip } = await seedFlights(userId);
    const document = await prisma.document.create({
      data: {
        userId,
        flightId: mail.id,
        storedName: "x.pdf",
        sizeBytes: 1,
        mimetype: "application/pdf",
        sha256: "0",
        format: "pdf",
      },
    });
    const companion = await prisma.companion.create({
      data: { userId, canonicalName: "ana", displayName: "Ana", searchName: "ana" },
    });
    await prisma.flightCompanion.create({
      data: { flightId: mail.id, companionId: companion.id, position: 0 },
    });
    await runDataQualityChecks(userId, NOW);
    const flag = await duplicateFlag(userId, "flight");

    const merged = await post(`/${flag.id}/resolve`, { action: "merge" });
    expect(merged.status).toBe(200);
    expect(merged.body.data).toMatchObject({
      status: "resolved",
      entityId: typed.id,
      undoUntil: null,
      actions: ["keep", "merge"],
    });
    // The flag moved onto the kept copy: each copy is named once, the removed
    // one included (UAT beta.29 listed the kept id twice).
    expect(merged.body.data.evidence).toMatchObject({ ids: [typed.id, mail.id], keptId: typed.id });

    expect(await prisma.flight.findUnique({ where: { id: mail.id } })).toBeNull();
    const kept = await prisma.flight.findUniqueOrThrow({ where: { id: typed.id } });
    expect(kept.tripId).toBe(trip.id);
    expect((await prisma.document.findUniqueOrThrow({ where: { id: document.id } })).flightId).toBe(
      typed.id
    );
    expect(await prisma.flightCompanion.count({ where: { flightId: typed.id } })).toBe(1);

    // Not undoable, and nothing to ask on the next run.
    expect((await post(`/${flag.id}/undo`)).body).toEqual({ error: "undoExpired" });
    expect(await runDataQualityChecks(userId, NOW)).toMatchObject({ opened: 0, open: 0 });
  });

  it("merge of a stay pair keeps the named copy and moves its document", async () => {
    const { first, second } = await seedStays(userId);
    const document = await prisma.document.create({
      data: {
        userId,
        lodgingStayId: first.id,
        storedName: "y.pdf",
        sizeBytes: 1,
        mimetype: "application/pdf",
        sha256: "0",
        format: "pdf",
      },
    });
    await runDataQualityChecks(userId, NOW);
    const flag = await duplicateFlag(userId, "lodging_stay");
    expect(flag.evidence).toMatchObject({ ids: [second.id, first.id], keptId: first.id });

    const res = await post(`/${flag.id}/resolve`, { action: "merge", keptId: second.id });
    expect(res.status).toBe(200);
    expect(await prisma.lodgingStay.findUnique({ where: { id: first.id } })).toBeNull();
    expect(
      (await prisma.document.findUniqueOrThrow({ where: { id: document.id } })).lodgingStayId
    ).toBe(second.id);
  });

  it("refuses a merge keeping a record outside the finding", async () => {
    await seedFlights(userId);
    await runDataQualityChecks(userId, NOW);
    const flag = await duplicateFlag(userId, "flight");
    const res = await post(`/${flag.id}/resolve`, {
      action: "merge",
      keptId: "00000000-0000-4000-8000-000000000000",
    });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalidAction", reason: "keptIdNotInFinding" });
  });

  it("refuses a merge with staleFinding when the copies no longer match, and deletes nothing", async () => {
    const { mail } = await seedFlights(userId);
    await runDataQualityChecks(userId, NOW);
    const flag = await duplicateFlag(userId, "flight");
    await prisma.flight.update({ where: { id: mail.id }, data: { flightNumber: "LH402" } });

    const res = await post(`/${flag.id}/resolve`, { action: "merge" });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "staleFinding" });
    expect(await prisma.flight.count({ where: { userId } })).toBe(2);
  });

  it("refuses an action on a flag that is already answered with staleFinding", async () => {
    await seedFlights(userId);
    await runDataQualityChecks(userId, NOW);
    const flag = await duplicateFlag(userId, "flight");
    await post(`/${flag.id}/dismiss`);
    expect((await post(`/${flag.id}/resolve`, { action: "merge" })).body).toEqual({
      error: "staleFinding",
    });
  });

  it("offers only keep for a duplicate rail ride", async () => {
    expect(
      (await import("../findingEvidence")).findingActionsOf("duplicate_candidate", "rail_journey")
    ).toEqual(["keep"]);
  });
});
