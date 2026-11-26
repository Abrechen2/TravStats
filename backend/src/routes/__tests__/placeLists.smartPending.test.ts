import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

const USERS = ["smartpendinguser", "smartpendingother"];
const SMART = "/api/v1/place-lists/smart";
const RULE = {
  brandWikidataId: "Q38076",
  brandName: "McDonald's",
  minDwellMinutes: 5,
  maxDwellMinutes: 60,
  maxDistanceM: 100,
  autoAcceptDistanceM: 60,
  autoAccept: false,
};

describe("Smart lists: pending confirmations, inbox sources, automatic visits", () => {
  let cookie: string;
  let otherCookie: string;
  let userId: string;
  let listA: string;
  let listB: string;
  let placeId: string;
  let n = 0;

  const stay = async (opts: {
    placeId?: string | null;
    status?: string;
    evidence: Record<string, unknown>;
    visitId?: string;
    day?: string;
  }) => {
    n += 1;
    const day = opts.day ?? `2026-0${(n % 8) + 1}-1${n % 9}`;
    const start = new Date(`${day}T10:00:00Z`);
    const end = new Date(`${day}T10:20:00Z`);
    return prisma.dawarichStay.create({
      data: {
        userId,
        fingerprint: `smartpending-${n}`,
        provider: "travtrack",
        status: opts.status ?? "pending",
        sourceStartAt: start,
        sourceEndAt: end,
        sourceLat: 10 + n,
        sourceLon: 20 + n,
        startAt: start,
        endAt: end,
        lat: 10 + n,
        lon: 20 + n,
        zone: "UTC",
        pointCount: 5,
        placeId: opts.placeId ?? null,
        visitId: opts.visitId ?? null,
        evidence: opts.evidence as object,
      },
    });
  };
  const match = (listId: string, auto = false) => ({
    visit: { distanceM: 30, brandMatches: [{ listId, strength: "id", auto, ruleId: "x" }] },
  });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: USERS } } });
    const u = await prisma.user.create({
      data: { username: USERS[0], passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    cookie = `auth_token=${generateToken(u.id)}`;
    const o = await prisma.user.create({
      data: { username: USERS[1], passwordHash: await hashPassword("password123") },
    });
    otherCookie = `auth_token=${generateToken(o.id)}`;
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: USERS } } });
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await prisma.dawarichStay.deleteMany({ where: { userId } });
    await prisma.placeList.deleteMany({ where: { userId } });
    await prisma.place.deleteMany({ where: { userId } });
    await prisma.suggestionPlugin.deleteMany({ where: { userId } });
    listA = (await prisma.placeList.create({ data: { userId, name: "Maccis" } })).id;
    listB = (await prisma.placeList.create({ data: { userId, name: "Burger" } })).id;
    for (const listId of [listA, listB])
      await prisma.placeListBrandRule.create({ data: { userId, listId, ...RULE } });
    placeId = (await prisma.place.create({ data: { userId, name: "McD Hbf", lat: 50, lon: 8 } }))
      .id;
  });

  it("the pending section lists only this list's suggestions at known places", async () => {
    const mine = await stay({ placeId, evidence: match(listA) });
    await stay({ placeId, evidence: match(listB) });
    await stay({ placeId: null, evidence: match(listA) }); // a new outlet: its own section
    await stay({ placeId, status: "accepted", evidence: match(listA) }); // answered
    const res = await request(app).get(`${SMART}/${listA}/pending`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.map((r: { id: string }) => r.id)).toEqual([mine.id]);
    expect(res.body.data[0].lists).toEqual([{ listId: listA, listName: "Maccis" }]);
    expect(res.body.meta).toEqual({ total: 1 });
  });

  it("an accepted suggestion leaves the pending section", async () => {
    const row = await stay({ placeId, evidence: match(listA) });
    await prisma.dawarichStay.update({ where: { id: row.id }, data: { status: "accepted" } });
    const res = await request(app).get(`${SMART}/${listA}/pending`).set("Cookie", cookie);
    expect(res.body.data).toEqual([]);
  });

  it("another account cannot read a list's pending confirmations", async () => {
    const res = await request(app).get(`${SMART}/${listA}/pending`).set("Cookie", otherCookie);
    expect(res.status).toBe(404);
  });

  it("counts pending matches per list for the overview badge, outlets included", async () => {
    await stay({ placeId, evidence: match(listA) });
    await stay({ placeId: null, evidence: match(listA) });
    await stay({ placeId, evidence: match(listB) });
    await stay({ placeId, status: "rejected", evidence: match(listB) });
    const res = await request(app).get(`${SMART}/pending-counts`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ [listA]: 2, [listB]: 1 });
  });

  it("the inbox names each suggestion's sources and filters by one", async () => {
    const plugin = await prisma.suggestionPlugin.create({
      data: { userId, name: "Projekte", url: "https://plugin.example", secretEncrypted: "x" },
    });
    const listRow = await stay({ placeId, evidence: match(listA) });
    const pluginRow = await stay({
      evidence: { plugins: [{ pluginId: plugin.id, pluginName: "old name", confidence: 0.9 }] },
    });
    const calRow = await stay({ evidence: { calendar: { uidHash: "u" } } });
    const plain = await stay({ evidence: {} });

    const all = await request(app).get("/api/v1/dawarich-stays").set("Cookie", cookie);
    expect(all.status).toBe(200);
    const byId = new Map(
      all.body.data.map((r: { id: string; source: unknown }) => [r.id, r.source])
    );
    expect(byId.get(listRow.id)).toEqual({ kind: "smartList", id: listA, name: "Maccis" });
    expect(byId.get(pluginRow.id)).toEqual({ kind: "plugin", id: plugin.id, name: "Projekte" });
    expect(byId.get(calRow.id)).toEqual({ kind: "calendar", id: null, name: null });
    expect(byId.get(plain.id)).toEqual({ kind: "travtrack", id: null, name: null });

    const ids = async (source: string) =>
      (
        await request(app)
          .get(`/api/v1/dawarich-stays?source=${encodeURIComponent(source)}`)
          .set("Cookie", cookie)
      ).body.data.map((r: { id: string }) => r.id);
    expect(await ids(`smartList:${listA}`)).toEqual([listRow.id]);
    expect(await ids(`smartList:${listB}`)).toEqual([]);
    expect(await ids("plugin")).toEqual([pluginRow.id]);
    expect(await ids("calendar")).toEqual([calRow.id]);
    // Every TravTrack finding has TravTrack among its sources.
    expect((await ids("travtrack")).sort()).toEqual(
      [listRow.id, pluginRow.id, calRow.id, plain.id].sort()
    );
    // A malformed plugin entry in old evidence is skipped, never a failed inbox.
    await stay({ evidence: { plugins: [null, { pluginId: 7 }] } });
    expect((await request(app).get("/api/v1/dawarich-stays").set("Cookie", cookie)).status).toBe(
      200
    );
    const bad = await request(app).get("/api/v1/dawarich-stays?source=nope").set("Cookie", cookie);
    expect(bad.status).toBe(400);
  });

  describe("bulk undo of automatic visits", () => {
    const visit = (createdBy: string | null, extra: Record<string, unknown> = {}) =>
      prisma.placeVisit.create({
        data: { placeId, userId, visitedAt: new Date("2026-01-01T10:00:00Z"), createdBy, ...extra },
      });
    const undo = (visitIds: string[]) =>
      request(app).post(`${SMART}/auto-visits/undo`).set("Cookie", cookie).send({ visitIds });

    it("removes automatic visits, keeps the owner's and the ones the owner added to", async () => {
      const imported = await visit("import");
      const own = await visit(null);
      const noted = await visit("import", { notes: "lecker" });
      const res = await undo([imported.id, own.id, noted.id]);
      expect(res.status).toBe(200);
      expect(res.body.data.results).toEqual([
        { visitId: imported.id, outcome: "removed" },
        { visitId: own.id, outcome: "kept", reason: "notAutomatic" },
        { visitId: noted.id, outcome: "kept", reason: "ownerAdded" },
      ]);
      const left = await prisma.placeVisit.findMany({ where: { placeId }, select: { id: true } });
      expect(left.map((v) => v.id).sort()).toEqual([own.id, noted.id].sort());
    });

    it("the last imported visit undone, the place is no longer visited; with another left it stays", async () => {
      await prisma.place.update({ where: { id: placeId }, data: { visited: true } });
      const first = await visit("import");
      const second = await visit(null);
      await undo([first.id]);
      expect((await prisma.place.findUnique({ where: { id: placeId } }))?.visited).toBe(true);
      await prisma.placeVisit.update({ where: { id: second.id }, data: { createdBy: "import" } });
      await undo([second.id]);
      expect((await prisma.place.findUnique({ where: { id: placeId } }))?.visited).toBe(false);
    });

    it("keeps an automatic visit the owner edited since (date, trip, place)", async () => {
      const v = await visit("import");
      await prisma.placeVisit.update({
        where: { id: v.id },
        data: { updatedAt: new Date(v.createdAt.getTime() + 60_000) },
      });
      const res = await undo([v.id]);
      expect(res.body.data.results).toEqual([
        { visitId: v.id, outcome: "kept", reason: "ownerAdded" },
      ]);
    });

    it("takes a smart list's automatic visit back through the list's undo", async () => {
      const v = await visit("brandRule");
      const row = await stay({
        placeId,
        status: "accepted",
        visitId: v.id,
        evidence: match(listA, true),
      });
      const res = await undo([v.id]);
      expect(res.body.data.results).toEqual([{ visitId: v.id, outcome: "removed" }]);
      const after = await prisma.dawarichStay.findUnique({ where: { id: row.id } });
      expect(after?.status).toBe("rejected");
    });

    it("never touches another account's visit", async () => {
      const v = await visit("import");
      const res = await request(app)
        .post(`${SMART}/auto-visits/undo`)
        .set("Cookie", otherCookie)
        .send({ visitIds: [v.id] });
      expect(res.body.data.results).toEqual([
        { visitId: v.id, outcome: "kept", reason: "notFound" },
      ]);
      expect(await prisma.placeVisit.findUnique({ where: { id: v.id } })).not.toBeNull();
    });
  });
});
