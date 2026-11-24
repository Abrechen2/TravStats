import { readFileSync } from "fs";
import { join } from "path";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { travTrackSwitches } from "../../services/travtrack/__tests__/switches";
import { suggestTrips } from "../../services/locationEvidence/trips/suggest";
import {
  AWAY,
  NOW,
  makeDatedTrip,
  makeTripUser,
  resetTripUser,
  storeDay,
} from "../../services/locationEvidence/trips/__tests__/tripFixtures";

/**
 * Trip suggestions v2 across both former engines (owner 2026-11-23: a rejected
 * proposal and the off switch must never nag): one gate, one decision table,
 * one stream with at most three open cards, and a reset.
 */

const PREFIX = "trip-suggest-v2-";

beforeAll(() => {
  process.env.ENCRYPTION_KEY ??= "c".repeat(64);
});

describe("trip suggestions v2 — TravTrack questions in the one stream", () => {
  const switches = travTrackSwitches();
  let userId: string;
  let cookie: string;

  const pendingTripIds = async () => {
    const res = await request(app)
      .get("/api/v1/location-suggestions?status=pending")
      .set("Cookie", cookie)
      .expect(200);
    return (res.body.data as { id: string; kind: string }[])
      .filter((r) => r.kind === "trip")
      .map((r) => r.id);
  };
  const count = async () =>
    (await request(app).get("/api/v1/trip-suggestions/count").set("Cookie", cookie).expect(200))
      .body.data.count as number;
  const setEnabled = (on: boolean) =>
    prisma.userSettings.update({ where: { userId }, data: { tripSuggestionsEnabled: on } });
  /** Away on the 10th and 11th, then asked. */
  const question = async () => {
    await storeDay(userId, "2026-10-10", AWAY);
    await storeDay(userId, "2026-10-11", AWAY);
    await suggestTrips(userId, { nowMs: NOW });
    return (await prisma.locationSuggestion.findFirstOrThrow({ where: { userId, kind: "trip" } }))
      .id;
  };

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    userId = await makeTripUser(`${PREFIX}a`);
    cookie = `auth_token=${generateToken(userId)}`;
  });

  beforeEach(async () => {
    await switches.set({ beta: true, config: true });
    await resetTripUser(userId);
    await prisma.tripSuggestionDecision.deleteMany({ where: { userId } });
    await prisma.userSettings.update({
      where: { userId },
      data: { locationProvider: "travtrack", tripSuggestionsEnabled: true },
    });
  });

  afterAll(async () => {
    await switches.restore();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("switched off: the sweep asks nothing and existing questions are hidden, not deleted", async () => {
    const id = await question();
    expect(await pendingTripIds()).toEqual([id]);
    expect(await count()).toBe(1);

    await setEnabled(false);
    await storeDay(userId, "2026-10-15", AWAY);
    await storeDay(userId, "2026-10-16", AWAY);
    expect(await suggestTrips(userId, { nowMs: NOW })).toMatchObject({
      status: "skipped",
      reason: "tripSuggestionsOff",
    });
    expect(await pendingTripIds()).toEqual([]);
    expect(await count()).toBe(0);
    expect((await prisma.locationSuggestion.findUniqueOrThrow({ where: { id } })).status).toBe(
      "pending"
    );
    await request(app)
      .post(`/api/v1/location-suggestions/${id}/reject`)
      .set("Cookie", cookie)
      .send({})
      .expect(409);

    await setEnabled(true);
    expect(await pendingTripIds()).toEqual([id]);
  });

  it("a rejection lands in the shared decision table with its days, and a grown period stays quiet", async () => {
    const id = await question();
    await request(app)
      .post(`/api/v1/location-suggestions/${id}/reject`)
      .set("Cookie", cookie)
      .send({})
      .expect(200);
    const decision = await prisma.tripSuggestionDecision.findFirstOrThrow({ where: { userId } });
    expect(decision).toMatchObject({ status: "dismissed", source: "travtrack", kind: "new_trip" });
    expect(decision.startDay?.toISOString().slice(0, 10)).toBe("2026-10-10");
    expect(decision.endDay?.toISOString().slice(0, 10)).toBe("2026-10-11");

    // The period grows by a day and shifts its start: still not asked.
    await storeDay(userId, "2026-10-09", AWAY);
    await storeDay(userId, "2026-10-12", AWAY);
    await suggestTrips(userId, { nowMs: NOW });
    expect(await pendingTripIds()).toEqual([]);
    expect(await count()).toBe(0);
  });

  it("stores the residence a TravTrack rejection was judged against", async () => {
    const id = await question();
    await request(app)
      .post(`/api/v1/location-suggestions/${id}/reject`)
      .set("Cookie", cookie)
      .send({})
      .expect(200);
    const decision = await prisma.tripSuggestionDecision.findFirstOrThrow({ where: { userId } });
    expect(decision.homeSignature).toBe("50.11,8.68");
  });

  describe("the sweep re-asks once over a rejected period grown past double", () => {
    const rejectAndAge = async () => {
      const id = await question(); // 10-10..10-11, two days
      await request(app)
        .post(`/api/v1/location-suggestions/${id}/reject`)
        .set("Cookie", cookie)
        .send({})
        .expect(200);
      // Answered well before the sweep's day: the quiet period is over.
      await prisma.$executeRaw`UPDATE trip_suggestion_decisions SET updated_at = '2026-10-01' WHERE user_id = ${userId}`;
      return id;
    };

    it("reopens the rejected row, flagged expanded, when the run keeps its first day", async () => {
      const id = await rejectAndAge();
      for (const day of ["2026-10-12", "2026-10-13", "2026-10-14"])
        await storeDay(userId, day, AWAY);
      await suggestTrips(userId, { nowMs: NOW });
      const row = await prisma.locationSuggestion.findUniqueOrThrow({ where: { id } });
      expect(row.status).toBe("pending");
      expect(row.evidence).toMatchObject({
        fromDay: "2026-10-10",
        toDay: "2026-10-14",
        expanded: true,
      });
      const res = await request(app)
        .get("/api/v1/location-suggestions?status=pending")
        .set("Cookie", cookie)
        .expect(200);
      expect(res.body.data.find((r: { id: string }) => r.id === id)?.trip.expanded).toBe(true);
      expect(await count()).toBe(1);

      // Rejected again: the decision now covers the larger span and says so.
      await request(app)
        .post(`/api/v1/location-suggestions/${id}/reject`)
        .set("Cookie", cookie)
        .send({})
        .expect(200);
      const decision = await prisma.tripSuggestionDecision.findFirstOrThrow({ where: { userId } });
      expect(decision.expanded).toBe(true);
      expect(decision.endDay?.toISOString().slice(0, 10)).toBe("2026-10-14");
    });

    it("asks a new expanded question when the grown run starts earlier", async () => {
      await rejectAndAge();
      for (const day of ["2026-10-07", "2026-10-08", "2026-10-09"])
        await storeDay(userId, day, AWAY);
      await suggestTrips(userId, { nowMs: NOW });
      const ids = await pendingTripIds();
      expect(ids).toHaveLength(1);
      const row = await prisma.locationSuggestion.findUniqueOrThrow({ where: { id: ids[0] } });
      expect(row.evidence).toMatchObject({ fromDay: "2026-10-07", expanded: true });
    });

    it("stays quiet inside the quiet period, even grown past double", async () => {
      const id = await question();
      await request(app)
        .post(`/api/v1/location-suggestions/${id}/reject`)
        .set("Cookie", cookie)
        .send({})
        .expect(200);
      await prisma.$executeRaw`UPDATE trip_suggestion_decisions SET updated_at = '2026-10-20' WHERE user_id = ${userId}`;
      for (const day of ["2026-10-12", "2026-10-13", "2026-10-14"])
        await storeDay(userId, day, AWAY);
      await suggestTrips(userId, { nowMs: NOW });
      expect((await prisma.locationSuggestion.findUniqueOrThrow({ where: { id } })).status).toBe(
        "rejected"
      );
    });
  });

  it("hides a question whose days an existing trip came to cover", async () => {
    await question();
    await makeDatedTrip(userId, "2026-10-10", "2026-10-11");
    expect(await pendingTripIds()).toEqual([]);
    expect(await count()).toBe(0);
  });

  it("hides a question a dateless trip holds through its linked entries", async () => {
    await question();
    await prisma.userSettings.update({
      where: { userId },
      data: { enabledDomains: ["flight", "lodging"] },
    });
    const trip = await prisma.trip.create({ data: { userId, name: "Ohne Daten" } });
    const lodging = await prisma.lodging.create({
      data: { userId, name: "Hotel", city: "München", lat: AWAY.lat, lon: AWAY.lon },
    });
    await prisma.lodgingStay.create({
      data: {
        userId,
        lodgingId: lodging.id,
        tripId: trip.id,
        checkIn: new Date("2026-10-10T00:00:00Z"),
        checkOut: new Date("2026-10-12T00:00:00Z"),
      },
    });
    try {
      expect(await pendingTripIds()).toEqual([]);
    } finally {
      await prisma.lodgingStay.deleteMany({ where: { userId } });
      await prisma.lodging.deleteMany({ where: { userId } });
      await prisma.userSettings.update({ where: { userId }, data: { enabledDomains: ["flight"] } });
    }
  });

  it("opens at most three cards, and the badge says three", async () => {
    const evidence = (from: string, to: string) => ({
      source: "travtrack",
      fromDay: from,
      toDay: to,
      zone: "Europe/Berlin",
      awayDays: [from, to],
      countries: ["DE"],
      km: 300,
      tripId: null,
      aggregated: false,
      readCoverage: "complete",
    });
    await prisma.locationSuggestion.createMany({
      data: ["01", "03", "05", "07"].map((d) => ({
        userId,
        kind: "trip",
        provider: "travtrack",
        providerRev: 1,
        algorithm: 1,
        evidenceKey: `v2-cap-${d}`,
        windowFrom: new Date(`2026-09-${d}T00:00:00Z`),
        windowUntil: new Date(`2026-09-${d}T23:00:00Z`),
        explanation: { code: "trip.away", params: { days: 2, km: 300 } },
        evidence: evidence(`2026-09-${d}`, `2026-09-${String(Number(d) + 1).padStart(2, "0")}`),
      })),
    });
    expect(await pendingTripIds()).toHaveLength(3);
    expect(await count()).toBe(3);
  });

  it("reset forgets every rejection, and the period may be asked again", async () => {
    const id = await question();
    await request(app)
      .post(`/api/v1/location-suggestions/${id}/reject`)
      .set("Cookie", cookie)
      .send({})
      .expect(200);
    const res = await request(app)
      .post("/api/v1/trip-suggestions/rejections/reset")
      .set("Cookie", cookie)
      .expect(200);
    expect(res.body.data.reset).toBe(1);
    expect(await prisma.tripSuggestionDecision.count({ where: { userId } })).toBe(0);
    await suggestTrips(userId, { nowMs: NOW });
    expect(await pendingTripIds()).toHaveLength(1);
  });
});

describe("migration 20261123211841_trip_suggestions_v2 — answered TravTrack questions", () => {
  const sql = readFileSync(
    join(__dirname, "../../../prisma/migrations/20261123211841_trip_suggestions_v2/migration.sql"),
    "utf8"
  );
  const insert = sql.slice(sql.indexOf("INSERT INTO"));
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: `${PREFIX}mig` } });
    userId = (await prisma.user.create({ data: { username: `${PREFIX}mig`, passwordHash: "x" } }))
      .id;
  });
  afterAll(() => prisma.user.deleteMany({ where: { username: `${PREFIX}mig` } }));

  it("copies a rejected and an accepted question with their days, keeps them valid, and is idempotent", async () => {
    const base = {
      userId,
      kind: "trip",
      provider: "travtrack",
      providerRev: 1,
      algorithm: 1,
      windowFrom: new Date("2026-08-01T00:00:00Z"),
      windowUntil: new Date("2026-08-03T00:00:00Z"),
      explanation: { code: "trip.away", params: {} },
    };
    await prisma.locationSuggestion.createMany({
      data: [
        {
          ...base,
          evidenceKey: "mig-r",
          status: "rejected",
          evidence: { fromDay: "2026-08-01", toDay: "2026-08-02", tripId: null },
        },
        {
          ...base,
          evidenceKey: "mig-a",
          status: "accepted",
          evidence: { fromDay: "2026-08-05", toDay: "2026-08-06", tripId: "t-1" },
        },
        {
          ...base,
          evidenceKey: "mig-p",
          status: "pending",
          evidence: { fromDay: "2026-08-09", toDay: "2026-08-10", tripId: null },
        },
      ],
    });
    await prisma.$executeRawUnsafe(insert);
    await prisma.$executeRawUnsafe(insert);
    const rows = await prisma.tripSuggestionDecision.findMany({
      where: { userId },
      orderBy: { fingerprint: "asc" },
    });
    expect(
      rows.map((r) => [
        r.fingerprint,
        r.kind,
        r.status,
        r.targetId,
        r.startDay?.toISOString().slice(0, 10),
      ])
    ).toEqual([
      ["travtrack:mig-a", "extend", "accepted", "t-1", "2026-08-05"],
      ["travtrack:mig-r", "new_trip", "dismissed", null, "2026-08-01"],
    ]);
    expect(rows.every((r) => r.source === "travtrack")).toBe(true);
  });
});
