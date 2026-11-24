import { prisma } from "../../../../db";
import { utcMidnight } from "../../../countryDays/store";
import { setLocationProvider } from "../../../locationProvider/provider";
import { stayReviewSchema } from "../../../../schemas/dawarichStays";
import { acceptStay, rejectStay } from "../../../dawarich/stays/review";
import { deleteSource } from "../../../calendar/sources";
import { markTravTrackDaysDirty, VISITS_BIT } from "../../dirtyDays";
import { makeUser, storePoint, wipeTravTrack } from "../../__tests__/fixtures";
import { travTrackSwitches } from "../../__tests__/switches";
import { clearVisitRetry, projectVisitSuggestions, type VisitProjectionDeps } from "../project";
import type { VisitResolution } from "../resolve";
import { clearCalendarGeocodeCache, type CalendarDay } from "../calendarMatch";
import { updatePolicy } from "../../../externalServices/policy";
import type { GeocodeOutcome } from "../../../geo/nominatim";

jest.mock("../../../../utils/achievements", () => ({
  recheckAchievements: jest.fn(async () => {}),
}));
jest.mock("../../../places/addressBackfill", () => ({
  completePlaceAddress: jest.fn(async () => {}),
}));

/**
 * The calendar as evidence for stops (spec 2026-11-23-plugins-and-calendar.md, P2):
 * a no-venue stop an event places becomes a finding, nothing of an unmatched event
 * is stored, a geocoder failure keeps the day owed, accepting writes the purpose,
 * and an answered finding keeps only the event's span.
 */
const PREFIX = "travtrack-visit-calendar-";
const DAY = "2026-11-10";
const NOW = new Date("2026-11-12T00:00:00Z");
const MIN = 60_000;
const FROM = Date.parse(`${DAY}T10:00:00Z`);
const AT = { lat: 37.5665, lon: 126.978 };
const VENUE = { lat: 37.5666, lon: 126.9781 };
const SECRET_TITLE = "Geheimtermin beim Arzt";

const noVenue: VisitResolution = { kind: "none", why: "noVenue" };
const venue: VisitResolution = {
  kind: "pick",
  lookedUp: true,
  lookup: { geocoder: "ok", venues: "ok" },
  pick: {
    source: "osm",
    name: "Bürohaus",
    ...VENUE,
    placeId: null,
    osmRef: "way/9",
    type: "office",
    category: "other",
    isArea: true,
    resolved: "contains",
    distanceM: 12,
    brand: null,
    alternatives: [],
  },
};

describe("projectVisitSuggestions with a calendar", () => {
  const switches = travTrackSwitches();
  let userId: string;
  let sourceId: string;
  const resolveStop = jest.fn<Promise<VisitResolution>, [unknown, boolean]>();
  const read = jest.fn<Promise<CalendarDay>, [string, { fromMs: number; untilMs: number }]>();
  const geocode = jest.fn<Promise<GeocodeOutcome>, [string]>();
  const deps: VisitProjectionDeps = {
    now: NOW,
    resolveStop: resolveStop as VisitProjectionDeps["resolveStop"],
    calendar: { read, geocode },
  };
  const event = (title: string, start: number, end: number, location: string | null) => ({
    sourceId,
    sourceLabel: "Arbeit",
    event: {
      uid: title,
      title,
      location,
      startMs: start,
      endMs: end,
      allDay: false,
      startDay: null,
      endDay: null,
    },
  });
  const day = (failed = 0): CalendarDay => ({
    failed,
    events: [
      event("WAR Musterfirma", FROM, FROM + 30 * MIN, "Musterstraße 5, Seoul"),
      event(SECRET_TITLE, FROM + 9 * 60 * MIN, FROM + 10 * 60 * MIN, "Praxis"),
    ],
  });
  const rows = () =>
    prisma.dawarichStay.findMany({ where: { userId }, orderBy: { startAt: "asc" } });
  const done = async () =>
    ((
      await prisma.travTrackDirtyDay.findUniqueOrThrow({
        where: { userId_day: { userId, day: utcMidnight(DAY) } },
      })
    ).done &
      VISITS_BIT) !==
    0;
  async function stand(minutes: number) {
    for (let i = 0; i <= minutes; i++) await storePoint(userId, { t: FROM + i * MIN, ...AT });
  }
  const dirty = () => prisma.$transaction((tx) => markTravTrackDaysDirty(tx, userId, [DAY]));
  const review = (row: { lat: number; lon: number; name: string | null }) =>
    stayReviewSchema.parse({
      placeId: null,
      tripId: null,
      name: row.name,
      lat: row.lat,
      lon: row.lon,
      startAt: { local: "2026-11-10T19:00" },
      endAt: { local: "2026-11-10T19:25" },
    });

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
      data: {
        enabledDomains: ["poi"],
        staySuggestionsEnabled: true,
        calendarGeocodeLocations: true,
      },
    });
    await prisma.travTrackPrivacyZone.deleteMany({ where: { userId } });
    clearCalendarGeocodeCache();
    await prisma.dawarichStay.deleteMany({ where: { userId } });
    await prisma.placeVisit.deleteMany({ where: { userId } });
    await prisma.place.deleteMany({ where: { userId } });
    await prisma.calendarRule.deleteMany({ where: { userId } });
    await prisma.calendarSource.deleteMany({ where: { userId } });
    await wipeTravTrack([userId]);
    await prisma.travTrackDirtyDay.deleteMany({ where: { userId } });
    sourceId = (
      await prisma.calendarSource.create({
        data: { userId, label: "Arbeit", kind: "ics", icsHost: "calendar.example.com" },
      })
    ).id;
    await prisma.calendarRule.create({
      data: {
        userId,
        position: 0,
        kind: "keyword",
        token: "WAR",
        matchMode: "startsWith",
        purpose: "business",
        nameTemplate: "{titleAfterToken}",
      },
    });
    resolveStop.mockReset();
    read.mockReset();
    geocode.mockReset();
    read.mockResolvedValue(day());
    geocode.mockResolvedValue({ coords: { lat: AT.lat + 0.0005, lon: AT.lon }, failed: false });
    clearVisitRetry();
    await stand(40);
    await dirty();
  });

  it("makes a no-venue stop a finding when an event places it, named and with a purpose by the rule", async () => {
    resolveStop.mockResolvedValue(noVenue);
    const r = await projectVisitSuggestions(userId, deps);
    expect(r).toMatchObject({ created: 1, calendarMatched: 1, failed: { calendar: 0 } });
    const [row] = await rows();
    expect(row).toMatchObject({ status: "pending", name: "Musterfirma" });
    expect(row.evidence).toMatchObject({
      suggestedPurpose: "business",
      createdFrom: "calendar",
      calendar: {
        sourceId,
        title: "WAR Musterfirma",
        match: "geocoded",
        timeMatch: "overlap",
        rule: { kind: "keyword", purpose: "business" },
      },
    });
    expect(await done()).toBe(true);
  });

  it("stores nothing of an event that matched no stop", async () => {
    resolveStop.mockResolvedValue(noVenue);
    await projectVisitSuggestions(userId, deps);
    const [{ hits }] = await prisma.$queryRaw<{ hits: bigint }[]>`
      SELECT count(*)::bigint AS hits FROM dawarich_stays WHERE evidence::text LIKE ${"%Geheimtermin%"}`;
    expect(Number(hits)).toBe(0);
    const tables = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name LIKE 'calendar%'`;
    // No event table: the feature's two tables and the (older, outbound) calendar feed.
    expect(tables.map((t) => t.table_name).sort()).toEqual([
      "calendar_feeds",
      "calendar_rules",
      "calendar_sources",
    ]);
  });

  it("keeps the day owed when the geocoder fails, instead of reading 'no match'", async () => {
    resolveStop.mockResolvedValue(noVenue);
    geocode.mockResolvedValue({ coords: null, failed: true });
    const r = await projectVisitSuggestions(userId, deps);
    expect(r).toMatchObject({ created: 0, failed: { calendar: 1 } });
    expect(await done()).toBe(false);
    // Asked again: the calendar answers now and the stop becomes its finding.
    geocode.mockResolvedValue({ coords: { lat: AT.lat, lon: AT.lon }, failed: false });
    expect(await projectVisitSuggestions(userId, deps)).toMatchObject({ created: 1 });
  });

  it("a source that could not be read leaves the venue finding, and adds its event on the next run", async () => {
    resolveStop.mockResolvedValue(venue);
    read.mockResolvedValue({ failed: 1, events: [] });
    expect(await projectVisitSuggestions(userId, deps)).toMatchObject({
      created: 1,
      failed: { calendar: 1 },
    });
    expect(await done()).toBe(false);
    read.mockResolvedValue(day());
    expect(await projectVisitSuggestions(userId, deps)).toMatchObject({
      known: 1,
      calendarMatched: 1,
    });
    const [row] = await rows();
    expect(row.name).toBe("Bürohaus");
    expect(row.evidence).toMatchObject({ calendar: { title: "WAR Musterfirma" } });
    expect(await done()).toBe(true);
  });

  it("removing the source strips its evidence from a venue finding, which stays", async () => {
    resolveStop.mockResolvedValue(venue);
    await projectVisitSuggestions(userId, deps);
    await deleteSource(userId, sourceId);
    const [row] = await rows();
    expect(row.name).toBe("Bürohaus");
    expect(row.evidence).not.toHaveProperty("calendar");
    expect(row.evidence).not.toHaveProperty("suggestedPurpose");
  });

  it("an event without a place is context only: it lends a purpose, never the place or the name", async () => {
    resolveStop.mockResolvedValue(venue);
    geocode.mockResolvedValue({ coords: { lat: 48.1, lon: 11.5 }, failed: false });
    await projectVisitSuggestions(userId, deps);
    const [row] = await rows();
    expect(row).toMatchObject({ name: "Bürohaus", lat: VENUE.lat, lon: VENUE.lon });
    expect(row.evidence).toMatchObject({
      suggestedPurpose: "business",
      calendar: { match: "context" },
    });
  });

  it("accepting writes the suggested purpose and keeps only the event's span", async () => {
    resolveStop.mockResolvedValue(noVenue);
    await projectVisitSuggestions(userId, deps);
    const [row] = await rows();
    await acceptStay(userId, row.id, review(row));
    const visit = await prisma.placeVisit.findFirstOrThrow({ where: { userId } });
    expect(visit.purpose).toBe("business");
    const [after] = await rows();
    expect((after.evidence as { calendar: object }).calendar).toEqual({
      sourceId,
      uidHash: expect.any(String),
      start: new Date(FROM).toISOString(),
      end: new Date(FROM + 30 * MIN).toISOString(),
    });
  });

  it("the dialog's purpose wins over the suggestion", async () => {
    resolveStop.mockResolvedValue(noVenue);
    await projectVisitSuggestions(userId, deps);
    const [row] = await rows();
    await acceptStay(userId, row.id, { ...review(row), purpose: "private" });
    expect((await prisma.placeVisit.findFirstOrThrow({ where: { userId } })).purpose).toBe(
      "private"
    );
  });

  it("an explicit 'unknown' in the dialog clears the purpose of the visit it lands on", async () => {
    resolveStop.mockResolvedValue(noVenue);
    await projectVisitSuggestions(userId, deps);
    const [first] = await rows();
    await acceptStay(userId, first.id, review(first));
    const accepted = await prisma.dawarichStay.findUniqueOrThrow({ where: { id: first.id } });
    // A second (Dawarich) finding of the same place and time reuses that visit.
    const second = await prisma.dawarichStay.create({
      data: {
        userId,
        fingerprint: "second",
        sourceStartAt: accepted.sourceStartAt,
        sourceEndAt: accepted.sourceEndAt,
        sourceLat: accepted.sourceLat,
        sourceLon: accepted.sourceLon,
        startAt: accepted.startAt,
        endAt: accepted.endAt,
        lat: accepted.lat,
        lon: accepted.lon,
        zone: accepted.zone,
        pointCount: 3,
        evidence: { suggestedPurpose: "business" },
        name: accepted.name,
        provider: "dawarich",
        providerRev: 0,
        algorithmVersion: 1,
      },
    });
    await acceptStay(userId, second.id, {
      ...review(accepted),
      placeId: accepted.placeId,
      purpose: null,
    });
    const visits = await prisma.placeVisit.findMany({ where: { userId } });
    expect(visits).toHaveLength(1);
    expect(visits[0].purpose).toBeNull();
  });

  it("rejecting keeps only the event's span", async () => {
    resolveStop.mockResolvedValue(noVenue);
    await projectVisitSuggestions(userId, deps);
    const [row] = await rows();
    await rejectStay(userId, row.id);
    const [after] = await rows();
    expect(JSON.stringify(after.evidence)).not.toContain("Musterfirma");
    expect(after.status).toBe("rejected");
    // The calendar made it: the name it took from the event's title goes as well.
    expect(after.name).toBeNull();
    expect(after.evidence).not.toHaveProperty("suggestedPurpose");
  });

  describe("geocoding event locations (security review)", () => {
    it("asks nothing while the account's switch is off (the default)", async () => {
      await prisma.userSettings.update({
        where: { userId },
        data: { calendarGeocodeLocations: false },
      });
      resolveStop.mockResolvedValue(noVenue);
      expect(await projectVisitSuggestions(userId, deps)).toMatchObject({ created: 0 });
      expect(geocode).not.toHaveBeenCalled();
    });

    it("still matches by the venue's name without geocoding", async () => {
      await prisma.userSettings.update({
        where: { userId },
        data: { calendarGeocodeLocations: false },
      });
      read.mockResolvedValue({
        failed: 0,
        events: [event("WAR Bürohaus-Termin", FROM, FROM + 30 * MIN, "Bürohaus, 2. OG")],
      });
      resolveStop.mockResolvedValue(venue);
      await projectVisitSuggestions(userId, deps);
      expect(geocode).not.toHaveBeenCalled();
      expect((await rows())[0].evidence).toMatchObject({ calendar: { match: "placeName" } });
    });

    it("asks only for an event a rule selected", async () => {
      await prisma.calendarRule.deleteMany({ where: { userId } });
      resolveStop.mockResolvedValue(noVenue);
      await projectVisitSuggestions(userId, deps);
      expect(geocode).not.toHaveBeenCalled();
    });

    it("asks nothing for a stop inside a privacy zone", async () => {
      await prisma.travTrackPrivacyZone.create({
        data: { userId, name: "Home", ...AT, radiusM: 200 },
      });
      resolveStop.mockResolvedValue(noVenue);
      expect(await projectVisitSuggestions(userId, deps)).toMatchObject({ created: 0 });
      expect(geocode).not.toHaveBeenCalled();
    });

    it("asks nothing while the admin switched the geocoder off", async () => {
      await updatePolicy((p) => ({ ...p, disabled: [...p.disabled, "geocoder"] }));
      try {
        resolveStop.mockResolvedValue(noVenue);
        await projectVisitSuggestions(userId, deps);
        expect(geocode).not.toHaveBeenCalled();
      } finally {
        await updatePolicy((p) => ({ ...p, disabled: p.disabled.filter((d) => d !== "geocoder") }));
      }
    });

    it("asks once per location: the answer is cached under a hash", async () => {
      resolveStop.mockResolvedValue(noVenue);
      geocode.mockResolvedValue({ coords: null, failed: false });
      await projectVisitSuggestions(userId, deps);
      await prisma.$executeRaw`UPDATE travtrack_dirty_days SET done = 0, version = version + 1 WHERE user_id = ${userId}`;
      await projectVisitSuggestions(userId, deps);
      expect(geocode).toHaveBeenCalledTimes(1);
    });
  });

  describe("what an answered finding keeps (trigger)", () => {
    it.each(["accepted", "rejected", "superseded", "covered", "invalidated"])(
      "a move to %s keeps only source, keyed UID and span",
      async (status) => {
        resolveStop.mockResolvedValue(noVenue);
        await projectVisitSuggestions(userId, deps);
        const [row] = await rows();
        await prisma.dawarichStay.update({ where: { id: row.id }, data: { status } });
        const [after] = await rows();
        expect(Object.keys((after.evidence as { calendar: object }).calendar).sort()).toEqual([
          "end",
          "sourceId",
          "start",
          "uidHash",
        ]);
        expect(after.evidence).not.toHaveProperty("suggestedPurpose");
        expect(after.name).toBe(status === "accepted" ? "Musterfirma" : null);
      }
    );

    it("an open finding keeps the whole event", async () => {
      resolveStop.mockResolvedValue(noVenue);
      await projectVisitSuggestions(userId, deps);
      await prisma.dawarichStay.updateMany({ where: { userId }, data: { status: "accepting" } });
      expect((await rows())[0].evidence).toMatchObject({ calendar: { title: "WAR Musterfirma" } });
    });

    it("removing the source strips the text from answered rows a past path left whole", async () => {
      resolveStop.mockResolvedValue(noVenue);
      await projectVisitSuggestions(userId, deps);
      await prisma.$executeRawUnsafe(
        "ALTER TABLE dawarich_stays DISABLE TRIGGER dawarich_stays_shrink_calendar"
      );
      try {
        await prisma.dawarichStay.updateMany({ where: { userId }, data: { status: "accepted" } });
      } finally {
        await prisma.$executeRawUnsafe(
          "ALTER TABLE dawarich_stays ENABLE TRIGGER dawarich_stays_shrink_calendar"
        );
      }
      expect((await rows())[0].evidence).toMatchObject({ calendar: { title: "WAR Musterfirma" } });
      await deleteSource(userId, sourceId);
      const text = JSON.stringify((await rows())[0].evidence);
      expect(text).not.toContain("Musterfirma");
      expect(text).not.toContain("Musterstraße");
      expect(text).not.toContain("Arbeit");
    });
  });

  it("removing the source removes its finding and its evidence on open findings", async () => {
    await prisma.calendarRule.create({
      data: { userId, position: 1, kind: "calendar", sourceId, purpose: "business" },
    });
    resolveStop.mockResolvedValueOnce(noVenue);
    await projectVisitSuggestions(userId, deps);
    expect(await rows()).toHaveLength(1);
    await deleteSource(userId, sourceId);
    expect(await rows()).toHaveLength(0);
    // The calendar rule of that source goes with it; the keyword rule names no source and stays.
    expect(await prisma.calendarRule.findMany({ where: { userId } })).toEqual([
      expect.objectContaining({ kind: "keyword" }),
    ]);
  });
});
