import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * GET /currencies/recent — the currencies THIS account books in.
 *
 * Derived from the user's own rows rather than stored, so it cannot go stale,
 * and scoped to the user, because it is a statement about their travel.
 */
describe("recent currencies", () => {
  let authCookie: string;
  let userId: string;
  let otherCookie: string;
  let otherId: string;
  let lodgingId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({
      where: { username: { in: ["recentcur_test", "recentcur_other"] } },
    });
    const user = await prisma.user.create({
      data: { username: "recentcur_test", passwordHash: await hashPassword("password123") },
    });
    const other = await prisma.user.create({
      data: { username: "recentcur_other", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    otherId = other.id;
    authCookie = `auth_token=${generateToken(user.id)}`;
    otherCookie = `auth_token=${generateToken(other.id)}`;

    const lodging = await prisma.lodging.create({ data: { userId, name: "Hotel Recent" } });
    lodgingId = lodging.id;
    const stay = (currency: string, day: string) => ({
      userId,
      lodgingId,
      checkIn: new Date(`${day}T00:00:00.000Z`),
      checkOut: new Date(`${day}T00:00:00.000Z`),
      currency,
    });
    await prisma.lodgingStay.createMany({
      data: [
        stay("NOK", "2024-09-17"),
        stay("NOK", "2024-12-01"),
        stay("NOK", "2025-01-05"),
        stay("EGP", "2026-03-04"),
        // A row from before ISO-4217 validation: whatever it holds, it must not
        // be offered back as a choice, or the picker re-enters the bad value.
        stay("EURO", "2025-06-01"),
      ],
    });

    const otherLodging = await prisma.lodging.create({
      data: { userId: otherId, name: "Foreign Hotel" },
    });
    await prisma.lodgingStay.create({
      data: {
        userId: otherId,
        lodgingId: otherLodging.id,
        checkIn: new Date("2025-02-02T00:00:00.000Z"),
        checkOut: new Date("2025-02-03T00:00:00.000Z"),
        currency: "JPY",
      },
    });
  });

  afterAll(async () => {
    await prisma.lodgingStay.deleteMany({ where: { userId: { in: [userId, otherId] } } });
    await prisma.lodging.deleteMany({ where: { userId: { in: [userId, otherId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
    await prisma.$disconnect();
  });

  it("ranks the user's own currencies by how often they appear", async () => {
    const res = await request(app).get("/api/v1/currencies/recent").set("Cookie", authCookie);
    expect(res.status).toBe(200);
    expect(res.body.codes[0]).toBe("NOK"); // three stays beats one
    expect(res.body.codes).toContain("EGP");
  });

  it("never offers back a stored value that is not a currency", async () => {
    const res = await request(app).get("/api/v1/currencies/recent").set("Cookie", authCookie);
    expect(res.body.codes).not.toContain("EURO");
  });

  it("does not leak another account's currencies", async () => {
    const res = await request(app).get("/api/v1/currencies/recent").set("Cookie", authCookie);
    expect(res.body.codes).not.toContain("JPY");
    const theirs = await request(app).get("/api/v1/currencies/recent").set("Cookie", otherCookie);
    expect(theirs.body.codes).toEqual(["JPY"]);
  });

  it("requires authentication", async () => {
    const res = await request(app).get("/api/v1/currencies/recent");
    expect(res.status).toBe(401);
  });
});
