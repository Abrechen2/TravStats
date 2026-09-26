import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * Silent-failure review 2026-09-26, finding 15. The edit dialog sends airline
 * NAMES; the update wrote a new operating airline's name and left the previous
 * carrier's IATA/ICAO standing, so the logo and the airline stats kept showing
 * the airline the user had just replaced.
 */
const USERNAME = `flight-opcodes-${Date.now()}`;

describe("PUT /flights/:id — airline codes follow the airline name", () => {
  let cookie: string;
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: USERNAME, passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(userId)}`;
  });

  afterAll(async () => {
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    await prisma.$disconnect();
  });

  let seq = 0;
  const createCodeshare = async (): Promise<string> => {
    seq += 1;
    const flight = await prisma.flight.create({
      data: {
        userId,
        flightNumber: `LX${1000 + seq}`,
        airline: "Swiss",
        airlineIata: "LX",
        airlineIcao: "SWR",
        operatingAirline: "Lufthansa",
        operatingAirlineIata: "LH",
        operatingAirlineIcao: "DLH",
        isCodeshare: true,
        depIata: "FRA",
        arrIata: "ZRH",
        depLat: 50.03,
        depLon: 8.57,
        arrLat: 47.46,
        arrLon: 8.55,
        departureTime: new Date("2026-06-01T08:00:00Z"),
        arrivalTime: new Date("2026-06-01T09:00:00Z"),
      },
    });
    return flight.id;
  };

  const put = (id: string, body: Record<string, unknown>) =>
    request(app).put(`/api/v1/flights/${id}`).set("Cookie", cookie).send(body);

  it("gives a renamed operating airline its own codes", async () => {
    const id = await createCodeshare();
    await put(id, { operatingAirline: "Condor" }).expect(200);

    const stored = await prisma.flight.findUniqueOrThrow({ where: { id } });
    expect(stored.operatingAirline).toBe("Condor");
    expect(stored.operatingAirlineIata).toBe("DE");
    expect(stored.operatingAirlineIcao).toBe("CFG");
  });

  it("clears the codes of a renamed operating airline it cannot resolve", async () => {
    const id = await createCodeshare();
    await put(id, { operatingAirline: "Nowhere Air Charter" }).expect(200);

    const stored = await prisma.flight.findUniqueOrThrow({ where: { id } });
    expect(stored.operatingAirlineIata).toBeNull();
    expect(stored.operatingAirlineIcao).toBeNull();
  });

  it("keeps the codes when the name is saved unchanged", async () => {
    const id = await createCodeshare();
    await put(id, { operatingAirline: "Lufthansa", airline: "Swiss" }).expect(200);

    const stored = await prisma.flight.findUniqueOrThrow({ where: { id } });
    expect(stored.operatingAirlineIata).toBe("LH");
    expect(stored.operatingAirlineIcao).toBe("DLH");
    expect(stored.airlineIata).toBe("LX");
  });
});
