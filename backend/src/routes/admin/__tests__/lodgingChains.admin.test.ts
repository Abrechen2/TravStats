import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import express, { NextFunction, Response } from "express";
import request from "supertest";

import { prisma } from "../../../db";
import { errorHandler } from "../../../middleware/errorHandler";
import type { AuthRequest } from "../../../middleware/auth";
import lodgingChainsAdminRouter from "../lodgingChains";
import { seedLodgingChainsFromCSV } from "../../../seedLodgingChainsFromCSV";

/**
 * Admin › Hotelketten (forgejo#321): the catalogue can now be corrected, and
 * no correction may cost anybody a link — a merge moves every hotel and card,
 * a delete of a chain in use is refused, and the boot seed does not bring a
 * retired name back.
 */

const tag = `t${Date.now().toString(36)}`;
const userIds: string[] = [];
const chainIds: number[] = [];

const app = express();
app.use(express.json());
app.use((req: AuthRequest, _res: Response, next: NextFunction) => {
  req.userId = "admin-under-test";
  next();
});
app.use("/admin", lodgingChainsAdminRouter);
app.use(errorHandler);

async function user(): Promise<string> {
  const u = await prisma.user.create({
    data: { username: `chains-${tag}-${userIds.length}`, passwordHash: "x", isActive: true },
  });
  userIds.push(u.id);
  return u.id;
}

async function chain(name: string, userId: string | null = null): Promise<number> {
  const c = await prisma.lodgingChain.create({
    data: { name: `${name} ${tag}`, userId, isUserAdded: userId !== null },
  });
  chainIds.push(c.id);
  return c.id;
}

async function hotel(userId: string, chainId: number): Promise<string> {
  const l = await prisma.lodging.create({ data: { userId, name: `Hotel ${tag}`, chainId } });
  return l.id;
}

async function card(userId: string, programName: string, chains: number[]): Promise<string> {
  const m = await prisma.loyaltyMembership.create({
    data: {
      userId,
      programName: `${programName} ${tag}`,
      chains: { create: chains.map((chainId) => ({ chainId })) },
    },
  });
  return m.id;
}

let alice: string;
let bob: string;

beforeAll(async () => {
  alice = await user();
  bob = await user();
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.lodgingChain.deleteMany({ where: { id: { in: chainIds } } });
  await prisma.retiredLodgingChainName.deleteMany({ where: { name: { contains: tag } } });
});

describe("GET /admin/lodging-chains", () => {
  it("lists the catalogue only, with what links to each chain, and searches", async () => {
    const catalogue = await chain("Listed Group");
    await chain("Listed Group own", alice);
    await hotel(alice, catalogue);
    await hotel(bob, catalogue);
    await card(alice, "Listed Rewards", [catalogue]);

    const res = await request(app).get(`/admin/lodging-chains?search=${tag}`);
    expect(res.status).toBe(200);
    const names = res.body.items.map((c: { name: string }) => c.name);
    expect(names).toContain(`Listed Group ${tag}`);
    // A user's own chain is theirs, not the catalogue's.
    expect(names).not.toContain(`Listed Group own ${tag}`);
    const row = res.body.items.find((c: { id: number }) => c.id === catalogue);
    expect(row).toMatchObject({ lodgingCount: 2, membershipCount: 1 });
    expect(row).not.toHaveProperty("userId");
    expect(res.body.total).toBe(res.body.items.length);
  });
});

describe("POST /admin/lodging-chains", () => {
  it("adds a catalogue chain", async () => {
    const res = await request(app)
      .post("/admin/lodging-chains")
      .send({ name: `Added Group ${tag}`, brandColor: "#112233", loyaltyProgram: "Added Club" });
    expect(res.status).toBe(201);
    chainIds.push(res.body.id);
    const row = await prisma.lodgingChain.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.userId).toBeNull();
  });

  it("refuses a name the catalogue already has, in any case", async () => {
    await chain("Taken Group");
    const res = await request(app)
      .post("/admin/lodging-chains")
      .send({ name: `taken group ${tag}`.toUpperCase() });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("chainNameTaken");
  });

  it.each([[{ name: "" }], [{ name: "X", brandColor: "red" }], [{ name: "X", userId: "u" }]])(
    "refuses invalid input %j",
    async (body) => {
      const res = await request(app).post("/admin/lodging-chains").send(body);
      expect(res.status).toBe(400);
    }
  );
});

describe("PATCH /admin/lodging-chains/:id", () => {
  it("renames, and the next boot seed does not bring the old name back", async () => {
    const id = await prisma.lodgingChain
      .findFirst({ where: { name: "Hilton", userId: null } })
      .then(
        async (c) => c?.id ?? (await prisma.lodgingChain.create({ data: { name: "Hilton" } })).id
      );
    const res = await request(app)
      .patch(`/admin/lodging-chains/${id}`)
      .send({ name: `Hilton Hotels ${tag}` });
    expect(res.status).toBe(200);
    await seedLodgingChainsFromCSV();
    expect(await prisma.lodgingChain.count({ where: { name: "Hilton", userId: null } })).toBe(0);

    // Renaming back un-retires it, so it stays the catalogue's name.
    await request(app).patch(`/admin/lodging-chains/${id}`).send({ name: "Hilton" });
    expect(await prisma.retiredLodgingChainName.count({ where: { name: "hilton" } })).toBe(0);
  });

  it("refuses a rename onto another catalogue name", async () => {
    const a = await chain("Rename A");
    await chain("Rename B");
    const res = await request(app)
      .patch(`/admin/lodging-chains/${a}`)
      .send({ name: `Rename B ${tag}` });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("chainNameTaken");
  });

  it("does not touch a user's own chain", async () => {
    const own = await chain("Own Group", alice);
    const res = await request(app).patch(`/admin/lodging-chains/${own}`).send({ name: "Mine" });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /admin/lodging-chains/:id", () => {
  it("refuses a chain hotels or cards still link to, and changes nothing", async () => {
    const id = await chain("Busy Group");
    const h = await hotel(bob, id);
    const m = await card(bob, "Busy Club", [id]);
    const res = await request(app).delete(`/admin/lodging-chains/${id}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("chainInUse");
    expect((await prisma.lodging.findUniqueOrThrow({ where: { id: h } })).chainId).toBe(id);
    expect(await prisma.lodgingMembershipChain.count({ where: { membershipId: m } })).toBe(1);
  });

  it("refuses a chain only a card links to — deleting would cascade the card's link away", async () => {
    const id = await chain("Card Only Group");
    await card(alice, "Card Only Club", [id]);
    const res = await request(app).delete(`/admin/lodging-chains/${id}`);
    expect(res.status).toBe(409);
  });

  it("deletes an unused chain and keeps the seed from re-adding it", async () => {
    const id = await chain("Unused Group");
    const res = await request(app).delete(`/admin/lodging-chains/${id}`);
    expect(res.status).toBe(204);
    expect(await prisma.lodgingChain.count({ where: { id } })).toBe(0);
    expect(
      await prisma.retiredLodgingChainName.count({
        where: { name: `unused group ${tag}` },
      })
    ).toBe(1);
  });
});

describe("POST /admin/lodging-chains/:id/merge", () => {
  it("moves every account's hotels and cards to the target, then removes the source", async () => {
    const source = await chain("Merge Source");
    const target = await chain("Merge Target");
    const h1 = await hotel(alice, source);
    const h2 = await hotel(bob, source);
    const hTarget = await hotel(bob, target);
    const onlySource = await card(alice, "Merge Club A", [source]);
    const both = await card(bob, "Merge Club B", [source, target]);

    const res = await request(app)
      .post(`/admin/lodging-chains/${source}/merge`)
      .send({ targetId: target });
    expect(res.status).toBe(200);
    expect(res.body.moved).toMatchObject({ lodgings: 2, memberships: 2 });
    expect(res.body.target).toMatchObject({ id: target, lodgingCount: 3, membershipCount: 2 });

    for (const id of [h1, h2, hTarget]) {
      expect((await prisma.lodging.findUniqueOrThrow({ where: { id } })).chainId).toBe(target);
    }
    for (const membershipId of [onlySource, both]) {
      const links = await prisma.lodgingMembershipChain.findMany({ where: { membershipId } });
      expect(links.map((l) => l.chainId)).toEqual([target]);
    }
    expect(await prisma.lodgingChain.count({ where: { id: source } })).toBe(0);
  });

  it("refuses merging into itself or into a user's own chain, and moves nothing", async () => {
    const source = await chain("Merge Refused");
    const own = await chain("Merge Own", alice);
    const h = await hotel(alice, source);
    expect(
      (await request(app).post(`/admin/lodging-chains/${source}/merge`).send({ targetId: source }))
        .status
    ).toBe(400);
    expect(
      (await request(app).post(`/admin/lodging-chains/${source}/merge`).send({ targetId: own }))
        .status
    ).toBe(404);
    expect((await prisma.lodging.findUniqueOrThrow({ where: { id: h } })).chainId).toBe(source);
    expect(await prisma.lodgingChain.count({ where: { id: source } })).toBe(1);
  });
});
