import { prisma } from "../../../db";
import { runCheckinImport } from "../index";

/**
 * Check-in file -> rail rides through the spreadsheet importer's own rules.
 * Stations are synthetic catalogue rows (Europe/Berlin positions).
 */
describe("check-in import (forgejo#401)", () => {
  const USERS = ["checkinuser"];
  let userId: string;

  const station = (name: string, uic: string, lat: number, lon: number) => ({
    name,
    searchName: name.toLowerCase(),
    uic,
    dbId: uic,
    lat,
    lon,
    country: "DE",
    timezone: "Europe/Berlin",
  });

  beforeAll(async () => {
    await prisma.railStation.deleteMany({ where: { uic: { in: ["8999001", "8999002"] } } });
    await prisma.railStation.createMany({
      data: [station("Alpha Hbf", "8999001", 52.5, 13.4), station("Beta Hbf", "8999002", 53.5, 10)],
    });
    await prisma.user.deleteMany({ where: { username: { in: USERS } } });
    userId = (await prisma.user.create({ data: { username: USERS[0], passwordHash: "x" } })).id;
  });
  afterAll(async () => {
    await prisma.railJourney.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { username: { in: USERS } } });
    await prisma.railStation.deleteMany({ where: { uic: { in: ["8999001", "8999002"] } } });
  });

  const file = (extra: unknown[] = []) =>
    JSON.stringify({
      data: [
        {
          train: {
            category: "regional",
            lineName: "RE 5",
            journeyNumber: "5",
            origin: {
              name: "Alpha Hbf",
              evaIdentifier: "8999001",
              departurePlanned: "2026-03-01T08:00:00+01:00",
            },
            destination: {
              name: "Beta Hbf",
              evaIdentifier: "8999002",
              arrivalPlanned: "2026-03-01T10:00:00+01:00",
            },
          },
        },
        ...extra,
      ],
    });
  const run = (text: string, dryRun: boolean, source: "travelling" | "travelynx" = "travelling") =>
    runCheckinImport(userId, { source, text, dryRun });

  it("previews without writing, then commits once and recognises the ride on the second read", async () => {
    const preview = await run(file(), true);
    expect(preview.sheets[0]).toMatchObject({ key: "rail", created: 1, errors: 0 });
    expect(await prisma.railJourney.count({ where: { userId } })).toBe(0);

    const applied = await run(file(), false);
    expect(applied.sheets[0].created).toBe(1);
    const [ride] = await prisma.railJourney.findMany({ where: { userId } });
    expect(ride).toMatchObject({
      trainNumber: "5",
      transitMode: "rail",
      depStationName: "Alpha Hbf",
    });
    // 08:00 on the platform clock in Berlin (+01:00 in March) is 07:00Z.
    expect(ride.departureTime.toISOString()).toBe("2026-03-01T07:00:00.000Z");

    const again = await run(file(), false);
    expect(again.sheets[0]).toMatchObject({ created: 0, skipped: 1 });
    expect(await prisma.railJourney.count({ where: { userId } })).toBe(1);
  });

  it("keeps the transit mode of a tram and reads a UTC instant in the station's zone", async () => {
    const text = JSON.stringify([
      {
        train: {
          category: "tram",
          lineName: "Tram 9",
          origin: { name: "Alpha Hbf", departurePlanned: "2026-07-01T06:00:00Z" },
          destination: { name: "Beta Hbf", arrivalPlanned: "2026-07-01T07:00:00Z" },
        },
      },
    ]);
    await run(text, false);
    const ride = await prisma.railJourney.findFirstOrThrow({
      where: { userId, transitMode: "tram" },
    });
    expect(ride.departureTime.toISOString()).toBe("2026-07-01T06:00:00.000Z");
    expect(ride.depTimezone).toBe("Europe/Berlin");
  });

  it("a ride whose station is not in the catalogue is shown with its reason, not dropped", async () => {
    const out = await run(
      file([
        {
          train: {
            category: "regional",
            origin: { name: "Nowhere Nord", departurePlanned: "2026-04-01T08:00:00+02:00" },
            destination: { name: "Beta Hbf", arrivalPlanned: "2026-04-01T09:00:00+02:00" },
          },
        },
        { body: "no journey" },
        {
          train: {
            category: "ferry",
            origin: { name: "A", departurePlanned: "2026-04-01T08:00:00+02:00" },
            destination: { name: "B" },
          },
        },
      ]),
      true
    );
    const errors = out.sheets.flatMap((s) => s.rows).filter((r) => r.action === "error");
    expect(errors.map((e) => [e.row, e.message])).toEqual([
      [2, "unknown_station"],
      [3, "not_a_journey"],
      [4, "unsupported_mode:ferry"],
    ]);
    expect(out.clean).toBe(false);
  });

  it("reports the same ride twice in one file once, and the copy as a skip", async () => {
    const dup = JSON.parse(file()).data[0];
    dup.train.origin.departurePlanned = "2026-05-01T08:00:00+02:00";
    dup.train.destination.arrivalPlanned = "2026-05-01T10:00:00+02:00";
    const out = await run(JSON.stringify([dup, dup]), true);
    const rows = out.sheets[0].rows;
    expect(rows.map((r) => r.action)).toEqual(["create", "skip"]);
    expect(rows[1].message).toBe("duplicate_in_file");
  });

  it("imports a travelynx history entry (epoch seconds) in the station's zone", async () => {
    // 2026-08-01T05:00:00Z = 07:00 in Berlin (summer time)
    const text = JSON.stringify([
      {
        fromStation: { name: "Alpha Hbf", uic: 8999001, scheduledTime: 1785560400 },
        toStation: { name: "Beta Hbf", uic: 8999002, scheduledTime: 1785567600 },
        train: { type: "ICE", line: "ICE 1", no: "1" },
      },
    ]);
    await run(text, false, "travelynx");
    const ride = await prisma.railJourney.findFirstOrThrow({ where: { userId, trainNumber: "1" } });
    expect(ride.departureTime.toISOString()).toBe("2026-08-01T05:00:00.000Z");
    expect(ride.depTimezone).toBe("Europe/Berlin");
  });
});
