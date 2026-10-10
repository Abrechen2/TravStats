import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * forgejo#285 — when online check-in opens. Stated by the airline, normally
 * on the departure airport's clock, so a bare `{local}` is read there. Never
 * derived from the departure: null means not recorded.
 */
const USER = "flightonlinecheckin";
const FRA = { iata: "FRA", lat: 50.030241, lon: 8.561096 };
const HND = { iata: "HND", lat: 35.552299, lon: 139.779999 };

describe("Flights — online check-in opening (forgejo#285)", () => {
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

  const create = (body: Record<string, unknown>) =>
    request(app)
      .post("/api/v1/flights?force=true")
      .set("Cookie", cookie)
      .send({
        airline: "Lufthansa",
        flightNumber: "LH716",
        departure: FRA,
        arrival: HND,
        departureLocal: "2027-07-01T13:30",
        arrivalLocal: "2027-07-02T08:30",
        ...body,
      });
  const put = (id: string, body: Record<string, unknown>) =>
    request(app).put(`/api/v1/flights/${id}`).set("Cookie", cookie).send(body);

  it("reads a bare {local} on the departure airport's clock", async () => {
    const res = await create({ onlineCheckInOpensAt: { local: "2027-06-30T13:30" } });
    expect(res.status).toBe(201);
    expect(res.body.flight.times.onlineCheckInOpens).toMatchObject({
      utc: "2027-06-30T11:30:00.000Z",
      zone: "Europe/Berlin",
      local: "2027-06-30T13:30:00",
      precision: "minute",
    });
    const row = await prisma.flight.findUniqueOrThrow({ where: { id: res.body.flight.id } });
    expect(row.onlineCheckInZone).toBe("Europe/Berlin");
  });

  it("is null when not recorded — never derived from the departure", async () => {
    const res = await create({});
    expect(res.status).toBe(201);
    expect(res.body.flight.times.onlineCheckInOpens).toBeNull();
  });

  it("leaves it alone on an unrelated edit and clears it on null", async () => {
    const id = (await create({ onlineCheckInOpensAt: { local: "2027-06-30T13:30" } })).body.flight
      .id;
    const untouched = await put(id, { notes: "window seat" });
    expect(untouched.status).toBe(200);
    expect(untouched.body.flight.times.onlineCheckInOpens.utc).toBe("2027-06-30T11:30:00.000Z");

    const cleared = await put(id, { onlineCheckInOpensAt: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.flight.times.onlineCheckInOpens).toBeNull();
    const row = await prisma.flight.findUniqueOrThrow({ where: { id } });
    expect(row.onlineCheckInZone).toBeNull();
  });

  it("sets it on an edit, on the stored departure zone", async () => {
    const id = (await create({})).body.flight.id;
    const res = await put(id, { onlineCheckInOpensAt: { local: "2027-06-29T10:00" } });
    expect(res.status).toBe(200);
    expect(res.body.flight.times.onlineCheckInOpens).toMatchObject({
      utc: "2027-06-29T08:00:00.000Z",
      zone: "Europe/Berlin",
    });
  });

  it("refuses an offset-less datetime with 422 TIME_SHAPE_REQUIRED", async () => {
    const res = await create({ onlineCheckInOpensAt: "2027-06-30T13:30" });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: "TIME_SHAPE_REQUIRED", field: "onlineCheckInOpensAt" });
  });
});
