import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

describe("Lodging Memberships API", () => {
  let authCookie: string;
  let userId: string;
  let otherAuthCookie: string;
  let otherUserId: string;

  beforeAll(async () => {
    await prisma.lodgingMembership.deleteMany({
      where: { user: { username: { in: ["lodgingmembertest", "lodgingmemberother"] } } },
    });
    await prisma.user.deleteMany({
      where: { username: { in: ["lodgingmembertest", "lodgingmemberother"] } },
    });

    const u = await prisma.user.create({
      data: { username: "lodgingmembertest", passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    authCookie = `auth_token=${generateToken(u.id)}`;

    const other = await prisma.user.create({
      data: { username: "lodgingmemberother", passwordHash: await hashPassword("password123") },
    });
    otherUserId = other.id;
    otherAuthCookie = `auth_token=${generateToken(other.id)}`;
  });

  afterAll(async () => {
    await prisma.lodgingMembership.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await prisma.$disconnect();
  });

  describe("POST/GET /api/v1/lodging-memberships", () => {
    it("requires authentication", async () => {
      const res = await request(app).get("/api/v1/lodging-memberships");
      expect(res.status).toBe(401);
    });

    it("creates and lists a membership for the owner only", async () => {
      const create = await request(app)
        .post("/api/v1/lodging-memberships")
        .set("Cookie", authCookie)
        .send({ programName: "Marriott Bonvoy", tier: "Gold" });
      expect(create.status).toBe(201);
      expect(create.body.data.userId).toBe(userId);
      expect(create.body.data.programName).toBe("Marriott Bonvoy");
      // No chainId on the response — memberships are program-based, several
      // chains (Sheraton/Westin/Ritz-Carlton) share one loyalty program.
      expect(create.body.data).not.toHaveProperty("chainId");

      const list = await request(app)
        .get("/api/v1/lodging-memberships")
        .set("Cookie", authCookie);
      expect(list.status).toBe(200);
      expect(list.body.data).toHaveLength(1);
    });

    it("strips an unknown chainId field from the input instead of persisting it", async () => {
      const res = await request(app)
        .post("/api/v1/lodging-memberships")
        .set("Cookie", authCookie)
        .send({ programName: "Hilton Honors", chainId: 1 });
      expect(res.status).toBe(201);
      expect(res.body.data).not.toHaveProperty("chainId");
    });

    it("rejects an invalid payload (missing programName)", async () => {
      const res = await request(app)
        .post("/api/v1/lodging-memberships")
        .set("Cookie", authCookie)
        .send({});
      expect(res.status).toBe(400);
    });

    it("rejects a second membership for the same program cleanly (unique per user+program), not a raw 500", async () => {
      const res = await request(app)
        .post("/api/v1/lodging-memberships")
        .set("Cookie", authCookie)
        .send({ programName: "Marriott Bonvoy", tier: "Platinum" });
      expect(res.status).toBe(409);
    });
  });

  describe("PATCH/DELETE /api/v1/lodging-memberships/:id — ownership scoping", () => {
    let membershipId: string;

    beforeAll(async () => {
      const created = await prisma.lodgingMembership.create({
        data: { userId, programName: "IHG One Rewards", tier: "Silver" },
      });
      membershipId = created.id;
    });

    it("updates the owner's membership", async () => {
      const res = await request(app)
        .patch(`/api/v1/lodging-memberships/${membershipId}`)
        .set("Cookie", authCookie)
        .send({ tier: "Gold" });
      expect(res.status).toBe(200);
      expect(res.body.data.tier).toBe("Gold");
    });

    it("404s another user's membership on PATCH (row unchanged, no existence leak)", async () => {
      const res = await request(app)
        .patch(`/api/v1/lodging-memberships/${membershipId}`)
        .set("Cookie", otherAuthCookie)
        .send({ tier: "Hacked" });
      expect(res.status).toBe(404);
      const still = await prisma.lodgingMembership.findUnique({ where: { id: membershipId } });
      expect(still?.tier).toBe("Gold");
    });

    it("404s a PATCH on a non-existent id the same way as someone else's row (no existence leak)", async () => {
      const res = await request(app)
        .patch("/api/v1/lodging-memberships/00000000-0000-0000-0000-000000000000")
        .set("Cookie", authCookie)
        .send({ tier: "Gold" });
      expect(res.status).toBe(404);
    });

    it("404s another user's membership on DELETE (row survives)", async () => {
      const res = await request(app)
        .delete(`/api/v1/lodging-memberships/${membershipId}`)
        .set("Cookie", otherAuthCookie);
      expect(res.status).toBe(404);
      const still = await prisma.lodgingMembership.findUnique({ where: { id: membershipId } });
      expect(still).not.toBeNull();
    });

    it("rejects an empty PATCH body — no silent no-op", async () => {
      const res = await request(app)
        .patch(`/api/v1/lodging-memberships/${membershipId}`)
        .set("Cookie", authCookie)
        .send({});
      expect(res.status).toBe(400);
    });

    it("deletes the owner's membership", async () => {
      const res = await request(app)
        .delete(`/api/v1/lodging-memberships/${membershipId}`)
        .set("Cookie", authCookie);
      expect(res.status).toBe(204);
      const gone = await prisma.lodgingMembership.findUnique({ where: { id: membershipId } });
      expect(gone).toBeNull();
    });
  });

  describe("GET /api/v1/lodging-memberships — listing is scoped to the caller", () => {
    it("does not list another user's memberships", async () => {
      await prisma.lodgingMembership.create({
        data: { userId: otherUserId, programName: "Accor Live Limitless" },
      });
      const res = await request(app)
        .get("/api/v1/lodging-memberships")
        .set("Cookie", authCookie);
      expect(res.status).toBe(200);
      for (const m of res.body.data as { userId: string }[]) {
        expect(m.userId).toBe(userId);
      }
    });
  });
});
