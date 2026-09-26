import { prisma } from "../../../db";
import { importSheets } from "../importSheets";

/**
 * Companions and tags from the spreadsheet are written the way the forms write
 * them: the name list AND the link rows the companion pages, statistics and
 * export read. The cruise importer used to write the names alone, so a
 * companion typed into the sheet showed on the cruise card and nowhere else;
 * the flight sheet carried neither column at all.
 */
describe("spreadsheet import — companions and tags", () => {
  const USER = "xlsxcompanions";
  let userId: string;
  const ctx = () => ({ userId, mode: "merge" as const, dryRun: false });

  const flightRow = (over: Record<string, string> = {}): Record<string, string> => ({
    airline: "Lufthansa",
    flightNumber: "LH400",
    depIata: "FRA",
    arrIata: "JFK",
    departureTime: "2025-05-01T10:00:00.000Z",
    arrivalTime: "2025-05-01T18:00:00.000Z",
    status: "flown",
    companions: "Anna, Ben",
    tags: "work, nyc",
    ...over,
  });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
    userId = (await prisma.user.create({ data: { username: USER, passwordHash: "x" } })).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
    await prisma.$disconnect();
  });

  it("creates a flight with its tags and linked companions", async () => {
    const [outcome] = await importSheets([{ key: "flights", rows: [flightRow()] }], ctx());
    expect(outcome).toMatchObject({ created: 1, errors: 0 });
    const flight = await prisma.flight.findFirstOrThrow({
      where: { userId },
      include: { companionLinks: { include: { companion: true }, orderBy: { position: "asc" } } },
    });
    expect(flight.tags).toEqual(["work", "nyc"]);
    expect(flight.companions).toEqual(["Anna", "Ben"]);
    expect(flight.companionLinks.map((l) => l.companion.displayName)).toEqual(["Anna", "Ben"]);
  });

  it("leaves an unchanged row alone, and relinks when the companions change", async () => {
    const flight = await prisma.flight.findFirstOrThrow({ where: { userId } });
    const [same] = await importSheets(
      [{ key: "flights", rows: [flightRow({ id: flight.id })] }],
      ctx()
    );
    expect(same).toMatchObject({ updated: 0, skipped: 1 });

    const [changed] = await importSheets(
      [{ key: "flights", rows: [flightRow({ id: flight.id, companions: "Carla" })] }],
      ctx()
    );
    expect(changed).toMatchObject({ updated: 1 });
    const links = await prisma.flightCompanion.findMany({
      where: { flightId: flight.id },
      include: { companion: true },
    });
    expect(links.map((l) => l.companion.displayName)).toEqual(["Carla"]);
  });

  it("links a cruise's companions when the sheet changes them", async () => {
    const cruise = await prisma.cruise.create({
      data: {
        userId,
        routeName: "Norwegen",
        startDate: new Date("2025-06-01T00:00:00Z"),
        endDate: new Date("2025-06-08T00:00:00Z"),
        status: "completed",
      },
    });
    const [outcome] = await importSheets(
      [
        {
          key: "cruises",
          rows: [
            {
              id: cruise.id,
              routeName: "Norwegen",
              startDate: "2025-06-01",
              endDate: "2025-06-08",
              companions: "Dora",
            },
          ],
        },
      ],
      ctx()
    );
    expect(outcome).toMatchObject({ updated: 1, errors: 0 });
    const links = await prisma.cruiseCompanion.findMany({
      where: { cruiseId: cruise.id },
      include: { companion: true },
    });
    expect(links.map((l) => l.companion.displayName)).toEqual(["Dora"]);
    expect(
      (await prisma.cruise.findUniqueOrThrow({ where: { id: cruise.id } })).companions
    ).toEqual(["Dora"]);
  });
});
