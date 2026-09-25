import { prisma } from "../../../db";
import { importSheets } from "../importSheets";

/**
 * Rail rides back from the spreadsheet (rail spec, on the 2.7 importer's
 * rules). The sheet carries each station's wall clock — the time on the
 * ticket — so an untouched export must come back as "unchanged", a moved
 * file must create rather than touch another account's rides, and reading
 * the same id-less file twice must converge instead of doubling the logbook.
 */
describe("spreadsheet import — rail", () => {
  const USERS = ["xlsxrail", "xlsxrailother"];
  let userId: string;
  let otherRideId: string;

  const ctx = (mode: "add" | "merge" | "replace" = "merge", dryRun = false) => ({
    userId,
    mode,
    dryRun,
  });

  /** The row the export writes for the night train below. */
  const nightTrainRow = (over: Record<string, string> = {}): Record<string, string> => ({
    operator: "ÖBB",
    trainCategory: "NJ",
    trainNumber: "466",
    depStationName: "Wien Hbf",
    depLat: "48.1852",
    depLon: "16.3776",
    arrStationName: "Zürich HB",
    arrLat: "47.378",
    arrLon: "8.54",
    // Station wall clocks, as the export writes them.
    departureTime: "2025-12-31T22:58:00.000Z",
    arrivalTime: "2026-01-01T08:20:00.000Z",
    travelClass: "second",
    coach: "24",
    seat: "15",
    ...over,
  });

  const rail = (rows: Record<string, string>[], rowNumbers?: number[]) => [
    { key: "rail", rows, ...(rowNumbers && { rowNumbers }) },
  ];

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: USERS } } });
    userId = (await prisma.user.create({ data: { username: USERS[0], passwordHash: "x" } })).id;
    const other = await prisma.user.create({ data: { username: USERS[1], passwordHash: "x" } });
    otherRideId = (
      await prisma.railJourney.create({
        data: {
          userId: other.id,
          depStationName: "Fremd",
          arrStationName: "Anderswo",
          depLat: 50,
          depLon: 8,
          arrLat: 51,
          arrLon: 9,
          departureTime: new Date("2025-05-01T08:00:00Z"),
          status: "completed",
        },
      })
    ).id;
  });

  beforeEach(async () => {
    await prisma.railJourney.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: USERS } } });
    await prisma.$disconnect();
  });

  it("creates a ride on its stations' clocks and derives what the form derives", async () => {
    const [outcome] = await importSheets(rail([nightTrainRow()]), ctx());
    expect(outcome).toMatchObject({ created: 1, errors: 0 });
    const ride = await prisma.railJourney.findFirstOrThrow({ where: { userId } });
    // 22:58 in Vienna is 21:58 UTC; 08:20 in Zurich is 07:20 UTC.
    expect(ride.departureTime.toISOString()).toBe("2025-12-31T21:58:00.000Z");
    expect(ride.arrivalTime?.toISOString()).toBe("2026-01-01T07:20:00.000Z");
    expect(ride).toMatchObject({
      depTimezone: "Europe/Vienna",
      arrTimezone: "Europe/Zurich",
      depCountry: "AT",
      arrCountry: "CH",
      distanceSource: "great_circle",
      status: "completed",
      travelClass: "second",
    });
  });

  it("leaves an untouched row alone and updates only what the sheet changed", async () => {
    await importSheets(rail([nightTrainRow()]), ctx());
    const ride = await prisma.railJourney.findFirstOrThrow({ where: { userId } });

    const [same] = await importSheets(rail([nightTrainRow({ id: ride.id })]), ctx());
    expect(same).toMatchObject({ skipped: 1, updated: 0 });
    const untouched = await prisma.railJourney.findUniqueOrThrow({ where: { id: ride.id } });
    expect(untouched.updatedAt.getTime()).toBe(ride.updatedAt.getTime());

    const [edited] = await importSheets(
      rail([nightTrainRow({ id: ride.id, seat: "16", arrivalTime: "2026-01-01T08:45:00.000Z" })]),
      ctx()
    );
    expect(edited).toMatchObject({ updated: 1 });
    const after = await prisma.railJourney.findUniqueOrThrow({ where: { id: ride.id } });
    expect(after.seat).toBe("16");
    expect(after.arrivalTime?.toISOString()).toBe("2026-01-01T07:45:00.000Z");
    expect(after.departureTime.getTime()).toBe(ride.departureTime.getTime());
  });

  it("recognises an id-less row by train, day and stations, so a second read converges", async () => {
    await importSheets(rail([nightTrainRow()]), ctx());
    const [again] = await importSheets(rail([nightTrainRow({ seat: "99" })]), ctx());
    expect(again).toMatchObject({ created: 0, updated: 1 });
    expect(again.rows[0].message).toBe("matched_existing");
    expect(await prisma.railJourney.count({ where: { userId } })).toBe(1);
  });

  it("creates a new ride from another account's id and never touches theirs", async () => {
    const [outcome] = await importSheets(rail([nightTrainRow({ id: otherRideId })]), ctx());
    expect(outcome).toMatchObject({ created: 1, updated: 0 });
    const theirs = await prisma.railJourney.findUniqueOrThrow({ where: { id: otherRideId } });
    expect(theirs.depStationName).toBe("Fremd");
    expect(await prisma.railJourney.count({ where: { userId } })).toBe(1);
  });

  it("leaves an unknown class or status empty, says so, and applies the row", async () => {
    const [outcome] = await importSheets(
      rail([nightTrainRow({ travelClass: "Holzklasse", status: "verspätet" })]),
      ctx()
    );
    expect(outcome).toMatchObject({ created: 1, errors: 0 });
    expect(outcome.rows[0].dropped).toEqual([
      { field: "travelClass", value: "Holzklasse" },
      { field: "status", value: "verspätet" },
    ]);
    const ride = await prisma.railJourney.findFirstOrThrow({ where: { userId } });
    expect(ride.travelClass).toBeNull();
  });

  it("reports errors on the rows the user sees, and writes nothing in a dry run", async () => {
    const [outcome] = await importSheets(
      rail(
        [nightTrainRow(), { trainNumber: "1", departureTime: "2025-01-01T08:00:00.000Z" }],
        [4, 9]
      ),
      ctx("merge", true)
    );
    expect(outcome.rows.map((r) => [r.row, r.action, r.message ?? null])).toEqual([
      [4, "create", null],
      [9, "error", "rail_needs_route"],
    ]);
    expect(await prisma.railJourney.count({ where: { userId } })).toBe(0);
  });

  it("refuses an arrival before the departure", async () => {
    const [outcome] = await importSheets(
      rail([nightTrainRow({ arrivalTime: "2025-12-31T20:00:00.000Z" })]),
      ctx()
    );
    expect(outcome.rows[0]).toMatchObject({ action: "error", message: "invalid_date" });
  });

  it("in replace mode removes the rides the file leaves out", async () => {
    await importSheets(rail([nightTrainRow(), nightTrainRow({ trainNumber: "40466" })]), ctx());
    const keep = await prisma.railJourney.findFirstOrThrow({
      where: { userId, trainNumber: "466" },
    });
    const [outcome] = await importSheets(rail([nightTrainRow({ id: keep.id })]), ctx("replace"));
    expect(outcome.deleted).toBe(1);
    expect(await prisma.railJourney.findMany({ where: { userId } })).toEqual([
      expect.objectContaining({ id: keep.id }),
    ]);
  });
});
