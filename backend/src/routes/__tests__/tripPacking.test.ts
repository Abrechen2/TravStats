import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";

/**
 * A trip's packing list on the server (Companion audit 2026-10-23): the whole
 * list is written at once, a write names the rev it started from, a stale one
 * is refused with the stored rev, and a resend of an applied write is answered
 * as applied.
 */
describe("trip packing list", () => {
  let cookie: string[];
  let otherCookie: string[];
  let tripId: string;

  const clean = async (): Promise<void> => {
    await prisma.tripPackingList.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.userSettings.deleteMany();
    await prisma.user.deleteMany();
  };

  const userCookie = async (username: string): Promise<{ cookie: string[]; id: string }> => {
    const user = await prisma.user.create({ data: { username, passwordHash: "unused-hash" } });
    return { cookie: [`auth_token=${generateToken(user.id)}`], id: user.id };
  };

  const item = (id: string, label: string, done = false) => ({ id, label, done });

  beforeEach(async () => {
    await clean();
    const owner = await userCookie("packing-owner");
    cookie = owner.cookie;
    otherCookie = (await userCookie("packing-other")).cookie;
    tripId = (await prisma.trip.create({ data: { userId: owner.id, name: "Bergen" } })).id;
  });

  afterAll(async () => {
    await clean();
    await prisma.$disconnect();
  });

  const put = (body: object, as = cookie) =>
    request(app).put(`/api/v1/trips/${tripId}/packing`).set("Cookie", as).send(body);

  it("is empty with rev 0 until written", async () => {
    const res = await request(app)
      .get(`/api/v1/trips/${tripId}/packing`)
      .set("Cookie", cookie)
      .expect(200);
    expect(res.body).toEqual({ items: [], rev: 0, updatedAt: null });
  });

  it("stores the whole list and raises the rev on each write", async () => {
    const first = await put({ items: [item("a", "Pass")], baseRev: 0, mutationId: "m1" }).expect(
      200
    );
    expect(first.body).toMatchObject({ items: [item("a", "Pass")], rev: 1 });

    const second = await put({
      items: [item("a", "Pass", true), item("b", "Adapter")],
      baseRev: 1,
      mutationId: "m2",
    }).expect(200);
    expect(second.body.rev).toBe(2);

    const read = await request(app)
      .get(`/api/v1/trips/${tripId}/packing`)
      .set("Cookie", cookie)
      .expect(200);
    expect(read.body.items).toEqual([item("a", "Pass", true), item("b", "Adapter")]);
  });

  it("refuses a write from an older rev and names the stored one", async () => {
    await put({ items: [item("a", "Pass")], baseRev: 0, mutationId: "m1" }).expect(200);
    await put({ items: [item("b", "Adapter")], baseRev: 1, mutationId: "m2" }).expect(200);

    const stale = await put({ items: [item("c", "Socken")], baseRev: 1, mutationId: "m3" }).expect(
      409
    );
    expect(stale.body.code).toBe("PACKING_LIST_STALE");
    expect(stale.body.rev).toBe(2);

    const fresh = await put({ items: [item("c", "Socken")], baseRev: 0, mutationId: "m4" }).expect(
      409
    );
    expect(fresh.body.code).toBe("PACKING_LIST_STALE");
  });

  it("answers a resend of an applied write as applied, not as stale", async () => {
    await put({ items: [item("a", "Pass")], baseRev: 0, mutationId: "m1" }).expect(200);
    const again = await put({ items: [item("a", "Pass")], baseRev: 0, mutationId: "m1" }).expect(
      200
    );
    expect(again.body).toMatchObject({ rev: 1, replayed: true });

    await put({ items: [item("b", "Adapter")], baseRev: 1, mutationId: "m2" }).expect(200);
    const resend = await put({
      items: [item("b", "Adapter")],
      baseRev: 1,
      mutationId: "m2",
    }).expect(200);
    expect(resend.body).toMatchObject({ rev: 2, replayed: true });
  });

  it("refuses repeated item ids, blank labels and too many items", async () => {
    const twice = await put({
      items: [item("a", "Pass"), item("a", "Adapter")],
      baseRev: 0,
      mutationId: "m1",
    }).expect(400);
    expect(twice.body.code).toBe("PACKING_LIST_INVALID");
    await put({ items: [item("a", "  ")], baseRev: 0, mutationId: "m1" }).expect(400);
    const many = Array.from({ length: 201 }, (_, i) => item(`i${i}`, `Item ${i}`));
    await put({ items: many, baseRev: 0, mutationId: "m1" }).expect(400);
  });

  it("answers another user's trip like a missing one", async () => {
    await request(app)
      .get(`/api/v1/trips/${tripId}/packing`)
      .set("Cookie", otherCookie)
      .expect(404);
    await put({ items: [item("a", "Pass")], baseRev: 0, mutationId: "m1" }, otherCookie).expect(
      404
    );
    expect(await prisma.tripPackingList.count()).toBe(0);
  });

  it("goes with the trip", async () => {
    await put({ items: [item("a", "Pass")], baseRev: 0, mutationId: "m1" }).expect(200);
    await prisma.trip.delete({ where: { id: tripId } });
    expect(await prisma.tripPackingList.count()).toBe(0);
  });

  /**
   * Codex review of S1, finding 4: a trip merge drops nothing, so a merged
   * list can be longer than any one request was allowed to be. It must stay
   * editable as long as an edit does not grow it.
   */
  it("keeps a merged list over the request limit editable while it does not grow", async () => {
    const many = Array.from({ length: 2200 }, (_, i) => item(`i${i}`, `Item ${i}`));
    await prisma.tripPackingList.create({
      data: {
        userId: (await prisma.trip.findUniqueOrThrow({ where: { id: tripId } })).userId,
        tripId,
        items: many,
        rev: 1,
      },
    });

    const ticked = many.map((it, i) => (i === 0 ? { ...it, done: true } : it));
    const edit = await put({ items: ticked, baseRev: 1, mutationId: "tick" }).expect(200);
    expect(edit.body.rev).toBe(2);
    expect(edit.body.items).toHaveLength(2200);

    const shorter = await put({ items: ticked.slice(1), baseRev: 2, mutationId: "drop" }).expect(
      200
    );
    expect(shorter.body.items).toHaveLength(2199);

    const grown = await put({
      items: [...ticked.slice(1), item("new", "Neu")],
      baseRev: 3,
      mutationId: "grow",
    }).expect(400);
    expect(grown.body.code).toBe("PACKING_LIST_INVALID");
  });

  /**
   * Codex review of S1, finding 5: two identical first writes (baseRev 0, one
   * mutationId) race; the one that loses the insert must answer the winner's
   * row as its own applied write, not as stale. The loser's read before the
   * insert is made to miss the winner, which is the interleaving of the race.
   */
  it("answers the loser of two identical first writes as replayed, not stale", async () => {
    const body = { items: [item("a", "Pass")], baseRev: 0, mutationId: "first" };
    await put(body).expect(200);

    const realFindUnique = prisma.tripPackingList.findUnique.bind(prisma.tripPackingList);
    const spy = jest
      .spyOn(prisma.tripPackingList, "findUnique")
      .mockImplementationOnce((async () => null) as unknown as typeof realFindUnique);
    try {
      const resend = await put(body).expect(200);
      expect(resend.body).toMatchObject({ items: [item("a", "Pass")], rev: 1, replayed: true });
    } finally {
      spy.mockRestore();
    }

    // A different first write losing the same race is still stale.
    const spy2 = jest
      .spyOn(prisma.tripPackingList, "findUnique")
      .mockImplementationOnce((async () => null) as unknown as typeof realFindUnique);
    try {
      const other = await put({ ...body, mutationId: "other" }).expect(409);
      expect(other.body.code).toBe("PACKING_LIST_STALE");
    } finally {
      spy2.mockRestore();
    }
  });
});
