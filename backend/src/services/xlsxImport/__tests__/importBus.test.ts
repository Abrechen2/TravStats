import request from "supertest";
import app from "../../../index";
import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { generateToken } from "../../../utils/jwt";
import { importSheets } from "../importSheets";

/**
 * forgejo#180: the bus sheet's round trip, and the trip page listing rides.
 * The sheet carries the terminal's wall clock and each terminal's position;
 * the importer stores the real instant through the bus write rules. Failure
 * paths: a terminal without coordinates, a row without a departure.
 */
describe("bus rides in the workbook and on the trip (forgejo#180)", () => {
  let userId: string;
  let tripId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "xlsxbus" } });
    const user = await prisma.user.create({
      data: { username: "xlsxbus", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    tripId = (await prisma.trip.create({ data: { userId, name: "Korea" } })).id;
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
  });

  const run = (rows: Record<string, string>[], dryRun = false) =>
    importSheets([{ key: "bus", rows }], { userId, dryRun, mode: "merge" });

  const seoulSokcho = {
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
    tripId: `Korea [${"placeholder"}]`,
  };

  it("creates a ride on the terminal's clock, and recognises it on the second import", async () => {
    const row = { ...seoulSokcho, tripId: `Korea [${tripId}]` };
    const [first] = await run([row]);
    expect(first.created).toBe(1);
    const ride = await prisma.busJourney.findFirstOrThrow({ where: { userId } });
    // 10:00 in Seoul is 01:00 UTC — the cell is the wall clock, not an instant.
    expect(ride.departureTime.toISOString()).toBe("2026-10-07T01:00:00.000Z");
    expect(ride.depTimezone).toBe("Asia/Seoul");
    expect(ride.tripId).toBe(tripId);

    const [again] = await run([row]);
    expect(again.created).toBe(0);
    expect(await prisma.busJourney.count({ where: { userId } })).toBe(1);
  });

  it("updates the ride its id names", async () => {
    const ride = await prisma.busJourney.findFirstOrThrow({ where: { userId } });
    const [result] = await run([
      { ...seoulSokcho, id: ride.id, tripId: `Korea [${tripId}]`, seat: "14", lineName: "Premium" },
    ]);
    expect(result.updated).toBe(1);
    const after = await prisma.busJourney.findUniqueOrThrow({ where: { id: ride.id } });
    expect([after.seat, after.lineName]).toEqual(["14", "Premium"]);
  });

  it("refuses a new ride whose terminal has no coordinates, and one without a departure", async () => {
    const [noCoords] = await run([
      { ...seoulSokcho, depStationName: "Jeonju", depLat: "", depLon: "", tripId: "" },
    ]);
    expect(noCoords.rows[0].action).toBe("error");
    const [noDeparture] = await run([
      { ...seoulSokcho, depStationName: "Jeonju", departureTime: "", tripId: "" },
    ]);
    expect(noDeparture.rows[0].action).toBe("error");
  });

  it("lists the trip's rides on GET /trips/:id with their terminal times", async () => {
    const res = await request(app)
      .get(`/api/v1/trips/${tripId}`)
      .set("Cookie", `auth_token=${generateToken(userId)}`)
      .expect(200);
    const rides = res.body.trip.busJourneys;
    expect(rides).toHaveLength(1);
    expect(rides[0].depStationName).toBe("Seoul Express Bus Terminal");
    expect(rides[0].times.departure.local).toBe("2026-10-07T10:00:00");
    expect(rides[0].depLat).toBeCloseTo(37.5045);
  });
});
