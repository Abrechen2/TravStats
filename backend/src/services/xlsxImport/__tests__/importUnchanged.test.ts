import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { importSheets } from "../importSheets";
import type { IncomingSheet } from "../types";

/**
 * Reading back an untouched export changes nothing (browser acceptance,
 * 2026-09-25): the preview listed every row as "ändern" and applying it
 * rewrote them all — `updatedAt` moved on records nobody had edited, and the
 * preview could not tell the user which rows they had actually changed.
 *
 * The rows below are written the way `frontend/src/lib/xlsx/sheets.ts` writes
 * them, every column included, so a normalisation the importer applies (a day
 * turned into a Date, a list split on commas, a country written in the
 * reader's language) is exercised exactly as a real round trip would.
 */

const USER = "xlsx-unchanged";
const PORT_NAME = "Xlsx-Unchanged-Hafen";

let userId: string;
let portId: number;

const iso = (d: Date | null): string => (d ? d.toISOString() : "");
const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const ref = (name: string, id: string | null): string => (id ? `${name} [${id}]` : "");

async function seed(): Promise<void> {
  const trip = await prisma.trip.create({ data: { userId, name: "Italien 2024" } });
  await prisma.flight.create({
    data: {
      userId,
      airline: "Lufthansa",
      flightNumber: "LH1860",
      depIata: "MUC",
      depLat: 48.35,
      depLon: 11.78,
      arrIata: "HEL",
      arrLat: 60.31,
      arrLon: 24.96,
      departureTime: new Date("2024-04-02T07:00:00Z"),
      arrivalTime: new Date("2024-04-02T09:30:00Z"),
      status: "flown",
      aircraft: "A320",
      seatNumber: "12A",
      seatClass: "business",
      category: "vacation",
      price: 199.9,
      currency: "EUR",
      notes: "Fensterplatz",
      tripId: trip.id,
    },
  });
  const place = await prisma.place.create({
    data: {
      userId,
      name: "Trevi-Brunnen",
      category: "landmark",
      lat: 41.9009,
      lon: 12.4833,
      city: "Rom",
      country: "Italy",
      isoCountryCode: "IT",
      visited: true,
    },
  });
  await prisma.placeVisit.create({
    data: {
      userId,
      placeId: place.id,
      visitedAt: new Date("2024-04-05"),
      rating: 4,
      notes: "Abend",
    },
  });
  await prisma.cruise.create({
    data: {
      userId,
      cruiseLine: "AIDA",
      routeName: "Westliches Mittelmeer",
      shipNameOverride: "AIDAcosma",
      startDate: new Date("2024-04-03"),
      endDate: new Date("2024-04-10"),
      status: "flown",
      cabinNumber: "8123",
      cabinType: "balcony",
      deck: 8,
      bookingReference: "ABC123",
      price: 1899.5,
      currency: "EUR",
      notes: "Mit Getränkepaket",
      tags: ["Mittelmeer", "Sommer"],
      companions: ["Anna", "Ben"],
      tripId: trip.id,
      stops: {
        create: [
          {
            dayNumber: 1,
            portId,
            isAtSea: false,
            departureTime: new Date("2024-04-03T18:00:00Z"),
            excursionNote: "Altstadt",
          },
          { dayNumber: 2, isAtSea: true },
        ],
      },
    },
  });
  const lodging = await prisma.lodging.create({
    data: {
      userId,
      name: "Hotel Okura",
      type: "hotel",
      address: "2-10-4 Toranomon",
      city: "Tokyo",
      country: "Japan",
      lat: 35.6672,
      lon: 139.7452,
      stars: 5,
      amenities: ["Pool", "Spa"],
      notes: "Ruhig",
    },
  });
  await prisma.lodgingStay.create({
    data: {
      userId,
      lodgingId: lodging.id,
      checkIn: new Date("2024-05-01"),
      checkOut: new Date("2024-05-04"),
      roomNumber: "1204",
      roomCategory: "Deluxe King",
      board: "breakfast",
      pricePerNight: 200,
      totalPrice: 600,
      currency: "EUR",
      status: "completed",
    },
  });
}

/** Every sheet, every column, as the frontend export writes it (German UI). */
async function exportAll(): Promise<IncomingSheet[]> {
  const flights = await prisma.flight.findMany({ where: { userId }, include: { trip: true } });
  const places = await prisma.place.findMany({ where: { userId }, include: { visits: true } });
  const cruises = await prisma.cruise.findMany({
    where: { userId },
    include: { trip: true, stops: { include: { port: true } } },
  });
  const lodgings = await prisma.lodging.findMany({ where: { userId }, include: { stays: true } });

  return [
    {
      key: "flights",
      rows: flights.map((f) => ({
        id: f.id,
        airline: str(f.airline),
        flightNumber: str(f.flightNumber),
        depIata: str(f.depIata),
        arrIata: str(f.arrIata),
        departureTime: iso(f.departureTime),
        arrivalTime: iso(f.arrivalTime),
        status: f.status,
        aircraft: str(f.aircraft),
        aircraftRegistration: str(f.aircraftRegistration),
        seatNumber: str(f.seatNumber),
        seatClass: str(f.seatClass),
        bookingReference: str(f.bookingReference),
        price: str(f.price),
        currency: str(f.currency),
        category: str(f.category),
        tripId: f.trip ? ref(f.trip.name, f.trip.id) : "",
        notes: str(f.notes),
      })),
    },
    {
      key: "places",
      rows: places.map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        address: str(p.address),
        city: str(p.city),
        // `placeCountryLabel`: the ISO code, named in the reader's language.
        country: p.isoCountryCode === "IT" ? "Italien" : str(p.country),
        lat: str(p.lat),
        lon: str(p.lon),
        visited: String(p.visited),
        notes: str(p.notes),
      })),
    },
    {
      key: "placeVisits",
      rows: places.flatMap((p) =>
        p.visits.map((v) => ({
          id: v.id,
          placeId: ref(`${p.name} (${p.city})`, p.id),
          visitedAt: iso(v.visitedAt),
          rating: str(v.rating),
          notes: str(v.notes),
        }))
      ),
    },
    {
      key: "cruises",
      rows: cruises.map((c) => ({
        id: c.id,
        cruiseLine: str(c.cruiseLine),
        ship: str(c.shipNameOverride),
        routeName: str(c.routeName),
        startDate: iso(c.startDate),
        endDate: iso(c.endDate),
        status: c.status,
        departurePort: "",
        arrivalPort: "",
        cabinNumber: str(c.cabinNumber),
        cabinType: str(c.cabinType),
        deck: str(c.deck),
        price: str(c.price),
        currency: str(c.currency),
        bookingReference: str(c.bookingReference),
        tripId: c.trip ? ref(c.trip.name, c.trip.id) : "",
        companions: c.companions.join(", "),
        tags: c.tags.join(", "),
        notes: str(c.notes),
      })),
    },
    {
      key: "cruiseStops",
      rows: cruises.flatMap((c) =>
        c.stops.map((s) => ({
          id: s.id,
          cruiseId: ref(`${c.routeName} (${iso(c.startDate).slice(0, 10)})`, c.id),
          dayNumber: String(s.dayNumber),
          port: s.port?.name ?? s.unresolvedPortName ?? "",
          isAtSea: String(s.isAtSea),
          arrivalTime: iso(s.arrivalTime),
          departureTime: iso(s.departureTime),
          excursionNote: str(s.excursionNote),
        }))
      ),
    },
    {
      key: "lodging",
      rows: lodgings.map((l) => ({
        id: l.id,
        name: l.name,
        type: l.type,
        chain: "",
        address: str(l.address),
        city: str(l.city),
        country: str(l.country),
        lat: str(l.lat),
        lon: str(l.lon),
        stars: str(l.stars),
        visited: String(l.visited),
        amenities: l.amenities.join(", "),
        notes: str(l.notes),
      })),
    },
    {
      key: "lodgingStays",
      rows: lodgings.flatMap((l) =>
        l.stays.map((s) => ({
          id: s.id,
          lodgingId: ref(`${l.name} (${l.city})`, l.id),
          checkIn: iso(s.checkIn),
          checkOut: iso(s.checkOut),
          nights: "3",
          status: s.status,
          roomNumber: str(s.roomNumber),
          roomCategory: str(s.roomCategory),
          board: str(s.board),
          pricePerNight: str(s.pricePerNight),
          totalPrice: str(s.totalPrice),
          currency: s.currency,
        }))
      ),
    },
  ];
}

/** `updatedAt` of every record the workbook carries, keyed by id. */
async function stamps(): Promise<Record<string, number>> {
  const rows = [
    ...(await prisma.flight.findMany({ where: { userId } })),
    ...(await prisma.place.findMany({ where: { userId } })),
    ...(await prisma.placeVisit.findMany({ where: { userId } })),
    ...(await prisma.cruise.findMany({ where: { userId } })),
    ...(await prisma.cruiseStop.findMany({ where: { cruise: { userId } } })),
    ...(await prisma.lodging.findMany({ where: { userId } })),
    ...(await prisma.lodgingStay.findMany({ where: { userId } })),
  ];
  return Object.fromEntries(rows.map((r) => [r.id, r.updatedAt.getTime()]));
}

const run = (sheets: IncomingSheet[], dryRun: boolean) =>
  importSheets(sheets, { userId, dryRun, mode: "merge" });

const actions = (result: Awaited<ReturnType<typeof run>>) =>
  result.flatMap((s) => s.rows.map((r) => `${s.key}:${r.action}`));

beforeAll(async () => {
  const port = await prisma.port.create({
    data: { name: PORT_NAME, lat: 42.09, lon: 11.79, isUserAdded: true },
  });
  portId = port.id;
});

beforeEach(async () => {
  await prisma.user.deleteMany({ where: { username: USER } });
  const u = await prisma.user.create({
    data: { username: USER, passwordHash: await hashPassword("password123") },
  });
  userId = u.id;
  await seed();
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { username: USER } });
  await prisma.port.deleteMany({ where: { id: portId } });
  await prisma.$disconnect();
});

describe("re-importing an untouched export", () => {
  it("previews every row as unchanged", async () => {
    const result = await run(await exportAll(), true);

    expect(actions(result)).toEqual([
      "flights:skip",
      "places:skip",
      "placeVisits:skip",
      "cruises:skip",
      "cruiseStops:skip",
      "cruiseStops:skip",
      "lodging:skip",
      "lodgingStays:skip",
    ]);
    expect(result.every((s) => s.updated === 0)).toBe(true);
  });

  it("writes nothing when applied — updatedAt stays where it was", async () => {
    const sheets = await exportAll();
    const before = await stamps();
    // Past the timestamp resolution, so a rewrite could not land on the same ms.
    await new Promise((resolve) => setTimeout(resolve, 20));

    await run(sheets, false);

    expect(await stamps()).toEqual(before);
  });

  it("still updates the one row whose cell was edited, and only that row", async () => {
    const sheets = await exportAll();
    const cruises = sheets.find((s) => s.key === "cruises");
    if (!cruises) throw new Error("no cruises sheet");
    cruises.rows[0] = { ...cruises.rows[0], cabinNumber: "9001" };

    const result = await run(sheets, false);

    expect(actions(result).filter((a) => a.endsWith(":update"))).toEqual(["cruises:update"]);
    const cruise = await prisma.cruise.findFirstOrThrow({ where: { userId } });
    expect(cruise.cabinNumber).toBe("9001");
  });
});
