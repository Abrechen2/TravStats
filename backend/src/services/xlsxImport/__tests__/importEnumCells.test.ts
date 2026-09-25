import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { importSheets } from "../importSheets";
import type { IncomingSheet, SheetOutcome } from "../types";

/**
 * An enum cell holding text the field does not know (browser acceptance,
 * 2026-09-25). The demo seed and older data carry free-text cabin types
 * ("Außenkabine", "Star Class Suite"); the importer refused every such cruise
 * row whole — "Zeile … unvollständig oder ungültiger Wert" — and a preview
 * instance lost every cruise it had on a round trip.
 *
 * The rule, for every enum column of every sheet: an obvious synonym maps onto
 * the field's value; anything else leaves the field EMPTY, is named on the
 * row, and the row is applied.
 */

const USER = "xlsx-enum-cells";
let userId: string;

const run = (sheets: IncomingSheet[], dryRun = false) =>
  importSheets(sheets, { userId, dryRun, mode: "merge" });

const sheetOf = (result: SheetOutcome[], key: string): SheetOutcome => {
  const sheet = result.find((s) => s.key === key);
  if (!sheet) throw new Error(`no ${key} outcome`);
  return sheet;
};

const cruiseRow = (routeName: string, cabinType: string) => ({
  id: "",
  cruiseLine: "AIDA",
  ship: "AIDAcosma",
  routeName,
  startDate: "2024-04-03",
  endDate: "2024-04-10",
  cabinType,
});

beforeEach(async () => {
  await prisma.user.deleteMany({ where: { username: USER } });
  const u = await prisma.user.create({
    data: { username: USER, passwordHash: await hashPassword("password123") },
  });
  userId = u.id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { username: USER } });
  await prisma.$disconnect();
});

describe("cabin type", () => {
  it("maps German and English synonyms onto the stored value", async () => {
    const result = await run([
      {
        key: "cruises",
        rows: [
          cruiseRow("Innen", "Innenkabine"),
          cruiseRow("Aussen", "Außenkabine"),
          cruiseRow("Aussen2", "Aussenkabine"),
          cruiseRow("Meer", "Meerblick"),
          cruiseRow("Balkon", "Balkonkabine"),
          cruiseRow("Suite", "Star Class Suite"),
          cruiseRow("Stored", "Balcony"),
        ],
      },
    ]);

    expect(sheetOf(result, "cruises").errors).toBe(0);
    const cruises = await prisma.cruise.findMany({ where: { userId } });
    const byRoute = Object.fromEntries(cruises.map((c) => [c.routeName, c.cabinType]));
    expect(byRoute).toEqual({
      Innen: "inside",
      Aussen: "oceanview",
      Aussen2: "oceanview",
      Meer: "oceanview",
      Balkon: "balcony",
      Suite: "suite",
      Stored: "balcony",
    });
  });

  it("imports the row with an EMPTY cabin type when the text names none", async () => {
    const preview = await run(
      [{ key: "cruises", rows: [cruiseRow("Karibik", "Havana Cabana")] }],
      true
    );
    const row = sheetOf(preview, "cruises").rows[0];
    expect(row.action).toBe("create");
    expect(row.dropped).toEqual([{ field: "cabinType", value: "Havana Cabana" }]);

    await run([{ key: "cruises", rows: [cruiseRow("Karibik", "Havana Cabana")] }]);
    const cruise = await prisma.cruise.findFirstOrThrow({ where: { userId } });
    expect(cruise.cabinType).toBeNull();
  });
});

describe("the other enum columns follow the same rule", () => {
  it("flight seat class and category: unknown text is left empty, the flight is created", async () => {
    const result = await run([
      {
        key: "flights",
        rows: [
          {
            airline: "Lufthansa",
            flightNumber: "LH1",
            depIata: "FRA",
            arrIata: "JFK",
            departureTime: "2024-06-01T10:00:00.000Z",
            seatClass: "Holzklasse",
            category: "Dienstreise mit Urlaub",
          },
        ],
      },
    ]);
    const row = sheetOf(result, "flights").rows[0];
    expect(row.action).toBe("create");
    expect(row.dropped).toEqual([
      { field: "seatClass", value: "Holzklasse" },
      { field: "category", value: "Dienstreise mit Urlaub" },
    ]);
    const flight = await prisma.flight.findFirstOrThrow({ where: { userId } });
    expect([flight.seatClass, flight.category]).toEqual([null, null]);
  });

  it("a flight exported with status 'duplicated' comes back instead of being refused", async () => {
    const result = await run([
      {
        key: "flights",
        rows: [
          {
            airline: "Lufthansa",
            flightNumber: "LH2",
            depIata: "FRA",
            arrIata: "JFK",
            departureTime: "2024-06-02T10:00:00.000Z",
            status: "duplicated",
          },
        ],
      },
    ]);
    expect(sheetOf(result, "flights").rows[0].action).toBe("create");
  });

  it("lodging type and stay board: unknown text is left empty, both rows are created", async () => {
    const result = await run([
      { key: "lodging", rows: [{ name: "Burg Eltz", city: "Wierschem", type: "Schloss" }] },
      {
        key: "lodgingStays",
        rows: [
          {
            lodgingId: "Burg Eltz (Wierschem)",
            checkIn: "2024-07-01",
            checkOut: "2024-07-03",
            board: "Frühstück extra",
          },
        ],
      },
    ]);
    expect(sheetOf(result, "lodging").rows[0].action).toBe("create");
    expect(sheetOf(result, "lodging").rows[0].dropped).toEqual([
      { field: "type", value: "Schloss" },
    ]);
    expect(sheetOf(result, "lodgingStays").rows[0].action).toBe("create");
    expect(sheetOf(result, "lodgingStays").rows[0].dropped).toEqual([
      { field: "board", value: "Frühstück extra" },
    ]);
    const stay = await prisma.lodgingStay.findFirstOrThrow({ where: { userId } });
    expect(stay.board).toBeNull();
  });

  it("place category: a new place is created, an existing one keeps its category", async () => {
    const existing = await prisma.place.create({
      data: { userId, name: "Hofbräuhaus", category: "restaurant", lat: 48.1376, lon: 11.5799 },
    });
    const result = await run([
      {
        key: "places",
        rows: [
          { name: "Augustiner", category: "Biergarten", lat: "48.14", lon: "11.55" },
          { id: existing.id, name: "Hofbräuhaus", category: "Biergarten" },
        ],
      },
    ]);
    const rows = sheetOf(result, "places").rows;
    expect(rows.map((r) => r.action)).toEqual(["create", "skip"]);
    expect(rows[0].dropped).toEqual([{ field: "category", value: "Biergarten" }]);
    // The existing place keeps its category, and the outcome says so — the
    // preview read "left empty" here, which was not what happened.
    expect(rows[1].dropped).toEqual([{ field: "category", value: "Biergarten", kept: true }]);
    const places = await prisma.place.findMany({ where: { userId }, orderBy: { name: "asc" } });
    expect(places.map((p) => [p.name, p.category])).toEqual([
      ["Augustiner", "other"],
      ["Hofbräuhaus", "restaurant"],
    ]);
  });
});

describe("an unknown cell on an existing entry is reported as kept, not emptied", () => {
  it("an updated flight keeps its stored seat class and the drop says kept", async () => {
    const flight = {
      airline: "Lufthansa",
      flightNumber: "LH3",
      depIata: "FRA",
      arrIata: "JFK",
      departureTime: "2024-06-03T10:00:00.000Z",
      seatClass: "business",
    };
    await run([{ key: "flights", rows: [flight] }]);
    const stored = await prisma.flight.findFirstOrThrow({ where: { userId } });

    const result = await run([
      {
        key: "flights",
        rows: [{ ...flight, id: stored.id, seatClass: "Holzklasse", aircraft: "A350" }],
      },
    ]);
    const row = sheetOf(result, "flights").rows[0];
    expect(row.action).toBe("update");
    expect(row.dropped).toEqual([{ field: "seatClass", value: "Holzklasse", kept: true }]);
    const after = await prisma.flight.findUniqueOrThrow({ where: { id: stored.id } });
    expect(after.seatClass).toBe("business");
  });
});
