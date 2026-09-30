import { prisma } from "../../../../db";
import { foldStationName } from "../../railStations";
import { resolveStationName, toRailCandidate } from "../railCandidates";
import type { ParsedRailBooking } from "../types";

/**
 * Station resolution and duplicate recognition against the database. The
 * rows are this file's own (a `sourceId` prefix); a catalogue that happens to
 * be seeded locally carries the same stations at the same places, so every
 * assertion reads the row by NAME and position, never by a fixed id.
 */
const PREFIX = `test-railparser-${Date.now()}-`;

const ROWS = [
  { name: "Neufahrn (b Freising)", uic: "8020489", lat: 48.32164, lon: 11.661265 },
  // The other Neufahrn — why a bare "Neufahrn" may not resolve.
  { name: "Neufahrn (Niederbay)", uic: "8026340", lat: 48.729885, lon: 12.19046 },
  { name: "München Flughafen Terminal", uic: "8020658", lat: 48.353731, lon: 11.785972 },
  { name: "München Flughafen Terminal 1", uic: null, lat: 48.353362, lon: 11.786152 },
  // One invented name at two places far apart: ambiguous, never guessed.
  { name: "Musterhausen Ost", uic: "9900001", lat: 50.0, lon: 8.0 },
  { name: "Musterhausen Ost", uic: "9900002", lat: 52.0, lon: 10.0 },
];

describe("rail import candidates", () => {
  let userId: string;

  beforeAll(async () => {
    await prisma.railStation.createMany({
      data: ROWS.map((r, i) => ({
        sourceId: `${PREFIX}${i}`,
        name: r.name,
        searchName: foldStationName(r.name),
        uic: r.uic,
        lat: r.lat,
        lon: r.lon,
        country: "DE",
        timezone: "Europe/Berlin",
      })),
    });
    userId = (
      await prisma.user.create({
        data: { username: `railparser-cand-${Date.now()}`, passwordHash: "x" },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.railJourney.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.railStation.deleteMany({ where: { sourceId: { startsWith: PREFIX } } });
  });

  it("resolves DB's spelling without the space to the right Neufahrn", async () => {
    const station = await resolveStationName("Neufahrn(b Freising)");
    expect(station).toMatchObject({
      name: "Neufahrn (b Freising)",
      printedName: "Neufahrn(b Freising)",
      resolved: true,
      timezone: "Europe/Berlin",
      code: "8020489",
    });
    expect(station.lat).toBeCloseTo(48.3216, 3);
  });

  it("leaves a bare, ambiguous name unresolved — with its name — instead of picking one", async () => {
    expect(await resolveStationName("Neufahrn")).toMatchObject({
      name: "Neufahrn",
      resolved: false,
      stationId: null,
      lat: null,
    });
    expect(await resolveStationName("Musterhausen Ost")).toMatchObject({ resolved: false });
  });

  it("takes the station with a rail code over its platform rows, and reads a truncated name", async () => {
    const exact = await resolveStationName("München Flughafen Terminal");
    expect(exact).toMatchObject({ resolved: true, code: "8020658" });
    const truncated = await resolveStationName("München Flughafen T");
    expect(truncated).toMatchObject({ resolved: true, code: "8020658" });
  });

  it("marks a leg the user already logged under the same reference and departure", async () => {
    const existing = await prisma.railJourney.create({
      data: {
        userId,
        depStationName: "Neufahrn (b Freising)",
        depLat: 48.32,
        depLon: 11.66,
        depTimezone: "Europe/Berlin",
        arrStationName: "München Flughafen Terminal",
        arrLat: 48.35,
        arrLon: 11.79,
        arrTimezone: "Europe/Berlin",
        // 10:12 in Munich in June is 08:12 UTC.
        departureTime: new Date("2025-06-14T08:12:00Z"),
        bookingReference: "123456789012",
      },
    });
    const booking: ParsedRailBooking = {
      bookingReference: "123456789012",
      travelClass: "second",
      tariff: null,
      price: 3.2,
      currency: "EUR",
      operator: null,
      source: "db-confirmation",
      legs: [
        {
          depStationName: "Neufahrn(b Freising)",
          arrStationName: "München Flughafen Terminal",
          departureLocal: "2025-06-14T10:12",
          arrivalLocal: "2025-06-14T10:22",
          trainCategory: null,
          trainNumber: null,
          coach: null,
          seat: null,
          direction: null,
        },
        {
          depStationName: "Neufahrn(b Freising)",
          arrStationName: "München Flughafen Terminal",
          departureLocal: "2025-06-14T11:12",
          arrivalLocal: null,
          trainCategory: null,
          trainNumber: null,
          coach: null,
          seat: null,
          direction: null,
        },
      ],
    };
    const candidate = await toRailCandidate(booking, userId);
    expect(candidate.legs.map((l) => l.duplicateOf)).toEqual([existing.id, null]);
    expect(candidate.legs[0].departureStation.resolved).toBe(true);

    // Someone else's identical ride is not this user's duplicate.
    const other = await toRailCandidate(booking, "00000000-0000-4000-8000-000000000000");
    expect(other.legs.map((l) => l.duplicateOf)).toEqual([null, null]);
  });
});
