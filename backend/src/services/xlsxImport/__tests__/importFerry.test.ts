import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { importSheets, isImportable } from "../importSheets";

/**
 * The ferry sheet's round trip. Ferry was the one transport domain the
 * workbook neither wrote nor read back, so a crossing could not be moved or
 * bulk-edited the way a bus ride can. The sheet carries each port's wall clock
 * and position; the importer stores the real instant through the ferry write
 * rules. Failure paths: a port without coordinates, a row without a departure.
 */
describe("ferry crossings in the workbook", () => {
  let userId: string;
  let tripId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "xlsxferry" } });
    const user = await prisma.user.create({
      data: { username: "xlsxferry", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    tripId = (await prisma.trip.create({ data: { userId, name: "Schweden" } })).id;
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
  });

  const run = (rows: Record<string, string>[], dryRun = false) =>
    importSheets([{ key: "ferry", rows }], { userId, dryRun, mode: "merge" });

  const kielGoteborg = {
    id: "",
    operator: "Stena Line",
    vesselName: "Stena Germanica",
    depStationName: "Kiel",
    depLat: "54.3233",
    depLon: "10.1394",
    arrStationName: "Göteborg",
    arrLat: "57.7089",
    arrLon: "11.9746",
    departureTime: "2026-10-07T18:45:00.000Z",
    arrivalTime: "2026-10-08T09:15:00.000Z",
  };

  it("is a sheet the importer understands", () => {
    expect(isImportable("ferry")).toBe(true);
  });

  it("creates a crossing on the port's clock, and recognises it on the second import", async () => {
    const row = { ...kielGoteborg, tripId: `Schweden [${tripId}]` };
    const [first] = await run([row]);
    expect(first.created).toBe(1);
    const crossing = await prisma.ferryJourney.findFirstOrThrow({ where: { userId } });
    // 18:45 in Kiel (CEST) is 16:45 UTC — the cell is the wall clock, not an instant.
    expect(crossing.departureTime.toISOString()).toBe("2026-10-07T16:45:00.000Z");
    expect(crossing.depTimezone).toBe("Europe/Berlin");
    expect(crossing.arrTimezone).toBe("Europe/Stockholm");
    expect(crossing.vesselName).toBe("Stena Germanica");
    expect(crossing.tripId).toBe(tripId);

    const [again] = await run([row]);
    expect(again.created).toBe(0);
    expect(await prisma.ferryJourney.count({ where: { userId } })).toBe(1);
  });

  it("updates the crossing its id names", async () => {
    const crossing = await prisma.ferryJourney.findFirstOrThrow({ where: { userId } });
    const [result] = await run([
      { ...kielGoteborg, id: crossing.id, cabinType: "Außenkabine", vehicleType: "Pkw" },
    ]);
    expect(result.updated).toBe(1);
    const after = await prisma.ferryJourney.findUniqueOrThrow({ where: { id: crossing.id } });
    expect([after.cabinType, after.vehicleType]).toEqual(["Außenkabine", "Pkw"]);
  });

  it("refuses a port without coordinates and a new row without a departure, and writes nothing", async () => {
    const before = await prisma.ferryJourney.count({ where: { userId } });
    const [result] = await run([
      { ...kielGoteborg, depStationName: "Trelleborg", depLat: "", depLon: "" },
      { ...kielGoteborg, depStationName: "Rostock", departureTime: "" },
    ]);
    expect(result.rows.map((r) => r.message)).toEqual([
      "ferry_needs_coordinates",
      "ferry_needs_route",
    ]);
    expect(await prisma.ferryJourney.count({ where: { userId } })).toBe(before);
  });
});
