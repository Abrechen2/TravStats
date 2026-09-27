import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * ADR 0002 phase 2 for flights: the zone each end was WRITTEN with is stored,
 * and an edit that does not change that end's airport reads a new wall clock
 * in the STORED zone — a catalogue correction must not move a past flight
 * (defect class 4). A new airport re-derives it.
 */
const USER = "flighttimemodel";
const FRA = { iata: "FRA", lat: 50.030241, lon: 8.561096 };
const HND = { iata: "HND", lat: 35.552299, lon: 139.779999 };
const JFK = { iata: "JFK", lat: 40.639447, lon: -73.779317 };

describe("Flights — time model (phase 2)", () => {
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
      .send({ airline: "Lufthansa", flightNumber: "LH716", departure: FRA, arrival: HND, ...body });

  it("stores the zone each end was written with, and the precision", async () => {
    const res = await create({
      departureLocal: "2027-07-01T13:30",
      arrivalLocal: "2027-07-02T08:30",
    });
    expect(res.status).toBe(201);
    const row = await prisma.flight.findUniqueOrThrow({
      where: { id: res.body.id ?? res.body.flight?.id },
    });
    expect(row.departureTime?.toISOString()).toBe("2027-07-01T11:30:00.000Z");
    expect(row.depTimezone).toBe("Europe/Berlin");
    expect(row.arrTimezone).toBe("Asia/Tokyo");
    expect(row.depPrecision).toBe("minute");
  });

  it("records the airports' zones even for a flight with no times", async () => {
    const res = await create({ status: "historical" });
    expect(res.status).toBe(201);
    const row = await prisma.flight.findUniqueOrThrow({
      where: { id: res.body.id ?? res.body.flight?.id },
    });
    expect(row.depTimezone).toBe("Europe/Berlin");
    expect(row.depPrecision).toBeNull();
  });

  it("reads an edit at an unchanged airport in the STORED zone, not today's catalogue", async () => {
    const res = await create({
      departureLocal: "2027-07-01T13:30",
      arrivalLocal: "2027-07-02T08:30",
    });
    const id = res.body.id ?? res.body.flight?.id;
    // The flight was written when the catalogue said something else.
    await prisma.flight.update({ where: { id }, data: { depTimezone: "Europe/Lisbon" } });
    const put = await request(app).put(`/api/v1/flights/${id}`).set("Cookie", cookie).send({
      departure: FRA,
      departureLocal: "2027-07-01T13:30",
      arrivalLocal: "2027-07-02T08:30",
    });
    expect(put.status).toBe(200);
    const row = await prisma.flight.findUniqueOrThrow({ where: { id } });
    expect(row.depTimezone).toBe("Europe/Lisbon");
    expect(row.departureTime?.toISOString()).toBe("2027-07-01T12:30:00.000Z");
  });

  it("answers a read with the zone the flight was written with, so an edit form resends it", async () => {
    // The edit modal reads a flight's times in the zone the read gives it and
    // resends them with that zone. When the read joined today's catalogue
    // instead, a seat-only edit wrote the catalogue zone over the stored one.
    const res = await create({
      departureLocal: "2027-07-01T13:30",
      arrivalLocal: "2027-07-02T08:30",
    });
    const id = res.body.id ?? res.body.flight?.id;
    await prisma.flight.update({ where: { id }, data: { depTimezone: "Europe/Lisbon" } });
    const one = await request(app).get(`/api/v1/flights/${id}`).set("Cookie", cookie);
    expect(one.status).toBe(200);
    const flight = one.body.flight ?? one.body;
    expect(flight.depTimezone).toBe("Europe/Lisbon");
    expect(flight.arrTimezone).toBe("Asia/Tokyo");
    const list = await request(app).get("/api/v1/flights").set("Cookie", cookie);
    const rows = list.body.flights ?? list.body.data ?? list.body;
    expect(rows.find((f: { id: string }) => f.id === id).depTimezone).toBe("Europe/Lisbon");
  });

  it("re-derives the zone when the airport changes", async () => {
    const res = await create({
      departureLocal: "2027-07-01T13:30",
      arrivalLocal: "2027-07-02T08:30",
    });
    const id = res.body.id ?? res.body.flight?.id;
    const put = await request(app)
      .put(`/api/v1/flights/${id}`)
      .set("Cookie", cookie)
      .send({ departure: JFK });
    expect(put.status).toBe(200);
    const row = await prisma.flight.findUniqueOrThrow({ where: { id } });
    expect(row.depTimezone).toBe("America/New_York");
  });

  it("takes the EARLIER repeated hour by default (owner decision Q5)", async () => {
    const res = await create({
      arrival: FRA,
      departure: JFK,
      departureLocal: "2027-10-30T18:00",
      arrivalLocal: "2027-10-31T02:30",
    });
    expect(res.status).toBe(201);
    const row = await prisma.flight.findUniqueOrThrow({
      where: { id: res.body.id ?? res.body.flight?.id },
    });
    expect(row.arrivalTime?.toISOString()).toBe("2027-10-31T00:30:00.000Z");
  });

  it("takes the later repeated hour when told to", async () => {
    const res = await create({
      arrival: FRA,
      departure: JFK,
      departureLocal: "2027-10-30T18:00",
      arrivalLocal: "2027-10-31T02:30",
      arrivalFold: "later",
    });
    expect(res.status).toBe(201);
    const row = await prisma.flight.findUniqueOrThrow({
      where: { id: res.body.id ?? res.body.flight?.id },
    });
    expect(row.arrivalTime?.toISOString()).toBe("2027-10-31T01:30:00.000Z");
  });

  it("refuses an unknown zone with 422 ZONE_UNKNOWN on its field", async () => {
    const res = await create({
      departureLocal: "2027-07-01T13:30",
      depTimezone: "Europe/Atlantis",
    });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: "ZONE_UNKNOWN", field: "depTimezone" });
  });
});
