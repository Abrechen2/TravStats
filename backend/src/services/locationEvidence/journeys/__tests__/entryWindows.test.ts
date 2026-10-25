import { prisma } from "../../../../db";
import { DOMAIN_KEYS } from "../../../../shared/domains";
import { makeUser } from "../../../travtrack/__tests__/fixtures";
import {
  ENTRY_WINDOW_ADAPTERS,
  coveringWindow,
  logbookWindows,
  unclassifiedDomains,
  type EntryWindow,
} from "../entryWindows";

/**
 * The logbook's time windows, one adapter per domain (TravTrack plan E7):
 * each reads its own table's columns on its own clock, and a new domain must
 * be classified before it can ship.
 */

const PREFIX = "journey-entry-windows-";
const H = 3_600_000;
const T = Date.parse("2026-10-20T08:00:00Z");
const WINDOW = { fromMs: T - 24 * H, untilMs: T + 24 * H };

describe("entry windows", () => {
  let userId: string;

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
    await prisma.userSettings.create({ data: { userId, data: {} } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("every DOMAIN_KEYS entry has an adapter or a reason", () => {
    expect(unclassifiedDomains(DOMAIN_KEYS)).toEqual([]);
    // A new domain added to the registry without an adapter is caught.
    expect(unclassifiedDomains([...DOMAIN_KEYS, "hovercraft"])).toEqual(["hovercraft"]);
    for (const key of DOMAIN_KEYS) {
      const adapter = ENTRY_WINDOW_ADAPTERS[key];
      if ("none" in adapter) expect(adapter.none.length).toBeGreaterThan(10);
      else if (adapter.movement !== true) expect(adapter.movement.no.length).toBeGreaterThan(10);
    }
  });

  describe("each adapter reads its own table's window", () => {
    const only = async (domain: (typeof DOMAIN_KEYS)[number]) => {
      const adapter = ENTRY_WINDOW_ADAPTERS[domain];
      if ("none" in adapter) throw new Error("no adapter");
      return adapter.read(userId, WINDOW);
    };

    it("flight: the recorder window", async () => {
      const f = await prisma.flight.create({
        data: {
          userId,
          depIata: "FRA",
          arrIata: "MUC",
          depLat: 50.03,
          depLon: 8.57,
          arrLat: 48.35,
          arrLon: 11.79,
          flightNumber: "LH100",
          departureTime: new Date(T),
          arrivalTime: new Date(T + H),
          depPrecision: "minute",
          arrPrecision: "minute",
          status: "flown",
        },
      });
      const [w] = await only("flight");
      expect(w.id).toBe(f.id);
      expect(w.fromMs).toBeLessThanOrEqual(T);
      expect(w.untilMs).toBeGreaterThanOrEqual(T + H);
    });

    const ride = {
      depStationName: "A",
      depLat: 50,
      depLon: 8,
      arrStationName: "B",
      arrLat: 50,
      arrLon: 10,
      departureTime: new Date(T),
      arrivalTime: new Date(T + 2 * H),
    };

    it("rail, bus and ferry: departure to arrival, actual times first; cancelled none", async () => {
      const r = await prisma.railJourney.create({
        data: { ...ride, userId, actualArrivalTime: new Date(T + 3 * H) },
      });
      await prisma.railJourney.create({ data: { ...ride, userId, status: "cancelled" } });
      const b = await prisma.busJourney.create({ data: { ...ride, userId } });
      const f = await prisma.ferryJourney.create({ data: { ...ride, userId } });
      expect(await only("rail")).toEqual([
        { domain: "rail", id: r.id, fromMs: T, untilMs: T + 3 * H },
      ]);
      expect(await only("bus")).toEqual([
        { domain: "bus", id: b.id, fromMs: T, untilMs: T + 2 * H },
      ]);
      expect(await only("ferry")).toEqual([
        { domain: "ferry", id: f.id, fromMs: T, untilMs: T + 2 * H },
      ]);
    });

    it("cruise: its days on its own clock", async () => {
      const c = await prisma.cruise.create({
        data: {
          userId,
          startDay: new Date("2026-10-19T00:00:00Z"),
          endDay: new Date("2026-10-20T00:00:00Z"),
          startZone: "Europe/Berlin",
          endZone: "Europe/Berlin",
        },
      });
      expect(await only("cruise")).toEqual([
        {
          domain: "cruise",
          id: c.id,
          fromMs: Date.parse("2026-10-18T22:00:00Z"),
          untilMs: Date.parse("2026-10-20T22:00:00Z"),
        },
      ]);
    });

    it("rental: pick-up to return", async () => {
      const r = await prisma.rentalBooking.create({
        data: {
          userId,
          provider: "Sixt",
          pickupStationName: "A",
          pickupLat: 50,
          pickupLon: 8,
          pickupTimezone: "Europe/Berlin",
          returnStationName: "A",
          returnLat: 50,
          returnLon: 8,
          returnTimezone: "Europe/Berlin",
          pickupTime: new Date(T - 2 * H),
          returnTime: new Date(T + 5 * H),
        },
      });
      expect(await only("rental")).toEqual([
        { domain: "rental", id: r.id, fromMs: T - 2 * H, untilMs: T + 5 * H },
      ]);
    });

    it("roadtrip: its stations' days", async () => {
      const route = await prisma.tripRoute.create({
        data: {
          userId,
          name: "Alpen",
          mode: "road",
          kind: "roadtrip",
          stops: {
            create: [
              {
                title: "Start",
                routeOrderIdx: 0,
                startDate: new Date("2026-10-19T00:00:00Z"),
                stopZone: "Europe/Berlin",
              },
              {
                title: "Ende",
                routeOrderIdx: 1,
                startDate: new Date("2026-10-20T00:00:00Z"),
                stopZone: "Europe/Berlin",
              },
            ],
          },
        },
      });
      // A day tour is not a roadtrip.
      await prisma.tripRoute.create({ data: { userId, name: "Tour", mode: "foot" } });
      expect(await only("roadtrip")).toEqual([
        {
          domain: "roadtrip",
          id: route.id,
          fromMs: Date.parse("2026-10-18T22:00:00Z"),
          untilMs: Date.parse("2026-10-20T22:00:00Z"),
        },
      ]);
    });

    it("lodging: check-in to check-out", async () => {
      const lodging = await prisma.lodging.create({ data: { userId, name: "Hotel" } });
      const s = await prisma.lodgingStay.create({
        data: {
          userId,
          lodgingId: lodging.id,
          checkInAt: new Date(T - 10 * H),
          checkOutAt: new Date(T + 10 * H),
        },
      });
      expect(await only("lodging")).toEqual([
        { domain: "lodging", id: s.id, fromMs: T - 10 * H, untilMs: T + 10 * H },
      ]);
    });

    it("poi: a visit's instant", async () => {
      const place = await prisma.place.create({ data: { userId, name: "Dom", lat: 50, lon: 7 } });
      const v = await prisma.placeVisit.create({
        data: { userId, placeId: place.id, visitedAtUtc: new Date(T) },
      });
      await prisma.placeVisit.create({ data: { userId, placeId: place.id } });
      expect(await only("poi")).toEqual([{ domain: "poi", id: v.id, fromMs: T, untilMs: T }]);
    });

    it("logbookWindows lists every domain's windows", async () => {
      const domains = new Set((await logbookWindows(userId, WINDOW)).map((w) => w.domain));
      expect([...domains].sort()).toEqual([...DOMAIN_KEYS].sort());
    });
  });

  describe("coveringWindow", () => {
    const run = { fromMs: 0, untilMs: 100 };
    const w = (domain: EntryWindow["domain"], fromMs: number, untilMs: number, id = "x") => ({
      domain,
      id,
      fromMs,
      untilMs,
    });

    it("covers when half the run lies in one window", () => {
      expect(coveringWindow(run, [w("rail", 50, 200)], new Set())?.domain).toBe("rail");
      expect(coveringWindow(run, [w("rail", 51, 200)], new Set())).toBeNull();
      // Two windows of 30 each do not add up.
      expect(coveringWindow(run, [w("rail", 0, 30), w("bus", 40, 70)], new Set())).toBeNull();
    });

    it("a stay or a place visit does not cover movement", () => {
      expect(coveringWindow(run, [w("lodging", -10, 200)], new Set())).toBeNull();
    });

    it("an entry made by answering this question does not cover it", () => {
      expect(coveringWindow(run, [w("rail", 0, 100, "own")], new Set(["rail:own"]))).toBeNull();
      expect(coveringWindow(run, [w("rail", 0, 100, "other")], new Set(["rail:own"]))?.id).toBe(
        "other"
      );
    });
  });
});
