import { prisma } from "../../../../db";
import { foldStationName } from "../../railStations";
import { PROVIDER_AGREES_KM, resolveProviderStop } from "../railStopResolve";
import { toRailCandidate } from "../railCandidates";
import { findBusDuplicate } from "../railDuplicates";
import type { ParsedRailBooking } from "../types";

/**
 * A bahn.de stop resolved from bahn.de's own data (2026-10-23): EVA number
 * first, the name among namesakes by position second, bahn.de's position last.
 * Invented names and EVA numbers (99…), so a seeded catalogue cannot collide.
 */
const PREFIX = `test-railstop-${Date.now()}-`;

const ROWS = [
  // A station whose catalogue name differs from what bahn.de prints.
  { name: "Teststadt Hauptbahnhof", dbId: "9911001", lat: 48.1, lon: 11.5 },
  // An EVA number whose catalogue row lies 40 km from where bahn.de puts it.
  { name: "Woanders Süd", dbId: "9911002", lat: 48.46, lon: 11.5 },
  // One name, two towns 200 km apart.
  { name: "Doppelstadt Nord", dbId: null, lat: 50.0, lon: 8.0 },
  { name: "Doppelstadt Nord", dbId: null, lat: 51.8, lon: 8.0 },
];

const near = (lat: number, lon: number) => ({ lat: lat + 0.002, lon: lon + 0.002 });

describe("resolveProviderStop", () => {
  beforeAll(async () => {
    await prisma.railStation.createMany({
      data: ROWS.map((r, i) => ({
        sourceId: `${PREFIX}${i}`,
        name: r.name,
        searchName: foldStationName(r.name),
        uic: r.dbId,
        dbId: r.dbId,
        lat: r.lat,
        lon: r.lon,
        country: "DE",
        timezone: "Europe/Berlin",
      })),
    });
  });

  afterAll(async () => {
    await prisma.railStation.deleteMany({ where: { sourceId: { startsWith: PREFIX } } });
  });

  it("matches the EVA number against the catalogue's db_id, whatever the name says", async () => {
    const s = await resolveProviderStop("Teststadt Hbf (tief)", {
      eva: "9911001",
      position: near(48.1, 11.5),
    });
    expect(s).toMatchObject({
      name: "Teststadt Hauptbahnhof",
      // What the document printed stays with the stop, so a ride saved under it
      // is still found as a duplicate.
      printedName: "Teststadt Hbf (tief)",
      resolved: true,
      positionSource: "catalogue",
      lat: 48.1,
      lon: 11.5,
      catalogueConflictKm: null,
    });
    expect(s.stationId).toEqual(expect.any(Number));
  });

  it("does not trust an EVA row far from bahn.de's position, and says how far", async () => {
    const s = await resolveProviderStop("Teststadt Rathaus", {
      eva: "9911002",
      position: { lat: 48.1, lon: 11.5 },
    });
    expect(s).toMatchObject({
      resolved: false,
      stationId: null,
      positionSource: "provider",
      lat: 48.1,
      lon: 11.5,
    });
    expect(s.catalogueConflictKm).toBeGreaterThan(PROVIDER_AGREES_KM);
    expect(s.catalogueConflictKm).toBe(40);
  });

  it("takes the namesake at bahn.de's position, and neither without one", async () => {
    const south = await resolveProviderStop("Doppelstadt Nord", {
      eva: null,
      position: near(50.0, 8.0),
    });
    expect(south).toMatchObject({ resolved: true, lat: 50.0, positionSource: "catalogue" });
    const northern = await resolveProviderStop("Doppelstadt Nord", {
      eva: null,
      position: near(51.8, 8.0),
    });
    expect(northern).toMatchObject({ resolved: true, lat: 51.8 });
    const blind = await resolveProviderStop("Doppelstadt Nord", { eva: null, position: null });
    expect(blind).toMatchObject({ resolved: false, positionSource: null, lat: null });
  });

  it("keeps bahn.de's name and position for a stop the catalogue does not hold", async () => {
    const s = await resolveProviderStop("Teststadt, Rathausplatz", {
      eva: "9911999",
      position: { lat: 48.137154, lon: 11.576124 },
    });
    expect(s).toEqual({
      name: "Teststadt, Rathausplatz",
      printedName: "Teststadt, Rathausplatz",
      stationId: null,
      code: "9911999",
      lat: 48.137154,
      lon: 11.576124,
      country: "DE",
      timezone: "Europe/Berlin",
      resolved: false,
      positionSource: "provider",
      catalogueConflictKm: null,
    });
  });

  it("derives a foreign stop's country and zone from its coordinates, never Germany", async () => {
    const s = await resolveProviderStop("Wien Karlsplatz", {
      eva: "9911998",
      position: { lat: 48.200547, lon: 16.369599 },
    });
    expect(s).toMatchObject({
      country: "AT",
      timezone: "Europe/Vienna",
      positionSource: "provider",
    });
  });

  it("leaves a stop without usable coordinates for the user to pick", async () => {
    const s = await resolveProviderStop("Teststadt, Nirgendwo", { eva: "9911997", position: null });
    expect(s).toMatchObject({ resolved: false, lat: null, lon: null, positionSource: null });
  });

  it("resolves a booking's stops through the provider data, and a document's by name", async () => {
    const leg = {
      depStationName: "Teststadt, Rathausplatz",
      arrStationName: "Teststadt Hbf",
      departureLocal: "2026-11-03T08:08",
      arrivalLocal: "2026-11-03T08:20",
      trainCategory: "STR",
      trainNumber: "12",
      coach: null,
      seat: null,
      direction: null,
    };
    const booking: ParsedRailBooking = {
      bookingReference: null,
      travelClass: null,
      tariff: null,
      price: null,
      currency: null,
      operator: null,
      source: "db-share-link",
      legs: [
        {
          ...leg,
          departureStop: { eva: null, position: { lat: 48.137154, lon: 11.576124 } },
          arrivalStop: { eva: "9911001", position: near(48.1, 11.5) },
          transit: { mode: "tram", busKind: null },
        },
        leg,
      ],
    };
    const candidate = await toRailCandidate(booking, undefined);
    expect(candidate.legs[0]).toMatchObject({
      transit: { mode: "tram" },
      departureStation: { positionSource: "provider", lat: 48.137154 },
      arrivalStation: { name: "Teststadt Hauptbahnhof", printedName: "Teststadt Hbf" },
    });
    expect(candidate.legs[0]).not.toHaveProperty("departureStop");
    // The same printed names with no provider data: neither is placed.
    expect(candidate.legs[1].departureStation).toMatchObject({ positionSource: null, lat: null });
  });
});

describe("findBusDuplicate", () => {
  it("finds a bus leg imported before among the bus rides, at its stop's clock", async () => {
    const user = await prisma.user.create({
      data: { username: `railstop-bus-${Date.now()}`, passwordHash: "x" },
    });
    try {
      const ride = await prisma.busJourney.create({
        data: {
          userId: user.id,
          depStationName: "Odeonsplatz",
          depLat: 48.1425,
          depLon: 11.5775,
          depTimezone: "Europe/Berlin",
          arrStationName: "Chinesischer Turm",
          arrLat: 48.152,
          arrLon: 11.592,
          departureTime: new Date("2026-03-14T08:40:00Z"),
          lineName: "Bus 100",
        },
      });
      const leg = {
        depStationName: "Odeonsplatz",
        arrStationName: "Chinesischer Turm",
        departureLocal: "2026-03-14T09:40",
        arrivalLocal: null,
        trainCategory: "Bus",
        trainNumber: "100",
        coach: null,
        seat: null,
        direction: null,
      };
      const stop = (name: string) => ({ name, printedName: name, stationId: null, code: null });
      const [dep, arr] = [stop("Odeonsplatz"), stop("Chinesischer Turm")];
      expect(await findBusDuplicate(user.id, leg, dep, arr)).toEqual({
        duplicateOf: ride.id,
        possibleDuplicateOf: null,
      });
      expect(
        await findBusDuplicate(user.id, { ...leg, departureLocal: "2026-03-14T09:41" }, dep, arr)
      ).toEqual({ duplicateOf: null, possibleDuplicateOf: null });
    } finally {
      await prisma.busJourney.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});
