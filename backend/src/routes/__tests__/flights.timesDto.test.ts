import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * ADR 0002 phase 4 for flights: every read path hands out `times`, each end a
 * TimeValue at its airport — read in the zone the flight was STORED with, so
 * a catalogue correction does not move a past flight. A row that has no
 * stored zone is read in today's catalogue zone and SAYS so
 * (`zoneSource: "catalogue"`); a row with neither shows UTC, labelled.
 *
 * FRA and NRT are in the seeded test catalogue (seed-test-catalogues.ts).
 */
const USER = "flighttimesdto";
const FRA = { depIata: "FRA", depLat: 50.030241, depLon: 8.561096 };
const NRT = { arrIata: "NRT", arrLat: 35.764722, arrLon: 140.386389 };

describe("Flights — times (phase 4)", () => {
  let userId: string;
  let cookie: string;

  const cleanup = async (): Promise<void> => {
    await prisma.flight.deleteMany({ where: { user: { username: USER } } });
    await prisma.user.deleteMany({ where: { username: USER } });
  };

  beforeAll(async () => {
    await cleanup();
    const u = await prisma.user.create({
      data: { username: USER, passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    cookie = `auth_token=${generateToken(u.id)}`;
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.flight.deleteMany({ where: { userId } });
  });

  const seed = (data: Record<string, unknown>) =>
    prisma.flight.create({ data: { userId, ...FRA, ...NRT, status: "flown", ...data } });

  const read = async (id: string) => {
    const res = await request(app).get(`/api/v1/flights/${id}`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    return res.body.times;
  };

  it("reads each end in the zone the flight was stored with, not today's catalogue", async () => {
    // Stored when the zone was written as Lisbon; the catalogue says Berlin today.
    const f = await seed({
      departureTime: new Date("2027-07-01T11:30:00Z"),
      arrivalTime: new Date("2027-07-02T00:30:00Z"),
      depTimezone: "Europe/Lisbon",
      arrTimezone: "Asia/Tokyo",
      depPrecision: "minute",
      arrPrecision: "minute",
      actualDeparture: new Date("2027-07-01T11:52:00Z"),
    });
    const times = await read(f.id);
    expect(times.actualDeparture).toMatchObject({
      local: "2027-07-01T12:52:00",
      zone: "Europe/Lisbon",
    });
    expect(times.runwayArrival).toBeNull();
    expect(times.departure).toEqual({
      utc: "2027-07-01T11:30:00.000Z",
      zone: "Europe/Lisbon",
      offset: "+01:00",
      local: "2027-07-01T12:30:00",
      precision: "minute",
      zoneSource: "stored",
    });
    expect(times.arrival).toMatchObject({ local: "2027-07-02T09:30:00", zoneSource: "stored" });
  });

  it("says a zone came from today's catalogue when the flight stored none", async () => {
    const f = await seed({ departureTime: new Date("2027-07-01T11:30:00Z") });
    const times = await read(f.id);
    expect(times.departure).toMatchObject({
      zone: "Europe/Berlin",
      local: "2027-07-01T13:30:00",
      zoneSource: "catalogue",
    });
    expect(times.arrival).toBeNull();
  });

  it("shows UTC, labelled, when neither a stored nor a catalogue zone exists", async () => {
    const f = await seed({
      depIata: null,
      depLat: 0,
      depLon: 0,
      departureTime: new Date("2027-07-01T11:30:00Z"),
    });
    const times = await read(f.id);
    expect(times.departure).toMatchObject({
      zone: null,
      offset: "+00:00",
      local: "2027-07-01T11:30:00",
      zoneSource: null,
    });
  });

  it("reads a legacy fake-UTC value as the airport's wall clock", async () => {
    const f = await seed({
      departureTime: new Date("2019-03-10T13:30:00Z"),
      depTimeSemantics: "LEGACY_FAKE_UTC",
      depTimezone: "Europe/Berlin",
    });
    const times = await read(f.id);
    expect(times.departure).toMatchObject({
      utc: "2019-03-10T12:30:00.000Z",
      local: "2019-03-10T13:30:00",
      offset: "+01:00",
      precision: "minute",
    });
  });

  it("gives a date-only flight its day at the airport, precision day", async () => {
    const f = await seed({
      departureTime: new Date("2015-05-02T12:00:00Z"),
      depTimeSemantics: "DATE_ONLY",
      depTimezone: "Pacific/Kiritimati",
      depPrecision: "day",
    });
    const times = await read(f.id);
    expect(times.departure).toMatchObject({
      local: "2015-05-02T00:00:00",
      precision: "day",
      zone: "Pacific/Kiritimati",
    });
  });

  it("carries times on the list as well", async () => {
    await seed({
      departureTime: new Date("2027-07-01T11:30:00Z"),
      depTimezone: "Europe/Berlin",
    });
    const res = await request(app).get("/api/v1/flights").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.flights[0].times.departure.local).toBe("2027-07-01T13:30:00");
  });
});
