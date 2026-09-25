import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { importSheets } from "../importSheets";
import type { IncomingSheet } from "../types";

/**
 * The workbook as a way to MOVE entries (tester report, #dev-talk 2026-09-20
 * and 2026-09-25; owner decision 2026-09-25).
 *
 * The tester exported one account, deleted the ids and read the file into a
 * second account. Flights came across; every lodging and cruise row was
 * refused with "Eine neue Unterkunft lässt sich nicht aus der Tabelle anlegen",
 * and the stops and stays sheets were not even sent. These tests replay that:
 * rows shaped exactly as the export writes them (see
 * `frontend/src/lib/xlsx/sheets.ts`), read from account A, imported into B.
 */

const ROUTE = "Westliches Mittelmeer";
const HOTEL = "Hotel Okura";
const PORT_NAME = "Xlsx-Testhafen Civitavecchia";

let aId: string;
let bId: string;
let portId: number;

async function makeUser(username: string): Promise<string> {
  await prisma.user.deleteMany({ where: { username } });
  const u = await prisma.user.create({
    data: { username, passwordHash: await hashPassword("password123") },
  });
  return u.id;
}

/** The source account: one entry of every kind the workbook carries. */
async function seedSource(userId: string): Promise<void> {
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
      visited: true,
    },
  });
  await prisma.placeVisit.createMany({
    data: [
      { userId, placeId: place.id, visitedAt: new Date("2024-04-05"), notes: "Mittag" },
      { userId, placeId: place.id, visitedAt: new Date("2024-04-05"), notes: "Abend" },
    ],
  });
  await prisma.cruise.create({
    data: {
      userId,
      cruiseLine: "AIDA",
      routeName: ROUTE,
      shipNameOverride: "AIDAcosma",
      startDate: new Date("2024-04-03"),
      endDate: new Date("2024-04-10"),
      status: "flown",
      price: 1899.5,
      currency: "EUR",
      stops: {
        create: [
          { dayNumber: 1, portId, isAtSea: false },
          { dayNumber: 2, isAtSea: true },
        ],
      },
    },
  });
  const lodging = await prisma.lodging.create({
    data: { userId, name: HOTEL, city: "Tokyo", country: "Japan", lat: 35.6672, lon: 139.7452 },
  });
  await prisma.lodgingStay.create({
    data: {
      userId,
      lodgingId: lodging.id,
      checkIn: new Date("2024-05-01"),
      checkOut: new Date("2024-05-04"),
      roomNumber: "1204",
      totalPrice: 600,
      currency: "EUR",
      status: "completed",
    },
  });
}

const iso = (d: Date | null): string => (d ? d.toISOString() : "");
const ref = (name: string, id: string | null): string => (id ? `${name} [${id}]` : name);

/**
 * The workbook of one account, as the frontend export writes it.
 *
 * `labels: "plain"` writes the parent label the way exports did before this
 * fix (the bare name) — which is what the tester's file carries.
 */
async function exportOf(
  userId: string,
  opts: { stripIds?: boolean; labels?: "plain" | "qualified" } = {}
): Promise<IncomingSheet[]> {
  const idCell = (id: string) => (opts.stripIds ? "" : id);
  const qualified = opts.labels !== "plain";
  const withQ = (base: string, q: string | null) => (qualified && q ? `${base} (${q})` : base);

  const flights = await prisma.flight.findMany({ where: { userId }, include: { trip: true } });
  const places = await prisma.place.findMany({ where: { userId }, include: { visits: true } });
  const cruises = await prisma.cruise.findMany({
    where: { userId },
    include: { stops: { include: { port: true } } },
  });
  const lodgings = await prisma.lodging.findMany({ where: { userId }, include: { stays: true } });

  return [
    {
      key: "flights",
      rows: flights.map((f) => ({
        id: idCell(f.id),
        airline: f.airline ?? "",
        flightNumber: f.flightNumber ?? "",
        depIata: f.depIata ?? "",
        arrIata: f.arrIata ?? "",
        departureTime: iso(f.departureTime),
        arrivalTime: iso(f.arrivalTime),
        status: f.status,
        tripId: f.trip ? ref(f.trip.name, f.trip.id) : "",
      })),
    },
    {
      key: "places",
      rows: places.map((p) => ({
        id: idCell(p.id),
        name: p.name,
        category: p.category,
        city: p.city ?? "",
        lat: String(p.lat),
        lon: String(p.lon),
        visited: String(p.visited),
      })),
    },
    {
      key: "placeVisits",
      rows: places.flatMap((p) =>
        p.visits.map((v) => ({
          id: idCell(v.id),
          placeId: ref(withQ(p.name, p.city), p.id),
          visitedAt: iso(v.visitedAt),
          notes: v.notes ?? "",
        }))
      ),
    },
    {
      key: "cruises",
      rows: cruises.map((c) => ({
        id: idCell(c.id),
        cruiseLine: c.cruiseLine ?? "",
        ship: c.shipNameOverride ?? "",
        routeName: c.routeName ?? "",
        startDate: iso(c.startDate),
        endDate: iso(c.endDate),
        status: c.status,
        price: String(c.price ?? ""),
        currency: c.currency ?? "",
      })),
    },
    {
      key: "cruiseStops",
      rows: cruises.flatMap((c) =>
        c.stops.map((s) => ({
          id: idCell(s.id),
          cruiseId: ref(withQ(c.routeName ?? "", iso(c.startDate).slice(0, 10)), c.id),
          dayNumber: String(s.dayNumber),
          port: s.port?.name ?? s.unresolvedPortName ?? "",
          isAtSea: String(s.isAtSea),
        }))
      ),
    },
    {
      key: "lodging",
      rows: lodgings.map((l) => ({
        id: idCell(l.id),
        name: l.name,
        type: l.type,
        city: l.city ?? "",
        country: l.country ?? "",
        lat: String(l.lat ?? ""),
        lon: String(l.lon ?? ""),
        visited: String(l.visited),
      })),
    },
    {
      key: "lodgingStays",
      rows: lodgings.flatMap((l) =>
        l.stays.map((s) => ({
          id: idCell(s.id),
          lodgingId: ref(withQ(l.name, l.city), l.id),
          checkIn: iso(s.checkIn),
          checkOut: iso(s.checkOut),
          nights: "3",
          status: s.status,
          roomNumber: s.roomNumber ?? "",
          totalPrice: String(s.totalPrice ?? ""),
          currency: s.currency,
        }))
      ),
    },
  ];
}

async function countsOf(userId: string) {
  return {
    flights: await prisma.flight.count({ where: { userId } }),
    places: await prisma.place.count({ where: { userId } }),
    visits: await prisma.placeVisit.count({ where: { userId } }),
    cruises: await prisma.cruise.count({ where: { userId } }),
    stops: await prisma.cruiseStop.count({ where: { cruise: { userId } } }),
    lodgings: await prisma.lodging.count({ where: { userId } }),
    stays: await prisma.lodgingStay.count({ where: { userId } }),
  };
}

const ONE_OF_EACH = {
  flights: 1,
  places: 1,
  visits: 2,
  cruises: 1,
  stops: 2,
  lodgings: 1,
  stays: 1,
};

const run = (userId: string, sheets: IncomingSheet[], dryRun = false) =>
  importSheets(sheets, { userId, dryRun, mode: "merge" });

const errorsOf = (result: Awaited<ReturnType<typeof run>>) =>
  result.flatMap((s) => s.rows.filter((r) => r.action === "error").map((r) => [s.key, r.message]));

beforeAll(async () => {
  const port = await prisma.port.create({
    data: { name: PORT_NAME, lat: 42.09, lon: 11.79, isUserAdded: true },
  });
  portId = port.id;
});

beforeEach(async () => {
  aId = await makeUser("xlsxmove-a");
  bId = await makeUser("xlsxmove-b");
  await seedSource(aId);
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { username: { in: ["xlsxmove-a", "xlsxmove-b"] } } });
  await prisma.port.deleteMany({ where: { id: portId } });
  await prisma.$disconnect();
});

describe("moving entries to another account", () => {
  it("creates every domain in the target account when the ids are kept", async () => {
    const sourceBefore = await countsOf(aId);
    const result = await run(bId, await exportOf(aId));

    expect(errorsOf(result)).toEqual([]);
    expect(await countsOf(bId)).toEqual(ONE_OF_EACH);
    // The source account is untouched — nothing re-owned, nothing changed.
    expect(await countsOf(aId)).toEqual(sourceBefore);
  });

  it("creates every domain when the ids were deleted by hand (the tester's file)", async () => {
    const result = await run(bId, await exportOf(aId, { stripIds: true, labels: "plain" }));

    expect(errorsOf(result)).toEqual([]);
    expect(await countsOf(bId)).toEqual(ONE_OF_EACH);
  });

  it("hangs every child under the target account's own parent", async () => {
    await run(bId, await exportOf(aId, { stripIds: true }));

    const stay = await prisma.lodgingStay.findFirstOrThrow({
      where: { userId: bId },
      include: { lodging: true },
    });
    expect(stay.lodging.userId).toBe(bId);
    expect(stay.lodging.name).toBe(HOTEL);
    expect(stay.roomNumber).toBe("1204");
    // Derived by the shared stay writer, not copied from the file.
    expect(stay.status).toBe("completed");

    const stops = await prisma.cruiseStop.findMany({
      where: { cruise: { userId: bId } },
      orderBy: { dayNumber: "asc" },
    });
    expect(stops.map((s) => [s.dayNumber, s.portId, s.isAtSea])).toEqual([
      [1, portId, false],
      [2, null, true],
    ]);

    const visits = await prisma.placeVisit.findMany({
      where: { userId: bId },
      include: { place: true },
    });
    expect(visits.every((v) => v.place.userId === bId)).toBe(true);
  });

  it("reads the same id-less file twice without duplicating anything", async () => {
    const file = await exportOf(aId, { stripIds: true });
    await run(bId, file);
    const second = await run(bId, file);

    expect(await countsOf(bId)).toEqual(ONE_OF_EACH);
    expect(second.every((s) => s.created === 0)).toBe(true);
    const actions = second.flatMap((s) => s.rows.map((r) => `${r.action}:${r.message ?? ""}`));
    expect(new Set(actions)).toEqual(new Set(["update:matched_existing"]));
  });

  it("reads a file that still carries the other account's ids twice without duplicating", async () => {
    const file = await exportOf(aId);
    await run(bId, file);
    await run(bId, file);
    expect(await countsOf(bId)).toEqual(ONE_OF_EACH);
  });

  it("previews every row as a create and writes nothing on a dry run", async () => {
    const result = await run(bId, await exportOf(aId, { stripIds: true }), true);

    expect(errorsOf(result)).toEqual([]);
    const byKey = Object.fromEntries(result.map((s) => [s.key, s.created]));
    expect(byKey).toEqual({
      flights: 1,
      places: 1,
      placeVisits: 2,
      cruises: 1,
      cruiseStops: 2,
      lodging: 1,
      lodgingStays: 1,
    });
    expect(await countsOf(bId)).toEqual({
      flights: 0,
      places: 0,
      visits: 0,
      cruises: 0,
      stops: 0,
      lodgings: 0,
      stays: 0,
    });
  });

  it("links a moved flight to the target's trip of the same name, and only that", async () => {
    const own = await prisma.trip.create({ data: { userId: bId, name: "Italien 2024" } });
    await run(bId, await exportOf(aId));

    const flight = await prisma.flight.findFirstOrThrow({ where: { userId: bId } });
    expect(flight.tripId).toBe(own.id);
  });

  it("leaves a moved flight unlinked, and says so, when the target has no such trip", async () => {
    const [flights] = await run(bId, await exportOf(aId));

    const flight = await prisma.flight.findFirstOrThrow({ where: { userId: bId } });
    expect(flight.tripId).toBeNull();
    expect(flights.rows[0].notes).toEqual(["trip_not_linked"]);
    // The source trip gained nothing from the target account.
    const sourceTrip = await prisma.trip.findFirstOrThrow({
      where: { userId: aId },
      include: { flights: true },
    });
    expect(sourceTrip.flights.every((f) => f.userId === aId)).toBe(true);
  });
});

describe("references never reach another account", () => {
  it("refuses a stay whose lodging exists only in the other account", async () => {
    const sheets = await exportOf(aId);
    const staysOnly = sheets.filter((s) => s.key === "lodgingStays");
    const aLodging = await prisma.lodging.findFirstOrThrow({ where: { userId: aId } });

    const [stays] = await run(bId, staysOnly);

    expect(stays.errors).toBe(1);
    expect(stays.rows[0].message).toBe("unknown_lodging");
    expect(await prisma.lodgingStay.count({ where: { lodgingId: aLodging.id } })).toBe(1);
    expect(await prisma.lodgingStay.count({ where: { userId: bId } })).toBe(0);
  });

  it("refuses a stop whose cruise exists only in the other account", async () => {
    const sheets = await exportOf(aId);
    const [stops] = await run(
      bId,
      sheets.filter((s) => s.key === "cruiseStops")
    );
    expect(stops.errors).toBe(2);
    expect(stops.rows[0].message).toBe("unknown_cruise");
  });

  it("never updates the other account's stay or stop through their ids", async () => {
    const aStay = await prisma.lodgingStay.findFirstOrThrow({ where: { userId: aId } });
    const aStop = await prisma.cruiseStop.findFirstOrThrow({
      where: { cruise: { userId: aId }, dayNumber: 1 },
    });
    const bLodging = await prisma.lodging.create({ data: { userId: bId, name: HOTEL } });
    const bCruise = await prisma.cruise.create({
      data: { userId: bId, routeName: "Eigene Route" },
    });

    await run(bId, [
      {
        key: "lodgingStays",
        rows: [{ id: aStay.id, lodgingId: `${HOTEL} [${bLodging.id}]`, roomNumber: "9999" }],
      },
      {
        key: "cruiseStops",
        rows: [
          {
            id: aStop.id,
            cruiseId: `Eigene Route [${bCruise.id}]`,
            dayNumber: "1",
            isAtSea: "true",
            excursionNote: "gekapert",
          },
        ],
      },
    ]);

    const staysAfter = await prisma.lodgingStay.findUniqueOrThrow({ where: { id: aStay.id } });
    expect(staysAfter.roomNumber).toBe("1204");
    expect(staysAfter.userId).toBe(aId);
    const stopAfter = await prisma.cruiseStop.findUniqueOrThrow({ where: { id: aStop.id } });
    expect(stopAfter.excursionNote).toBeNull();
    expect(stopAfter.isAtSea).toBe(false);
    // …and the rows landed in B instead.
    expect(await prisma.lodgingStay.count({ where: { lodgingId: bLodging.id } })).toBe(1);
    expect(await prisma.cruiseStop.count({ where: { cruiseId: bCruise.id } })).toBe(1);
  });

  it("refuses a name that matches two of the target's parents instead of guessing", async () => {
    await prisma.lodging.createMany({
      data: [
        { userId: bId, name: HOTEL, city: "Tokyo" },
        { userId: bId, name: HOTEL, city: "Tokyo" },
      ],
    });
    const [stays] = await run(bId, [
      {
        key: "lodgingStays",
        rows: [{ id: "", lodgingId: HOTEL, checkIn: "2024-06-01", checkOut: "2024-06-02" }],
      },
    ]);
    expect(stays.rows[0].message).toBe("ambiguous_lodging");
  });
});

describe("editing inside one account", () => {
  it("updates an existing stay and stop by their ids", async () => {
    const stay = await prisma.lodgingStay.findFirstOrThrow({ where: { userId: aId } });
    const stop = await prisma.cruiseStop.findFirstOrThrow({
      where: { cruise: { userId: aId }, dayNumber: 2 },
    });

    const result = await run(aId, [
      { key: "lodgingStays", rows: [{ id: stay.id, roomNumber: "0815" }] },
      {
        key: "cruiseStops",
        rows: [{ id: stop.id, dayNumber: "2", isAtSea: "true", excursionNote: "Seetag" }],
      },
    ]);

    expect(result.map((s) => s.updated)).toEqual([1, 1]);
    expect(
      (await prisma.lodgingStay.findUniqueOrThrow({ where: { id: stay.id } })).roomNumber
    ).toBe("0815");
    expect(
      (await prisma.cruiseStop.findUniqueOrThrow({ where: { id: stop.id } })).excursionNote
    ).toBe("Seetag");
  });

  it("keeps an unknown stop port as an unresolved stop instead of dropping it", async () => {
    const cruise = await prisma.cruise.findFirstOrThrow({ where: { userId: aId } });
    await run(aId, [
      {
        key: "cruiseStops",
        rows: [{ id: "", cruiseId: `x [${cruise.id}]`, dayNumber: "3", port: "Nirgendhafen" }],
      },
    ]);
    const stop = await prisma.cruiseStop.findFirstOrThrow({
      where: { cruiseId: cruise.id, dayNumber: 3 },
    });
    expect([stop.portId, stop.isAtSea, stop.unresolvedPortName]).toEqual([
      null,
      false,
      "Nirgendhafen",
    ]);
  });
});
