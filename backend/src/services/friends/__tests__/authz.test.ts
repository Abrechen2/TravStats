import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { prisma } from "../../../db";
import { JWT_SECRET } from "../../../utils/jwtSecret";
import travplanRouter from "../../../routes/travplan";
import { errorHandler } from "../../../middleware/errorHandler";
import { shareTripWithUser } from "../../sharing/shareTrip";
import { listLinkableCompanions } from "../../sharing/companionLink";
import {
  DEFAULT_ON,
  acceptLocal,
  requestLocal,
  revokeLocal,
  setLocalSwitches,
} from "../localConnections";
import { mayOfferTripTo, offerStatuses, plansGivenTo } from "../authz";

jest.mock("../../travplan/availability", () => ({
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
const cookie = (id: string) => "auth_token=" + jwt.sign({ userId: id, epoch: 0 }, JWT_SECRET);

jest.setTimeout(30_000);
const created: string[] = [];
async function user() {
  const u = await prisma.user.create({
    data: { username: `fr-az-${randomUUID().slice(0, 8)}`, passwordHash: "test-only" },
  });
  created.push(u.id);
  return u;
}
async function friends(a: string, b: string, aGives = DEFAULT_ON, bGives = DEFAULT_ON) {
  await requestLocal(a, b, aGives);
  await acceptLocal(b, a, bGives);
}

beforeAll(async () => {
  await prisma.travelPlanConfig.upsert({
    where: { id: "default" },
    create: { enabled: true },
    update: { enabled: true },
  });
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

describe("trip offers read the connection", () => {
  it("a pair without a connection keeps the old consent rule", async () => {
    const [a, b] = [await user(), await user()];
    expect(await mayOfferTripTo(prisma, a.id, b.id)).toBe(false);
    await prisma.shareConsent.create({
      data: { requesterId: a.id, targetId: b.id, status: "accepted", decidedAt: new Date() },
    });
    expect(await mayOfferTripTo(prisma, a.id, b.id)).toBe(true);
    expect(await mayOfferTripTo(prisma, b.id, a.id)).toBe(false);
  });

  it("with a connection only the target's tripOffers switch decides, whatever an accepted consent row says", async () => {
    const [a, b] = [await user(), await user()];
    // b does NOT let a offer, a lets b offer. Activation writes consents both ways.
    await friends(a.id, b.id, DEFAULT_ON, { ...DEFAULT_ON, tripOffers: false });
    expect(
      await prisma.shareConsent.count({
        where: { requesterId: a.id, targetId: b.id, status: "accepted" },
      })
    ).toBe(1);
    expect(await mayOfferTripTo(prisma, a.id, b.id)).toBe(false);
    expect(await mayOfferTripTo(prisma, b.id, a.id)).toBe(true);
    await setLocalSwitches(b.id, a.id, DEFAULT_ON);
    expect(await mayOfferTripTo(prisma, a.id, b.id)).toBe(true);
  });

  it("removing a friend refuses a NEW offer but the delivered linked copy stays an open trip", async () => {
    const [a, b] = [await user(), await user()];
    await friends(a.id, b.id);
    const first = await prisma.trip.create({ data: { userId: a.id, name: "Madeira" } });
    const shared = await shareTripWithUser(a.id, first.id, b.id);
    expect(shared).toBeDefined();
    const copies = await prisma.trip.findMany({ where: { userId: b.id } });
    expect(copies).toHaveLength(1);
    await revokeLocal(a.id, b.id);
    const second = await prisma.trip.create({ data: { userId: a.id, name: "Azores" } });
    await expect(shareTripWithUser(a.id, second.id, b.id)).rejects.toMatchObject({
      code: "SHARE_CONSENT_REQUIRED",
    });
    // The copy b already had is still b's own trip.
    expect(await prisma.trip.findUnique({ where: { id: copies[0].id } })).toMatchObject({
      userId: b.id,
      name: "Madeira",
    });
    expect(await offerStatuses(a.id)).toEqual(new Map([[b.id, "withdrawn"]]));
    expect((await listLinkableCompanions(a.id)).linkableUsers).toEqual([]);
  });

  it("lists a friend as linkable only while they let the caller offer", async () => {
    const [a, b] = [await user(), await user()];
    await friends(a.id, b.id);
    expect((await listLinkableCompanions(a.id)).linkableUsers.map((u) => u.id)).toEqual([b.id]);
    await setLocalSwitches(b.id, a.id, { ...DEFAULT_ON, tripOffers: false });
    expect((await listLinkableCompanions(a.id)).linkableUsers).toEqual([]);
  });
});

describe("plans read the connection", () => {
  const call = (method: "get" | "post", url: string, who: string, body?: object) => {
    const r = request(app)
      [method]("/api/v1" + url)
      .set("Cookie", cookie(who));
    return body ? r.send(body) : r;
  };
  async function newPlan(owner: string) {
    const r = await call("post", "/travplan/plans", owner, {
      name: "Plan",
      clientRef: randomUUID(),
      settings: { destination: "Madeira", startDay: "2027-03-10", endDay: "2027-03-17" },
    });
    expect(r.status).toBe(201);
    return r.body as { tripId: string };
  }

  it("plansGivenTo needs an active connection with the switch on", async () => {
    const [a, b] = [await user(), await user()];
    expect(await plansGivenTo(prisma, a.id, b.id)).toBe(false);
    await friends(a.id, b.id, { ...DEFAULT_ON, plans: false });
    expect(await plansGivenTo(prisma, a.id, b.id)).toBe(false);
    expect(await plansGivenTo(prisma, b.id, a.id)).toBe(true);
  });

  it("an invitation needs plans on on both sides and names whose switch is off", async () => {
    const [owner, friend] = [await user(), await user()];
    await friends(owner.id, friend.id, { ...DEFAULT_ON, plans: false }, DEFAULT_ON);
    const plan = await newPlan(owner.id);
    const invite = () =>
      call("post", `/trips/${plan.tripId}/plan/members`, owner.id, { username: friend.username });
    const mine = await invite();
    expect([mine.status, mine.body.code]).toEqual([403, "PLAN_MEMBER_CONSENT_MINE"]);
    await setLocalSwitches(owner.id, friend.id, DEFAULT_ON);
    await setLocalSwitches(friend.id, owner.id, { ...DEFAULT_ON, plans: false });
    const theirs = await invite();
    expect([theirs.status, theirs.body.code]).toEqual([403, "PLAN_MEMBER_CONSENT_THEIRS"]);
    await setLocalSwitches(friend.id, owner.id, DEFAULT_ON);
    expect((await invite()).status).toBe(201);
  });

  it("removing a friend stops new invitations, but a plan already joined stays readable", async () => {
    const [owner, friend] = [await user(), await user()];
    await friends(owner.id, friend.id);
    const plan = await newPlan(owner.id);
    const invited = await call("post", `/trips/${plan.tripId}/plan/members`, owner.id, {
      username: friend.username,
    });
    expect(invited.status).toBe(201);
    const accepted = await call(
      "post",
      `/travplan/invitations/${invited.body.id}/accept`,
      friend.id
    );
    expect(accepted.body).toEqual({ status: "active" });
    const second = await newPlan(owner.id);

    await revokeLocal(owner.id, friend.id);

    expect((await call("get", `/trips/${plan.tripId}/plan`, friend.id)).status).toBe(200);
    const again = await call("post", `/trips/${second.tripId}/plan/members`, owner.id, {
      username: friend.username,
    });
    expect([again.status, again.body.code]).toEqual([403, "PLAN_MEMBER_CONSENT_MINE"]);
  });

  it("a pair without a connection still loses a joined plan when the consent is withdrawn", async () => {
    const [owner, member] = [await user(), await user()];
    for (const [r, t] of [
      [owner.id, member.id],
      [member.id, owner.id],
    ])
      await prisma.shareConsent.create({
        data: { requesterId: r, targetId: t, status: "accepted", decidedAt: new Date() },
      });
    const plan = await newPlan(owner.id);
    const invited = await call("post", `/trips/${plan.tripId}/plan/members`, owner.id, {
      username: member.username,
    });
    await call("post", `/travplan/invitations/${invited.body.id}/accept`, member.id);
    expect((await call("get", `/trips/${plan.tripId}/plan`, member.id)).status).toBe(200);
    await prisma.shareConsent.updateMany({
      where: { requesterId: owner.id, targetId: member.id },
      data: { status: "withdrawn" },
    });
    const gone = await call("get", `/trips/${plan.tripId}/plan`, member.id);
    expect([gone.status, gone.body.code]).toEqual([403, "PLAN_MEMBER_CONSENT_WITHDRAWN"]);
  });
});

describe("revocation paths really revoke (security review)", () => {
  it("a legacy withdraw or decline on a connected pair switches the matching side off", async () => {
    const [a, b] = [await user(), await user()];
    await friends(a.id, b.id);
    expect(await mayOfferTripTo(prisma, a.id, b.id)).toBe(true);
    // b withdraws the consent a holds into b's account through the OLD control.
    const consent = await prisma.shareConsent.findFirstOrThrow({
      where: { requesterId: a.id, targetId: b.id },
    });
    const { withdrawConsent } = await import("../../sharing/consent");
    await withdrawConsent(b.id, consent.id);
    expect(await mayOfferTripTo(prisma, a.id, b.id)).toBe(false);
    expect(await plansGivenTo(prisma, b.id, a.id)).toBe(false);
  });

  it("a decline through the old control switches the decliner's side off", async () => {
    const [a, b] = [await user(), await user()];
    await friends(a.id, b.id);
    const consent = await prisma.shareConsent.findFirstOrThrow({
      where: { requesterId: a.id, targetId: b.id },
    });
    await prisma.shareConsent.update({ where: { id: consent.id }, data: { status: "pending" } });
    const { decideConsent } = await import("../../sharing/consent");
    await decideConsent(b.id, consent.id, "declined");
    expect(await mayOfferTripTo(prisma, a.id, b.id)).toBe(false);
  });

  it("a connection row alone authorises no plan access: pending, declined and a plans-off row fall through to consent", async () => {
    const [owner, member] = [await user(), await user()];
    const { mayWorkOnPlan } = await import("../authz");
    // Pending row, no consents.
    await requestLocal(owner.id, member.id, DEFAULT_ON);
    expect(await mayWorkOnPlan(prisma, owner.id, member.id)).toBe(false);
    // Active but plans off on one side, consents withdrawn.
    await acceptLocal(member.id, owner.id, { ...DEFAULT_ON, plans: false });
    await prisma.shareConsent.updateMany({
      where: {
        requesterId: { in: [owner.id, member.id] },
        targetId: { in: [owner.id, member.id] },
      },
      data: { status: "withdrawn" },
    });
    expect(await mayWorkOnPlan(prisma, owner.id, member.id)).toBe(false);
    await setLocalSwitches(member.id, owner.id, DEFAULT_ON);
    expect(await mayWorkOnPlan(prisma, owner.id, member.id)).toBe(true);
  });

  it("removing a friend ends a plan membership that never came through both plans switches", async () => {
    const [owner, member] = [await user(), await user()];
    await friends(owner.id, member.id, DEFAULT_ON, { ...DEFAULT_ON, plans: false });
    const trip = await prisma.trip.create({ data: { userId: owner.id, name: "P" } });
    const plan = await prisma.travelPlan.create({
      data: { createRef: randomUUID(), tripId: trip.id, state: {} },
    });
    const m = await prisma.travelPlanMember.create({
      data: {
        planId: plan.id,
        kind: "local",
        userId: member.id,
        displayName: "m",
        status: "active",
      },
    });
    await revokeLocal(owner.id, member.id);
    expect((await prisma.travelPlanMember.findUniqueOrThrow({ where: { id: m.id } })).status).toBe(
      "revoked"
    );
  });
});
