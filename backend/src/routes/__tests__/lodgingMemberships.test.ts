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

  /**
   * Chain links. The whole reason they exist: the chain page used to find a
   * membership by comparing `LodgingChain.loyaltyProgram` to this row's
   * `programName` as strings, so a rebrand (NH Rewards -> NH DISCOVERY ->
   * Minor DISCOVERY) or a user correcting their own card made the membership
   * vanish from the page. Linking by id has to survive exactly that.
   */
  describe("chain links", () => {
    let chainA: number;
    let chainB: number;

    beforeAll(async () => {
      const a = await prisma.lodgingChain.create({
        data: { name: "MembershipLinkTest A", loyaltyProgram: "Stale Name", isUserAdded: true },
      });
      const b = await prisma.lodgingChain.create({
        data: { name: "MembershipLinkTest B", loyaltyProgram: "Stale Name", isUserAdded: true },
      });
      chainA = a.id;
      chainB = b.id;
    });

    afterAll(async () => {
      await prisma.lodgingChain.deleteMany({ where: { id: { in: [chainA, chainB] } } });
    });

    afterEach(async () => {
      await prisma.lodgingMembership.deleteMany({ where: { userId } });
    });

    it("creates a membership covering several chains and returns them", async () => {
      const res = await request(app)
        .post("/api/v1/lodging-memberships")
        .set("Cookie", authCookie)
        .send({ programName: "Multi Brand", chainIds: [chainA, chainB] });

      expect(res.status).toBe(201);
      expect(res.body.data.chainIds.sort()).toEqual([chainA, chainB].sort());
      expect(res.body.data.chains.map((c: { name: string }) => c.name).sort()).toEqual([
        "MembershipLinkTest A",
        "MembershipLinkTest B",
      ]);
    });

    it("rejects an unknown chain id with 400 instead of a foreign-key 500", async () => {
      const res = await request(app)
        .post("/api/v1/lodging-memberships")
        .set("Cookie", authCookie)
        .send({ programName: "Bad Link", chainIds: [999999] });

      expect(res.status).toBe(400);
      expect(await prisma.lodgingMembership.count({ where: { userId } })).toBe(0);
    });

    it("keeps the links when a PATCH does not mention chainIds", async () => {
      const created = await request(app)
        .post("/api/v1/lodging-memberships")
        .set("Cookie", authCookie)
        .send({ programName: "Keep Links", chainIds: [chainA] });

      const res = await request(app)
        .patch(`/api/v1/lodging-memberships/${created.body.data.id}`)
        .set("Cookie", authCookie)
        .send({ tier: "Gold" });

      expect(res.status).toBe(200);
      expect(res.body.data.tier).toBe("Gold");
      // Editing a tier must never unlink a card as a side effect.
      expect(res.body.data.chainIds).toEqual([chainA]);
    });

    it("replaces the links when chainIds IS present, including an empty array", async () => {
      const created = await request(app)
        .post("/api/v1/lodging-memberships")
        .set("Cookie", authCookie)
        .send({ programName: "Replace Links", chainIds: [chainA, chainB] });

      const swapped = await request(app)
        .patch(`/api/v1/lodging-memberships/${created.body.data.id}`)
        .set("Cookie", authCookie)
        .send({ chainIds: [chainB] });
      expect(swapped.body.data.chainIds).toEqual([chainB]);

      const cleared = await request(app)
        .patch(`/api/v1/lodging-memberships/${created.body.data.id}`)
        .set("Cookie", authCookie)
        .send({ chainIds: [] });
      expect(cleared.body.data.chainIds).toEqual([]);
    });

    it("keeps the membership on the chain page after the programme is RENAMED", async () => {
      const created = await request(app)
        .post("/api/v1/lodging-memberships")
        .set("Cookie", authCookie)
        .send({ programName: "NH Rewards", chainIds: [chainA] });

      // The user corrects their card's wording. Under the old string join this
      // is exactly the edit that made the membership disappear.
      await request(app)
        .patch(`/api/v1/lodging-memberships/${created.body.data.id}`)
        .set("Cookie", authCookie)
        .send({ programName: "Minor DISCOVERY" });

      const chain = await request(app)
        .get(`/api/v1/lodging-chains/${chainA}`)
        .set("Cookie", authCookie);

      expect(chain.status).toBe(200);
      expect(chain.body.data.membership).not.toBeNull();
      expect(chain.body.data.membership.programName).toBe("Minor DISCOVERY");
    });

    it("does not leak another user's membership onto the chain page", async () => {
      await request(app)
        .post("/api/v1/lodging-memberships")
        .set("Cookie", otherAuthCookie)
        .send({ programName: "Someone Else's Card", chainIds: [chainA] });

      const chain = await request(app)
        .get(`/api/v1/lodging-chains/${chainA}`)
        .set("Cookie", authCookie);

      expect(chain.body.data.membership).toBeNull();
      await prisma.lodgingMembership.deleteMany({ where: { userId: otherUserId } });
    });

    it("deletes the links with the membership, never the catalogue chains", async () => {
      const created = await request(app)
        .post("/api/v1/lodging-memberships")
        .set("Cookie", authCookie)
        .send({ programName: "Cascade Test", chainIds: [chainA, chainB] });

      await request(app)
        .delete(`/api/v1/lodging-memberships/${created.body.data.id}`)
        .set("Cookie", authCookie)
        .expect(204);

      expect(
        await prisma.lodgingMembershipChain.count({
          where: { membershipId: created.body.data.id },
        })
      ).toBe(0);
      expect(await prisma.lodgingChain.count({ where: { id: { in: [chainA, chainB] } } })).toBe(2);
    });
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
