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
  let chainId: number;
  let houseA: string;
  let foreignHouse: string;

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

    chainId = (
      await prisma.lodgingChain.upsert({
        where: { name: "Suggestion Test Chain" },
        update: {},
        create: { name: "Suggestion Test Chain" },
      })
    ).id;
    const house = (userId: string, name: string, amenities: string[], chain?: number) =>
      prisma.lodging.create({
        data: { userId, name, type: "hotel", amenities, chainId: chain ?? null },
      });
    const a = await house(user.id, "Haus A", ["Pool", "WLAN", " Sauna "], chainId);
    houseA = a.id;
    const b = await house(user.id, "Haus B", ["wlan", "Pool", ""]);
    const sibling = await house(user.id, "Haus D", [], chainId);
    await house(user.id, "Haus C", ["WLAN"]);
    const foreign = await house(other.id, "Fremdes Haus", ["Secret Spa", "Pool"], chainId);
    foreignHouse = foreign.id;
    const day = (d: string) => new Date(`${d}T00:00:00.000Z`);
    const stay = (
      lodgingId: string,
      roomNumber: string,
      roomCategory: string,
      board: string,
      checkIn: string
    ) => ({ lodgingId, userId: user.id, roomNumber, roomCategory, board, checkIn: day(checkIn) });

    await prisma.lodgingStay.createMany({
      data: [
        { lodgingId: a.id, userId: user.id, roomAmenities: ["Balkon", "Minibar"] },
        { lodgingId: a.id, userId: user.id, roomAmenities: ["balkon"] },
        { lodgingId: a.id, userId: user.id, roomAmenities: ["Balkon"] },
        { lodgingId: foreign.id, userId: other.id, roomAmenities: ["Secret Butler"] },
        // Room, category and board history.
        stay(a.id, "412", "Deluxe", "breakfast", "2025-05-01"),
        stay(a.id, "412", "deluxe", "breakfast", "2024-05-01"),
        stay(a.id, "12", "Suite", "half", "2023-05-01"),
        stay(sibling.id, "7", "Club", "full", "2025-01-01"),
        stay(b.id, "3", "Standard", "all_inclusive", "2022-01-01"),
        stay(b.id, "3", "Standard", "none", "2022-02-01"),
        stay(b.id, "3", "Standard", "none", "2022-03-01"),
        { ...stay(foreign.id, "999", "Secret Suite", "breakfast", "2025-06-01"), userId: other.id },
      ],
    });
  });

  afterAll(async () => {
    const ids = { in: [user?.id, other?.id] };
    await prisma.lodgingStay.deleteMany({ where: { userId: ids } });
    await prisma.lodging.deleteMany({ where: { userId: ids } });
    await prisma.user.deleteMany({ where: { id: ids } });
    await prisma.lodgingChain.deleteMany({ where: { id: chainId } });
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

  it("offers this house's rooms, then categories and board from the house, its chain, any", async () => {
    const res = await suggestions({ lodgingId: houseA });
    expect(res.status).toBe(200);
    expect(res.body.data.roomNumbers).toEqual(["412", "12"]);
    // "Deluxe"/"deluxe" merge (the later stay's spelling); the house's own
    // before the chain sibling's "Club", before "Standard" from an unrelated house.
    expect(res.body.data.roomCategories).toEqual(["Deluxe", "Suite", "Club", "Standard"]);
    // "none" is the default, not a suggestion — and the cap is three.
    expect(res.body.data.boards).toEqual(["breakfast", "half", "full"]);
  });

  it("without a house offers no rooms and ranks categories over all stays", async () => {
    const res = await suggestions();
    expect(res.body.data.roomNumbers).toEqual([]);
    expect(res.body.data.roomCategories).toEqual(["Standard", "Deluxe", "Club", "Suite"]);
  });

  it("never offers another account's values, even for that account's house", async () => {
    for (const query of [{}, { lodgingId: foreignHouse }]) {
      const res = await suggestions(query);
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toMatch(/Secret|999/);
      expect(res.body.data.roomNumbers).toEqual([]);
    }
  });

  it("rejects a lodgingId that is not an id", async () => {
    expect((await suggestions({ lodgingId: "nope" })).status).toBe(400);
  });

  it("requires authentication", async () => {
    expect((await request(app).get("/api/v1/lodging/entry-suggestions")).status).toBe(401);
  });
});
