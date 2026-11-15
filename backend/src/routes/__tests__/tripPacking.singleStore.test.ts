import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";

/**
 * One packing list per trip (forgejo#398): the legacy `{id, label, done}`
 * routes keep working for installed Companion apps and never wipe what they do
 * not know; `?shape=rich` carries the whole item.
 */
describe("single packing store - trip routes", () => {
  let cookie: string[];
  let ownerId: string;
  let tripId: string;

  const clean = async (): Promise<void> => {
    await prisma.packingMutation.deleteMany();
    await prisma.tripPackingList.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.userSettings.deleteMany();
    await prisma.user.deleteMany();
  };

  const rich = (id: string, label: string, extra: object = {}) => ({
    id,
    label,
    done: false,
    category: "",
    quantity: 1,
    scope: "personal",
    note: "",
    manual: true,
    ownerPrincipal: null,
    assigneePrincipal: null,
    ...extra,
  });
  const legacy = (id: string, label: string, done = false) => ({ id, label, done });
  const url = (shape?: "rich") => `/api/v1/trips/${tripId}/packing${shape ? "?shape=rich" : ""}`;
  const put = (body: object, shape?: "rich", as = cookie) =>
    request(app).put(url(shape)).set("Cookie", as).send(body);
  const get = (shape?: "rich") => request(app).get(url(shape)).set("Cookie", cookie);

  /** Another member's personal item, put straight into the stored list. */
  const hiddenItem = rich("secret", "Her insulin", {
    ownerPrincipal: { server: "local", subjectId: "someone-else" },
  });

  beforeEach(async () => {
    await clean();
    const owner = await prisma.user.create({
      data: { username: "single-store-owner", passwordHash: "unused-hash" },
    });
    ownerId = owner.id;
    cookie = [`auth_token=${generateToken(owner.id)}`];
    tripId = (await prisma.trip.create({ data: { userId: owner.id, name: "Lofoten" } })).id;
  });
  afterAll(async () => {
    await clean();
    await prisma.$disconnect();
  });

  it("a legacy PUT never wipes the rich fields of an item it renames or ticks", async () => {
    await put(
      {
        items: [
          rich("a", "Tent", {
            category: "camping",
            quantity: 2,
            scope: "shared",
            note: "the green one",
            manual: false,
            assigneePrincipal: { server: "local", subjectId: ownerId },
          }),
        ],
        baseRev: 0,
        mutationId: "m1",
      },
      "rich"
    ).expect(200);

    await put({
      items: [legacy("a", "Tent (3 person)", true)],
      baseRev: 1,
      mutationId: "m2",
    }).expect(200);

    const res = await get("rich").expect(200);
    expect(res.body.items).toEqual([
      rich("a", "Tent (3 person)", {
        done: true,
        category: "camping",
        quantity: 2,
        scope: "shared",
        note: "the green one",
        manual: false,
        assigneePrincipal: { server: "local", subjectId: ownerId },
      }),
    ]);
  });

  it("answers the legacy shape without ?shape=rich, and an old row with defaults", async () => {
    await prisma.tripPackingList.create({
      data: { userId: ownerId, tripId, items: [legacy("o", "Pass")], rev: 3 },
    });
    expect((await get().expect(200)).body).toMatchObject({ items: [legacy("o", "Pass")], rev: 3 });
    expect((await get("rich").expect(200)).body.items).toEqual([rich("o", "Pass")]);
  });

  it("a legacy PUT neither lists nor deletes an item its caller cannot see", async () => {
    await prisma.tripPackingList.create({
      data: { userId: ownerId, tripId, items: [legacy("a", "Pass"), hiddenItem], rev: 1 },
    });
    // The hidden item is not in the projection ...
    expect((await get().expect(200)).body.items).toEqual([legacy("a", "Pass")]);
    // ... and a write that leaves "a" out deletes "a" only.
    await put({ items: [], baseRev: 1, mutationId: "m1" }).expect(200);
    const stored = await prisma.tripPackingList.findUniqueOrThrow({ where: { tripId } });
    expect((stored.items as { id: string }[]).map((i) => i.id)).toEqual(["secret"]);
  });

  it("refuses a body id that collides with an item the caller cannot see (PACKING_ID_CONFLICT)", async () => {
    await prisma.tripPackingList.create({
      data: { userId: ownerId, tripId, items: [hiddenItem], rev: 1 },
    });
    const res = await put({
      items: [legacy("secret", "Grab it")],
      baseRev: 1,
      mutationId: "m1",
    }).expect(409);
    expect(res.body.code).toBe("PACKING_ID_CONFLICT");
    const stored = await prisma.tripPackingList.findUniqueOrThrow({ where: { tripId } });
    expect(stored.rev).toBe(1);
    expect((stored.items as { label: string }[])[0].label).toBe("Her insulin");
  });

  it("answers interleaved retries from two devices from the receipts, not as stale", async () => {
    // Device A writes (rev 0 -> 1), device B writes on top (1 -> 2) ...
    await put({ items: [legacy("a", "Pass")], baseRev: 0, mutationId: "device-a-1" }).expect(200);
    await put({
      items: [legacy("a", "Pass"), legacy("b", "Hat")],
      baseRev: 1,
      mutationId: "device-b-1",
    }).expect(200);
    // ... then A resends its first write, whose answer it lost: the list has
    // moved on, but A's mutation was applied and is answered as applied.
    const resendA = await put({
      items: [legacy("a", "Pass")],
      baseRev: 0,
      mutationId: "device-a-1",
    }).expect(200);
    expect(resendA.body).toMatchObject({ replayed: true, rev: 1 });
    const resendB = await put({
      items: [legacy("a", "Pass"), legacy("b", "Hat")],
      baseRev: 1,
      mutationId: "device-b-1",
    }).expect(200);
    expect(resendB.body).toMatchObject({ replayed: true, rev: 2 });
    // Nothing was applied twice.
    expect((await prisma.tripPackingList.findUniqueOrThrow({ where: { tripId } })).rev).toBe(2);
    // A new write on a stale rev is still refused.
    const stale = await put({ items: [], baseRev: 1, mutationId: "device-a-2" }).expect(409);
    expect(stale.body).toMatchObject({ code: "PACKING_LIST_STALE", rev: 2 });
  });

  it("a rich write replaces the caller's own view and keeps hidden items", async () => {
    await prisma.tripPackingList.create({
      data: { userId: ownerId, tripId, items: [legacy("a", "Pass"), hiddenItem], rev: 1 },
    });
    await put(
      {
        items: [rich("a", "Pass", { scope: "shared", category: "docs", quantity: 2 })],
        baseRev: 1,
        mutationId: "m1",
      },
      "rich"
    ).expect(200);
    const stored = (await prisma.tripPackingList.findUniqueOrThrow({ where: { tripId } }))
      .items as { id: string; scope: string; category: string }[];
    expect(stored.map((i) => [i.id, i.scope, i.category])).toEqual([
      ["a", "shared", "docs"],
      ["secret", "personal", ""],
    ]);
  });

  it("refuses to assign a shared item to someone who is not on the trip", async () => {
    const res = await put(
      {
        items: [
          rich("a", "Tent", {
            scope: "shared",
            assigneePrincipal: { server: "local", subjectId: "stranger" },
          }),
        ],
        baseRev: 0,
        mutationId: "m1",
      },
      "rich"
    ).expect(400);
    expect(res.body.code).toBe("PACKING_ASSIGNEE_UNKNOWN");
  });

  it("keeps an assignee who left the plan on an unchanged item, so the card can still edit the list", async () => {
    const gone = { server: "local", subjectId: "left-the-plan" };
    await prisma.tripPackingList.create({
      data: {
        tripId,
        userId: ownerId,
        rev: 1,
        items: [rich("a", "Tent", { scope: "shared", assigneePrincipal: gone })],
      },
    });
    const res = await put(
      {
        items: [rich("a", "Tent", { scope: "shared", assigneePrincipal: gone, done: true })],
        baseRev: 1,
        mutationId: "m-edit",
      },
      "rich"
    ).expect(200);
    expect(res.body.items[0].done).toBe(true);
    // a NEW assignment to the same person is still refused
    await put(
      {
        items: [
          rich("a", "Tent", { scope: "shared", assigneePrincipal: gone, done: true }),
          rich("b", "Stove", { scope: "shared", assigneePrincipal: gone }),
        ],
        baseRev: 2,
        mutationId: "m-new",
      },
      "rich"
    ).expect(400);
  });

  it("announces packingSingleStore in /version capabilities", async () => {
    const res = await request(app).get("/api/v1/version").expect(200);
    expect(res.body.capabilities).toEqual({ packingSingleStore: true });
  });
});
