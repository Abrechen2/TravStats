import { jest } from "@jest/globals";
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/** forgejo#343: the user's own airlines and aircraft come from a database GROUP BY, not a row scan. */
describe("suggestions from the user's own flights", () => {
  let cookie: string;
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "suggestionsuserentries" } });
    const user = await prisma.user.create({
      data: { username: "suggestionsuserentries", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
    const leg = {
      userId,
      depIata: "MUC",
      arrIata: "CPH",
      depLat: 48.35,
      depLon: 11.78,
      arrLat: 55.62,
      arrLon: 12.65,
      status: "flown",
    };
    await prisma.flight.createMany({
      data: [
        ...[0, 1, 2, 3].map(() => ({ ...leg, airline: "Zqx Homebrew Air", aircraft: "Zqx-9" })),
        { ...leg, airline: "Qwv Other Wings", aircraft: "Qwv-1" },
        { ...leg, airline: null, aircraft: null },
      ],
    });
  });

  afterAll(async () => {
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("lists each of the user's airlines once, filtered by q ignoring case, without a row scan", async () => {
    const scan = jest.spyOn(prisma.flight, "findMany");
    try {
      const res = await request(app)
        .get("/api/v1/suggestions/airlines?q=HOMEBREW")
        .set("Cookie", cookie);
      expect(res.body.suggestions).toEqual(["Zqx Homebrew Air"]);
      expect(scan).not.toHaveBeenCalled();
    } finally {
      scan.mockRestore();
    }
    const all = await request(app).get("/api/v1/suggestions/airlines?q=zqx").set("Cookie", cookie);
    expect(all.body.suggestions).toEqual(["Zqx Homebrew Air"]);
    const other = await request(app)
      .get("/api/v1/suggestions/airlines?q=wings")
      .set("Cookie", cookie);
    expect(other.body.suggestions).toContain("Qwv Other Wings");
  });

  it("lists the user's aircraft types once each without a row scan", async () => {
    const scan = jest.spyOn(prisma.flight, "findMany");
    try {
      const res = await request(app)
        .get("/api/v1/suggestions/aircraft?q=zqx")
        .set("Cookie", cookie);
      expect(res.body.suggestions.filter((s: string) => /zqx/i.test(s))).toHaveLength(1);
      expect(scan).not.toHaveBeenCalled();
    } finally {
      scan.mockRestore();
    }
  });
});
