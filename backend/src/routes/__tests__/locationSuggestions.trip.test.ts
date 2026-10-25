import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { travTrackSwitches } from "../../services/travtrack/__tests__/switches";
import { suggestTrips } from "../../services/locationEvidence/trips/suggest";
import {
  AWAY,
  HOME_PERIOD,
  NOW,
  makeDatedTrip,
  makeTripUser,
  resetTripUser,
  setHomes,
  storeDay,
} from "../../services/locationEvidence/trips/__tests__/tripFixtures";

/**
 * Answering a trip question (TravTrack plan L4, through E4's protocol): a new
 * trip over the run's days, or an existing trip widened to hold them — each
 * re-checked against the history as it is now, published under the TravTrack
 * lock, idempotent through the entry the question names.
 */

const PREFIX = "location-suggestions-trip-";

beforeAll(() => {
  process.env.ENCRYPTION_KEY ??= "c".repeat(64);
});

describe("trip questions", () => {
  const switches = travTrackSwitches();
  let userId: string;
  let otherId: string;
  let cookie: string;

  const row = (id: string) => prisma.locationSuggestion.findUniqueOrThrow({ where: { id } });
  const accept = (id: string, body: object) =>
    request(app).post(`/api/v1/location-suggestions/${id}/accept`).set("Cookie", cookie).send(body);
  const reject = (id: string) =>
    request(app).post(`/api/v1/location-suggestions/${id}/reject`).set("Cookie", cookie).send({});
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
    otherId = await makeTripUser(`${PREFIX}b`);
    cookie = `auth_token=${generateToken(userId)}`;
  });

  beforeEach(async () => {
    await switches.set({ beta: true, config: true });
    await resetTripUser(userId);
    await prisma.userSettings.update({
      where: { userId },
      data: { locationProvider: "travtrack" },
    });
  });

  afterAll(async () => {
    await switches.restore();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("lists the question with days, countries and km — no position, no key", async () => {
    const trip = await makeDatedTrip(userId, "2026-10-12", "2026-10-14", "München");
    const id = await question();
    const res = await request(app)
      .get("/api/v1/location-suggestions?status=pending")
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    const [item] = res.body.data;
    expect(item).toMatchObject({
      id,
      kind: "trip",
      algorithm: { name: "trip", version: 1 },
      explanation: { code: "trip.extend", params: { days: 2, tripId: trip.id } },
      trip: {
        fromDay: "2026-10-10",
        toDay: "2026-10-11",
        days: 2,
        countries: ["DE"],
        tripId: trip.id,
        tripName: "München",
        aggregated: false,
      },
    });
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(String(AWAY.lat));
    expect(text).not.toContain((await row(id)).evidenceKey);
    expect(text).not.toContain("awayDays");
  });

  it("accept create makes one trip, twice the same", async () => {
    const id = await question();
    const first = await accept(id, { action: "create", name: "München" });
    expect(first.status).toBe(200);
    expect(first.body.data.status).toBe("accepted");
    const stored = await row(id);
    expect(stored).toMatchObject({ status: "accepted", acceptedEntryKind: "trip" });
    const trip = await prisma.trip.findUniqueOrThrow({ where: { id: stored.acceptedEntryId! } });
    expect(trip).toMatchObject({ userId, name: "München", status: "completed" });
    expect(trip.startDay?.toISOString().slice(0, 10)).toBe("2026-10-10");
    expect(trip.endDay?.toISOString().slice(0, 10)).toBe("2026-10-11");

    const again = await accept(id, { action: "create", name: "Anders" });
    expect(again.status).toBe(200);
    expect(await prisma.trip.count({ where: { userId } })).toBe(1);
  });

  it("two concurrent accepts make one trip", async () => {
    const id = await question();
    const answers = await Promise.all([
      accept(id, { action: "create", name: "München" }),
      accept(id, { action: "create", name: "München" }),
    ]);
    // The second either replays the first or is told to retry: never a second trip.
    for (const a of answers) expect([200, 409]).toContain(a.status);
    expect(answers.some((a) => a.status === 200)).toBe(true);
    expect(await prisma.trip.count({ where: { userId } })).toBe(1);
  });

  it("accept extend widens only the dates", async () => {
    const trip = await makeDatedTrip(userId, "2026-10-12", "2026-10-14", "München");
    await prisma.trip.update({
      where: { id: trip.id },
      data: { endZone: "Europe/Berlin", notes: "Oktoberfest", countries: ["DE"] },
    });
    const id = await question();
    const res = await accept(id, { action: "extend", tripId: trip.id });
    expect(res.status).toBe(200);
    const after = await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } });
    expect(after.startDay?.toISOString().slice(0, 10)).toBe("2026-10-10");
    expect(after.startDate?.toISOString()).toBe("2026-10-10T00:00:00.000Z");
    // The end the run does not move keeps its day and its zone; nothing else changes.
    expect(after.endDay?.toISOString().slice(0, 10)).toBe("2026-10-14");
    expect(after.endZone).toBe("Europe/Berlin");
    expect(after).toMatchObject({ name: "München", notes: "Oktoberfest", countries: ["DE"] });
    expect((await row(id)).acceptedEntryId).toBe(trip.id);
  });

  it("another account's trip is refused, and the question stays", async () => {
    const theirs = await makeDatedTrip(otherId, "2026-10-12", "2026-10-14");
    const id = await question();
    const res = await accept(id, { action: "extend", tripId: theirs.id });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_FAILED");
    expect((await row(id)).status).toBe("pending");
    await prisma.trip.delete({ where: { id: theirs.id } });
  });

  it("a body of another kind is refused", async () => {
    const id = await question();
    expect((await accept(id, { verdict: "visited" })).status).toBe(400);
    expect((await accept(id, { action: "create", name: "  " })).status).toBe(400);
    expect((await row(id)).status).toBe("pending");
  });

  it("a rejected run is not asked again", async () => {
    const id = await question();
    const res = await reject(id);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("rejected");
    await suggestTrips(userId, { nowMs: NOW });
    expect(await prisma.locationSuggestion.count({ where: { userId, kind: "trip" } })).toBe(1);
  });

  it("TravTrack off → accept 403 and the question stays; reject still works", async () => {
    const id = await question();
    await switches.set({ beta: true, config: false });
    const res = await accept(id, { action: "create", name: "München" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("TRAVTRACK_DISABLED");
    expect((await row(id)).status).toBe("pending");
    expect(await prisma.trip.count({ where: { userId } })).toBe(0);
    expect((await reject(id)).status).toBe(200);
  });

  it("away days that no longer hold → 409 EVIDENCE_INVALIDATED, committed", async () => {
    const id = await question();
    // The user now says they lived in Munich then: those days were at home.
    await setHomes(userId, [{ ...HOME_PERIOD, residence: { name: "München", ...AWAY } }]);
    const res = await accept(id, { action: "create", name: "München" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("EVIDENCE_INVALIDATED");
    expect((await row(id)).status).toBe("invalidated");
    expect(await prisma.trip.count({ where: { userId } })).toBe(0);
  });

  it("no confirmed residence at accept → unverifiable, the question stays open", async () => {
    const id = await question();
    await setHomes(userId, [{ ...HOME_PERIOD, residenceConfirmed: false }]);
    const res = await accept(id, { action: "create", name: "München" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("EVIDENCE_UNVERIFIABLE");
    expect((await row(id)).status).toBe("pending");
  });

  it("deleting the run's points removes the open question", async () => {
    const id = await question();
    const res = await request(app)
      .delete("/api/v1/travtrack/points?fromDay=2026-10-10&toDay=2026-10-11")
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(await prisma.locationSuggestion.findUnique({ where: { id } })).toBeNull();
    expect((await accept(id, { action: "create", name: "München" })).status).toBe(404);
  });

  it("another account's question is not found", async () => {
    const id = await question();
    const res = await request(app)
      .post(`/api/v1/location-suggestions/${id}/accept`)
      .set("Cookie", `auth_token=${generateToken(otherId)}`)
      .send({ action: "create", name: "x" });
    expect(res.status).toBe(404);
  });
});
