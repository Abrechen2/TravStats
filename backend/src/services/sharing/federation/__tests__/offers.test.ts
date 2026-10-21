/**
 * Offering a trip across servers, on one server (spec 2026-10-20 F-S4c): every reason an offer
 * cannot be made is refused by name before anything leaves; a trip page's invitation carries its
 * offer in the claim reply; who receives a member's changes on other servers follows the same
 * consent rule as locally (`receivingRemotes`); a restore suspends every membership.
 */
import { randomUUID } from "crypto";
import { prisma } from "../../../../db";
import type { InviteClaim } from "../../../../schemas/tripSharePeer";
import { receivingRemotes } from "../../members";
import { createTripInvite, serveInviteClaim } from "../invites";
import { parseTripInviteCode } from "../inviteCode";
import { buildOfferBody } from "../offerBuild";
import { offerTrip } from "../offers";
import { suspendTripFederationAfterRestore } from "../restore";
import { withTripFederation } from "./federationEnv";

const ME = "https://me.trip-offers.test";
const PEER = "https://peer.trip-offers.test";
const users: string[] = [];
let restoreEnv: () => Promise<void>;
const startedAt = new Date();

beforeAll(async () => {
  restoreEnv = await withTripFederation(ME);
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  // Groups this suite made and left without a trip (a group outlives its creator, SetNull).
  await prisma.tripShareGroup.deleteMany({
    where: { createdAt: { gte: startedAt }, trips: { none: {} }, createdById: null },
  });
  await restoreEnv();
  await prisma.$disconnect();
});

async function user(name = "Anna") {
  const u = await prisma.user.create({
    data: { username: `off-${randomUUID().slice(0, 8)}`, passwordHash: "x", firstName: name },
  });
  users.push(u.id);
  return u.id;
}

/** A pairing of `userId` with someone on PEER, with its consent in `status`. */
async function pairing(userId: string, status = "accepted") {
  const remote = await prisma.remoteShareAccount.create({
    data: {
      userId,
      origin: PEER,
      channel: randomUUID(),
      localChannel: randomUUID(),
      username: "ben",
      displayName: "Ben",
    },
  });
  await prisma.shareConsent.create({
    data: { requesterId: userId, remoteTargetId: remote.id, status },
  });
  return remote;
}

const trip = (userId: string, extra: object = {}) =>
  prisma.trip.create({ data: { userId, name: "Lissabon", ...extra } });

describe("an offer that cannot be made is refused by name, before anything is sent", () => {
  it("someone else's pairing is not found", async () => {
    const anna = await user();
    const other = await pairing(await user("Eve"));
    await expect(offerTrip(anna, (await trip(anna)).id, other.id)).rejects.toMatchObject({
      code: "SHARE_REMOTE_PERSON_NOT_FOUND",
    });
  });

  it("a pairing whose consent was withdrawn names the server", async () => {
    const anna = await user();
    const remote = await pairing(anna, "withdrawn");
    await expect(offerTrip(anna, (await trip(anna)).id, remote.id)).rejects.toMatchObject({
      code: "SHARE_REMOTE_CONSENT_MISSING",
      extra: { origin: PEER },
    });
  });

  it("a trip that came from another server is offered on from there", async () => {
    const anna = await user();
    const remote = await pairing(anna);
    const group = await prisma.tripShareGroup.create({
      data: { homeOrigin: PEER, federatedRef: randomUUID() },
    });
    const received = await trip(anna, { shareGroupId: group.id });
    await expect(offerTrip(anna, received.id, remote.id)).rejects.toMatchObject({
      code: "SHARE_REMOTE_NOT_HOME",
      extra: { origin: PEER },
    });
  });

  it("a person already on the trip is not offered it again", async () => {
    const anna = await user();
    const remote = await pairing(anna);
    const group = await prisma.tripShareGroup.create({ data: { federatedRef: randomUUID() } });
    const t = await trip(anna, { shareGroupId: group.id });
    await prisma.tripShareRemoteMember.create({
      data: { groupId: group.id, remoteId: remote.id, state: "active" },
    });
    await expect(offerTrip(anna, t.id, remote.id)).rejects.toMatchObject({
      code: "SHARE_REMOTE_ALREADY_MEMBER",
    });
  });

  it("a trip of more than 500 entries is too large to offer", async () => {
    const anna = await user();
    const t = await trip(anna);
    await prisma.flight.createMany({
      data: Array.from({ length: 501 }, () => ({
        userId: anna,
        tripId: t.id,
        depLat: 1,
        depLon: 1,
        arrLat: 2,
        arrLon: 2,
      })),
    });
    const group = await prisma.tripShareGroup.create({ data: { federatedRef: randomUUID() } });
    await expect(
      prisma.$transaction(
        (tx) =>
          buildOfferBody(
            tx,
            ME,
            anna,
            t,
            { id: group.id, federatedRef: group.federatedRef! },
            { rosterRef: randomUUID() }
          ),
        { timeout: 60_000 }
      )
    ).rejects.toMatchObject({ code: "SHARE_REMOTE_TRIP_TOO_LARGE" });
    await prisma.tripShareGroup.delete({ where: { id: group.id } });
  });
});

describe("a trip page's invitation", () => {
  const claim = (code: string): InviteClaim => {
    const parsed = parseTripInviteCode(code);
    if (!parsed.ok) throw new Error("not a code");
    return {
      kind: "invite-claim",
      messageId: randomUUID(),
      sentAt: new Date().toISOString(),
      code: parsed.secret,
      channel: randomUUID(),
      username: "cleo",
      displayName: "Cleo",
    };
  };

  it("answers the claim with the trip's offer and records Cleo as invited", async () => {
    const anna = await user();
    const t = await trip(anna, { startDay: new Date("2030-06-01") });
    await prisma.flight.create({
      data: { userId: anna, tripId: t.id, depLat: 1, depLon: 1, arrLat: 2, arrLon: 2 },
    });
    const { code } = await createTripInvite(anna, t.id);
    const body = claim(code);
    const reply = await serveInviteClaim(PEER, body, ME);
    if (!reply.accepted) throw new Error("refused");
    expect(reply.offer).toMatchObject({
      kind: "offer",
      seq: 1,
      to: body.channel,
      from: reply.channel,
      trip: { name: "Lissabon", startDay: "2030-06-01" },
      roster: [{ displayName: "Anna", origin: ME }],
      counts: { flights: 1, cruises: 0 },
    });
    expect(reply.federatedRef).toBe(reply.offer?.groupRef);
    const group = await prisma.tripShareGroup.findFirstOrThrow({
      where: { federatedRef: reply.federatedRef as string, homeOrigin: null },
      include: { remoteMembers: true, trips: true },
    });
    expect(group.trips.map((x) => x.id)).toEqual([t.id]);
    expect(group.remoteMembers).toEqual([expect.objectContaining({ state: "invited" })]);
  });

  it("a person-level invitation answers without an offer", async () => {
    const anna = await user();
    const reply = await serveInviteClaim(PEER, claim((await createTripInvite(anna)).code), ME);
    expect(reply).toMatchObject({ accepted: true, federatedRef: null, offer: null });
  });
});

describe("receivingRemotes — who on other servers receives a member's changes", () => {
  it("only active members, through the member's own pairing, with an accepted consent", async () => {
    const anna = await user();
    const carl = await user("Carl");
    const group = await prisma.tripShareGroup.create({ data: { federatedRef: randomUUID() } });
    const member = async (userId: string, state: string, consent = "accepted") => {
      const remote = await pairing(userId, consent);
      return prisma.tripShareRemoteMember.create({
        data: { groupId: group.id, remoteId: remote.id, state },
      });
    };
    const ben = await member(anna, "active");
    await member(anna, "invited");
    await member(anna, "active", "withdrawn");
    await member(carl, "active");
    expect((await receivingRemotes(prisma, group.id, anna)).map((r) => r.id)).toEqual([ben.id]);
    await prisma.tripShareOutbox.create({
      data: {
        groupId: group.id,
        memberId: ben.id,
        peerOrigin: PEER,
        kind: "entry-removed",
        payload: {},
      },
    });

    await suspendTripFederationAfterRestore();
    expect(await receivingRemotes(prisma, group.id, anna)).toEqual([]);
    expect(await receivingRemotes(prisma, group.id, anna, { queueable: true })).toEqual([]);
    // A restored clone sends nothing the server it was copied from had queued (F-S4d).
    expect(await prisma.tripShareOutbox.count({ where: { groupId: group.id } })).toBe(0);
    expect(
      await prisma.tripShareRemoteMember.findUniqueOrThrow({ where: { id: ben.id } })
    ).toMatchObject({ state: "suspended", stateReason: "restore" });
  });
});
