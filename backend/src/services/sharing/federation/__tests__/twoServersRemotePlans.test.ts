/**
 * Plans over a user connection across two servers (spec 2026-11-02 §4): A hosts the plan, Ben on B
 * works on it through his own server. Driven through the real signed transport; each test names the
 * defect it guards against.
 */
import { randomUUID } from "crypto";
import {
  A,
  OFF,
  connect,
  setOffline,
  servers,
  user,
  useTwoServers,
  type Server,
} from "./twoServerHarness";
import { createPlan, readPlan } from "../../../travplan/store";
import { PLAN_TRANSPORT, messageHeader } from "../transport";

useTwoServers();
let a: Server;
let b: Server;
let hadConfig: { enabled: boolean } | null = null;
beforeAll(async () => {
  ({ a, b } = servers);
  hadConfig = await a.prisma.travelPlanConfig.findUnique({ where: { id: "default" } });
  await a.prisma.travelPlanConfig.upsert({
    where: { id: "default" },
    create: { enabled: true },
    update: { enabled: true },
  });
});
afterAll(async () => {
  if (hadConfig) return;
  await a.prisma.travelPlanConfig.deleteMany({ where: { id: "default" } });
});
afterEach(() => {
  a.plansRateLimit.resetRemoteCalls();
  b.plansMember.resetRemotePlanCache();
});

const PLANS = { plans: true };
const expectCode = (p: Promise<unknown>, code: string) => expect(p).rejects.toMatchObject({ code });

async function setup(options: { invite?: boolean; accept?: boolean } = {}) {
  const anna = await user(a, "Anna");
  const ben = await user(b, "Ben");
  const { onFrom, onTo } = await connect(a, anna, b, ben, { asker: PLANS, target: PLANS });
  const plan = await createPlan(anna, {
    name: "Madeira",
    clientRef: randomUUID(),
    settings: { destination: "Madeira", startDay: "2027-03-10", endDay: "2027-03-17" },
  });
  const ids = { anna, ben, onFrom, onTo, tripId: plan.tripId, planId: plan.id };
  if (options.invite ?? true) await a.plansHost.inviteRemoteMember(anna, plan.tripId, onFrom);
  if (options.accept ?? true) await b.plansMember.acceptRemotePlan(ben, onTo, plan.id);
  return ids;
}
type Ctx = Awaited<ReturnType<typeof setup>>;

const idea = (label: string) => ({
  type: "upsert",
  collection: "packing",
  value: {
    id: randomUUID(),
    label,
    category: "",
    quantity: 1,
    packed: false,
    scope: "shared",
    note: "",
    manual: true,
  },
});
const mutation = (revision: number, operation: object, clientRef = randomUUID()) => ({
  clientRef,
  baseRevision: revision,
  operation,
});
const readView = async (c: Ctx) =>
  (await b.plansMember.readRemotePlan(c.ben, c.onTo, c.planId)) as {
    notModified: false;
    etag: string;
    data: { revision: number; self: { kind: string } };
  };
const memberOf = (c: Ctx) =>
  a.prisma.travelPlanMember.findFirstOrThrow({
    where: { planId: c.planId, connectionId: c.onFrom },
  });

describe("inviting, accepting and working on a plan on another server", () => {
  it("an invitation reaches the member's server as an invitation, and nothing is joined before the answer", async () => {
    const c = await setup({ accept: false });
    const [invite] = await b.plansMember.listRemotePlans(c.ben);
    expect(invite).toEqual({
      connectionId: c.onTo,
      origin: A,
      planId: c.planId,
      tripId: c.tripId,
      title: "Madeira",
      ownerDisplayName: "Anna",
      role: "editor",
      state: "invited",
    });
    expect((await memberOf(c)).status).toBe("invited");
    await expectCode(
      b.plansMember.readRemotePlan(c.ben, c.onTo, c.planId),
      "REMOTE_PLAN_NOT_FOUND"
    );
    const accepted = await b.plansMember.acceptRemotePlan(c.ben, c.onTo, c.planId);
    expect(accepted.state).toBe("active");
    expect((await memberOf(c)).status).toBe("active");
  });

  it("the member reads, writes, and sees the collaboration state through his own server", async () => {
    const c = await setup();
    const view = await readView(c);
    expect(view.data.self.kind).toBe("remote");
    const written = (await b.plansMember.mutateRemotePlan(
      c.ben,
      c.onTo,
      c.planId,
      mutation(view.data.revision, idea("Sunscreen"))
    )) as { revision: number };
    expect(written.revision).toBe(view.data.revision + 1);
    const onHost = await readPlan(c.anna, c.tripId);
    expect(onHost.revision).toBe(written.revision);
    const collab = (await b.plansMember.collabRemotePlan(c.ben, c.onTo, c.planId)) as {
      members: { kind: string }[];
    };
    expect(collab.members.map((m) => m.kind).sort()).toEqual(["owner", "remote"]);
    // The owner hears what Ben changed.
    const owner = await a.prisma.travelPlanMember.findFirstOrThrow({
      where: { planId: c.planId, kind: "owner" },
    });
    expect(await a.prisma.travelPlanNotice.count({ where: { recipientId: owner.id } })).toBe(1);
  });

  it("a replay of the same write after a 503 gets the host's receipt and never a second mutation", async () => {
    const c = await setup();
    const view = await readView(c);
    const body = mutation(view.data.revision, idea("Hat"));
    setOffline(A, true);
    await expectCode(
      b.plansMember.mutateRemotePlan(c.ben, c.onTo, c.planId, body),
      "REMOTE_PLAN_UNREACHABLE"
    );
    setOffline(A, false);
    const first = (await b.plansMember.mutateRemotePlan(c.ben, c.onTo, c.planId, body)) as {
      revision: number;
    };
    const again = (await b.plansMember.mutateRemotePlan(c.ben, c.onTo, c.planId, body)) as {
      revision: number;
    };
    expect(again.revision).toBe(first.revision);
    expect(
      await a.prisma.travelPlanMutation.count({
        where: { planId: c.planId, clientRef: body.clientRef },
      })
    ).toBe(1);
  });

  it("a read within the cache window is answered 304 without asking the host, and later through the host's ETag", async () => {
    const c = await setup();
    const first = await readView(c);
    const spy = jest.spyOn(b.security, "exchange");
    const cached = await b.plansMember.readRemotePlan(c.ben, c.onTo, c.planId, first.etag);
    expect(cached).toEqual({ notModified: true, etag: first.etag });
    expect(spy).not.toHaveBeenCalled();
    // Past the window the host is asked once, with the client's ETag, and answers "not modified".
    const real = Date.now();
    jest.spyOn(Date, "now").mockReturnValue(real + 60_000);
    const later = await b.plansMember.readRemotePlan(c.ben, c.onTo, c.planId, first.etag);
    expect(later).toEqual({ notModified: true, etag: first.etag });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("a plan change by the host shows up after the cache window, not as a stale 304", async () => {
    const c = await setup();
    const first = await readView(c);
    const { writePlan } = await import("../../../travplan/store");
    await writePlan(c.anna, c.tripId, mutation(first.data.revision, idea("Boots")) as never);
    const real = Date.now();
    jest.spyOn(Date, "now").mockReturnValue(real + 60_000);
    const next = await b.plansMember.readRemotePlan(c.ben, c.onTo, c.planId, first.etag);
    expect(next.notModified).toBe(false);
  });

  it("uploads a document, lists and downloads it, and exports the trip as a file, all through his own server", async () => {
    const c = await setup();
    const bytes = Buffer.from("%PDF-1.4\n%plan document\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
    const dto = (await b.plansMember.putRemotePlanDocument(c.ben, c.onTo, c.planId, {
      buffer: bytes,
      originalname: "ticket.pdf",
      mimetype: "application/pdf",
    })) as { id: string; uploadedBy: { displayName: string } | null };
    expect(dto.uploadedBy?.displayName).toBe("Ben");
    const list = (await b.plansMember.listRemotePlanDocuments(c.ben, c.onTo, c.planId)) as {
      documents: { id: string }[];
    };
    expect(list.documents.map((d) => d.id)).toEqual([dto.id]);
    const file = await b.plansMember.getRemotePlanDocument(c.ben, c.onTo, c.planId, dto.id);
    expect(file.bytes.equals(bytes)).toBe(true);
    const archive = await b.plansMember.exportRemotePlan(c.ben, c.onTo, c.planId);
    expect(archive.bytes.subarray(0, 2).toString()).toBe("PK");
    expect(archive.filename.endsWith(".travstats")).toBe(true);
  });

  it("a document near the plan limit crosses the signed transport both ways, and one above it is refused before it is sent", async () => {
    const c = await setup();
    const big = Buffer.concat([
      Buffer.from("%PDF-1.4\n"),
      Buffer.alloc(9 * 1024 * 1024, "a"),
      Buffer.from("\n%%EOF\n"),
    ]);
    const dto = (await b.plansMember.putRemotePlanDocument(c.ben, c.onTo, c.planId, {
      buffer: big,
      originalname: "big.pdf",
      mimetype: "application/pdf",
    })) as { id: string; sizeBytes: number };
    expect(dto.sizeBytes).toBe(big.length);
    const back = await b.plansMember.getRemotePlanDocument(c.ben, c.onTo, c.planId, dto.id);
    expect(back.bytes.equals(big)).toBe(true);
    await expectCode(
      b.plansMember.putRemotePlanDocument(c.ben, c.onTo, c.planId, {
        buffer: Buffer.alloc(11 * 1024 * 1024, "a"),
        originalname: "huge.pdf",
        mimetype: "application/pdf",
      }),
      "PLAN_DOCUMENT_TOO_LARGE"
    );
  }, 120_000);

  it("owner-only acts and the owner's other documents stay refused for a remote member", async () => {
    const c = await setup();
    const view = await readView(c);
    await expectCode(
      b.plansMember.mutateRemotePlan(
        c.ben,
        c.onTo,
        c.planId,
        mutation(view.data.revision, { type: "handover" })
      ),
      "PLAN_OWNER_ONLY"
    );
    await expectCode(
      b.plansMember.getRemotePlanDocument(c.ben, c.onTo, c.planId, randomUUID()),
      "REMOTE_PLAN_NOT_FOUND"
    );
  });

  it("declining and leaving end it on both sides, the host learning through the retried outbox", async () => {
    const c = await setup({ accept: false });
    await b.plansMember.declineRemotePlan(c.ben, c.onTo, c.planId);
    expect(await b.plansMember.listRemotePlans(c.ben)).toEqual([]);
    expect((await memberOf(c)).status).toBe("left");
    // Invited again, accepted, then left while the host is down: the leave is kept and delivered.
    await a.plansHost.inviteRemoteMember(c.anna, c.tripId, c.onFrom);
    await b.plansMember.acceptRemotePlan(c.ben, c.onTo, c.planId);
    setOffline(A, true);
    await b.plansMember.leaveRemotePlan(c.ben, c.onTo, c.planId);
    expect(await b.prisma.connectionAnnouncement.count({ where: { kind: "plan-leave" } })).toBe(1);
    expect((await memberOf(c)).status).toBe("active");
    setOffline(A, false);
    const run = await b.announcements.runAnnouncements(new Date(Date.now() + 3_600_000));
    expect(run.sent).toBe(1);
    expect((await memberOf(c)).status).toBe("left");
  });
});

describe("access ends on the next call", () => {
  it("revoking the connection ends the member's access, and the plan leaves his list", async () => {
    const c = await setup();
    await a.connections.endConnection(c.anna, c.onFrom);
    expect(await b.plansMember.listRemotePlans(c.ben)).toEqual([]);
    expect((await memberOf(c)).status).toBe("revoked");
    await expectCode(
      b.plansMember.readRemotePlan(c.ben, c.onTo, c.planId),
      "REMOTE_PLAN_NOT_FOUND"
    );
  });

  it("a revoke the member's server never heard of still ends access: the host refuses on the call itself", async () => {
    const c = await setup();
    setOffline(b.origin, true);
    await a.connections.endConnection(c.anna, c.onFrom);
    setOffline(b.origin, false);
    // B still believes the connection is active; the host says no.
    expect(
      (await b.prisma.remoteShareAccount.findUniqueOrThrow({ where: { id: c.onTo } })).state
    ).toBe("active");
    await expectCode(
      b.plansMember.readRemotePlan(c.ben, c.onTo, c.planId),
      "REMOTE_PLAN_NOT_SHARED"
    );
    // ...and the announcement the host could not deliver is retried until B has it.
    expect(await a.prisma.connectionAnnouncement.count({ where: { kind: "connect-revoke" } })).toBe(
      1
    );
    await a.announcements.runAnnouncements(new Date(Date.now() + 3_600_000));
    expect(
      (await b.prisma.remoteShareAccount.findUniqueOrThrow({ where: { id: c.onTo } })).state
    ).toBe("revoked");
    expect(await a.prisma.connectionAnnouncement.count()).toBe(0);
  });

  it("switching plans off on either side ends access on the next call, and switching it on again restores it", async () => {
    const c = await setup();
    await readView(c);
    await a.connections.updateConnectionSwitches(c.anna, c.onFrom, { ...OFF, plans: false });
    await expectCode(
      b.plansMember.mutateRemotePlan(c.ben, c.onTo, c.planId, mutation(1, idea("x"))),
      "REMOTE_PLAN_NOT_SHARED"
    );
    await a.connections.updateConnectionSwitches(c.anna, c.onFrom, { ...OFF, plans: true });
    // The membership on the host never ended; Ben's pointer did, and the owner's invitation restores it.
    await a.plansHost.inviteRemoteMember(c.anna, c.tripId, c.onFrom);
    await b.plansMember.acceptRemotePlan(c.ben, c.onTo, c.planId);
    expect((await readView(c)).data.revision).toBeGreaterThan(0);
    await b.connections.updateConnectionSwitches(c.ben, c.onTo, { ...OFF, plans: false });
    await expectCode(
      b.plansMember.readRemotePlan(c.ben, c.onTo, c.planId),
      "REMOTE_PLAN_NOT_SHARED"
    );
  });

  it("removing the member on the host ends his access on the next call", async () => {
    const c = await setup();
    const m = await memberOf(c);
    await a.prisma.travelPlanMember.update({ where: { id: m.id }, data: { status: "revoked" } });
    b.plansMember.resetRemotePlanCache();
    await expectCode(
      b.plansMember.readRemotePlan(c.ben, c.onTo, c.planId),
      "REMOTE_PLAN_NOT_SHARED"
    );
    expect(await b.plansMember.listRemotePlans(c.ben)).toEqual([]);
  });

  it("an admin disabling the pin makes the host unreachable, not a data loss: the queue stays and it works again", async () => {
    const c = await setup();
    await a.prisma.comparisonPeer.update({ where: { origin: b.origin }, data: { enabled: false } });
    await expectCode(
      b.plansMember.mutateRemotePlan(c.ben, c.onTo, c.planId, mutation(1, idea("y"))),
      "REMOTE_PLAN_UNREACHABLE"
    );
    await a.prisma.comparisonPeer.update({ where: { origin: b.origin }, data: { enabled: true } });
    expect((await readView(c)).data.revision).toBeGreaterThan(0);
  });
});

describe("what a signed message alone does not grant", () => {
  const call = (c: Ctx, kind: string, extra: object = {}, planId = c.planId) =>
    b.security.exchange(
      A,
      {
        kind,
        ...messageHeader(),
        from: connectionChannels.from,
        to: connectionChannels.to,
        planId,
        ...extra,
      },
      PLAN_TRANSPORT
    ) as Promise<{ status: string }>;
  let connectionChannels = { from: "", to: "" };
  async function channels(c: Ctx) {
    const row = await b.prisma.remoteShareAccount.findUniqueOrThrow({ where: { id: c.onTo } });
    connectionChannels = { from: row.localChannel, to: row.channel };
  }

  it("a person connected but never invited, another plan, and a remote row claiming any role but editor all read as not shared", async () => {
    const c = await setup();
    await channels(c);
    const other = await createPlan(c.anna, {
      name: "Other",
      clientRef: randomUUID(),
      settings: { destination: "Porto", startDay: "2027-05-01", endDay: "2027-05-03" },
    });
    expect((await call(c, "plan-read")).status).toBe("ok");
    expect((await call(c, "plan-read", {}, other.id)).status).toBe("notShared");
    expect((await call(c, "plan-read", {}, randomUUID())).status).toBe("notShared");
    const m = await memberOf(c);
    await a.prisma.travelPlanMember.update({ where: { id: m.id }, data: { role: "owner" } });
    expect((await call(c, "plan-collab")).status).toBe("notShared");
    // Another person on B, connected with Anna but never invited.
    const eve = await user(b, "Eve");
    const link = await connect(a, c.anna, b, eve, { asker: PLANS, target: PLANS });
    const eveRow = await b.prisma.remoteShareAccount.findUniqueOrThrow({
      where: { id: link.onTo },
    });
    connectionChannels = { from: eveRow.localChannel, to: eveRow.channel };
    expect((await call(c, "plan-read")).status).toBe("notShared");
    expect((await call(c, "plan-doc-list")).status).toBe("notShared");
  });

  it("a made-up channel pair, or one with the right sender and a wrong receiver, reads as not shared", async () => {
    const c = await setup();
    await channels(c);
    connectionChannels = { from: randomUUID(), to: connectionChannels.to };
    expect((await call(c, "plan-read")).status).toBe("notShared");
    connectionChannels = { from: connectionChannels.from, to: randomUUID() };
    expect((await call(c, "plan-read")).status).toBe("notShared");
  });

  it("a member cannot spend more than 120 writes a minute", async () => {
    const c = await setup();
    await channels(c);
    const member = await memberOf(c);
    for (let i = 0; i < 120; i += 1)
      expect(a.plansRateLimit.takeRemoteCall(member.id, true)).toBe(true);
    const refused = (await call(c, "plan-mutate", { body: {} })) as {
      status: string;
      code?: string;
    };
    expect(refused).toMatchObject({ status: "error", code: "REMOTE_PLAN_RATE_LIMITED" });
  });

  it("at most 50 documents per member", async () => {
    const c = await setup();
    const member = await memberOf(c);
    const owner = await a.prisma.trip.findUniqueOrThrow({ where: { id: c.tripId } });
    const rows = [];
    for (let i = 0; i < 50; i += 1) {
      const doc = await a.prisma.document.create({
        data: {
          userId: owner.userId,
          tripId: c.tripId,
          storedName: `x-${randomUUID()}.pdf`,
          originalName: `d${i}.pdf`,
          mimetype: "application/pdf",
          format: "pdf",
          sizeBytes: 10,
          sha256: randomUUID().replace(/-/g, "").padEnd(64, "0"),
          source: "upload",
        },
      });
      rows.push({ planId: c.planId, documentId: doc.id, uploadedByMemberId: member.id });
    }
    await a.prisma.travelPlanDocument.createMany({ data: rows });
    await expectCode(
      b.plansMember.putRemotePlanDocument(c.ben, c.onTo, c.planId, {
        buffer: Buffer.from("%PDF-1.4\nsixty\n%%EOF\n"),
        originalname: "one-more.pdf",
        mimetype: "application/pdf",
      }),
      "PLAN_DOCUMENT_LIMIT"
    );
  });
});

describe("inviting", () => {
  it("only a connection with plans on at both sides is offered, and only the owner may invite", async () => {
    const anna = await user(a, "Anna");
    const ben = await user(b, "Ben");
    const noPlans = await connect(a, anna, b, ben, { asker: PLANS, target: {} });
    const plan = await createPlan(anna, {
      name: "P",
      clientRef: randomUUID(),
      settings: { destination: "Faro", startDay: "2027-06-01", endDay: "2027-06-02" },
    });
    expect(await a.plansHost.eligiblePlanConnections(anna, plan.tripId)).toEqual([]);
    await expectCode(
      a.plansHost.inviteRemoteMember(anna, plan.tripId, noPlans.onFrom),
      "SHARE_REMOTE_CONNECTION_STATE"
    );
    await b.connections.updateConnectionSwitches(ben, noPlans.onTo, { ...OFF, plans: true });
    const eligible = await a.plansHost.eligiblePlanConnections(anna, plan.tripId);
    expect(eligible).toMatchObject([
      { connectionId: noPlans.onFrom, displayName: "Ben", member: false },
    ]);
    await expectCode(
      a.plansHost.inviteRemoteMember(ben, plan.tripId, noPlans.onFrom),
      "PLAN_NOT_FOUND"
    );
  });

  it("an invitation the other server never got leaves no open invitation behind", async () => {
    const c = await setup({ invite: false, accept: false });
    setOffline(b.origin, true);
    await expectCode(
      a.plansHost.inviteRemoteMember(c.anna, c.tripId, c.onFrom),
      "SHARE_REMOTE_UNREACHABLE"
    );
    setOffline(b.origin, false);
    expect(
      await a.prisma.travelPlanMember.count({ where: { planId: c.planId, status: "invited" } })
    ).toBe(0);
    await a.plansHost.inviteRemoteMember(c.anna, c.tripId, c.onFrom);
    expect((await b.plansMember.listRemotePlans(c.ben)).map((p) => p.state)).toEqual(["invited"]);
  });

  it("counts open plan invitations for the inbox badge", async () => {
    const c = await setup({ accept: false });
    expect(await b.plansMember.countPlanInvites(c.ben)).toBe(1);
  });
});
