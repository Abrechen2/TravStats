// The route geocodes through Nominatim. A test must not, so the resolver is
// stubbed and each case says what the geocoder "found" — which is the input
// the decision actually turns on.
jest.mock("../lodgingGeocode", () => {
  const actual = jest.requireActual("../lodgingGeocode");
  return { ...actual, resolveLocation: jest.fn() };
});

import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { resolveLocation } from "../lodgingGeocode";

const resolveLocationMock = resolveLocation as jest.Mock;

/**
 * forgejo#118. The Companion decided "is this that house?" by demanding the
 * name AND the city match exactly. On 2026-09-10 a photographed invoice came
 * back with "Oplikon" for Opfikon at OCR confidence 67, and one letter created
 * a second DORMERO. The next scan could duplicate it again, because the first
 * duplicate is stored under the misread name.
 */
describe("POST /lodging/propose", () => {
  let cookie: string;
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "lodgingpropose" } });
    const user = await prisma.user.create({
      data: { username: "lodgingpropose", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
  });

  beforeEach(async () => {
    resolveLocationMock.mockReset();
    resolveLocationMock.mockResolvedValue({});
    await prisma.lodging.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await prisma.lodging.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  const storeDormero = () =>
    prisma.lodging.create({
      data: {
        userId,
        type: "hotel",
        name: "DORMERO Hotel Zürich Airport",
        address: "Schaffhauserstrasse 101",
        city: "Opfikon",
        country: "Schweiz",
        lat: 47.4302,
        lon: 8.5709,
      },
    });

  const propose = (body: Record<string, unknown>) =>
    request(app).post("/api/v1/lodging/propose").set("Cookie", cookie).send(body);

  it("recognises the house through the misread city, via the geocoded address", async () => {
    const stored = await storeDormero();
    // What the geocoder makes of the misread street: the building itself.
    resolveLocationMock.mockResolvedValue({ lat: 47.4303, lon: 8.571 });

    const res = await propose({
      name: "DORMERO Hotel Zürich Airport",
      address: "Schalfhauserstrasse 101, 8152",
      city: "Oplikon",
    }).expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.action).toBe("merge");
    expect(res.body.data.reason).toBe("coordinates");
    expect(res.body.data.match.id).toBe(stored.id);
    expect(res.body.data.match.distanceMetres).toBeLessThanOrEqual(75);
  });

  it("still answers create for a house that is genuinely new", async () => {
    await storeDormero();
    resolveLocationMock.mockResolvedValue({ lat: 52.52, lon: 13.405 });

    const res = await propose({
      name: "Hotel Adlon",
      city: "Berlin",
    }).expect(200);

    expect(res.body.data.action).toBe("create");
    expect(res.body.data.match).toBeNull();
  });

  it("writes nothing", async () => {
    await storeDormero();
    resolveLocationMock.mockResolvedValue({ lat: 52.52, lon: 13.405 });

    await propose({ name: "Hotel Adlon", city: "Berlin" }).expect(200);

    expect(await prisma.lodging.count({ where: { userId } })).toBe(1);
  });

  it("reports the stay count and what completing the row would add", async () => {
    const stored = await storeDormero();
    await prisma.lodging.update({
      where: { id: stored.id },
      data: { address: null, country: null },
    });
    await prisma.lodgingStay.create({
      data: {
        lodgingId: stored.id,
        userId,
        checkIn: new Date("2026-01-01T14:00:00.000Z"),
        checkOut: new Date("2026-01-03T10:00:00.000Z"),
      },
    });
    resolveLocationMock.mockResolvedValue({ lat: 47.4302, lon: 8.5709 });

    const res = await propose({
      name: "DORMERO Hotel Zürich Airport",
      address: "Schaffhauserstrasse 101",
      city: "Opfikon",
      country: "Schweiz",
    }).expect(200);

    expect(res.body.data.match.stayCount).toBe(1);
    expect(res.body.data.match.fillsFields).toEqual(
      expect.arrayContaining(["address", "country"])
    );
  });

  it("does not answer for another account's houses", async () => {
    await storeDormero();
    const other = await prisma.user.create({
      data: { username: `lodgingpropose-other-${Date.now()}`, passwordHash: await hashPassword("password123") },
    });
    resolveLocationMock.mockResolvedValue({ lat: 47.4303, lon: 8.571 });

    try {
      const res = await request(app)
        .post("/api/v1/lodging/propose")
        .set("Cookie", `auth_token=${generateToken(other.id)}`)
        .send({ name: "DORMERO Hotel Zürich Airport", city: "Opfikon" })
        .expect(200);

      expect(res.body.data.action).toBe("create");
      expect(res.body.data.match).toBeNull();
    } finally {
      await prisma.user.delete({ where: { id: other.id } });
    }
  });

  it("refuses a body with no name", async () => {
    await propose({ city: "Opfikon" }).expect(400);
  });

  it("needs a session", async () => {
    await request(app)
      .post("/api/v1/lodging/propose")
      .send({ name: "DORMERO Hotel Zürich Airport" })
      .expect(401);
  });
});
