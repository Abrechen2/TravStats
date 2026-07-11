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
  });

  afterAll(async () => {
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
  });
});
