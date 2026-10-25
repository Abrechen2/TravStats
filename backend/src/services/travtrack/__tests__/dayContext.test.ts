import { prisma } from "../../../db";
import { AVAILABLE_DOMAINS, type DomainKey } from "../../../shared/domains";
import { ENTRY_WINDOW_ADAPTERS } from "../../locationEvidence/journeys/entryWindows";
import { dayContext, type DayContextEntry } from "../dayContext";
import { readSafeTravTrack } from "../readSafe";
import { makeUser, storePoint, wipeTravTrack } from "./fixtures";

/**
 * A day's labels (TravTrack plan E10): what TravStats holds for the day — a
 * ride, a night, a visit, every domain with an entry-window adapter — and the
 * day's open TravTrack questions linked to their inbox card. A moving stretch
 * nothing covers is "unterwegs, ohne Eintrag", never a guessed mode. Map
 * anchors are the record's own pin or a privacy-safe vertex, never a point
 * inside a zone.
 */

const PREFIX = "travtrack-day-context-";
const MIN = 60_000;
const H = 60 * MIN;
// 20 Oct in Berlin (UTC+2) runs from 19 Oct 22:00Z to 20 Oct 22:00Z.
const DAY_START = Date.parse("2026-10-19T22:00:00Z");
const DAY_END = Date.parse("2026-10-20T22:00:00Z");
const WINDOW = { fromMs: DAY_START, untilMs: DAY_END };
const at = (iso: string) => Date.parse(iso);

describe("TravTrack — a day's labels from TravStats", () => {
  let userId: string;

  const context = async (): Promise<DayContextEntry[]> =>
    dayContext(userId, WINDOW, await readSafeTravTrack(userId, WINDOW, 50_000));

  const ofKind = (list: DayContextEntry[], kind: string) => list.filter((c) => c.kind === kind);

  const settings = async (enabledDomains: string[]) => {
    await prisma.userSettings.deleteMany({ where: { userId } });
    await prisma.userSettings.create({
      data: { userId, data: { display: { timezone: "Europe/Berlin" } }, enabledDomains },
    });
  };

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
  });

  beforeEach(async () => {
    await wipeTravTrack([userId]);
    await prisma.railJourney.deleteMany({ where: { userId } });
    await prisma.busJourney.deleteMany({ where: { userId } });
    await prisma.lodgingStay.deleteMany({ where: { userId } });
    await prisma.lodging.deleteMany({ where: { userId } });
    await prisma.placeVisit.deleteMany({ where: { userId } });
    await prisma.place.deleteMany({ where: { userId } });
    await prisma.dawarichStay.deleteMany({ where: { userId } });
    await prisma.locationSuggestion.deleteMany({ where: { userId } });
    await settings(["flight", "rail", "lodging", "poi"]);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  const ride = (from: number, until: number) => ({
    userId,
    depStationName: "Frankfurt (Main) Hbf",
    depLat: 50.107,
    depLon: 8.663,
    arrStationName: "Würzburg Hbf",
    arrLat: 49.802,
    arrLon: 9.936,
    trainNumber: "ICE 725",
    departureTime: new Date(from),
    arrivalTime: new Date(until),
  });

  const cafe = async (lat = 49.793, lon = 9.929) => {
    const place = await prisma.place.create({
      data: { userId, name: "Café Schmitt", lat, lon },
    });
    const visit = await prisma.placeVisit.create({
      data: { userId, placeId: place.id, visitedAtUtc: new Date(at("2026-10-20T11:00:00Z")) },
    });
    return { place, visit };
  };

  it("a day with a rail ride, a hotel night and a café visit shows all three with links", async () => {
    const rail = await prisma.railJourney.create({
      data: ride(at("2026-10-20T08:00:00Z"), at("2026-10-20T10:00:00Z")),
    });
    const lodging = await prisma.lodging.create({
      data: { userId, name: "Hotel Krone", lat: 49.794, lon: 9.931 },
    });
    await prisma.lodgingStay.create({
      data: {
        userId,
        lodgingId: lodging.id,
        checkInAt: new Date(at("2026-10-20T14:00:00Z")),
        checkOutAt: new Date(at("2026-10-21T08:00:00Z")),
      },
    });
    const { place } = await cafe();
    // A bus ride exists too, but the account does not show buses.
    const { trainNumber: _train, ...bus } = ride(
      at("2026-10-20T16:00:00Z"),
      at("2026-10-20T17:00:00Z")
    );
    await prisma.busJourney.create({ data: bus });

    const list = await context();
    const [train] = ofKind(list, "rail");
    expect(train).toMatchObject({
      id: rail.id,
      href: `/rail/${rail.id}`,
      fromMs: at("2026-10-20T08:00:00Z"),
      untilMs: at("2026-10-20T10:00:00Z"),
      anchor: { lat: 50.107, lon: 8.663 },
      unlabelled: false,
    });
    expect(train.label).toContain("Frankfurt (Main) Hbf");
    expect(train.label).toContain("Würzburg Hbf");
    const [night] = ofKind(list, "lodging");
    expect(night).toMatchObject({
      label: "Hotel Krone",
      href: `/lodging/${lodging.id}`,
      fromMs: at("2026-10-20T14:00:00Z"),
      untilMs: DAY_END, // the night runs past midnight; the day shows its part
      anchor: { lat: 49.794, lon: 9.931 },
    });
    const [visit] = ofKind(list, "poi");
    expect(visit).toMatchObject({
      label: "Café Schmitt",
      href: `/places/${place.id}`,
      fromMs: at("2026-10-20T11:00:00Z"),
      untilMs: at("2026-10-20T11:00:00Z"),
      anchor: { lat: 49.793, lon: 9.929 },
    });
    expect(ofKind(list, "bus")).toEqual([]);
    // Time order.
    expect(list.map((c) => c.fromMs)).toEqual([...list.map((c) => c.fromMs)].sort((a, b) => a - b));
  });

  it("an open stay suggestion appears with its inbox link and goes once answered", async () => {
    const base = {
      userId,
      sourceStartAt: new Date(at("2026-10-20T12:00:00Z")),
      sourceEndAt: new Date(at("2026-10-20T13:00:00Z")),
      sourceLat: 49.79,
      sourceLon: 9.95,
      startAt: new Date(at("2026-10-20T12:00:00Z")),
      endAt: new Date(at("2026-10-20T13:00:00Z")),
      lat: 49.79,
      lon: 9.95,
      zone: "Europe/Berlin",
      pointCount: 12,
      evidence: { zone: "Europe/Berlin", source: "travtrack", pointDigests: ["aa"] },
    };
    const stay = await prisma.dawarichStay.create({
      data: { ...base, fingerprint: "tt-1", provider: "travtrack", name: "Mainufer" },
    });
    // A Dawarich finding is not TravTrack's question.
    await prisma.dawarichStay.create({
      data: { ...base, fingerprint: "dw-1", evidence: { zone: "Europe/Berlin", pointIds: [1] } },
    });
    const run = (fromMs: number, state: "open" | "linked") => ({
      fromMs,
      untilMs: fromMs + H,
      km: 42.4,
      start: { lat: 50.1, lon: 8.66 },
      end: { lat: 49.8, lon: 9.2 },
      startRecorded: true,
      endRecorded: true,
      startZone: "Europe/Berlin",
      endZone: "Europe/Berlin",
      line: [
        [
          [8.66, 50.1],
          [9.2, 49.8],
        ],
      ],
      modeHint: "rail",
      pointCount: 30,
      pointDigests: ["bb"],
      state,
      link: state === "linked" ? { entryKind: "rail", entryId: "r1" } : null,
    });
    const journey = await prisma.locationSuggestion.create({
      data: {
        userId,
        kind: "journey",
        provider: "travtrack",
        providerRev: 1,
        algorithm: 1,
        evidenceKey: "journey-key",
        windowFrom: new Date(DAY_START),
        windowUntil: new Date(DAY_END),
        explanation: { code: "journey.unlogged", params: { runs: 2, km: 85 } },
        evidence: {
          source: "travtrack",
          day: "2026-10-20",
          zone: "Europe/Berlin",
          readCoverage: "complete",
          runs: [
            run(at("2026-10-20T06:00:00Z"), "open"),
            run(at("2026-10-20T15:00:00Z"), "linked"),
          ],
        },
      },
    });

    const list = ofKind(await context(), "suggestion");
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({
      suggestion: "journey",
      id: journey.id,
      href: `/pending-updates?view=list&item=${encodeURIComponent(`location:${journey.id}`)}`,
      fromMs: at("2026-10-20T06:00:00Z"),
      untilMs: at("2026-10-20T07:00:00Z"),
      anchor: { lat: 50.1, lon: 8.66 },
    });
    expect(list[0]).not.toHaveProperty("modeHint");
    expect(list[1]).toMatchObject({
      suggestion: "stay",
      id: stay.id,
      label: "Mainufer",
      href: `/pending-updates?view=list&item=${encodeURIComponent(`dawarich:${stay.id}`)}`,
      fromMs: at("2026-10-20T12:00:00Z"),
    });

    await prisma.dawarichStay.update({ where: { id: stay.id }, data: { status: "accepted" } });
    await prisma.locationSuggestion.update({
      where: { id: journey.id },
      data: { status: "rejected" },
    });
    expect(ofKind(await context(), "suggestion")).toEqual([]);
  });

  /** A walk out of town: `km` kilometres east in `minutes`, one fix a minute, from `t0`. */
  const drive = async (t0: number, km: number, minutes: number) => {
    // Ten quiet minutes first, at the start.
    for (let i = 0; i < 10; i++) {
      await storePoint(userId, { t: t0 - (10 - i) * MIN, lat: 50, lon: 8 });
    }
    const degPerKm = 1 / (111.32 * Math.cos((50 * Math.PI) / 180));
    for (let i = 0; i <= minutes; i++) {
      await storePoint(userId, {
        t: t0 + i * MIN,
        lat: 50,
        lon: 8 + (km * degPerKm * i) / minutes,
      });
    }
  };

  it("an uncovered moving stretch is unlabelled, without a mode", async () => {
    const t0 = at("2026-10-20T06:00:00Z");
    await drive(t0, 12, 15);
    const list = await context();
    const moving = ofKind(list, "movement");
    expect(moving).toHaveLength(1);
    expect(moving[0]).toMatchObject({
      id: null,
      label: "",
      href: null,
      unlabelled: true,
      anchor: { lat: 50, lon: 8 },
    });
    expect(moving[0].fromMs).toBeGreaterThanOrEqual(t0 - MIN);
    expect(moving[0].fromMs).toBeLessThanOrEqual(t0);
    expect(moving[0].untilMs).toBe(t0 + 15 * MIN);
    for (const key of ["mode", "modeHint", "suggestion"]) expect(moving[0]).not.toHaveProperty(key);

    // The same stretch on a rail ride is the ride's, not "unterwegs".
    await prisma.railJourney.create({ data: ride(t0 - 5 * MIN, t0 + 20 * MIN) });
    const covered = await context();
    expect(ofKind(covered, "movement")).toEqual([]);
    expect(ofKind(covered, "rail")).toHaveLength(1);
  });

  it("a short walk and a jittering phone are no stretch", async () => {
    const t0 = at("2026-10-20T09:00:00Z");
    await drive(t0, 1.2, 15);
    // An hour standing still, the fix wandering 30 m to and fro.
    for (let i = 0; i < 60; i++) {
      await storePoint(userId, {
        t: at("2026-10-20T12:00:00Z") + i * MIN,
        lat: 50.1 + (i % 2) * 0.00027,
        lon: 8.5,
      });
    }
    expect(ofKind(await context(), "movement")).toEqual([]);
  });

  it("a place visit whose pin lies in a zone is listed without a map anchor", async () => {
    await prisma.travTrackPrivacyZone.create({
      data: { userId, name: "Wohnung", lat: 49.793, lon: 9.929, radiusM: 300 },
    });
    const { place } = await cafe(49.7935, 9.9292);
    const [visit] = ofKind(await context(), "poi");
    expect(visit).toMatchObject({
      label: "Café Schmitt",
      href: `/places/${place.id}`,
      anchor: null,
    });
  });

  it("a stretch's anchor is its first privacy-safe vertex, never one inside a zone", async () => {
    const t0 = at("2026-10-20T06:00:00Z");
    // The drive starts inside a zone: the first vertices are cut away.
    await prisma.travTrackPrivacyZone.create({
      data: { userId, name: "Büro", lat: 50, lon: 8, radiusM: 400 },
    });
    await drive(t0, 12, 15);
    const [moving] = ofKind(await context(), "movement");
    expect(moving.anchor).not.toBeNull();
    const circle = { lat: 50, lon: 8 };
    const metres = (moving.anchor!.lon - circle.lon) * 111_320 * Math.cos((50 * Math.PI) / 180);
    expect(metres).toBeGreaterThan(400);
  });

  describe("a fake domain with an adapter", () => {
    const FAKE = "hovercraft" as DomainKey;
    const adapters = ENTRY_WINDOW_ADAPTERS as Record<string, unknown>;

    afterEach(() => {
      delete adapters[FAKE];
      const i = AVAILABLE_DOMAINS.indexOf(FAKE);
      if (i >= 0) AVAILABLE_DOMAINS.splice(i, 1);
    });

    it("a fake domain with an adapter appears without editing dayContext", async () => {
      AVAILABLE_DOMAINS.push(FAKE);
      adapters[FAKE] = {
        movement: true,
        read: async () => [
          {
            domain: FAKE,
            id: "hover-1",
            fromMs: at("2026-10-20T09:00:00Z"),
            untilMs: at("2026-10-20T09:30:00Z"),
          },
        ],
      };
      await settings(["flight", "hovercraft"]);
      const [entry] = ofKind(await context(), "hovercraft");
      expect(entry).toMatchObject({
        id: "hover-1",
        label: "",
        href: null,
        anchor: null,
        unlabelled: false,
        fromMs: at("2026-10-20T09:00:00Z"),
        untilMs: at("2026-10-20T09:30:00Z"),
      });
    });
  });
});
