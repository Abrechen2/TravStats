import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { parsePackageText } from "../../services/trip/package/parsePackage";
import { loadDrafts, matchInput } from "../../services/trip/package/__tests__/draftTemplates";

/**
 * Package tour → trip, end to end over the two routes (plan 2026-10-09 P3).
 * The invoice reading comes from the Berge & Meer draft template run on its
 * own invented test document; the travel-documents reading of the SAME
 * booking is written out here, because the draft's own case is a different
 * (invented) booking.
 */
const stamp = Date.now();

const invoiceReading = (): Record<string, unknown> => {
  const [invoice] = loadDrafts();
  const parsed = parsePackageText(matchInput(invoice), [invoice]);
  if (!parsed.reading) throw new Error("the invoice draft did not read");
  return parsed.reading as unknown as Record<string, unknown>;
};

/** The travel documents of the invoice's booking: legs by city, the hotels. */
const documentsReading = {
  bookingReference: "9z123456",
  issuedOn: "2026-03-05",
  flights: [
    {
      flightNumber: "ET0707",
      date: "2026-05-18",
      depCity: "Frankfurt",
      arrCity: "Addis Ababa",
      depTime: "21:35",
      arrTime: "06:25",
      arrDayOffset: 1,
    },
  ],
  stays: [
    {
      name: "Savanna Example Lodge",
      checkIn: "2026-05-19",
      checkOut: "2026-05-23",
      city: "Nanyuki",
      country: "Kenia",
      board: "Halbpension",
    },
    {
      name: "Hotel Seeblick Muster",
      checkIn: "2026-05-23",
      checkOut: "2026-05-30",
      city: "Naivasha",
      country: "Kenia",
    },
  ],
};

describe("POST /trips/package/{preview,commit}", () => {
  let cookie: string;
  let userId: string;
  let strangerId: string;

  beforeAll(async () => {
    const passwordHash = await hashPassword("password123");
    userId = (await prisma.user.create({ data: { username: `pkg-${stamp}`, passwordHash } })).id;
    strangerId = (await prisma.user.create({ data: { username: `pkg-x-${stamp}`, passwordHash } }))
      .id;
    cookie = `auth_token=${generateToken(userId)}`;
  });

  afterAll(async () => {
    await prisma.document.deleteMany({ where: { userId: { in: [userId, strangerId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, strangerId] } } });
    await prisma.$disconnect();
  });

  const preview = (body: Record<string, unknown>) =>
    request(app).post("/api/v1/trips/package/preview").set("Cookie", cookie).send(body);
  const commit = (body: Record<string, unknown>) =>
    request(app).post("/api/v1/trips/package/commit").set("Cookie", cookie).send(body);

  const keptDocument = (owner: string, extra: Record<string, unknown> = {}) =>
    prisma.document.create({
      data: {
        userId: owner,
        storedName: `${Math.random()}.pdf`,
        mimetype: "application/pdf",
        sizeBytes: 1,
        sha256: "0".repeat(64),
        format: "pdf",
        source: "parse",
        ...extra,
      },
    });

  it("proposes to create everything for a booking the logbook has never seen", async () => {
    const res = await preview({ reading: invoiceReading() }).expect(200);
    expect(res.body.success).toBe(true);
    const { proposal } = res.body.data;
    expect(proposal.trip).toMatchObject({
      action: "create",
      name: "Kenia & Tansania – Erlebnisreise",
      startDate: "2026-05-18",
      endDate: "2026-05-31",
    });
    expect(proposal.booking).toMatchObject({ action: "create", price: 3249, currency: "EUR" });
    expect(proposal.flights.map((f: { action: string }) => f.action)).toEqual([
      "create",
      "create",
      "create",
      "create",
    ]);
    expect(proposal.warnings).toEqual([]);
    expect(await prisma.trip.count({ where: { userId } })).toBe(0);
  });

  it("writes the invoice as one trip, one booking and four flights, and files the PDF", async () => {
    const document = await keptDocument(userId, {
      parsedDomain: "package",
      parsedPayload: { domain: "package", package: invoiceReading() },
    });
    const res = await commit({ documentId: document.id }).expect(201);
    const result = res.body.data;
    expect(result.trip.action).toBe("create");

    const trip = await prisma.trip.findUniqueOrThrow({ where: { id: result.trip.id } });
    expect(trip.name).toBe("Kenia & Tansania – Erlebnisreise");
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: result.booking.id } });
    expect(booking).toMatchObject({ tripId: trip.id, pnr: "9Z123456", price: 3249 });
    // FX on the issue day, never on the day of the import.
    expect(booking.fxRateDate?.toISOString()).toBe("2026-03-02T00:00:00.000Z");

    const flights = await prisma.flight.findMany({
      where: { userId },
      orderBy: { departureTime: "asc" },
    });
    expect(flights.map((f) => f.flightNumber)).toEqual(["ET707", "ET308", "ET309", "ET706"]);
    expect(flights.every((f) => f.tripId === trip.id && f.bookingId === booking.id)).toBe(true);
    expect(flights[0]).toMatchObject({ depIata: "FRA", arrIata: "ADD", airlineIata: "ET" });
    // 21:35 in Frankfurt (CEST) is 19:35Z; the +1 arrival lands the next day.
    expect(flights[0].departureTime?.toISOString()).toBe("2026-05-18T19:35:00.000Z");
    expect(flights[0].arrivalTime?.toISOString()).toBe("2026-05-19T03:25:00.000Z");

    const filed = await prisma.document.findUniqueOrThrow({ where: { id: document.id } });
    expect(filed.tripId).toBe(trip.id);
  });

  it("recognises the same invoice again and writes nothing new", async () => {
    const before = await prisma.flight.count({ where: { userId } });
    const res = await commit({ reading: invoiceReading() }).expect(201);
    expect(res.body.data.trip.action).toBe("attach");
    expect(res.body.data.proposal.trip.matchedBy).toBe("bookingReference");
    expect(res.body.data.flights.map((f: { reason?: string }) => f.reason)).toEqual([
      "duplicate",
      "duplicate",
      "duplicate",
      "duplicate",
    ]);
    expect(await prisma.flight.count({ where: { userId } })).toBe(before);
    expect(await prisma.trip.count({ where: { userId } })).toBe(1);
    expect(await prisma.booking.count({ where: { userId } })).toBe(1);
  });

  it("completes the trip from the travel documents: hotels added, flights matched by city", async () => {
    const res = await commit({ reading: documentsReading }).expect(201);
    const result = res.body.data;
    expect(result.trip.action).toBe("attach");
    expect(result.booking.action).toBe("attach");
    // Frankfurt → FRA and Addis Ababa → ADD through the catalogue; ET0707 is ET707.
    expect(result.proposal.flights[0]).toMatchObject({
      action: "skip",
      reason: "duplicate",
      departure: { iata: "FRA", status: "resolved" },
      arrival: { iata: "ADD", status: "resolved" },
    });
    expect(result.stays.map((s: { action: string }) => s.action)).toEqual(["create", "create"]);

    const stays = await prisma.lodgingStay.findMany({
      where: { userId },
      include: { lodging: true },
      orderBy: { checkIn: "asc" },
    });
    expect(stays.map((s) => s.lodging.name)).toEqual([
      "Savanna Example Lodge",
      "Hotel Seeblick Muster",
    ]);
    expect(
      stays.every((s) => s.tripId === result.trip.id && s.bookingId === result.booking.id)
    ).toBe(true);
    expect(stays[0].board).toBe("half");
    // The documents carry no price: the invoice's stands.
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: result.booking.id } });
    expect(booking.price).toBe(3249);
  });

  it("keeps a stored price and says so when a later document disagrees", async () => {
    const res = await preview({ reading: { ...invoiceReading(), totalPrice: 2999 } }).expect(200);
    const { proposal } = res.body.data;
    expect(proposal.booking.storedPrice).toEqual({ price: 3249, currency: "EUR" });
    expect(proposal.warnings).toContainEqual({ code: "priceConflict", subject: "9Z123456" });
  });

  it("never guesses an airport: an ambiguous city skips the leg until the reviewer picks one", async () => {
    const reading = {
      bookingReference: "AMB-1",
      issuedOn: "2026-01-10",
      flights: [
        {
          flightNumber: "KQ100",
          date: "2026-08-01",
          depCity: "Nairobi",
          arrIata: "MBA",
          depTime: "08:00",
          arrTime: "09:00",
        },
      ],
    };
    const first = await preview({ reading }).expect(200);
    const leg = first.body.data.proposal.flights[0];
    expect(leg).toMatchObject({ action: "skip", reason: "unresolvedAirport" });
    expect(leg.departure.status).toBe("ambiguous");
    expect(leg.departure.candidates.map((c: { iata: string }) => c.iata)).toEqual(
      expect.arrayContaining(["NBO", "WIL"])
    );
    expect(first.body.data.proposal.warnings).toContainEqual({
      code: "airportAmbiguous",
      subject: "Nairobi",
    });

    const chosen = await commit({ reading, choices: { airports: { Nairobi: "NBO" } } }).expect(201);
    expect(chosen.body.data.flights[0].action).toBe("create");
    const flight = await prisma.flight.findUniqueOrThrow({
      where: { id: chosen.body.data.flights[0].id },
    });
    expect(flight.depIata).toBe("NBO");
  });

  it("attaches a hand-typed flight of the same number and day instead of doubling it", async () => {
    const typed = await prisma.flight.create({
      data: {
        userId,
        flightNumber: "LH 400",
        depIata: "FRA",
        arrIata: "JFK",
        depLat: 50.03,
        depLon: 8.57,
        arrLat: 40.64,
        arrLon: -73.78,
        depTimezone: "Europe/Berlin",
        departureTime: new Date("2026-09-01T08:00:00Z"),
        arrivalTime: new Date("2026-09-01T16:00:00Z"),
      },
    });
    const res = await commit({
      reading: {
        bookingReference: "ATT-1",
        issuedOn: "2026-02-01",
        flights: [
          {
            flightNumber: "LH400",
            date: "2026-09-01",
            depIata: "FRA",
            arrIata: "JFK",
            depTime: "10:00",
            arrTime: "12:40",
          },
        ],
      },
    }).expect(201);
    expect(res.body.data.flights[0]).toMatchObject({ action: "attach", id: typed.id });
    const stored = await prisma.flight.findUniqueOrThrow({ where: { id: typed.id } });
    expect(stored.tripId).toBe(res.body.data.trip.id);
    expect(stored.bookingId).toBe(res.body.data.booking.id);
  });

  it("writes a dated cruise on the trip, and reports an undated one instead of inventing days", async () => {
    const cruise = {
      bookingReference: "CRU-1",
      issuedOn: "2026-01-05",
      cruiseShip: "Example Star",
      cruiseFrom: "Hamburg",
      cruiseTo: "Bergen",
      cruiseCabin: "8123",
    };
    const undated = await preview({ reading: cruise }).expect(200);
    expect(undated.body.data.proposal.cruise).toMatchObject({ action: "skip", reason: "undated" });
    expect(undated.body.data.proposal.warnings).toContainEqual({
      code: "cruiseUndated",
      subject: "Example Star",
    });

    const res = await commit({
      reading: { ...cruise, cruiseStart: "2026-07-01", cruiseEnd: "2026-07-08" },
    }).expect(201);
    expect(res.body.data.cruise.action).toBe("create");
    const stored = await prisma.cruise.findUniqueOrThrow({
      where: { id: res.body.data.cruise.id },
    });
    expect(stored).toMatchObject({
      shipNameOverride: "Example Star",
      routeName: "Hamburg – Bergen",
      cabinNumber: "8123",
      tripId: res.body.data.trip.id,
      bookingId: res.body.data.booking.id,
    });
  });

  it("refuses a leg that cannot be a flight with its own reason, and writes nothing", async () => {
    const trips = await prisma.trip.count({ where: { userId } });
    const res = await commit({
      reading: {
        bookingReference: "BAD-1",
        issuedOn: "2026-02-01",
        flights: [
          {
            flightNumber: "LH401",
            date: "2026-09-02",
            depIata: "FRA",
            arrIata: "JFK",
            depTime: "10:00",
            arrTime: "03:00",
          },
        ],
      },
    }).expect(422);
    expect(res.body.code).toBe("PACKAGE_FLIGHT_INVALID");
    expect(res.body.field).toBe("flights[0]");
    expect(await prisma.trip.count({ where: { userId } })).toBe(trips);
  });

  it("answers an invalid reading with the contract paths", async () => {
    const res = await preview({ reading: { issuedOn: "2026-02-01" } }).expect(422);
    expect(res.body.code).toBe("PACKAGE_READING_INVALID");
    expect(res.body.issues).toMatch(/^bookingReference/);
  });

  it("says when a document holds no package reading, and hides another account's", async () => {
    const plain = await keptDocument(userId, { parsedDomain: "flight", parsedPayload: {} });
    const missing = await preview({ documentId: plain.id }).expect(422);
    expect(missing.body.code).toBe("PACKAGE_READING_MISSING");

    const theirs = await keptDocument(strangerId, {
      parsedDomain: "package",
      parsedPayload: { domain: "package", package: invoiceReading() },
    });
    await preview({ documentId: theirs.id }).expect(404);
  });
});
