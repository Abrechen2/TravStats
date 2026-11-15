import fs from "fs";
import path from "path";
import { prisma } from "../../../db";
import { runAppImport } from "../index";
import type { AppSource } from "../types";

/**
 * Preview -> commit -> second read, for each source, through the spreadsheet
 * importer's own rules. Fixtures are SYNTHETIC (see the readers' headers);
 * airports and stations are synthetic catalogue rows.
 */
const fixture = (name: string) => fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");

describe("app import (forgejo#401)", () => {
  const USER = "appimportuser";
  const IATAS = ["FRA", "JFK", "NRT", "LAX", "LIS"];
  let userId: string;

  const airport = (iata: string, name: string, lat: number, lon: number, timezone: string) => ({
    iata,
    name,
    lat,
    lon,
    timezone,
    isClosed: false,
  });

  beforeAll(async () => {
    for (const a of [
      airport("FRA", "Frankfurt", 50.03, 8.57, "Europe/Berlin"),
      airport("JFK", "John F Kennedy", 40.64, -73.78, "America/New_York"),
      airport("NRT", "Narita", 35.77, 140.39, "Asia/Tokyo"),
      airport("LAX", "Los Angeles", 33.94, -118.41, "America/Los_Angeles"),
      airport("LIS", "Lisbon", 38.77, -9.13, "Europe/Lisbon"),
    ]) {
      const hit = await prisma.airport.findFirst({ where: { iata: a.iata, isClosed: false } });
      if (hit)
        await prisma.airport.update({ where: { id: hit.id }, data: { timezone: a.timezone } });
      else await prisma.airport.create({ data: a });
    }
    await prisma.railStation.deleteMany({ where: { uic: { in: ["8999001", "8999002"] } } });
    await prisma.railStation.createMany({
      data: [
        {
          name: "Alpha Hbf",
          searchName: "alpha hbf",
          uic: "8999001",
          dbId: "8999001",
          lat: 52.5,
          lon: 13.4,
          country: "DE",
          timezone: "Europe/Berlin",
        },
        {
          name: "Beta Hbf",
          searchName: "beta hbf",
          uic: "8999002",
          dbId: "8999002",
          lat: 53.5,
          lon: 10,
          country: "DE",
          timezone: "Europe/Berlin",
        },
      ],
    });
    await prisma.user.deleteMany({ where: { username: USER } });
    userId = (await prisma.user.create({ data: { username: USER, passwordHash: "x" } })).id;
  });
  afterAll(async () => {
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.railJourney.deleteMany({ where: { userId } });
    await prisma.lodging.deleteMany({ where: { userId } });
    await prisma.place.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { username: USER } });
    await prisma.railStation.deleteMany({ where: { uic: { in: ["8999001", "8999002"] } } });
    await prisma.$disconnect();
  });

  const run = (source: AppSource, file: string, dryRun: boolean) =>
    runAppImport(userId, { source, text: fixture(file), dryRun });
  const sheet = (o: Awaited<ReturnType<typeof run>>, key: string) =>
    o.sheets.find((s) => s.key === key);

  it("JetLovers: previews without writing, commits once, skips the same flights on a second read", async () => {
    const preview = await run("jetlovers", "jetlovers.csv", true);
    expect(sheet(preview, "flights")).toMatchObject({ created: 3, errors: 3, skipped: 0 });
    expect(await prisma.flight.count({ where: { userId } })).toBe(0);
    // every refused line names its reason, none vanishes
    const reasons = Object.fromEntries(
      sheet(preview, "flights")!
        .rows.filter((r) => r.action === "error")
        .map((r) => [r.row, r.message])
    );
    expect(reasons).toEqual({
      5: "missing_flight_number",
      6: "missing_airport_code",
      7: "invalid_date",
    });

    await run("jetlovers", "jetlovers.csv", false);
    const stored = await prisma.flight.findMany({
      where: { userId },
      orderBy: { departureTime: "asc" },
    });
    expect(stored.map((f) => f.flightNumber)).toEqual(["LH400", "NH6", "LH401"]);
    // 10:05 in Frankfurt (+01:00 in March) is 09:05Z; 12:20 in New York (-05:00 before DST) is 17:20Z
    expect(stored[0].departureTime?.toISOString()).toBe("2026-03-01T09:05:00.000Z");
    expect(stored[0].arrivalTime?.toISOString()).toBe("2026-03-01T17:20:00.000Z");
    // NRT 17:00 JST -> LAX 10:30 PDT: lands on the SAME date, later the same day in UTC
    expect(stored[1].arrivalTime! > stored[1].departureTime!).toBe(true);
    // JFK 18:30 -> FRA 07:45 has no arrival date in the file: it lands the next day
    expect(stored[2].arrivalTime! > stored[2].departureTime!).toBe(true);
    expect(stored[2].arrivalTime!.toISOString().slice(0, 10)).toBe("2026-03-13");

    const again = await run("jetlovers", "jetlovers.csv", false);
    expect(sheet(again, "flights")).toMatchObject({ created: 0, skipped: 3 });
    expect(await prisma.flight.count({ where: { userId } })).toBe(3);
  });

  it("FlightMemory and Logmyflight: a flight already stored by another source is recognised, not doubled", async () => {
    // LH400 on 2026-03-01 FRA-JFK is in the database from the JetLovers run.
    const fm = await run("flightmemory", "flightmemory.csv", true);
    const rows = sheet(fm, "flights")!.rows;
    expect(rows.find((r) => r.label.includes("LH400"))).toMatchObject({
      action: "skip",
      message: "exists",
    });
    const lmf = await run("logmyflight", "logmyflight.csv", true);
    expect(sheet(lmf, "flights")).toMatchObject({ created: 1, skipped: 1 });
  });

  it("FlightMemory: a flight with a day but no clock is created and says the time is unknown", async () => {
    const out = await run("flightmemory", "flightmemory.csv", true);
    const dateOnly = sheet(out, "flights")!.rows.find((r) => r.label.includes("TP1233"));
    expect(dateOnly).toMatchObject({ action: "create", notes: ["time_unknown"] });
  });

  it("TripIt JSON: flights, a stay under its lodging and a rail ride land in their own sheets", async () => {
    const preview = await run("tripit", "tripit.json", true);
    // LH400 FRA-JFK of 1 March is already stored from the JetLovers file.
    expect(sheet(preview, "flights")).toMatchObject({ created: 0, skipped: 1 });
    expect(sheet(preview, "lodging")).toMatchObject({ created: 1 });
    expect(sheet(preview, "lodgingStays")).toMatchObject({ created: 1, errors: 0 });
    expect(sheet(preview, "rail")).toMatchObject({ created: 1, errors: 0 });
    expect(sheet(preview, "other")!.rows.map((r) => r.message)).toEqual(["unsupported_object:car"]);
    expect(await prisma.lodging.count({ where: { userId } })).toBe(0);

    await run("tripit", "tripit.json", false);
    expect(await prisma.lodging.count({ where: { userId } })).toBe(1);
    expect(await prisma.lodgingStay.count({ where: { userId } })).toBe(1);
    expect(await prisma.railJourney.count({ where: { userId } })).toBe(1);
    const again = await run("tripit", "tripit.json", false);
    expect(sheet(again, "lodgingStays")).toMatchObject({ created: 0 });
    expect(sheet(again, "rail")).toMatchObject({ created: 0, skipped: 1 });
    expect(await prisma.lodging.count({ where: { userId } })).toBe(1);
  });

  it("TripIt iCal: UTC flight times and a stay; other events are listed as not imported", async () => {
    const preview = await run("tripit", "tripit.ics", true);
    expect(sheet(preview, "flights")!.rows[0]).toMatchObject({
      label: expect.stringContaining("LH400"),
    });
    // The same hotel stay came in with the JSON export above (the feed names no city):
    // recognised, not doubled into a second hotel.
    expect(sheet(preview, "lodging")).toBeUndefined();
    expect(sheet(preview, "lodgingStays")).toMatchObject({ created: 0, skipped: 1 });
    expect(sheet(preview, "other")!.rows[0].message).toBe("unsupported_event");
    expect(
      sheet(preview, "flights")!
        .rows.filter((r) => r.action === "error")
        .map((r) => r.message)
    ).toEqual(["missing_airport_code"]);
  });

  it("Polarsteps: steps become visited places with one visit each day; a second read adds nothing", async () => {
    const preview = await run("polarsteps", "polarsteps.json", true);
    expect(sheet(preview, "places")).toMatchObject({ created: 1, errors: 2 });
    expect(sheet(preview, "placeVisits")).toMatchObject({ created: 2, errors: 0 });
    await run("polarsteps", "polarsteps.json", false);
    const place = await prisma.place.findFirstOrThrow({ where: { userId } });
    expect(place).toMatchObject({ name: "Praça do Comércio", visited: true, isoCountryCode: "PT" });
    expect(await prisma.placeVisit.count({ where: { userId } })).toBe(2);
    const again = await run("polarsteps", "polarsteps.json", false);
    expect(sheet(again, "places")).toMatchObject({ created: 0, skipped: 1 });
    expect(sheet(again, "placeVisits")).toMatchObject({ created: 0 });
    expect(await prisma.placeVisit.count({ where: { userId } })).toBe(2);
  });

  it("an unreadable file is one error row with a reason, not an empty success", async () => {
    for (const [source, file] of [
      ["jetlovers", "no-key-columns.csv"],
      ["polarsteps", "polarsteps-malformed.json"],
    ] as const) {
      const out = await run(source, file, true);
      expect(out.clean).toBe(false);
      expect(out.sheets.flatMap((s) => s.rows)).toEqual([
        expect.objectContaining({ action: "error", message: "invalid_file" }),
      ]);
    }
  });
});
