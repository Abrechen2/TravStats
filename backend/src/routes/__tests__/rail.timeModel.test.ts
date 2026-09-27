import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * ADR 0002 phase 2 for rail: a station's zone comes from the station
 * CATALOGUE first and its coordinates second (D2), and a ride records the
 * precision of its times.
 */
const USER = "railtimemodel";
const PARIS = { name: "Paris Est", lat: 48.8768, lon: 2.3591, country: "FR" };

describe("Rail — time model (phase 2)", () => {
  let cookie: string;
  let stationId: number;

  const cleanup = async (): Promise<void> => {
    await prisma.railJourney.deleteMany({ where: { user: { username: USER } } });
    await prisma.user.deleteMany({ where: { username: USER } });
    await prisma.railStation.deleteMany({ where: { searchName: "tm catalogue zone" } });
  };

  beforeAll(async () => {
    await cleanup();
    const u = await prisma.user.create({
      data: { username: USER, passwordHash: await hashPassword("password123") },
    });
    cookie = `auth_token=${generateToken(u.id)}`;
    // A catalogue row whose zone says something its coordinates (Frankfurt)
    // would not: the catalogue is the authority when it names one.
    stationId = (
      await prisma.railStation.create({
        data: {
          name: "TM Catalogue Zone",
          searchName: "tm catalogue zone",
          lat: 50.1071,
          lon: 8.6632,
          timezone: "Europe/London",
          isUserAdded: true,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("reads the departure on the CATALOGUE's zone and records the precision", async () => {
    const res = await request(app)
      .post("/api/v1/rail")
      .set("Cookie", cookie)
      .send({
        operator: "Test",
        departureStation: { stationId, name: "TM Catalogue Zone", lat: 50.1071, lon: 8.6632 },
        arrivalStation: PARIS,
        departureLocal: "2027-07-01T08:15",
        arrivalLocal: "2027-07-01T12:09",
      });
    expect(res.status).toBe(201);
    const id = res.body.id ?? res.body.data?.id ?? res.body.journey?.id;
    const row = await prisma.railJourney.findUniqueOrThrow({ where: { id } });
    expect(row.depTimezone).toBe("Europe/London");
    expect(row.departureTime.toISOString()).toBe("2027-07-01T07:15:00.000Z");
    expect(row.arrTimezone).toBe("Europe/Paris");
    expect(row.depPrecision).toBe("minute");
    expect(row.arrPrecision).toBe("minute");
  });

  it("hands the ride out with times on the station's clock, on every read path", async () => {
    const res = await request(app)
      .post("/api/v1/rail")
      .set("Cookie", cookie)
      .send({
        operator: "Test",
        departureStation: { stationId, name: "TM Catalogue Zone", lat: 50.1071, lon: 8.6632 },
        arrivalStation: PARIS,
        departureLocal: "2027-07-02T08:15",
        arrivalLocal: "2027-07-02T12:09",
      });
    expect(res.status).toBe(201);
    expect(res.body.data.times.departure).toEqual({
      utc: "2027-07-02T07:15:00.000Z",
      zone: "Europe/London",
      offset: "+01:00",
      local: "2027-07-02T08:15:00",
      precision: "minute",
      zoneSource: "stored",
    });
    expect(res.body.data.times.actualArrival).toBeNull();
    const id = res.body.data.id;

    const detail = await request(app).get(`/api/v1/rail/${id}`).set("Cookie", cookie);
    expect(detail.body.data.times.arrival.local).toBe("2027-07-02T12:09:00");
    const list = await request(app).get("/api/v1/rail").set("Cookie", cookie);
    const listed = list.body.data.find((j: { id: string }) => j.id === id);
    expect(listed.times.arrival).toMatchObject({ zone: "Europe/Paris", offset: "+02:00" });
  });

  it("shows a ride stored without a zone as UTC, labelled — never as the station's clock", async () => {
    const res = await request(app)
      .post("/api/v1/rail")
      .set("Cookie", cookie)
      .send({
        operator: "Test",
        departureStation: { stationId, name: "TM Catalogue Zone", lat: 50.1071, lon: 8.6632 },
        arrivalStation: PARIS,
        departureLocal: "2027-07-03T08:15",
      });
    const id = res.body.data.id;
    // A ride written before phase 2 kept no zone.
    await prisma.railJourney.update({ where: { id }, data: { depTimezone: null } });
    const detail = await request(app).get(`/api/v1/rail/${id}`).set("Cookie", cookie);
    expect(detail.body.data.times.departure).toMatchObject({
      zone: null,
      offset: "+00:00",
      local: "2027-07-03T07:15:00",
      zoneSource: null,
    });
  });
});
