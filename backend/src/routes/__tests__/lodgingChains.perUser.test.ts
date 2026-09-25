import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { commitLodgingImport } from "../../services/lodging/lodgingImportCommit";
import { buildLodgingPreviewRows } from "../../services/lodging/lodgingImportPreview";
import { findChainId } from "../../services/xlsxImport/references";
import { withCatalogueChains } from "../../services/openData/lodgingEnrichment";
import { findVisibleChainByName } from "../../services/lodging/chainScope";
import type { NearbyLodging } from "../../services/openData/openStreetMap";

jest.mock("../../services/fx/resolver", () => ({
  convertToBase: jest.fn(async (amount: number) => ({
    baseAmount: amount,
    rate: 1,
    rateDate: "2026-01-01",
    source: "ecb" as const,
  })),
}));

/**
 * Per-user hotel chains (owner decision 2026-09-25).
 *
 * UAT 2026-08-16: a tester's import in their own account wrote "KOA" into the
 * owner's chain catalogue, because `lodging_chains` had no owner and every
 * account read every row. Now the seeded catalogue stays global and read-only,
 * and a chain a user creates — by hand or by an import — is theirs alone.
 *
 * Every case is asked from BOTH sides: A's chain must be invisible and
 * unusable for B, and the catalogue must stay visible to both. A test that
 * only checked A's view would pass on the old global table.
 */
describe("hotel chains are per user, the catalogue is shared", () => {
  const stamp = Date.now();
  const ownName = `Alpha Own ${stamp}`;
  const importName = `Alpha Import ${stamp}`;
  const catalogueName = `Catalogue Chain ${stamp}`;

  let aId: string;
  let bId: string;
  let aCookie: string;
  let bCookie: string;
  let catalogueId: number;
  let aChainId: number;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["chain_a", "chain_b"] } } });
    const a = await prisma.user.create({
      data: { username: "chain_a", passwordHash: await hashPassword("password123") },
    });
    const b = await prisma.user.create({
      data: { username: "chain_b", passwordHash: await hashPassword("password123") },
    });
    aId = a.id;
    bId = b.id;
    aCookie = `auth_token=${generateToken(a.id)}`;
    bCookie = `auth_token=${generateToken(b.id)}`;
    for (const id of [aId, bId]) {
      await prisma.userSettings.create({ data: { userId: id, data: {}, baseCurrency: "EUR" } });
    }
    catalogueId = (await prisma.lodgingChain.create({ data: { name: catalogueName } })).id;
  });

  afterAll(async () => {
    // Own chains go with their user (ON DELETE CASCADE); the catalogue row is ours.
    await prisma.user.deleteMany({ where: { id: { in: [aId, bId] } } });
    await prisma.lodgingChain.deleteMany({ where: { id: catalogueId } });
    await prisma.$disconnect();
  });

  const list = async (cookie: string, search: string): Promise<{ id: number }[]> => {
    const res = await request(app)
      .get(`/api/v1/lodging-chains?search=${encodeURIComponent(search)}`)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    return res.body.data;
  };

  it("a chain A adds belongs to A", async () => {
    const res = await request(app)
      .post("/api/v1/lodging-chains")
      .set("Cookie", aCookie)
      .send({ name: ownName });
    expect(res.status).toBe(201);
    aChainId = res.body.data.id;
    const row = await prisma.lodgingChain.findUniqueOrThrow({ where: { id: aChainId } });
    expect(row.userId).toBe(aId);
    expect((await list(aCookie, ownName)).map((c) => c.id)).toEqual([aChainId]);
  });

  it("B can neither list nor open A's chain", async () => {
    expect(await list(bCookie, ownName)).toEqual([]);
    const res = await request(app).get(`/api/v1/lodging-chains/${aChainId}`).set("Cookie", bCookie);
    expect(res.status).toBe(404);
  });

  it("B adding the same name gets B's own row, and A's view does not change", async () => {
    const res = await request(app)
      .post("/api/v1/lodging-chains")
      .set("Cookie", bCookie)
      .send({ name: ownName.toUpperCase() });
    expect(res.status).toBe(201);
    expect(res.body.data.id).not.toBe(aChainId);
    expect((await list(aCookie, ownName)).map((c) => c.id)).toEqual([aChainId]);
  });

  it("B cannot link A's chain to a hotel, on create or on edit", async () => {
    const created = await request(app)
      .post("/api/v1/lodging")
      .set("Cookie", bCookie)
      .send({ name: "B Hotel", chainId: aChainId });
    expect(created.status).toBe(400);

    const own = await prisma.lodging.create({ data: { userId: bId, name: "B Own Hotel" } });
    const patched = await request(app)
      .patch(`/api/v1/lodging/${own.id}`)
      .set("Cookie", bCookie)
      .send({ chainId: aChainId });
    expect(patched.status).toBe(400);
    expect((await prisma.lodging.findUniqueOrThrow({ where: { id: own.id } })).chainId).toBeNull();
  });

  it("B cannot attach A's chain to a membership", async () => {
    const res = await request(app)
      .post("/api/v1/lodging-memberships")
      .set("Cookie", bCookie)
      .send({ programName: `B Programme ${stamp}`, chainIds: [aChainId] });
    expect(res.status).toBe(400);
  });

  it("B cannot attach A's chain to a card on the loyalty page either, on create or on edit", async () => {
    // The loyalty page writes the same rows through its own router; a chain
    // check that held on one write path and not the other would be no check.
    const created = await request(app)
      .post("/api/v1/loyalty-memberships")
      .set("Cookie", bCookie)
      .send({ domain: "lodging", programName: `B Loyalty ${stamp}`, chainIds: [aChainId] });
    expect(created.status).toBe(400);

    const own = await request(app)
      .post("/api/v1/loyalty-memberships")
      .set("Cookie", bCookie)
      .send({ domain: "lodging", programName: `B Loyalty Own ${stamp}` });
    expect(own.status).toBe(201);
    const patched = await request(app)
      .patch(`/api/v1/loyalty-memberships/${own.body.data.id}`)
      .set("Cookie", bCookie)
      .send({ chainIds: [aChainId] });
    expect(patched.status).toBe(400);
    const links = await prisma.lodgingMembershipChain.count({
      where: { membershipId: own.body.data.id },
    });
    expect(links).toBe(0);

    // The catalogue stays linkable from the same route.
    const catalogue = await request(app)
      .patch(`/api/v1/loyalty-memberships/${own.body.data.id}`)
      .set("Cookie", bCookie)
      .send({ chainIds: [catalogueId] });
    expect(catalogue.status).toBe(200);
  });

  it("the catalogue stays visible to both, and a known catalogue name creates nothing", async () => {
    expect((await list(aCookie, catalogueName)).map((c) => c.id)).toEqual([catalogueId]);
    expect((await list(bCookie, catalogueName)).map((c) => c.id)).toEqual([catalogueId]);

    const res = await request(app)
      .post("/api/v1/lodging-chains")
      .set("Cookie", aCookie)
      .send({ name: catalogueName.toLowerCase() });
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(catalogueId);
  });

  it("A's chain detail page still works for A", async () => {
    await prisma.lodging.create({ data: { userId: aId, name: "A Hotel", chainId: aChainId } });
    const res = await request(app).get(`/api/v1/lodging-chains/${aChainId}`).set("Cookie", aCookie);
    expect(res.status).toBe(200);
    expect(res.body.data.stats.hotelCount).toBe(1);
  });

  describe("imports", () => {
    it("an import by A creates A's own chain, and never changes B's view", async () => {
      await commitLodgingImport(aId, "csv", "a.csv", [
        {
          sourceRowIndex: 0,
          action: "create",
          lodging: { name: `A Import Hotel ${stamp}`, chainName: importName, createChain: true },
        },
      ]);
      const chain = await prisma.lodgingChain.findFirstOrThrow({ where: { name: importName } });
      expect(chain.userId).toBe(aId);
      expect(await list(bCookie, importName)).toEqual([]);
    });

    it("B's import does not match A's chain: flagged unknown, committed without it", async () => {
      const preview = await buildLodgingPreviewRows(bId, [
        { lodging: { name: `B Import Hotel ${stamp}`, chainName: importName } },
      ]);
      expect(preview.rows[0].flags).toContain("unknown_chain");

      await commitLodgingImport(bId, "csv", "b.csv", [
        {
          sourceRowIndex: 0,
          action: "create",
          lodging: { name: `B Import Hotel ${stamp}`, chainName: importName },
        },
      ]);
      const hotel = await prisma.lodging.findFirstOrThrow({
        where: { userId: bId, name: `B Import Hotel ${stamp}` },
      });
      expect(hotel.chainId).toBeNull();
    });

    it("an import matches a catalogue chain for anyone, case-insensitively", async () => {
      await commitLodgingImport(bId, "csv", "b2.csv", [
        {
          sourceRowIndex: 0,
          action: "create",
          lodging: { name: `B Catalogue Hotel ${stamp}`, chainName: catalogueName.toUpperCase() },
        },
      ]);
      const hotel = await prisma.lodging.findFirstOrThrow({
        where: { userId: bId, name: `B Catalogue Hotel ${stamp}` },
      });
      expect(hotel.chainId).toBe(catalogueId);
    });

    it("the spreadsheet import resolves catalogue and own names only", async () => {
      expect(await findChainId(aId, importName)).not.toBeNull();
      expect(await findChainId(bId, importName)).toBeNull();
      expect(await findChainId(bId, catalogueName)).toBe(catalogueId);
    });
  });
  describe("map brands (OpenStreetMap)", () => {
    const place = (brand: string): NearbyLodging => ({
      name: "Somewhere",
      kind: "hotel",
      lat: 0,
      lon: 0,
      distanceM: 1,
      osmRef: "node/1",
      website: null,
      stars: null,
      brand,
    });

    it("links a brand to A's own chain for A only", async () => {
      const [forA] = await withCatalogueChains(aId, [place(ownName)]);
      const [forB] = await withCatalogueChains(bId, [place(ownName.toLowerCase())]);
      expect(forA.chain?.id).toBe(aChainId);
      // B has an own row of that name too (added above) — B gets B's, never A's.
      expect(forB.chain?.id).not.toBe(aChainId);
    });

    it("prefers the catalogue row when a user also owns one of the same name", async () => {
      const ownTwin = await prisma.lodgingChain.create({
        data: { name: catalogueName, userId: aId, isUserAdded: true },
      });
      expect((await findVisibleChainByName(aId, catalogueName))?.id).toBe(catalogueId);
      const [forA] = await withCatalogueChains(aId, [place(catalogueName)]);
      expect(forA.chain?.id).toBe(catalogueId);
      await prisma.lodgingChain.delete({ where: { id: ownTwin.id } });
    });
  });
});
