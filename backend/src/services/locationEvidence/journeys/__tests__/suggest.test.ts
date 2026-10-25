import { prisma } from "../../../../db";
import { travTrackSwitches } from "../../../travtrack/__tests__/switches";
import { bumpHistoryGeneration } from "../../generation";
import { parseJourneyEvidence } from "../evidence";
import { suggestJourneys } from "../suggest";
import {
  H,
  NOW,
  makeJourneyUser,
  morning,
  resetJourneyUser,
  ride,
  storeJourney,
} from "./journeyFixtures";

/**
 * Missing journeys (TravTrack plan E7): movement TravTrack saw that no ride,
 * crossing or roadtrip in the logbook holds becomes one question per local
 * day — bounded, privacy-cut, published under the TravTrack lock.
 */

const PREFIX = "journey-suggest-";

beforeAll(() => {
  process.env.ENCRYPTION_KEY ??= "c".repeat(64);
});

describe("suggestJourneys", () => {
  const switches = travTrackSwitches();
  let userId: string;

  const rows = () =>
    prisma.locationSuggestion.findMany({
      where: { userId, kind: "journey" },
      orderBy: { windowFrom: "asc" },
    });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    userId = await makeJourneyUser(`${PREFIX}a`);
  });

  beforeEach(async () => {
    await switches.set({ beta: true, config: true });
    await resetJourneyUser(userId);
    await prisma.userSettings.update({
      where: { userId },
      data: {
        locationProvider: "travtrack",
        enabledDomains: ["flight", "rail", "bus", "roadtrip"],
      },
    });
  });

  afterAll(async () => {
    await switches.restore();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("three runs on one day are one question", async () => {
    const day = "2026-10-20";
    await storeJourney(userId, morning(day));
    await storeJourney(userId, morning(day) + 4 * H, 10.5);
    await storeJourney(userId, morning(day) + 9 * H, 13);

    const result = await suggestJourneys(userId, { nowMs: NOW });
    expect(result).toMatchObject({ status: "done", created: 1 });

    const [row] = await rows();
    expect(row).toMatchObject({ provider: "travtrack", algorithm: 1, status: "pending" });
    const evidence = parseJourneyEvidence(row.evidence)!;
    expect(evidence.day).toBe(day);
    expect(evidence.zone).toBe("Europe/Berlin");
    expect(evidence.runs).toHaveLength(3);
    expect(evidence.runs.every((r) => r.state === "open" && r.pointDigests.length > 0)).toBe(true);
    // The explanation is a code and counts — never a position.
    expect(row.explanation).toEqual({
      code: "journey.unlogged",
      params: { runs: 3, km: expect.any(Number) },
    });
    expect(row.windowFrom.getTime()).toBe(evidence.runs[0].fromMs);
    expect(row.windowUntil.getTime()).toBe(evidence.runs[2].untilMs + 1);
  });

  it("a run covered by a rail ride, bus ride or roadtrip day is not suggested", async () => {
    const days = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22"];
    for (const d of days) await storeJourney(userId, morning(d));
    const t = (d: string) => morning(d) + 0.5 * H;
    await prisma.railJourney.create({ data: ride(userId, t(days[0]), t(days[0]) + 1.5 * H) });
    await prisma.busJourney.create({ data: ride(userId, t(days[1]), t(days[1]) + 1.5 * H) });
    await prisma.tripRoute.create({
      data: {
        userId,
        name: "Roadtrip",
        mode: "road",
        kind: "roadtrip",
        stops: {
          create: [
            { title: "A", routeOrderIdx: 0, startDate: new Date(`${days[2]}T00:00:00Z`) },
            { title: "B", routeOrderIdx: 1, startDate: new Date(`${days[2]}T00:00:00Z`) },
          ],
        },
      },
    });

    expect(await suggestJourneys(userId, { nowMs: NOW })).toMatchObject({ created: 1 });
    const [row] = await rows();
    expect(parseJourneyEvidence(row.evidence)!.day).toBe(days[3]);
  });

  it("the rail ride an answer linked does not cover its run on the next run", async () => {
    const day = "2026-10-20";
    await storeJourney(userId, morning(day));
    await storeJourney(userId, morning(day) + 4 * H, 10.5);
    await suggestJourneys(userId, { nowMs: NOW });
    const [row] = await rows();
    const evidence = parseJourneyEvidence(row.evidence)!;
    const run = evidence.runs[0];
    const own = await prisma.railJourney.create({ data: ride(userId, run.fromMs, run.untilMs) });
    const answered = {
      ...evidence,
      runs: evidence.runs.map((r, i) =>
        i === 0 ? { ...r, state: "linked", link: { entryKind: "rail", entryId: own.id } } : r
      ),
    };
    await prisma.locationSuggestion.update({ where: { id: row.id }, data: { evidence: answered } });

    expect(await suggestJourneys(userId, { nowMs: NOW })).toMatchObject({ created: 0 });
    const after = await rows();
    expect(after).toHaveLength(1);
    expect(after[0].status).toBe("pending");
    expect(after[0].evidence).toEqual(answered);
  });

  it("a day asked once is not asked again, and a rejected day neither", async () => {
    await storeJourney(userId, morning("2026-10-20"));
    await suggestJourneys(userId, { nowMs: NOW });
    expect(await suggestJourneys(userId, { nowMs: NOW })).toMatchObject({ created: 0 });
    await prisma.locationSuggestion.updateMany({ where: { userId }, data: { status: "rejected" } });
    // A later journey the same day changes the day's first run, not the answer.
    await storeJourney(userId, morning("2026-10-20") - 3 * H, 11);
    expect(await suggestJourneys(userId, { nowMs: NOW })).toMatchObject({ created: 0 });
    expect(await rows()).toHaveLength(1);
  });

  it("asks only about finished days inside the window", async () => {
    await storeJourney(userId, morning("2026-10-25")); // today
    await storeJourney(userId, morning("2026-10-16")); // before the window
    expect(await suggestJourneys(userId, { nowMs: NOW + 6 * H })).toMatchObject({ created: 0 });
  });

  it("no more than seven new per run, oldest first, the rest deferred", async () => {
    const days = Array.from({ length: 9 }, (_, i) => `2026-10-${String(14 + i).padStart(2, "0")}`);
    for (const d of days) await storeJourney(userId, morning(d));
    const result = await suggestJourneys(userId, { nowMs: NOW, windowDays: 11 });
    expect(result).toMatchObject({ created: 7, deferred: 2 });
    const asked = (await rows()).map((r) => parseJourneyEvidence(r.evidence)!.day);
    expect(asked).toEqual(days.slice(0, 7));
  });

  it("no questions when rail, bus and roadtrip are all disabled", async () => {
    await prisma.userSettings.update({
      where: { userId },
      data: { enabledDomains: ["flight", "lodging", "ferry"] },
    });
    await storeJourney(userId, morning("2026-10-20"));
    expect(await suggestJourneys(userId, { nowMs: NOW })).toMatchObject({
      status: "skipped",
      reason: "noJourneyDomains",
    });
    expect(await rows()).toHaveLength(0);
  });

  it("provider dawarich → none", async () => {
    await prisma.userSettings.update({ where: { userId }, data: { locationProvider: "dawarich" } });
    await storeJourney(userId, morning("2026-10-20"));
    expect(await suggestJourneys(userId, { nowMs: NOW })).toMatchObject({
      status: "skipped",
      reason: "providerOff",
    });
    expect(await rows()).toHaveLength(0);
  });

  it("TravTrack off → nothing runs", async () => {
    await switches.set({ beta: true, config: false });
    await storeJourney(userId, morning("2026-10-20"));
    expect(await suggestJourneys(userId, { nowMs: NOW })).toMatchObject({
      status: "skipped",
      reason: "disabled",
    });
    expect(await rows()).toHaveLength(0);
  });

  it("history deleted while it read: publishes nothing and says stale", async () => {
    await storeJourney(userId, morning("2026-10-20"));
    const result = await suggestJourneys(userId, {
      nowMs: NOW,
      hooks: {
        afterRead: () => prisma.$transaction((tx) => bumpHistoryGeneration(tx, userId)),
      },
    });
    expect(result).toMatchObject({ status: "stale", created: 0 });
    expect(await rows()).toHaveLength(0);
  });

  it("TravTrack switched off while it read: publishes nothing", async () => {
    await storeJourney(userId, morning("2026-10-20"));
    const result = await suggestJourneys(userId, {
      nowMs: NOW,
      hooks: { afterRead: () => switches.set({ beta: true, config: false }) },
    });
    expect(result).toMatchObject({ status: "skipped", reason: "disabled", created: 0 });
    expect(await rows()).toHaveLength(0);
  });
});
