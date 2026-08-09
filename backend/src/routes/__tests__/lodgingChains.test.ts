import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

describe("Lodging Chains API", () => {
  let authCookie: string;
  let userId: string;
  const createdChainIds: number[] = [];

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "lodgingchaintest" } });
    const u = await prisma.user.create({
      data: { username: "lodgingchaintest", passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    authCookie = `auth_token=${generateToken(u.id)}`;
    await prisma.userSettings.create({ data: { userId, data: {}, baseCurrency: "EUR" } });
  });

  afterAll(async () => {
    await prisma.lodgingStay.deleteMany({ where: { userId } });
    await prisma.lodging.deleteMany({ where: { userId } });
    await prisma.userSettings.deleteMany({ where: { userId } });
    if (createdChainIds.length > 0) {
      await prisma.lodgingChain.deleteMany({ where: { id: { in: createdChainIds } } });
    }
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  describe("GET /api/v1/lodging-chains", () => {
    it("requires authentication", async () => {
      const res = await request(app).get("/api/v1/lodging-chains");
      expect(res.status).toBe(401);
    });

    it("searches chains case-insensitively", async () => {
      const seeded = await prisma.lodgingChain.create({ data: { name: "Marriott Test Chain" } });
      createdChainIds.push(seeded.id);
      const res = await request(app)
        .get("/api/v1/lodging-chains?search=marr")
        .set("Cookie", authCookie);
      expect(res.status).toBe(200);
      expect(res.body.data.some((c: { name: string }) => /marriott/i.test(c.name))).toBe(true);
    });

    it("returns an empty match set for a search with no hits (never errors)", async () => {
      const res = await request(app)
        .get("/api/v1/lodging-chains?search=zzz-no-such-chain-in-catalog-zzz")
        .set("Cookie", authCookie);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it("returns the full catalog (no search) capped by the request limit", async () => {
      const res = await request(app).get("/api/v1/lodging-chains").set("Cookie", authCookie);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe("POST /api/v1/lodging-chains", () => {
    it("adds a user chain flagged isUserAdded", async () => {
      const res = await request(app)
        .post("/api/v1/lodging-chains")
        .set("Cookie", authCookie)
        .send({ name: "My Boutique Group" });
      expect(res.status).toBe(201);
      expect(res.body.data.isUserAdded).toBe(true);
      createdChainIds.push(res.body.data.id);
    });

    it("requires authentication", async () => {
      const res = await request(app).post("/api/v1/lodging-chains").send({ name: "No Auth Group" });
      expect(res.status).toBe(401);
    });

    it("rejects an invalid payload (missing name)", async () => {
      const res = await request(app)
        .post("/api/v1/lodging-chains")
        .set("Cookie", authCookie)
        .send({});
      expect(res.status).toBe(400);
    });

    it("ignores a client-forged isUserAdded:false and a client-supplied id (server sets ownership)", async () => {
      const res = await request(app)
        .post("/api/v1/lodging-chains")
        .set("Cookie", authCookie)
        .send({ name: "Forged Flag Group", isUserAdded: false, id: 999999999 });
      expect(res.status).toBe(201);
      expect(res.body.data.isUserAdded).toBe(true);
      expect(res.body.data.id).not.toBe(999999999);
      createdChainIds.push(res.body.data.id);
    });

    it("handles a duplicate chain name cleanly instead of a raw 500 (decision: returns the existing chain, 200)", async () => {
      const first = await request(app)
        .post("/api/v1/lodging-chains")
        .set("Cookie", authCookie)
        .send({ name: "Duplicate Name Group" });
      expect(first.status).toBe(201);
      createdChainIds.push(first.body.data.id);

      const second = await request(app)
        .post("/api/v1/lodging-chains")
        .set("Cookie", authCookie)
        .send({ name: "Duplicate Name Group" });
      expect(second.status).toBe(200);
      expect(second.body.data.id).toBe(first.body.data.id);
    });

    it("still creates a genuinely new chain name, flagged isUserAdded", async () => {
      const countBefore = await prisma.lodgingChain.count();

      const res = await request(app)
        .post("/api/v1/lodging-chains")
        .set("Cookie", authCookie)
        .send({ name: "Totally Novel Chain Name" });
      expect(res.status).toBe(201);
      expect(res.body.data.isUserAdded).toBe(true);
      createdChainIds.push(res.body.data.id);

      const countAfter = await prisma.lodgingChain.count();
      expect(countAfter).toBe(countBefore + 1);
    });

    it("matches an existing chain case-insensitively (lowercase variant), without creating a near-duplicate", async () => {
      // "Hilton" is part of the real CSV-seeded catalog (see
      // seedLodgingChainsFromCSV.ts) — look it up rather than creating it,
      // so this test doesn't collide with (or delete) catalog data.
      let seeded = await prisma.lodgingChain.findFirst({
        where: { name: { equals: "Hilton", mode: "insensitive" } },
      });
      if (!seeded) {
        seeded = await prisma.lodgingChain.create({ data: { name: "Hilton" } });
        createdChainIds.push(seeded.id);
      }
      const countBefore = await prisma.lodgingChain.count();

      const res = await request(app)
        .post("/api/v1/lodging-chains")
        .set("Cookie", authCookie)
        .send({ name: "hilton" });

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(seeded.id);
      expect(res.body.data.name).toBe(seeded.name); // catalog casing wins, not the user's spelling

      const countAfter = await prisma.lodgingChain.count();
      expect(countAfter).toBe(countBefore);
    });

    it("matches an existing chain case-insensitively (mixed-case variant), without creating a near-duplicate", async () => {
      const seeded = await prisma.lodgingChain.create({ data: { name: "Hilton Mixed" } });
      createdChainIds.push(seeded.id);
      const countBefore = await prisma.lodgingChain.count();

      const res = await request(app)
        .post("/api/v1/lodging-chains")
        .set("Cookie", authCookie)
        .send({ name: "HILTON MIXED" });

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(seeded.id);
      expect(res.body.data.name).toBe("Hilton Mixed");

      const countAfter = await prisma.lodgingChain.count();
      expect(countAfter).toBe(countBefore);
    });
  });

  describe("GET /api/v1/lodging-chains/:id", () => {
    it("requires authentication", async () => {
      const chain = await prisma.lodgingChain.create({ data: { name: "Auth Test Chain" } });
      createdChainIds.push(chain.id);
      const res = await request(app).get(`/api/v1/lodging-chains/${chain.id}`);
      expect(res.status).toBe(401);
    });

    it("404s for a chain id that doesn't exist", async () => {
      const res = await request(app)
        .get("/api/v1/lodging-chains/999999999")
        .set("Cookie", authCookie);
      expect(res.status).toBe(404);
    });

    it("400s for a non-numeric id", async () => {
      const res = await request(app)
        .get("/api/v1/lodging-chains/not-a-number")
        .set("Cookie", authCookie);
      expect(res.status).toBe(400);
    });

    it("returns the chain, the caller's hotels in it (with aggregates), stats, membership and sibling chains", async () => {
      const chain = await prisma.lodgingChain.create({
        data: { name: "Sheraton Detail Test", loyaltyProgram: "Marriott Bonvoy Detail Test" },
      });
      createdChainIds.push(chain.id);
      const sibling = await prisma.lodgingChain.create({
        data: { name: "Westin Detail Test", loyaltyProgram: "Marriott Bonvoy Detail Test" },
      });
      createdChainIds.push(sibling.id);
      // A chain sharing no program with anything — must never show up as a sibling.
      const unrelated = await prisma.lodgingChain.create({ data: { name: "Unrelated Detail Test" } });
      createdChainIds.push(unrelated.id);

      const lodging = await prisma.lodging.create({
        data: { userId, name: "Sheraton Zürich Detail Test", chainId: chain.id },
      });
      await prisma.lodgingStay.create({
        data: {
          lodgingId: lodging.id,
          userId,
          checkIn: new Date("2024-05-13T15:00:00.000Z"),
          checkOut: new Date("2024-05-15T11:00:00.000Z"),
          ratingOverall: 4,
        },
      });
      // Linked by ID, not by a name that happens to equal the chain's
      // `loyaltyProgram` — that string join is gone (see LodgingMembershipChain).
      // Linked to BOTH chains, which is what makes the sibling a sibling here.
      const membership = await prisma.lodgingMembership.create({
        data: {
          userId,
          programName: "Marriott Bonvoy Detail Test",
          tier: "Gold",
          chains: { create: [{ chainId: chain.id }, { chainId: sibling.id }] },
        },
      });

      const res = await request(app)
        .get(`/api/v1/lodging-chains/${chain.id}`)
        .set("Cookie", authCookie);
      expect(res.status).toBe(200);
      expect(res.body.data.chain.id).toBe(chain.id);
      expect(res.body.data.lodgings).toHaveLength(1);
      expect(res.body.data.lodgings[0].nights).toBe(2);
      expect(res.body.data.lodgings[0].overallRating).toBe(4);
      expect(res.body.data.stats).toEqual({
        hotelCount: 1,
        stayCount: 1,
        nights: 2,
        totalSpendBase: 0,
        avgRating: 4,
      });
      expect(res.body.data.membership.id).toBe(membership.id);
      expect(res.body.data.membership.programName).toBe("Marriott Bonvoy Detail Test");
      expect(res.body.data.siblingChains).toHaveLength(1);
      expect(res.body.data.siblingChains[0].id).toBe(sibling.id);

      await prisma.lodgingMembership.deleteMany({ where: { id: membership.id } });
    });

    it("returns null membership and an empty hotel list for a chain the caller has no data for", async () => {
      const chain = await prisma.lodgingChain.create({
        data: { name: "No Membership Chain Detail Test" },
      });
      createdChainIds.push(chain.id);

      const res = await request(app)
        .get(`/api/v1/lodging-chains/${chain.id}`)
        .set("Cookie", authCookie);
      expect(res.status).toBe(200);
      expect(res.body.data.lodgings).toEqual([]);
      expect(res.body.data.stats).toEqual({
        hotelCount: 0,
        stayCount: 0,
        nights: 0,
        totalSpendBase: 0,
        avgRating: null,
      });
      expect(res.body.data.membership).toBeNull();
      expect(res.body.data.siblingChains).toEqual([]);
    });

    it("never returns another user's hotels for this chain", async () => {
      const chain = await prisma.lodgingChain.create({ data: { name: "Isolation Test Chain" } });
      createdChainIds.push(chain.id);
      const other = await prisma.user.create({
        data: { username: "lodgingchaintest-other", passwordHash: await hashPassword("password123") },
      });
      await prisma.lodging.create({
        data: { userId: other.id, name: "Someone Else's Hotel", chainId: chain.id },
      });

      const res = await request(app)
        .get(`/api/v1/lodging-chains/${chain.id}`)
        .set("Cookie", authCookie);
      expect(res.status).toBe(200);
      expect(res.body.data.lodgings).toEqual([]);

      await prisma.lodging.deleteMany({ where: { userId: other.id } });
      await prisma.user.deleteMany({ where: { id: other.id } });
    });
  });
});
