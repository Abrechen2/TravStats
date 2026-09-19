import { prisma } from "../db";
import { hashPassword } from "../utils/password";
import { CRUISE_TEMPLATES, loadPools, seedCruises } from "../seedDemoAccount";

/**
 * The bulk cruise seed, checked against the rules the rest of the app holds.
 *
 * Both properties here were broken until the independent review of 2026-09-17:
 * the seed looked ports up BY NAME (finding B1) in a catalogue that holds two
 * "Naples", two "Venice", two "Nassau" and more — the American one wins,
 * because it is inserted later and the name-keyed map keeps the last row — and
 * a port the catalogue did not hold at all became a SEA DAY carrying the port
 * name in an excursion note (finding B2), which is not one of the three states
 * a stop may be in.
 */

/** Templates whose itinerary never leaves the Mediterranean rim. */
const MEDITERRANEAN_SHIPS = [
  "AIDAnova",
  "AIDAbella",
  "AIDAmar",
  "Costa Toscana",
  "Costa Smeralda",
  "MSC World Europa",
  "Mein Schiff 3",
];

const MEDITERRANEAN_RIM = ["Spain", "Italy", "France", "Greece", "Türkiye", "Croatia", "Malta"];

/**
 * Itineraries that cannot leave a named set of countries. Which duplicate the
 * name-keyed map returned was down to the PHYSICAL row order — measured on the
 * test database, "Naples" resolved to Italy while "Las Palmas" resolved to
 * Argentina, and a VACUUM could swap either. That is the whole argument for
 * the locode.
 */
const REGION_BOUNDS = [
  { region: "the Mediterranean", ships: MEDITERRANEAN_SHIPS, countries: MEDITERRANEAN_RIM },
  { region: "the Canaries and Madeira", ships: ["AIDAperla"], countries: ["Spain", "Portugal"] },
];

describe("seedCruises", () => {
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "seedCruiseStopsUser" } });
    userId = (
      await prisma.user.create({
        data: { username: "seedCruiseStopsUser", passwordHash: await hashPassword("password123") },
      })
    ).id;
    const { ships, ports } = await loadPools();
    await seedCruises(userId, ships, ports);
  }, 120_000);

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("keeps every stop in one of the three states, numbered from 1", async () => {
    const cruises = await prisma.cruise.findMany({
      where: { userId },
      include: { stops: { orderBy: { dayNumber: "asc" } } },
    });
    expect(cruises.length).toBeGreaterThan(0);
    for (const cruise of cruises) {
      cruise.stops.forEach((stop, i) => {
        expect(stop.dayNumber).toBe(i + 1);
        const matchedPort =
          stop.portId !== null && !stop.isAtSea && stop.unresolvedPortName === null;
        const seaDay = stop.portId === null && stop.isAtSea && stop.unresolvedPortName === null;
        const unresolved =
          stop.portId === null &&
          !stop.isAtSea &&
          stop.unresolvedPortName !== null &&
          stop.unresolvedPortName.length > 0;
        if (!(matchedPort || seaDay || unresolved)) {
          throw new Error(
            `stop ${stop.dayNumber} of cruise ${cruise.id} is in no valid state: ` +
              `portId=${stop.portId} isAtSea=${stop.isAtSea} unresolved=${stop.unresolvedPortName}`
          );
        }
      });
    }
  });

  it.each(REGION_BOUNDS)(
    "keeps every port call on $region inside the countries that region has",
    async ({ region, ships: shipNames, countries }) => {
      const ships = await prisma.ship.findMany({
        where: { name: { in: shipNames } },
        select: { id: true, name: true },
      });
      expect(ships.length).toBeGreaterThan(0);
      const cruises = await prisma.cruise.findMany({
        where: { userId, shipId: { in: ships.map((s) => s.id) } },
        include: { stops: { include: { port: true } } },
      });
      expect(cruises.length).toBeGreaterThan(0);
      for (const cruise of cruises) {
        const shipName = ships.find((s) => s.id === cruise.shipId)?.name;
        for (const stop of cruise.stops) {
          if (!stop.port) continue;
          if (!countries.includes(stop.port.country ?? "")) {
            throw new Error(
              `${shipName} day ${stop.dayNumber}: ${stop.port.name} (${stop.port.unlocode}) ` +
                `is in ${stop.port.country}, which is not on ${region}`
            );
          }
        }
      }
    }
  );

  it("resolves every port call to the UN/LOCODE its itinerary names", async () => {
    const ships = await prisma.ship.findMany({ select: { id: true, name: true } });
    const shipIdByName = new Map(ships.map((s) => [s.name, s.id]));
    for (const tpl of CRUISE_TEMPLATES) {
      const shipId = shipIdByName.get(tpl.shipName);
      if (shipId === undefined) continue; // ship not in this catalogue — seed skips it
      const cruise = await prisma.cruise.findFirst({
        where: { userId, shipId },
        include: { stops: { orderBy: { dayNumber: "asc" }, include: { port: true } } },
      });
      if (!cruise) throw new Error(`${tpl.shipName}: cruise not seeded`);
      expect(cruise.stops).toHaveLength(tpl.stops.length);
      tpl.stops.forEach((templateStop, i) => {
        const stop = cruise.stops[i];
        if (!("locode" in templateStop)) return;
        expect(stop.port?.unlocode).toBe(templateStop.locode);
      });
    }
  });

  it("keeps every stop inside the cruise it belongs to", async () => {
    const cruises = await prisma.cruise.findMany({ where: { userId }, include: { stops: true } });
    for (const cruise of cruises) {
      for (const stop of cruise.stops) {
        for (const [label, time] of [
          ["arrival", stop.arrivalTime],
          ["departure", stop.departureTime],
        ] as const) {
          if (time === null) continue;
          if (time < cruise.startDate || time > cruise.endDate) {
            throw new Error(
              `stop ${stop.dayNumber}'s ${label} ${time.toISOString()} is outside ` +
                `${cruise.startDate.toISOString()}..${cruise.endDate.toISOString()}`
            );
          }
        }
      }
    }
  });

  it("keeps a port the catalogue does not hold as a port call, not a sea day", async () => {
    const unresolved = await prisma.cruiseStop.findMany({
      where: { cruise: { userId }, unresolvedPortName: { not: null } },
    });
    // The Panama Canal transit is the itinerary entry the port catalogue has no
    // row for. It stays a port call so the demo account shows the third stop
    // state at all — a sea day with the name in a note showed neither.
    expect(unresolved.length).toBeGreaterThan(0);
    for (const stop of unresolved) {
      expect(stop.portId).toBeNull();
      expect(stop.isAtSea).toBe(false);
    }
  });
});
