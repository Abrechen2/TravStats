import { prisma } from "../../../../db";
import { utcMidnight } from "../../../countryDays/store";
import { setLocationProvider } from "../../../locationProvider/provider";
import { stayReviewSchema } from "../../../../schemas/dawarichStays";
import { acceptStay, rejectStay } from "../../../dawarich/stays/review";
import { recheckFinding } from "../../../locationEvidence/recheck";
import { markTravTrackDaysDirty, VISITS_BIT } from "../../dirtyDays";
import { makeUser, storePoint, wipeTravTrack } from "../../__tests__/fixtures";
import { travTrackSwitches } from "../../__tests__/switches";
import {
  clearVisitRetry,
  projectVisitSuggestions,
  rescanVisitDays,
  scheduledVisitSuggestions,
  visitRetryAfter,
  type VisitProjectionDeps,
} from "../project";
import type { VisitPick, VisitResolution } from "../resolve";

jest.mock("../../../../utils/achievements", () => ({
  recheckAchievements: jest.fn(async () => {}),
}));
jest.mock("../../../places/addressBackfill", () => ({
  completePlaceAddress: jest.fn(async () => {}),
}));

const PREFIX = "travtrack-visit-project-";
const DAY = "2026-11-10";
const NOW = new Date("2026-11-12T00:00:00Z");
const MIN = 60_000;
const FROM = Date.parse(`${DAY}T10:00:00Z`);
const SEOUL = { lat: 37.5665, lon: 126.978 };
const VENUE_AT = { lat: 37.5666, lon: 126.9781 };

const pick = (over: Partial<VisitPick> = {}): VisitPick => ({
  source: "osm",
  name: "McDonald's",
  ...VENUE_AT,
  placeId: null,
  osmRef: "way/1",
  type: "fast_food",
  category: "restaurant",
  isArea: true,
  resolved: "contains",
  distanceM: 14,
  alternatives: [
    { name: "McCafé", osmRef: "node/2", type: "cafe", distanceM: 9, foldedInto: "McDonald's" },
  ],
  ...over,
});
const picked = (over: Partial<VisitPick> = {}): VisitResolution => ({
  kind: "pick",
  lookedUp: true,
  pick: pick(over),
  lookup: { geocoder: "ok", venues: "ok" },
});

const review = (row: { lat: number; lon: number; startAt: Date; endAt: Date }, name: string) =>
  stayReviewSchema.parse({
    placeId: null,
    tripId: null,
    name,
    lat: row.lat,
    lon: row.lon,
    startAt: { local: "2026-11-10T19:00" },
    endAt: { local: "2026-11-10T19:25" },
  });

describe("projectVisitSuggestions", () => {
  const switches = travTrackSwitches();
  let userId: string;
  const resolveStop = jest.fn<Promise<VisitResolution>, [unknown, boolean]>();
  const deps = (more: VisitProjectionDeps = {}): VisitProjectionDeps => ({
    now: NOW,
    resolveStop: resolveStop as VisitProjectionDeps["resolveStop"],
    ...more,
  });

  /** A stand of `minutes` at `at`, one fix a minute. */
  async function stand(minutes: number, at = SEOUL, start = FROM) {
    for (let i = 0; i <= minutes; i++) await storePoint(userId, { t: start + i * MIN, ...at });
  }
  const dirty = (days = [DAY]) =>
    prisma.$transaction((tx) => markTravTrackDaysDirty(tx, userId, days));
  const rows = () =>
    prisma.dawarichStay.findMany({ where: { userId }, orderBy: { startAt: "asc" } });
  const done = async (day = DAY) =>
    ((
      await prisma.travTrackDirtyDay.findUniqueOrThrow({
        where: { userId_day: { userId, day: utcMidnight(day) } },
      })
    ).done &
      VISITS_BIT) !==
    0;

  beforeAll(async () => {
    process.env.ENCRYPTION_KEY ??= "c".repeat(64);
    userId = await makeUser(`${PREFIX}a`);
    await prisma.userSettings.create({
      data: { userId, data: {}, enabledDomains: ["poi"], locationProvider: "travtrack" },
    });
    await prisma.dawarichStayScan.create({ data: { userId, enabled: true } });
  });
  afterAll(async () => {
    await switches.restore();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
  });
  beforeEach(async () => {
    await switches.set({ beta: true, config: true });
    await setLocationProvider(userId, "travtrack");
    await prisma.userSettings.update({
      where: { userId },
      data: { enabledDomains: ["poi"], staySuggestionsEnabled: true, data: {} },
    });
    await prisma.trip.deleteMany({ where: { userId } });
    await prisma.dawarichStayScan.update({ where: { userId }, data: { enabled: true } });
    await prisma.dawarichStay.deleteMany({ where: { userId } });
    await prisma.placeVisit.deleteMany({ where: { userId } });
    await prisma.place.deleteMany({ where: { userId } });
    await prisma.travTrackStopDismissal.deleteMany({ where: { userId } });
    await wipeTravTrack([userId]);
    await prisma.travTrackDirtyDay.deleteMany({ where: { userId } });
    resolveStop.mockReset();
    resolveStop.mockResolvedValue(picked());
    clearVisitRetry();
  });

  it("a stop on a venue becomes a pending finding with the stop's evidence, the building and its sub-venue", async () => {
    await stand(25);
    await dirty();
    const r = await projectVisitSuggestions(userId, deps());
    expect(r).toMatchObject({ status: "done", created: 1, days: 1 });
    const [row] = await rows();
    expect(row).toMatchObject({
      status: "pending",
      provider: "travtrack",
      name: "McDonald's",
      lat: VENUE_AT.lat,
      lon: VENUE_AT.lon,
      placeId: null,
    });
    const ev = row.evidence as Record<string, any>;
    expect(ev.visit.durationMs).toBe(25 * MIN);
    expect(ev.visit.observedMs).toBe(25 * MIN);
    expect(ev.visit.venue).toMatchObject({
      osmRef: "way/1",
      category: "restaurant",
      resolved: "contains",
    });
    expect(ev.visit.alternatives[0].name).toBe("McCafé");
    expect(ev.explanation.code).toBe("stay.stop");
    expect(ev.zone).toBe("Asia/Seoul");
    expect(await done()).toBe(true);
  });

  it("exposes the stop duration so the minimum stop can be measured, and does not change it", async () => {
    await stand(16);
    await dirty();
    const r = await projectVisitSuggestions(userId, deps());
    expect(r.stopMinutes).toEqual([16]);
    // 16 minutes is below the stay detector's 20 and above STOP_MS (15): a stop, hence a suggestion.
    expect(r.created).toBe(1);
  });

  it("a known place becomes a visit of that place (the finding names it)", async () => {
    const place = await prisma.place.create({ data: { userId, name: "Mine", ...SEOUL } });
    resolveStop.mockResolvedValue(
      picked({
        source: "known",
        placeId: place.id,
        name: "Mine",
        ...SEOUL,
        osmRef: null,
        alternatives: [],
      })
    );
    await stand(25);
    await dirty();
    await projectVisitSuggestions(userId, deps());
    expect((await rows())[0]).toMatchObject({ placeId: place.id, name: "Mine" });
  });

  it("never asks twice about the same stop: a second run makes nothing and does not look again", async () => {
    await stand(25);
    await dirty();
    await projectVisitSuggestions(userId, deps());
    await dirty();
    resolveStop.mockClear();
    const r = await projectVisitSuggestions(userId, deps());
    expect(r.created).toBe(0);
    expect(r.known).toBe(1);
    expect(resolveStop).not.toHaveBeenCalled();
    expect(await rows()).toHaveLength(1);
  });

  it("a rejected stop never resurfaces, even re-derived with a later last fix, and keeps its coordinates", async () => {
    await stand(25);
    await dirty();
    await projectVisitSuggestions(userId, deps());
    const [first] = await rows();
    await rejectStay(userId, first.id);
    // The phone reports a few minutes more: the stop is a different span now.
    await storePoint(userId, { t: FROM + 30 * MIN, ...SEOUL });
    await dirty();
    resolveStop.mockClear();
    const r = await projectVisitSuggestions(userId, deps());
    expect(r.created).toBe(0);
    expect(resolveStop).not.toHaveBeenCalled();
    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      status: "rejected",
      sourceLat: SEOUL.lat,
      sourceLon: SEOUL.lon,
    });
  });

  it("a pending finding is extended when the same stop is read longer", async () => {
    await stand(20);
    await dirty();
    await projectVisitSuggestions(userId, deps());
    for (let i = 21; i <= 40; i++) await storePoint(userId, { t: FROM + i * MIN, ...SEOUL });
    await dirty();
    const r = await projectVisitSuggestions(userId, deps());
    expect(r.grown).toBe(1);
    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0].sourceEndAt.getTime()).toBe(FROM + 40 * MIN);
    expect((all[0].evidence as any).visit.durationMs).toBe(40 * MIN);
  });

  it("an accepted visit covers the stop: nothing is suggested twice", async () => {
    const place = await prisma.place.create({ data: { userId, name: "Mine", ...SEOUL } });
    await prisma.placeVisit.create({
      data: {
        userId,
        placeId: place.id,
        visitedAt: new Date(FROM),
        visitedAtUtc: new Date(FROM + 5 * MIN),
        visitedPrecision: "minute",
        visitedZone: "Asia/Seoul",
      },
    });
    await stand(25);
    await dirty();
    const r = await projectVisitSuggestions(userId, deps());
    expect(r).toMatchObject({ created: 0, covered: 1 });
  });

  it("suggests nothing inside a privacy zone: neither a stop in it nor a venue beside it", async () => {
    await prisma.travTrackPrivacyZone.create({
      data: { userId, name: "Home", ...VENUE_AT, radiusM: 10 },
    });
    // The venue lies inside the zone, the stop's own fixes 14 m outside it.
    await stand(25);
    await dirty();
    const r = await projectVisitSuggestions(userId, deps());
    expect(r.created).toBe(0);
    expect(r.skippedPrivate).toBe(1);
    expect(await rows()).toHaveLength(0);
  });

  it("a provider that did not answer leaves the day open and is reported by reason; the next run asks again", async () => {
    resolveStop.mockResolvedValueOnce({ kind: "failed", reason: "venues" });
    await stand(25);
    await dirty();
    const first = await projectVisitSuggestions(userId, deps());
    expect(first.failed).toEqual({ places: 0, venues: 1 });
    expect(first.created).toBe(0);
    // A day left open still cost its derivation: it counts against the tick's budget.
    expect(first.days).toBe(1);
    expect(await done()).toBe(false);
    const second = await projectVisitSuggestions(userId, deps());
    expect(second.created).toBe(1);
    expect(await done()).toBe(true);
  });

  it("the schedule waits after a failed lookup and says when it will ask again", async () => {
    resolveStop.mockResolvedValue({ kind: "failed", reason: "places" });
    await stand(25);
    await dirty();
    await scheduledVisitSuggestions(userId, deps());
    expect(visitRetryAfter(userId)).toBeGreaterThan(NOW.getTime());
    resolveStop.mockClear();
    const again = await scheduledVisitSuggestions(userId, deps());
    expect(again.status).toBe("skipped");
    expect(resolveStop).not.toHaveBeenCalled();
  });

  it("spends one lookup per stop and leaves the rest owed once the run's lookups are used", async () => {
    resolveStop.mockImplementation(async (_stop, allowLookup) =>
      allowLookup ? picked() : { kind: "deferred" }
    );
    await stand(25);
    await stand(25, { lat: 37.57, lon: 126.99 }, FROM + 3 * 60 * MIN);
    await dirty();
    const r = await projectVisitSuggestions(userId, deps({ maxLookups: 1 }));
    expect(r.created).toBe(1);
    expect(r.deferred).toBe(1);
    expect(await done()).toBe(false);
  });

  it("a venue that turns out to be an own place by its OSM id still spent its lookup (the cap holds)", async () => {
    const place = await prisma.place.create({
      data: { userId, name: "Golden Arches", ...VENUE_AT },
    });
    resolveStop.mockImplementation(async (_stop, allowLookup) =>
      allowLookup
        ? picked({ source: "known", placeId: place.id, name: place.name })
        : { kind: "deferred" }
    );
    await stand(25);
    await stand(25, { lat: 37.57, lon: 126.99 }, FROM + 3 * 60 * MIN);
    await dirty();
    const r = await projectVisitSuggestions(userId, deps({ maxLookups: 1 }));
    expect(r.created).toBe(1);
    expect(r.deferred).toBe(1);
  });

  it("a stop that named no venue is not looked up again on the next run, so the stops behind it get their turn", async () => {
    resolveStop.mockResolvedValue({ kind: "none", why: "noVenue" });
    await stand(25);
    await dirty();
    expect((await projectVisitSuggestions(userId, deps())).noVenue).toBe(1);
    resolveStop.mockClear();
    await dirty();
    const again = await projectVisitSuggestions(userId, deps());
    expect(again.noVenue).toBe(1);
    expect(resolveStop).not.toHaveBeenCalled();
  });

  it("'scan now' reopens a day under a new version, so a run already reading it cannot close it again", async () => {
    await dirty();
    const before = await prisma.travTrackDirtyDay.findUniqueOrThrow({
      where: { userId_day: { userId, day: utcMidnight(DAY) } },
    });
    await rescanVisitDays(userId, 5, deps());
    const after = await prisma.travTrackDirtyDay.findUniqueOrThrow({
      where: { userId_day: { userId, day: utcMidnight(DAY) } },
    });
    expect(after.version).toBeGreaterThan(before.version);
  });

  it("'scan now' reads the window it was asked for, not the oldest backlog", async () => {
    const old = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"];
    await dirty(old);
    await stand(25);
    await dirty();
    const r = await rescanVisitDays(userId, 3, deps());
    expect(r.created).toBe(1);
    expect(await done("2026-09-01")).toBe(false);
  });

  // 15:10 UTC on the scanned day is 00:10 the NEXT day in Seoul: the stop's own local day decides.
  const LATE = Date.parse(`${DAY}T15:10:00Z`);
  const inSeoul = (extra: object = {}) =>
    prisma.userSettings.update({
      where: { userId },
      data: { data: { display: { timezone: "Asia/Seoul" }, ...extra } },
    });

  it("a stop just after local midnight belongs to the trip that starts that local day, not the scanned UTC day", async () => {
    await inSeoul();
    const trip = await prisma.trip.create({
      data: {
        userId,
        name: "Seoul",
        startDate: new Date("2026-11-11T00:00:00Z"),
        endDate: new Date("2026-11-14T00:00:00Z"),
        startDay: new Date("2026-11-11T00:00:00Z"),
        endDay: new Date("2026-11-14T00:00:00Z"),
        startZone: "Asia/Seoul",
        endZone: "Asia/Seoul",
      },
    });
    await stand(25, SEOUL, LATE);
    await dirty();
    await projectVisitSuggestions(userId, deps());
    expect((await rows())[0].tripId).toBe(trip.id);
  });

  it("home suppression reads the stop's local day: a stop at the home that is confirmed from that local day is not a venue", async () => {
    await inSeoul({
      homePeriods: [
        {
          fromDate: "2026-11-11",
          toDate: null,
          residence: { name: "Jongno", lat: SEOUL.lat + 0.001, lon: SEOUL.lon },
          residenceConfirmed: true,
          airports: [{ code: "ICN", primary: true }],
        },
      ],
    });
    await stand(25, SEOUL, LATE);
    await dirty();
    const r = await projectVisitSuggestions(userId, deps());
    expect(r).toMatchObject({ created: 0, suppressed: 1 });
  });

  it("without the scan's consent nothing is asked, and the day is acknowledged unread", async () => {
    await prisma.dawarichStayScan.update({ where: { userId }, data: { enabled: false } });
    await stand(25);
    await dirty();
    const r = await projectVisitSuggestions(userId, deps());
    expect(r.status).toBe("paused");
    expect(resolveStop).not.toHaveBeenCalled();
    expect(await done()).toBe(true);
  });

  it("days older than the horizon are acknowledged unread", async () => {
    await stand(25);
    await dirty();
    const r = await projectVisitSuggestions(
      userId,
      deps({ now: new Date("2027-03-01T00:00:00Z") })
    );
    expect(r.created).toBe(0);
    expect(resolveStop).not.toHaveBeenCalled();
    expect(await done()).toBe(true);
  });

  it("history deleted under a read publishes nothing", async () => {
    await stand(25);
    await dirty();
    resolveStop.mockImplementationOnce(async () => {
      await prisma.$transaction(async (tx) => {
        const { bumpHistoryGeneration } = await import("../../../locationEvidence/generation");
        await bumpHistoryGeneration(tx, userId);
      });
      return picked();
    });
    const r = await projectVisitSuggestions(userId, deps());
    expect(r.interrupted).toBe(true);
    expect(await rows()).toHaveLength(0);
    expect(await done()).toBe(false);
  });

  it("'scan now' asks the last days again, whatever the schedule did", async () => {
    await stand(25);
    await dirty();
    await projectVisitSuggestions(
      userId,
      deps({ maxDays: 0 + 1, now: new Date("2027-03-01T00:00:00Z") })
    );
    expect(await rows()).toHaveLength(0);
    const r = await rescanVisitDays(userId, 30, deps({ now: new Date("2026-11-20T00:00:00Z") }));
    expect(r.created).toBe(1);
  });

  describe("accepting", () => {
    it("creates the place with the building's name, category, coordinates and OSM id, and a visit", async () => {
      await stand(25);
      await dirty();
      await projectVisitSuggestions(userId, deps());
      const [row] = await rows();
      await acceptStay(userId, row.id, review(row, row.name!));
      const place = await prisma.place.findFirstOrThrow({ where: { userId } });
      expect(place).toMatchObject({
        name: "McDonald's",
        category: "restaurant",
        externalRef: "osm:way/1",
        lat: VENUE_AT.lat,
      });
      expect(await prisma.placeVisit.count({ where: { userId, placeId: place.id } })).toBe(1);
    });

    it("a renamed place is the owner's own: no OSM id is carried over", async () => {
      await stand(25);
      await dirty();
      await projectVisitSuggestions(userId, deps());
      const [row] = await rows();
      await acceptStay(userId, row.id, review(row, "Lunch spot"));
      const place = await prisma.place.findFirstOrThrow({ where: { userId } });
      expect(place.externalRef).toBeNull();
    });
  });

  it("the accept re-check holds for a 16-minute stop, which the 20-minute stay detector would invalidate", async () => {
    await stand(16);
    await dirty();
    await projectVisitSuggestions(userId, deps());
    const [row] = await rows();
    const verdict = await recheckFinding(userId, row);
    expect(verdict.outcome).toBe("holds");
  });
});
