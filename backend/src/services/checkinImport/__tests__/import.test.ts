import { prisma } from "../../../db";
import { runCheckinImport, parseCheckinFile } from "../index";
import { buildSheets } from "../toSheets";
import { status } from "./fixtures/status";

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
        status({
          lineName: "RE 5",
          journeyNumber: "5",
          dep: "2026-03-01T08:00:00+01:00",
          arr: "2026-03-01T10:00:00+01:00",
        }),
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
      status({
        category: "tram",
        lineName: "Tram 9",
        dep: "2026-07-01T06:00:00Z",
        arr: "2026-07-01T07:00:00Z",
      }),
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
        status({
          from: "Nowhere Nord",
          dep: "2026-04-01T08:00:00+02:00",
          arr: "2026-04-01T09:00:00+02:00",
        }),
        { body: "no journey" },
        status({
          category: "ferry",
          from: "Alpha Hbf",
          to: "Beta Hbf",
          dep: "2026-04-01T08:00:00+02:00",
        }),
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
    dup.checkin.origin.departurePlanned = "2026-05-01T08:00:00+02:00";
    dup.checkin.destination.arrivalPlanned = "2026-05-01T10:00:00+02:00";
    const out = await run(JSON.stringify([dup, dup]), true);
    const rows = out.sheets[0].rows;
    expect(rows.map((r) => r.action)).toEqual(["create", "skip"]);
    expect(rows[1].message).toBe("duplicate_in_file");
  });

  it("an arrival before the departure is refused and does not hide the valid copy of the ride", async () => {
    const bad = JSON.parse(file()).data[0];
    bad.checkin.origin.departurePlanned = "2026-06-01T08:00:00+02:00";
    bad.checkin.destination.arrivalPlanned = "2026-06-01T07:00:00+02:00";
    const good = JSON.parse(JSON.stringify(bad));
    good.checkin.destination.arrivalPlanned = "2026-06-01T10:00:00+02:00";
    const out = await run(JSON.stringify([bad, good]), true);
    expect(out.sheets[0].rows.map((r) => [r.row, r.action, r.message])).toEqual([
      [1, "error", "invalid_date"],
      [2, "create", undefined],
    ]);
  });

  it("looks each distinct station up once per request, however many rides use it", async () => {
    const mk = (day: string) =>
      status({ dep: `2026-09-${day}T08:00:00+02:00`, arr: `2026-09-${day}T10:00:00+02:00` });
    const findMany = jest.spyOn(prisma.railStation, "findMany");
    // The resolving step on its own (the spreadsheet importer's per-row
    // station check afterwards is not part of this cache).
    const { rides } = parseCheckinFile(
      "travelling",
      JSON.stringify(["01", "02", "03", "04"].map(mk))
    );
    await buildSheets(rides);
    // 4 rides x 2 stops, but only 2 distinct stops.
    expect(findMany.mock.calls.length).toBeLessThanOrEqual(2);
    findMany.mockRestore();
  });

  it("imports a travelynx export journey (epoch seconds) in the station's zone", async () => {
    // 2026-08-01T05:00:00Z = 07:00 in Berlin (summer time)
    const text = JSON.stringify({
      journeys: [
        {
          is_iris: true,
          train_type: "ICE",
          train_line: "ICE 1",
          train_no: "1",
          dep_name: "Alpha Hbf",
          dep_eva: 8999001,
          sched_dep_ts: 1785560400,
          arr_name: "Beta Hbf",
          arr_eva: 8999002,
          sched_arr_ts: 1785567600,
        },
      ],
    });
    await run(text, false, "travelynx");
    const ride = await prisma.railJourney.findFirstOrThrow({ where: { userId, trainNumber: "1" } });
    expect(ride.departureTime.toISOString()).toBe("2026-08-01T05:00:00.000Z");
    expect(ride.depTimezone).toBe("Europe/Berlin");
  });
});
