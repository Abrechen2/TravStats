import { prisma } from "../../../db";
import { importSheets } from "../importSheets";

/**
 * Two ways a spreadsheet row used to do damage on the bus and rail sheets:
 * a negative price or a made-up currency was stored as it stood (the roadtrip
 * cost sheet refuses both), and in `replace` mode a refused row WITHOUT an id
 * left the record it named out of `seen`, so the prune deleted it. Every
 * value is invented.
 */
describe("spreadsheet import — bus/rail money and the replace prune", () => {
  const USER = "xlsxmoneyprune";
  let userId: string;

  const busRow = (over: Record<string, string> = {}): Record<string, string> => ({
    id: "",
    operator: "Kobus",
    depStationName: "Seoul Express Bus Terminal",
    depLat: "37.5045",
    depLon: "127.0049",
    arrStationName: "Sokcho Express Bus Terminal",
    arrLat: "38.1987",
    arrLon: "128.5868",
    departureTime: "2026-10-07T10:00:00.000Z",
    arrivalTime: "2026-10-07T12:30:00.000Z",
    ...over,
  });
  const railRow = (over: Record<string, string> = {}): Record<string, string> => ({
    operator: "ÖBB",
    trainCategory: "NJ",
    trainNumber: "466",
    depStationName: "Wien Hbf",
    depLat: "48.1852",
    depLon: "16.3776",
    arrStationName: "Zürich HB",
    arrLat: "47.378",
    arrLon: "8.54",
    departureTime: "2025-12-31T22:58:00.000Z",
    arrivalTime: "2026-01-01T08:20:00.000Z",
    ...over,
  });
  const run = (key: string, rows: Record<string, string>[], mode: "merge" | "replace") =>
    importSheets([{ key, rows }], { userId, dryRun: false, mode });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
    userId = (await prisma.user.create({ data: { username: USER, passwordHash: "x" } })).id;
  });

  beforeEach(async () => {
    await prisma.busJourney.deleteMany({ where: { userId } });
    await prisma.railJourney.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
    await prisma.$disconnect();
  });

  it.each([
    ["bus", busRow],
    ["rail", railRow],
  ] as const)(
    "refuses a negative price and a currency that is no ISO code (%s)",
    async (key, row) => {
      const [outcome] = await run(
        key,
        [row({ price: "-12", currency: "EUR" }), row({ price: "12", currency: "EURO" })],
        "merge"
      );
      expect(outcome.rows.map((r) => [r.action, r.message])).toEqual([
        ["error", "negative_price"],
        ["error", "invalid_currency"],
      ]);
      expect(outcome.created).toBe(0);
    }
  );

  it("keeps a valid price and currency", async () => {
    const [outcome] = await run("bus", [busRow({ price: "12.5", currency: "krw" })], "merge");
    expect(outcome).toMatchObject({ created: 1, errors: 0 });
    const ride = await prisma.busJourney.findFirstOrThrow({ where: { userId } });
    expect([ride.price, ride.currency]).toEqual([12.5, "KRW"]);
  });

  it.each([
    ["bus", busRow, () => prisma.busJourney.count({ where: { userId } })],
    ["rail", railRow, () => prisma.railJourney.count({ where: { userId } })],
  ] as const)(
    "never prunes in replace mode while a refused row carries no id (%s)",
    async (key, row, count) => {
      await run(key, [row()], "merge");
      expect(await count()).toBe(1);
      // The same ride, unreadable: no id, so nothing tells which record it names.
      const [outcome] = await run(key, [row({ depLat: "north" })], "replace");
      expect(outcome.errors).toBe(1);
      expect(outcome.deleted).toBe(0);
      expect(await count()).toBe(1);
    }
  );
});
