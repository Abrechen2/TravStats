import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * `GET /lodging/entry-suggestions` — what the lodging and stay forms offer
 * from the caller's own lodgings. Pinned: values are merged
 * case-insensitively and ranked by use, the lodging router's envelope is
 * kept, and nothing of another account is ever offered.
 */
describe("GET /api/v1/lodging/entry-suggestions", () => {
  let user: { id: string };
  let other: { id: string };
  let authCookie: string;

  const suggestions = (query: Record<string, string> = {}) =>
    request(app).get("/api/v1/lodging/entry-suggestions").query(query).set("Cookie", authCookie);

  beforeAll(async () => {
    const timestamp = Date.now();
    const make = (name: string) =>
      hashPassword("test-password").then((passwordHash) =>
        prisma.user.create({
          data: { username: `${name}-${timestamp}`, passwordHash, isAdmin: false, isActive: true },
        })
      );
    user = await make("lodging-suggest");
    other = await make("lodging-suggest-other");
    authCookie = `auth_token=${generateToken(user.id)}`;

    const house = (userId: string, name: string, amenities: string[]) =>
      prisma.lodging.create({ data: { userId, name, type: "hotel", amenities } });
    const a = await house(user.id, "Haus A", ["Pool", "WLAN", " Sauna "]);
    await house(user.id, "Haus B", ["wlan", "Pool", ""]);
    await house(user.id, "Haus C", ["WLAN"]);
    const foreign = await house(other.id, "Fremdes Haus", ["Secret Spa", "Pool"]);

    await prisma.lodgingStay.createMany({
      data: [
        { lodgingId: a.id, userId: user.id, roomAmenities: ["Balkon", "Minibar"] },
        { lodgingId: a.id, userId: user.id, roomAmenities: ["balkon"] },
        { lodgingId: a.id, userId: user.id, roomAmenities: ["Balkon"] },
        { lodgingId: foreign.id, userId: other.id, roomAmenities: ["Secret Butler"] },
      ],
    });
  });

  afterAll(async () => {
    const ids = { in: [user?.id, other?.id] };
    await prisma.lodgingStay.deleteMany({ where: { userId: ids } });
    await prisma.lodging.deleteMany({ where: { userId: ids } });
    await prisma.user.deleteMany({ where: { id: ids } });
  });

  it("offers house and room amenities, merged and ranked by use, in the envelope", async () => {
    const res = await suggestions();
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.amenities).toEqual([
      // "WLAN" twice over "wlan" once — the spelling used most is shown.
      { name: "WLAN", usageCount: 3 },
      { name: "Pool", usageCount: 2 },
      { name: "Sauna", usageCount: 1 },
    ]);
    expect(res.body.data.roomAmenities).toEqual([
      { name: "Balkon", usageCount: 3 },
      { name: "Minibar", usageCount: 1 },
    ]);
  });

  it("never offers another account's values", async () => {
    const body = JSON.stringify((await suggestions()).body);
    expect(body).not.toContain("Secret");
  });

  it("requires authentication", async () => {
    expect((await request(app).get("/api/v1/lodging/entry-suggestions")).status).toBe(401);
  });
});
