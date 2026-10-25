import { prisma } from "../../../../db";
import { deleteTravTrackRange } from "../../../travtrack/deleteRange";
import { travTrackSwitches } from "../../../travtrack/__tests__/switches";
import { bumpHistoryGeneration } from "../../generation";
import { parseTripEvidence } from "../evidence";
import { suggestTrips } from "../suggest";
import {
  ABROAD,
  AWAY,
  HOME,
  HOME_PERIOD,
  NOW,
  makeDatedTrip,
  makeTripUser,
  resetTripUser,
  setHomes,
  storeDay,
  storeSpan,
} from "./tripFixtures";

/**
 * Trip inference (TravTrack plan L4): an away-from-home period TravTrack saw
 * that no trip holds becomes a question — nightly over the last 60 days only,
 * at most three new per run (the rest aggregated), published under the
 * TravTrack lock with the history generation the read captured.
 */

const PREFIX = "trip-suggest-";

beforeAll(() => {
  process.env.ENCRYPTION_KEY ??= "c".repeat(64);
});

describe("suggestTrips", () => {
  const switches = travTrackSwitches();
  let userId: string;

  const rows = () =>
    prisma.locationSuggestion.findMany({
      where: { userId, kind: "trip" },
      orderBy: { windowFrom: "asc" },
    });
  const away = async (days: string[], at = AWAY) => {
    for (const d of days) await storeDay(userId, d, at);
  };

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    userId = await makeTripUser(`${PREFIX}a`);
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

  it("three days > 50 km from the confirmed home are one away run, and one question", async () => {
    await storeDay(userId, "2026-10-09", HOME);
    await away(["2026-10-10", "2026-10-11"]);
    await away(["2026-10-12"], ABROAD);
    await storeDay(userId, "2026-10-13", HOME);

    expect(await suggestTrips(userId, { nowMs: NOW })).toMatchObject({
      status: "done",
      created: 1,
    });
    const [row] = await rows();
    expect(row).toMatchObject({ provider: "travtrack", status: "pending", algorithm: 1 });
    expect(row.explanation).toEqual({
      code: "trip.away",
      params: { days: 3, km: expect.any(Number) },
    });
    const evidence = parseTripEvidence(row.evidence)!;
    expect(evidence).toMatchObject({
      fromDay: "2026-10-10",
      toDay: "2026-10-12",
      zone: "Europe/Berlin",
      countries: ["AT", "DE"],
      tripId: null,
      aggregated: false,
    });
    // Pinless: no position, no digest anywhere in the row.
    const text = JSON.stringify(row.evidence);
    expect(text).not.toContain(String(AWAY.lat));
    expect(text).not.toContain("igest");
    // The window is the span's local days.
    expect(row.windowFrom.toISOString()).toBe("2026-10-09T22:00:00.000Z");
    expect(row.windowUntil.toISOString()).toBe("2026-10-12T22:00:00.000Z");
  });

  it("a run covered by a trip → none; touching its edge → extend", async () => {
    await away(["2026-10-10", "2026-10-11"]);
    await makeDatedTrip(userId, "2026-10-09", "2026-10-12");
    expect(await suggestTrips(userId, { nowMs: NOW })).toMatchObject({ created: 0 });

    await away(["2026-10-15", "2026-10-16"]);
    const trip = await makeDatedTrip(userId, "2026-10-17", "2026-10-20", "Wien");
    expect(await suggestTrips(userId, { nowMs: NOW })).toMatchObject({ created: 1 });
    const [row] = await rows();
    expect(row.explanation).toEqual({
      code: "trip.extend",
      params: { days: 2, km: expect.any(Number), tripId: trip.id },
    });
    expect(parseTripEvidence(row.evidence)).toMatchObject({
      fromDay: "2026-10-15",
      toDay: "2026-10-16",
      tripId: trip.id,
    });
  });

  it("at most three new per run, the rest aggregated", async () => {
    await away(["2026-10-01", "2026-10-02"]);
    await away(["2026-10-05", "2026-10-06"]);
    await away(["2026-10-09", "2026-10-10"]);
    await away(["2026-10-13", "2026-10-14"]);
    await away(["2026-10-17", "2026-10-18"]);

    expect(await suggestTrips(userId, { nowMs: NOW })).toMatchObject({
      created: 5,
      aggregated: 2,
    });
    const flags = (await rows()).map((r) => [
      parseTripEvidence(r.evidence)!.fromDay,
      parseTripEvidence(r.evidence)!.aggregated,
    ]);
    // The newest three are cards; the older ones wait in the aggregate entry.
    expect(flags).toEqual([
      ["2026-10-01", true],
      ["2026-10-05", true],
      ["2026-10-09", false],
      ["2026-10-13", false],
      ["2026-10-17", false],
    ]);
    // A second run makes no new card from what is asked already.
    expect(await suggestTrips(userId, { nowMs: NOW })).toMatchObject({ created: 0 });
  });

  it("a rejected run is not asked again", async () => {
    await away(["2026-10-10", "2026-10-11"]);
    await suggestTrips(userId, { nowMs: NOW });
    await prisma.locationSuggestion.updateMany({ where: { userId }, data: { status: "rejected" } });
    expect(await suggestTrips(userId, { nowMs: NOW })).toMatchObject({ created: 0, grown: 0 });
    // Not even when it turns out longer.
    await away(["2026-10-12"]);
    expect(await suggestTrips(userId, { nowMs: NOW })).toMatchObject({ created: 0, grown: 0 });
    expect(await rows()).toHaveLength(1);
  });

  it("a pending question grows while the run goes on", async () => {
    await away(["2026-10-22", "2026-10-23"]);
    await suggestTrips(userId, { nowMs: NOW - 86_400_000 });
    await away(["2026-10-24"]);
    expect(await suggestTrips(userId, { nowMs: NOW })).toMatchObject({ created: 0, grown: 1 });
    const all = await rows();
    expect(all).toHaveLength(1);
    expect(parseTripEvidence(all[0].evidence)).toMatchObject({
      fromDay: "2026-10-22",
      toDay: "2026-10-24",
    });
    expect(all[0].explanation).toMatchObject({ params: { days: 3 } });
  });

  it("only the last 60 finished days are read, and today is not asked about", async () => {
    await away(["2026-08-10", "2026-08-11"]);
    await away(["2026-10-24", "2026-10-25"]);
    expect(await suggestTrips(userId, { nowMs: NOW })).toMatchObject({ created: 0 });
  });

  it("finished days are the residence's, not the profile's: a Honolulu day still running is not asked", async () => {
    const HONOLULU = { lat: 21.31, lon: -157.86 };
    const HILO = { lat: 19.72, lon: -155.08 };
    await setHomes(userId, [{ ...HOME_PERIOD, residence: { name: "Honolulu", ...HONOLULU } }]);
    // Away on the Honolulu days of the 23rd and the 24th, 06:00–23:00 HST.
    for (const d of ["2026-10-23", "2026-10-24"]) {
      const start = Date.parse(`${d}T16:00:00Z`);
      await storeSpan(userId, start, start + 17 * 3_600_000, HILO);
    }
    // 04:25 UTC on the 25th: Berlin (the profile) is on the 25th, Honolulu
    // still on the 24th — which is not over, so only the 23rd is finished.
    const at = Date.parse("2026-10-25T04:25:00Z");
    expect(await suggestTrips(userId, { nowMs: at })).toMatchObject({ created: 0 });
    // A day later both days are over: one question.
    expect(await suggestTrips(userId, { nowMs: at + 86_400_000 })).toMatchObject({ created: 1 });
  });

  it("no confirmed residence → no questions", async () => {
    await away(["2026-10-10", "2026-10-11"]);
    await setHomes(userId, [{ ...HOME_PERIOD, residenceConfirmed: false }]);
    expect(await suggestTrips(userId, { nowMs: NOW })).toMatchObject({
      status: "skipped",
      reason: "noResidence",
    });
    expect(await rows()).toHaveLength(0);
  });

  it("TravTrack off → nothing runs; provider dawarich → none", async () => {
    await away(["2026-10-10", "2026-10-11"]);
    await switches.set({ beta: true, config: false });
    expect(await suggestTrips(userId, { nowMs: NOW })).toMatchObject({
      status: "skipped",
      reason: "disabled",
    });
    await switches.set({ beta: true, config: true });
    await prisma.userSettings.update({ where: { userId }, data: { locationProvider: "dawarich" } });
    expect(await suggestTrips(userId, { nowMs: NOW })).toMatchObject({
      status: "skipped",
      reason: "providerOff",
    });
    expect(await rows()).toHaveLength(0);
  });

  it("a removal while it read publishes nothing", async () => {
    await away(["2026-10-10", "2026-10-11"]);
    const result = await suggestTrips(userId, {
      nowMs: NOW,
      hooks: {
        afterRead: () => prisma.$transaction((tx) => bumpHistoryGeneration(tx, userId)),
      },
    });
    expect(result.status).toBe("stale");
    expect(await rows()).toHaveLength(0);
  });

  it("deleting the run's points removes the open question; an accepted one stays", async () => {
    await away(["2026-10-10", "2026-10-11"]);
    await away(["2026-10-15", "2026-10-16"]);
    await suggestTrips(userId, { nowMs: NOW });
    const [first, second] = await rows();
    await prisma.locationSuggestion.update({
      where: { id: second.id },
      data: { status: "accepted", acceptedEntryKind: "trip", acceptedEntryId: "t-1" },
    });
    await deleteTravTrackRange(
      userId,
      new Date("2026-10-10T00:00:00Z"),
      new Date("2026-10-17T00:00:00Z")
    );
    expect(await prisma.locationSuggestion.findUnique({ where: { id: first.id } })).toBeNull();
    const kept = await prisma.locationSuggestion.findUniqueOrThrow({ where: { id: second.id } });
    expect(kept.status).toBe("accepted");
    // Its span stays; nothing else of the deleted history does.
    expect(kept.evidence).toMatchObject({ fromDay: "2026-10-15", toDay: "2026-10-16" });
    expect(kept.evidence).not.toHaveProperty("countries");
    expect(kept.evidence).not.toHaveProperty("km");
    expect(kept.evidence).toHaveProperty("historyDeletedAt");
    // The distance from home was measured on the deleted history; the span stays.
    expect(kept.explanation).toEqual({ code: "trip.away", params: { days: 2 } });
  });
});
