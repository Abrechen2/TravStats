import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { prisma } from "../../../db";
import { JWT_SECRET } from "../../../utils/jwtSecret";
import travplanRouter from "../../../routes/travplan";
import tripPackingRouter from "../../../routes/trips/tripPacking";
import { errorHandler } from "../../../middleware/errorHandler";
import { readPlan, writePlan } from "../store";
import { ensurePackingMigrated } from "../packingMigration";
import { sameServerAccount } from "../../packing/items";

jest.mock("../availability", () => ({
  travPlanOffered: async () => true,
  assertTravPlanOffered: async () => undefined,
  travPlanUserEnabled: async () => true,
  assertTravPlanForUser: async () => undefined,
}));

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use("/api/v1", travplanRouter);
app.use("/api/v1", tripPackingRouter);
app.use(errorHandler);

let owner: string, editor: string;
let editorName: string;
const cookie = (id: string) => "auth_token=" + jwt.sign({ userId: id, epoch: 0 }, JWT_SECRET);
const call = (method: "get" | "post" | "put", url: string, who: string, body?: object) => {
  const r = request(app)
    [method]("/api/v1" + url)
    .set("Cookie", cookie(who));
  return body ? r.send(body) : r;
};
async function consent(a: string, b: string) {
  await prisma.shareConsent.upsert({
    where: { requesterId_targetId: { requesterId: a, targetId: b } },
    create: { requesterId: a, targetId: b, status: "accepted", decidedAt: new Date() },
    update: { status: "accepted" },
  });
}
async function newPlan() {
  const r = await call("post", "/travplan/plans", owner, {
    name: "Packing trip",
    clientRef: randomUUID(),
    settings: { destination: "Madeira", startDay: "2027-03-10", endDay: "2027-03-17" },
  });
  expect(r.status).toBe(201);
  return r.body as { id: string; tripId: string; revision: number };
}
const write = (tripId: string, revision: number, operation: object, who: string) =>
  call("post", `/trips/${tripId}/plan/mutations`, who, {
    clientRef: randomUUID(),
    baseRevision: revision,
    operation,
  });
async function join(tripId: string) {
  await consent(owner, editor);
  await consent(editor, owner);
  const invited = await call("post", `/trips/${tripId}/plan/members`, owner, {
    username: editorName,
  });
  expect(invited.status).toBe(201);
  await call("post", `/travplan/invitations/${invited.body.id}/accept`, editor);
}
const packing = (label: string, scope: "personal" | "shared", extra: object = {}) => ({
  type: "upsert",
  collection: "packing",
  value: {
    id: randomUUID(),
    label,
    category: "docs",
    quantity: 2,
    packed: false,
    scope,
    note: "note",
    manual: true,
    ...extra,
  },
});
const labels = (items: { label: string }[]) => items.map((i) => i.label).sort();
const planLabels = async (tripId: string, who: string) =>
  labels((await call("get", `/trips/${tripId}/plan`, who)).body.state.packing);
const storedItems = async (tripId: string) =>
  (await prisma.tripPackingList.findUniqueOrThrow({ where: { tripId } })).items as {
    id: string;
    label: string;
    done: boolean;
    scope: string;
    category: string;
    quantity: number;
    ownerPrincipal: unknown;
    assigneePrincipal: unknown;
  }[];

beforeAll(async () => {
  const users = await Promise.all(
    [0, 1].map((n) =>
      prisma.user.create({
        data: { username: "packing-store-" + n + "-" + randomUUID(), passwordHash: "x" },
      })
    )
  );
  [owner, editor] = users.map((u) => u.id);
  editorName = users[1].username;
  await prisma.travelPlanConfig.upsert({
    where: { id: "default" },
    create: { enabled: true },
    update: { enabled: true },
  });
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("TravPlan packing is the trip's one list", () => {
  it("a plan upsert lands in the trip's list with its rich fields, and the legacy list shows it", async () => {
    const plan = await newPlan();
    const op = packing("Passport", "personal");
    const done = await write(plan.tripId, plan.revision, op, owner);
    expect(done.status).toBe(200);
    expect(done.body.state.packing).toEqual([
      expect.objectContaining({ label: "Passport", category: "docs", quantity: 2, note: "note" }),
    ]);
    expect(await storedItems(plan.tripId)).toEqual([
      expect.objectContaining({
        label: "Passport",
        category: "docs",
        quantity: 2,
        ownerPrincipal: null,
      }),
    ]);
    // The plan JSON itself no longer takes the item.
    const row = await prisma.travelPlan.findUniqueOrThrow({ where: { id: plan.id } });
    expect((row.state as { packing: unknown[] }).packing).toEqual([]);
    // The Companion's legacy read sees it too.
    const legacy = await call("get", `/trips/${plan.tripId}/packing`, owner);
    expect(legacy.body.items).toEqual([
      { id: (op.value as { id: string }).id, label: "Passport", done: false },
    ]);
  });

  it("a legacy PUT of the trip owner leaves a co-planner's personal item and a plan item's fields alone", async () => {
    const plan = await newPlan();
    await join(plan.tripId);
    const mine = packing("Owner item", "personal");
    const theirs = packing("Editor insulin", "personal");
    const shared = packing("Tent", "shared");
    let rev = (await write(plan.tripId, plan.revision, mine, owner)).body.revision;
    rev = (await write(plan.tripId, rev, theirs, editor)).body.revision;
    await write(plan.tripId, rev, shared, owner);

    const read = await call("get", `/trips/${plan.tripId}/packing`, owner);
    expect(labels(read.body.items)).toEqual(["Owner item", "Tent"]);
    // The owner's app writes its (legacy) view back, ticking the tent and dropping its own item.
    const tent = read.body.items.find((i: { label: string }) => i.label === "Tent");
    const res = await call("put", `/trips/${plan.tripId}/packing`, owner, {
      items: [{ ...tent, done: true }],
      baseRev: read.body.rev,
      mutationId: "legacy-1",
    });
    expect(res.status).toBe(200);
    const items = await storedItems(plan.tripId);
    expect(labels(items)).toEqual(["Editor insulin", "Tent"]);
    expect(items.find((i) => i.label === "Tent")).toMatchObject({
      done: true,
      category: "docs",
      quantity: 2,
    });
    // The editor still sees their own item and the tent, never the owner's.
    expect(await planLabels(plan.tripId, editor)).toEqual(["Editor insulin", "Tent"]);
    expect(await planLabels(plan.tripId, owner)).toEqual(["Tent"]);
  });

  it("a federated member sees only the shared items and their own", async () => {
    const plan = await newPlan();
    const connection = await prisma.remoteShareAccount.create({
      data: {
        userId: owner,
        origin: "https://peer.example",
        channel: "chan-" + randomUUID(),
        localChannel: "local-" + randomUUID(),
        username: "anna",
        displayName: "Anna",
        state: "active",
        sharePlans: true,
        remoteSwitches: {
          plans: true,
          stats: "off",
          achievements: false,
          leaderboard: false,
          tripOffers: false,
        },
      },
    });
    const member = await prisma.travelPlanMember.create({
      data: {
        planId: plan.id,
        kind: "remote",
        connectionId: connection.id,
        remoteOrigin: connection.origin,
        displayName: "Anna",
        status: "active",
      },
    });
    const remote = { remote: { memberId: member.id, planId: plan.id } };
    let rev = (
      await write(plan.tripId, plan.revision, packing("Owner passport", "personal"), owner)
    ).body.revision;
    rev = (await write(plan.tripId, rev, packing("Tent", "shared"), owner)).body.revision;
    const wrote = await writePlan(remote, plan.tripId, {
      clientRef: randomUUID(),
      baseRevision: rev,
      operation: packing("Anna's pills", "personal") as never,
    });
    expect(labels(wrote.state.packing)).toEqual(["Anna's pills", "Tent"]);
    expect(labels((await readPlan(remote, plan.tripId)).state.packing)).toEqual([
      "Anna's pills",
      "Tent",
    ]);
    // Stored under the connection's principal, never as the owner's.
    const stored = (await storedItems(plan.tripId)).find((i) => i.label === "Anna's pills");
    expect(stored?.ownerPrincipal).toEqual({
      server: "https://peer.example",
      subjectId: connection.channel,
    });
    // The trip owner's own projection hides it, and the legacy route too.
    expect(await planLabels(plan.tripId, owner)).toEqual(["Owner passport", "Tent"]);
    expect(labels((await call("get", `/trips/${plan.tripId}/packing`, owner)).body.items)).toEqual([
      "Owner passport",
      "Tent",
    ]);
  });

  it("undoing a packing change restores the list, and is refused (409) once the list moved on", async () => {
    const plan = await newPlan();
    const added = await write(plan.tripId, plan.revision, packing("Hat", "personal"), owner);
    expect(added.status).toBe(200);
    // Undo while the list is as the change left it.
    const undone = await write(
      plan.tripId,
      added.body.revision,
      { type: "undo", mutationId: added.body.lastMutationId },
      owner
    );
    expect(undone.status).toBe(200);
    expect(undone.body.state.packing).toEqual([]);
    expect(await storedItems(plan.tripId)).toEqual([]);

    // A second change, then the Companion writes the list before the undo.
    const again = await write(plan.tripId, undone.body.revision, packing("Cap", "personal"), owner);
    const list = await call("get", `/trips/${plan.tripId}/packing`, owner);
    await call("put", `/trips/${plan.tripId}/packing`, owner, {
      items: [...list.body.items, { id: "x", label: "Phone charger", done: false }],
      baseRev: list.body.rev,
      mutationId: "companion-1",
    }).expect(200);
    const refused = await write(
      plan.tripId,
      again.body.revision,
      { type: "undo", mutationId: again.body.lastMutationId },
      owner
    );
    expect([refused.status, refused.body.code]).toEqual([409, "PLAN_UNDO_STALE"]);
    expect(labels(await storedItems(plan.tripId))).toEqual(["Cap", "Phone charger"]);
  });
});

describe("edge cases of the shared list", () => {
  it("refuses a plan packing change drawn from a list the Companion has since written (basePackingRev)", async () => {
    const plan = await newPlan();
    const seen = await call("get", `/trips/${plan.tripId}/plan`, owner);
    await call("put", `/trips/${plan.tripId}/packing`, owner, {
      items: [{ id: "c1", label: "Charger", done: false }],
      baseRev: 0,
      mutationId: "c-1",
    }).expect(200);
    const res = await call("post", `/trips/${plan.tripId}/plan/mutations`, owner, {
      clientRef: randomUUID(),
      baseRevision: seen.body.revision,
      basePackingRev: seen.body.packingRev,
      operation: packing("Hat", "personal"),
    });
    expect([res.status, res.body.code]).toEqual([409, "PLAN_REVISION_CONFLICT"]);
    expect(labels(await storedItems(plan.tripId))).toEqual(["Charger"]);
  });

  it("removes a Companion-named (non-uuid) item and reads a list longer than the plan's own cap", async () => {
    const plan = await newPlan();
    const items = Array.from({ length: 205 }, (_, n) => ({
      id: `c${n}`,
      label: `Item ${n}`,
      done: false,
    }));
    // A merged trip may hold more than 200 (the merge drops nothing).
    await prisma.tripPackingList.create({
      data: { userId: owner, tripId: plan.tripId, items, rev: 1 },
    });
    const read = await call("get", `/trips/${plan.tripId}/plan`, owner);
    expect(read.status).toBe(200);
    expect(read.body.state.packing).toHaveLength(205);
    const removed = await write(
      plan.tripId,
      read.body.revision,
      { type: "remove", collection: "packing", id: "c3" },
      owner
    );
    expect(removed.status).toBe(200);
    expect(removed.body.state.packing).toHaveLength(204);
  });
});

describe("folding state.packing into the trip's list", () => {
  const legacyEntry = (id: string, label: string, extra: object = {}) => ({
    id,
    label,
    category: "docs",
    quantity: 3,
    packed: false,
    scope: "personal",
    note: "from the plan",
    manual: true,
    ownerMemberId: null,
    ...extra,
  });
  async function planWithLegacy(entries: object[], list?: object[]) {
    const plan = await newPlan();
    const row = await prisma.travelPlan.findUniqueOrThrow({ where: { id: plan.id } });
    await prisma.travelPlan.update({
      where: { id: plan.id },
      data: {
        state: { ...(row.state as object), packing: entries },
        packingMigratedAt: null,
      },
    });
    if (list)
      await prisma.tripPackingList.create({
        data: { userId: owner, tripId: plan.tripId, items: list, rev: 4 },
      });
    return plan;
  }

  it("is idempotent, merges the Companion's copy and keeps ambiguous duplicates and colliding ids", async () => {
    const plan = await planWithLegacy(
      [
        legacyEntry("x", "Pass", { packed: true }), // the copy of A's "x"
        legacyEntry("y", "Tent", { scope: "shared" }),
        legacyEntry("z", "Pass"), // same label, other id: kept
        legacyEntry("a", "Mat"), // id used by A's "Hat": remapped
      ],
      [
        { id: "x", label: "Pass", done: false },
        { id: "a", label: "Hat", done: true },
      ]
    );
    expect(await ensurePackingMigrated(plan.id)).toBe(true);
    const first = await storedItems(plan.tripId);
    expect(first.map((i) => i.label)).toEqual(["Pass", "Hat", "Tent", "Pass", "Mat"]);
    expect(first[0]).toMatchObject({ id: "x", done: true, category: "docs", quantity: 3 });
    expect(first[1]).toMatchObject({ id: "a", label: "Hat", done: true });
    expect(first[4].id).not.toBe("a");
    expect(new Set(first.map((i) => i.id)).size).toBe(5);
    const rev = (await prisma.tripPackingList.findUniqueOrThrow({ where: { tripId: plan.tripId } }))
      .rev;

    expect(await ensurePackingMigrated(plan.id)).toBe(false);
    expect(await storedItems(plan.tripId)).toEqual(first);
    expect(
      (await prisma.tripPackingList.findUniqueOrThrow({ where: { tripId: plan.tripId } })).rev
    ).toBe(rev);
  });

  it("does not fold a co-planner's item into the owner's item of the same id and label", async () => {
    const plan = await newPlan();
    await join(plan.tripId);
    const member = await prisma.travelPlanMember.findFirstOrThrow({
      where: { planId: plan.id, userId: editor },
    });
    const row = await prisma.travelPlan.findUniqueOrThrow({ where: { id: plan.id } });
    await prisma.tripPackingList.create({
      data: {
        userId: owner,
        tripId: plan.tripId,
        items: [{ id: "d", label: "Pills", done: false }],
        rev: 1,
      },
    });
    await prisma.travelPlan.update({
      where: { id: plan.id },
      data: {
        state: {
          ...(row.state as object),
          packing: [legacyEntry("d", "Pills", { ownerMemberId: member.id })],
        },
        packingMigratedAt: null,
      },
    });
    await ensurePackingMigrated(plan.id);
    expect(await planLabels(plan.tripId, owner)).toEqual(["Pills"]);
    expect(await planLabels(plan.tripId, editor)).toEqual(["Pills"]);
    expect((await storedItems(plan.tripId)).map((i) => i.label)).toEqual(["Pills", "Pills"]);
  });

  it("keeps a co-planner's personal item theirs and publishes nothing", async () => {
    const plan = await newPlan();
    await join(plan.tripId);
    const member = await prisma.travelPlanMember.findFirstOrThrow({
      where: { planId: plan.id, userId: editor },
    });
    const row = await prisma.travelPlan.findUniqueOrThrow({ where: { id: plan.id } });
    await prisma.travelPlan.update({
      where: { id: plan.id },
      data: {
        state: {
          ...(row.state as object),
          packing: [
            legacyEntry("p1", "Editor insulin", { ownerMemberId: member.id }),
            legacyEntry("p2", "Owner passport"),
          ],
        },
        packingMigratedAt: null,
      },
    });
    await ensurePackingMigrated(plan.id);
    const items = await storedItems(plan.tripId);
    expect(items.find((i) => i.label === "Editor insulin")?.ownerPrincipal).toEqual(
      sameServerAccount(editor)
    );
    expect(items.find((i) => i.label === "Owner passport")?.ownerPrincipal).toBeNull();
    expect(await planLabels(plan.tripId, editor)).toEqual(["Editor insulin"]);
    expect(await planLabels(plan.tripId, owner)).toEqual(["Owner passport"]);
  });

  it("runs when the plan is first opened after the upgrade", async () => {
    const plan = await planWithLegacy([legacyEntry("q", "Sunscreen")]);
    expect(await planLabels(plan.tripId, owner)).toEqual(["Sunscreen"]);
    expect(labels(await storedItems(plan.tripId))).toEqual(["Sunscreen"]);
  });
});
