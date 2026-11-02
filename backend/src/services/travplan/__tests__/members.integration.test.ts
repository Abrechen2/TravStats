import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { prisma } from "../../../db";
import { JWT_SECRET } from "../../../utils/jwtSecret";
import travplanRouter from "../../../routes/travplan";
import { errorHandler } from "../../../middleware/errorHandler";

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
app.use(errorHandler);

let owner: string, editor: string, stranger: string;
let editorName: string;
const cookie = (id: string) => "auth_token=" + jwt.sign({ userId: id, epoch: 0 }, JWT_SECRET);
const call = (method: "get" | "post" | "delete", url: string, who: string, body?: object) => {
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
    name: "Shared trip",
    clientRef: randomUUID(),
    settings: { destination: "Madeira", startDay: "2027-03-10", endDay: "2027-03-17" },
  });
  expect(r.status).toBe(201);
  return r.body as { tripId: string; revision: number };
}
async function write(
  tripId: string,
  revision: number,
  operation: object,
  who: string,
  clientRef = randomUUID()
) {
  return call("post", `/trips/${tripId}/plan/mutations`, who, {
    clientRef,
    baseRevision: revision,
    operation,
  });
}
/** Owner invites the editor, who accepts. */
async function join(tripId: string) {
  const invited = await call("post", `/trips/${tripId}/plan/members`, owner, {
    username: editorName,
  });
  expect(invited.status).toBe(201);
  const accepted = await call("post", `/travplan/invitations/${invited.body.id}/accept`, editor);
  expect(accepted.body).toEqual({ status: "active" });
  return invited.body.id as string;
}
const packing = (label: string, scope: "personal" | "shared") => ({
  type: "upsert",
  collection: "packing",
  value: {
    id: randomUUID(),
    label,
    category: "",
    quantity: 1,
    packed: false,
    scope,
    note: "",
    manual: true,
  },
});

beforeAll(async () => {
  const users = await Promise.all(
    [0, 1, 2].map((n) =>
      prisma.user.create({
        data: { username: "members-test-" + n + "-" + randomUUID(), passwordHash: "x" },
      })
    )
  );
  [owner, editor, stranger] = users.map((u) => u.id);
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

describe("TravPlan co-planners on the same server", () => {
  it("answers a non-member with the 404 of a plan that does not exist, on every plan path", async () => {
    const plan = await newPlan();
    for (const [method, url] of [
      ["get", `/trips/${plan.tripId}/plan`],
      ["get", `/trips/${plan.tripId}/plan/collab`],
      ["get", `/trips/${plan.tripId}/plan/packing-suggestions`],
      ["post", `/trips/${plan.tripId}/plan/leave`],
    ] as const)
      expect((await call(method, url, stranger)).status).toBe(404);
    expect((await write(plan.tripId, plan.revision, { type: "handover" }, stranger)).status).toBe(
      404
    );
    expect(
      (await call("post", `/trips/${plan.tripId}/plan/members`, stranger, { username: "x" })).status
    ).toBe(404);
  });

  it("invites only with the sharing consent accepted in both directions and names whose answer is missing", async () => {
    const plan = await newPlan();
    const invite = () =>
      call("post", `/trips/${plan.tripId}/plan/members`, owner, { username: editorName });
    const none = await invite();
    expect([none.status, none.body.code]).toEqual([403, "PLAN_MEMBER_CONSENT_MINE"]);
    await consent(editor, owner);
    const half = await invite();
    expect([half.status, half.body.code]).toEqual([403, "PLAN_MEMBER_CONSENT_THEIRS"]);
    await consent(owner, editor);
    expect((await invite()).status).toBe(201);
    expect((await invite()).body.code).toBe("PLAN_MEMBER_DUPLICATE");
    const self = await call("post", `/trips/${plan.tripId}/plan/members`, owner, {
      username: (await prisma.user.findUniqueOrThrow({ where: { id: owner } })).username,
    });
    expect(self.body.code).toBe("PLAN_MEMBER_SELF");
  });

  it("lets an invited account read nothing until it accepts, then lists the plan under its own name", async () => {
    await consent(owner, editor);
    await consent(editor, owner);
    const plan = await newPlan();
    const invited = await call("post", `/trips/${plan.tripId}/plan/members`, owner, {
      username: editorName,
    });
    expect((await call("get", `/trips/${plan.tripId}/plan`, editor)).status).toBe(404);
    const open = await call("get", "/travplan/invitations", editor);
    expect(open.body.invitations.map((i: { tripId: string }) => i.tripId)).toContain(plan.tripId);
    await call("post", `/travplan/invitations/${invited.body.id}/accept`, editor);
    expect((await call("get", `/trips/${plan.tripId}/plan`, editor)).status).toBe(200);
    const list = await call("get", "/travplan/plans", editor);
    expect(list.body.plans.find((p: { tripId: string }) => p.tripId === plan.tripId)).toMatchObject(
      { role: "editor" }
    );
  });

  it("names the editor as the author of a change and tells the owner, who can read the notice once", async () => {
    await consent(owner, editor);
    await consent(editor, owner);
    const plan = await newPlan();
    await join(plan.tripId);
    const idea = {
      type: "upsert",
      collection: "ideas",
      value: {
        id: randomUUID(),
        title: "Levada walk",
        category: "",
        priority: "optional",
        note: "",
        itemId: null,
      },
    };
    const done = await write(plan.tripId, plan.revision, idea, editor);
    expect(done.status).toBe(200);
    expect(done.body.lastMutation).toMatchObject({
      summary: "upsert:ideas",
      actor: { displayName: editorName },
    });
    const seen = await call("get", `/trips/${plan.tripId}/plan/collab`, owner);
    expect(seen.body.notices).toEqual([
      expect.objectContaining({ actorName: editorName, summary: "upsert:ideas" }),
    ]);
    await call("post", `/trips/${plan.tripId}/plan/notices/read`, owner);
    expect((await call("get", `/trips/${plan.tripId}/plan/collab`, owner)).body.notices).toEqual(
      []
    );
    // The editor is never told about their own change.
    expect((await call("get", `/trips/${plan.tripId}/plan/collab`, editor)).body.notices).toEqual(
      []
    );
  });

  it("refuses a stale write with the conflict and names who changed the plan meanwhile", async () => {
    await consent(owner, editor);
    await consent(editor, owner);
    const plan = await newPlan();
    await join(plan.tripId);
    const first = await write(plan.tripId, plan.revision, packing("Torch", "shared"), editor);
    expect(first.status).toBe(200);
    const stale = await write(plan.tripId, plan.revision, packing("Sunscreen", "shared"), owner);
    expect([stale.status, stale.body.code]).toEqual([409, "PLAN_REVISION_CONFLICT"]);
    const fresh = await call("get", `/trips/${plan.tripId}/plan`, owner);
    expect(fresh.body.lastMutation.actor.displayName).toBe(editorName);
    expect(fresh.headers.etag).toBeDefined();
  });

  it("holds the owner-only acts back from a co-planner (D3): delete, members, AI policy and the logbook acts", async () => {
    await consent(owner, editor);
    await consent(editor, owner);
    const plan = await newPlan();
    const memberId = await join(plan.tripId);
    const code = (r: { status: number; body: { code?: string } }) => [r.status, r.body.code];
    expect(code(await call("delete", `/trips/${plan.tripId}/plan`, editor))).toEqual([
      403,
      "PLAN_OWNER_ONLY",
    ]);
    expect(code(await call("get", `/trips/${plan.tripId}/plan/delete-preview`, editor))).toEqual([
      403,
      "PLAN_OWNER_ONLY",
    ]);
    expect(
      code(await call("post", `/trips/${plan.tripId}/plan/members`, editor, { username: "x" }))
    ).toEqual([403, "PLAN_OWNER_ONLY"]);
    expect(
      code(await call("delete", `/trips/${plan.tripId}/plan/members/${memberId}`, editor))
    ).toEqual([403, "PLAN_OWNER_ONLY"]);
    expect(
      code(await call("post", `/trips/${plan.tripId}/plan/proposals`, editor, { request: "x" }))
    ).toEqual([403, "PLAN_OWNER_ONLY"]);
    const ai = { type: "settings", values: { ai: { enabled: true, policy: "cloud_allowed" } } };
    expect(code(await write(plan.tripId, plan.revision, ai, editor))).toEqual([
      403,
      "PLAN_OWNER_ONLY",
    ]);
    for (const operation of [
      { type: "handover" },
      { type: "refresh_existing" },
      { type: "station_handover", stationId: randomUUID() },
    ])
      expect(code(await write(plan.tripId, plan.revision, operation, editor))).toEqual([
        403,
        "PLAN_OWNER_ONLY",
      ]);
    // Everything else the owner can do, the editor can: settings without the AI policy.
    const name = await write(
      plan.tripId,
      plan.revision,
      { type: "settings", values: {}, name: "Madeira with Anna" },
      editor
    );
    expect(name.status).toBe(200);
    // The plan is still there, owned by the owner.
    expect((await call("get", `/trips/${plan.tripId}/plan`, owner)).status).toBe(200);
    expect((await call("delete", `/trips/${plan.tripId}/plan`, owner)).status).toBe(200);
    // ... and a member sees nothing of it afterwards.
    expect((await call("get", `/trips/${plan.tripId}/plan`, editor)).status).toBe(404);
  });

  it("keeps personal packing and notes to their member, stamps the writer and refuses to touch a foreign item", async () => {
    await consent(owner, editor);
    await consent(editor, owner);
    const plan = await newPlan();
    await join(plan.tripId);
    const mine = packing("Owner passport", "personal");
    const theirs = packing("Editor insulin", "personal");
    const shared = packing("Tent", "shared");
    let revision = plan.revision;
    for (const [op, who] of [
      [mine, owner],
      [theirs, editor],
      [shared, owner],
    ] as const) {
      const r = await write(plan.tripId, revision, op, who);
      expect(r.status).toBe(200);
      revision = r.body.revision;
    }
    const labels = async (who: string) =>
      (
        (await call("get", `/trips/${plan.tripId}/plan`, who)).body.state.packing as {
          label: string;
        }[]
      )
        .map((p) => p.label)
        .sort();
    expect(await labels(owner)).toEqual(["Owner passport", "Tent"]);
    expect(await labels(editor)).toEqual(["Editor insulin", "Tent"]);
    const stored = await prisma.travelPlan.findFirstOrThrow({ where: { tripId: plan.tripId } });
    const rows = (
      stored.state as unknown as { packing: { label: string; ownerMemberId: string }[] }
    ).packing;
    const ownerMember = await prisma.travelPlanMember.findFirstOrThrow({
      where: { plan: { tripId: plan.tripId }, kind: "owner" },
    });
    expect(rows.find((p) => p.label === "Owner passport")?.ownerMemberId).toBe(ownerMember.id);
    // The editor cannot reach the owner's item, by id, as if it did not exist.
    const foreign = (mine.value as { id: string }).id;
    const removed = await write(
      plan.tripId,
      revision,
      { type: "remove", collection: "packing", id: foreign },
      editor
    );
    expect([removed.status, removed.body.code]).toEqual([404, "PLAN_ITEM_NOT_FOUND"]);
    const overwritten = await write(
      plan.tripId,
      revision,
      { type: "upsert", collection: "packing", value: { ...mine.value, label: "Stolen" } },
      editor
    );
    expect(overwritten.status).toBe(404);
    // A note is the writer's own.
    const note = await write(
      plan.tripId,
      revision,
      { type: "member_note", text: "Ask Anna" },
      editor
    );
    expect(note.status).toBe(200);
    expect(note.body.state.memberNotes).toHaveLength(1);
    const ownerView = await call("get", `/trips/${plan.tripId}/plan`, owner);
    expect(ownerView.body.state.memberNotes).toEqual([]);
    // Another member cannot replay the editor's receipt by its clientRef.
    const clientRef = randomUUID();
    const first = await write(
      plan.tripId,
      note.body.revision,
      packing("Hat", "shared"),
      editor,
      clientRef
    );
    expect(first.status).toBe(200);
    const replay = await write(
      plan.tripId,
      note.body.revision,
      packing("Hat", "shared"),
      owner,
      clientRef
    );
    expect([replay.status, replay.body.code]).toEqual([409, "PLAN_IDEMPOTENCY_CONFLICT"]);
  });

  it("refuses to assign an item or split a cost to somebody who is not on the plan", async () => {
    await consent(owner, editor);
    await consent(editor, owner);
    const plan = await newPlan();
    const bad = packing("Stove", "shared");
    (bad.value as Record<string, unknown>).ownerMemberId = randomUUID();
    const r = await write(plan.tripId, plan.revision, bad, owner);
    expect([r.status, r.body.code]).toEqual([400, "PLAN_MEMBER_UNKNOWN"]);
    const cost = {
      type: "upsert",
      collection: "costs",
      value: {
        id: randomUUID(),
        title: "Fuel",
        amount: 100,
        currency: "EUR",
        paid: 0,
        kind: "estimate",
        splitMemberIds: [randomUUID()],
      },
    };
    expect((await write(plan.tripId, plan.revision, cost, owner)).body.code).toBe(
      "PLAN_MEMBER_UNKNOWN"
    );
  });

  it("ends access when a member leaves, is removed, or either side withdraws the sharing consent", async () => {
    await consent(owner, editor);
    await consent(editor, owner);
    const plan = await newPlan();
    const memberId = await join(plan.tripId);
    expect((await call("post", `/trips/${plan.tripId}/plan/leave`, editor)).body).toEqual({
      left: true,
    });
    expect((await call("get", `/trips/${plan.tripId}/plan`, editor)).status).toBe(404);
    expect((await call("post", `/trips/${plan.tripId}/plan/leave`, owner)).body.code).toBe(
      "PLAN_OWNER_CANNOT_LEAVE"
    );
    // Invited again, removed by the owner.
    await join(plan.tripId);
    const row = await prisma.travelPlanMember.findFirstOrThrow({
      where: { userId: editor, plan: { tripId: plan.tripId } },
    });
    expect(row.id).toBe(memberId);
    expect(
      (await call("delete", `/trips/${plan.tripId}/plan/members/${row.id}`, owner)).body
    ).toEqual({ revoked: true });
    expect((await call("get", `/trips/${plan.tripId}/plan`, editor)).status).toBe(404);
    // Consent withdrawn while a member: the access ends with the consent, with its own reason.
    await join(plan.tripId);
    await prisma.shareConsent.updateMany({
      where: { requesterId: editor, targetId: owner },
      data: { status: "withdrawn" },
    });
    const gone = await call("get", `/trips/${plan.tripId}/plan`, editor);
    expect([gone.status, gone.body.code]).toEqual([403, "PLAN_MEMBER_CONSENT_WITHDRAWN"]);
    await consent(editor, owner);
  });

  it("gives every co-planner the linked copy of the trip at handover and names one whose copy failed", async () => {
    await consent(owner, editor);
    await consent(editor, owner);
    const plan = await newPlan();
    const memberId = await join(plan.tripId);
    const done = await write(plan.tripId, plan.revision, { type: "handover" }, owner);
    expect(done.status).toBe(200);
    expect(done.body.memberShares).toEqual([
      expect.objectContaining({ memberId, ok: true, displayName: editorName }),
    ]);
    const copy = await prisma.trip.findFirst({
      where: { userId: editor, shareGroupId: { not: null }, name: "Shared trip" },
    });
    const origin = await prisma.trip.findUniqueOrThrow({ where: { id: plan.tripId } });
    expect(copy?.shareGroupId).toBe(origin.shareGroupId);
    expect(
      (await prisma.travelPlanMember.findUniqueOrThrow({ where: { id: memberId } })).sharedAt
    ).not.toBeNull();
    // A copy that cannot be made is reported with its code, not swallowed.
    await prisma.user.update({ where: { id: editor }, data: { isActive: false } });
    try {
      const retry = await call(
        "post",
        `/trips/${plan.tripId}/plan/members/${memberId}/share`,
        owner
      );
      expect(retry.body).toMatchObject({ ok: false, code: "SHARE_USER_NOT_FOUND" });
    } finally {
      await prisma.user.update({ where: { id: editor }, data: { isActive: true } });
    }
  });

  describe("undo", () => {
    const idea = (title: string) => ({
      type: "upsert",
      collection: "ideas",
      value: {
        id: randomUUID(),
        title,
        category: "",
        priority: "optional",
        note: "",
        itemId: null,
      },
    });
    const undo = (tripId: string, revision: number, mutationId: string, who: string) =>
      write(tripId, revision, { type: "undo", mutationId }, who);
    async function joined() {
      await consent(owner, editor);
      await consent(editor, owner);
      const plan = await newPlan();
      await join(plan.tripId);
      return plan;
    }
    const setBefore = async (
      mutationId: string,
      edit: (state: Record<string, unknown>) => void
    ) => {
      const row = await prisma.travelPlanMutation.findUniqueOrThrow({ where: { id: mutationId } });
      const before = row.before as unknown as { state: Record<string, unknown> };
      edit(before.state);
      await prisma.travelPlanMutation.update({
        where: { id: mutationId },
        data: { before: before as never },
      });
    };

    it("refuses a co-planner's undo of somebody else's change, and the owner may still undo it", async () => {
      const plan = await joined();
      const made = await write(plan.tripId, plan.revision, idea("Owner idea"), owner);
      const refused = await undo(plan.tripId, made.body.revision, made.body.lastMutationId, editor);
      expect([refused.status, refused.body.code]).toEqual([403, "PLAN_OWNER_ONLY"]);
      expect(
        (await undo(plan.tripId, made.body.revision, made.body.lastMutationId, owner)).status
      ).toBe(200);
    });

    it("fails closed on a receipt that names no author or no operation", async () => {
      const plan = await joined();
      const made = await write(plan.tripId, plan.revision, idea("Mine"), editor);
      await prisma.travelPlanMutation.update({
        where: { id: made.body.lastMutationId },
        data: { summary: "", actorMemberId: null },
      });
      const refused = await undo(plan.tripId, made.body.revision, made.body.lastMutationId, editor);
      expect([refused.status, refused.body.code]).toEqual([403, "PLAN_OWNER_ONLY"]);
    });

    it("keeps the AI policy as it is now when a co-planner undoes their own change", async () => {
      const plan = await joined();
      const ai = { type: "settings", values: { ai: { enabled: true, policy: "local_only" } } };
      const aiOn = await write(plan.tripId, plan.revision, ai, owner);
      const mine = await write(plan.tripId, aiOn.body.revision, idea("Mine"), editor);
      await setBefore(mine.body.lastMutationId, (state) => {
        state.ai = { enabled: true, policy: "cloud_allowed" };
      });
      const done = await undo(plan.tripId, mine.body.revision, mine.body.lastMutationId, editor);
      expect(done.status).toBe(200);
      expect(done.body.state.ai).toEqual({ enabled: true, policy: "local_only" });
    });

    it("never takes another member's personal packing or note from the snapshot", async () => {
      const plan = await joined();
      const personal = packing("Owner passport", "personal");
      const added = await write(plan.tripId, plan.revision, personal, owner);
      const noted = await write(
        plan.tripId,
        added.body.revision,
        { type: "member_note", text: "Owner secret" },
        owner
      );
      const mine = await write(plan.tripId, noted.body.revision, idea("Mine"), editor);
      // A snapshot that lacks the owner's private parts, as an old one would.
      await setBefore(mine.body.lastMutationId, (state) => {
        state.packing = [];
        state.memberNotes = [];
      });
      const done = await undo(plan.tripId, mine.body.revision, mine.body.lastMutationId, editor);
      expect(done.status).toBe(200);
      const stored = await prisma.travelPlan.findFirstOrThrow({ where: { tripId: plan.tripId } });
      const state = stored.state as unknown as {
        packing: { label: string }[];
        memberNotes: { text: string }[];
      };
      expect(state.packing.map((p) => p.label)).toEqual(["Owner passport"]);
      expect(state.memberNotes.map((n) => n.text)).toEqual(["Owner secret"]);
      // ... and the editor's response does not show them.
      expect(done.body.state.packing).toEqual([]);
    });

    it("refuses a co-planner's undo that would change an execution", async () => {
      const plan = await joined();
      const mine = await write(plan.tripId, plan.revision, idea("Mine"), editor);
      await setBefore(mine.body.lastMutationId, (state) => {
        state.handoverRevision = 7;
      });
      const refused = await undo(plan.tripId, mine.body.revision, mine.body.lastMutationId, editor);
      expect([refused.status, refused.body.code]).toEqual([403, "PLAN_OWNER_ONLY"]);
    });
  });
});
