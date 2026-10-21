/**
 * The inviting side (spec 2026-10-20 F1, phase F-S4b): a code is single use, expires after 72 h,
 * is bound to the user who issued it, and a restore consumes every open one (§8).
 */
import { randomUUID } from "crypto";
import { prisma } from "../../../../db";
import logger from "../../../../utils/logger";
import { hash } from "../../../federation/refusal";
import type { InviteClaim } from "../../../../schemas/tripSharePeer";
import {
  INVITE_TTL_MS,
  OPEN_INVITE_LIMIT,
  createTripInvite,
  listTripInvites,
  revokeTripInvite,
  serveInviteClaim,
} from "../invites";
import { parseTripInviteCode } from "../inviteCode";
import { suspendTripFederationAfterRestore } from "../restore";
import { withTripFederation } from "./federationEnv";

const ME = "https://me.trip-invites.test";
const PEER = "https://peer.trip-invites.test";
const users: string[] = [];
let restoreEnv: () => Promise<void>;
let info: jest.SpyInstance;

async function user(prefix = "inv", extra: { firstName?: string; isActive?: boolean } = {}) {
  const u = await prisma.user.create({
    data: {
      username: `${prefix}-${randomUUID().slice(0, 8)}`,
      passwordHash: "test-only",
      ...extra,
    },
  });
  users.push(u.id);
  return u;
}
const secretOf = (code: string) => {
  const parsed = parseTripInviteCode(code);
  if (!parsed.ok) throw new Error("not a code");
  return parsed.secret;
};
const claim = (code: string, over: Partial<InviteClaim> = {}): InviteClaim => ({
  kind: "invite-claim",
  messageId: randomUUID(),
  sentAt: new Date().toISOString(),
  code: secretOf(code),
  channel: randomUUID(),
  username: "ben",
  displayName: "Ben B",
  ...over,
});

beforeAll(async () => {
  restoreEnv = await withTripFederation(ME);
});
beforeEach(() => {
  info = jest.spyOn(logger, "info").mockImplementation(() => undefined as never);
});
afterEach(() => info.mockRestore());
afterAll(async () => {
  await prisma.remoteShareAccount.deleteMany({ where: { userId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await restoreEnv();
  await prisma.$disconnect();
});

describe("issuing", () => {
  it("shows the code once and keeps only its hash, bound to the issuer", async () => {
    const anna = await user();
    const created = await createTripInvite(anna.id);
    expect(created.code.startsWith(`${ME}#trip:`)).toBe(true);
    const row = await prisma.tripShareInvite.findUniqueOrThrow({ where: { id: created.id } });
    expect(row).toMatchObject({
      userId: anna.id,
      hash: hash(secretOf(created.code)),
      usedAt: null,
    });
    expect(JSON.stringify(row)).not.toContain(secretOf(created.code));
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBeCloseTo(INVITE_TTL_MS, -4);
    expect(await listTripInvites(anna.id)).toEqual([
      {
        id: created.id,
        createdAt: created.createdAt,
        expiresAt: created.expiresAt,
        tripId: null,
      },
    ]);
  });

  it("lists and revokes only the caller's own codes", async () => {
    const anna = await user();
    const carl = await user();
    const created = await createTripInvite(anna.id);
    expect(await listTripInvites(carl.id)).toEqual([]);
    await expect(revokeTripInvite(carl.id, created.id)).rejects.toMatchObject({
      statusCode: 404,
      code: "SHARE_REMOTE_INVITE_NOT_FOUND",
    });
    await revokeTripInvite(anna.id, created.id);
    expect(await listTripInvites(anna.id)).toEqual([]);
    expect((await serveInviteClaim(PEER, claim(created.code))).accepted).toBe(false);
  });

  it(`refuses a code beyond ${OPEN_INVITE_LIMIT} open ones`, async () => {
    const anna = await user();
    await prisma.tripShareInvite.createMany({
      data: Array.from({ length: OPEN_INVITE_LIMIT }, () => ({
        hash: hash(randomUUID()),
        userId: anna.id,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      })),
    });
    await expect(createTripInvite(anna.id)).rejects.toMatchObject({
      statusCode: 429,
      code: "SHARE_REMOTE_INVITE_LIMIT",
    });
  });
});

describe("redeeming (invite-claim)", () => {
  it("pairs exactly the issuer with the claimant, both consents given", async () => {
    const anna = await user("anna", { firstName: "Anna" });
    const { code } = await createTripInvite(anna.id);
    const body = claim(code);
    const reply = await serveInviteClaim(PEER, body);
    expect(reply).toMatchObject({
      kind: "invite-claim-reply",
      accepted: true,
      username: anna.username,
      displayName: "Anna",
      federatedRef: null,
    });
    if (!reply.accepted) throw new Error("refused");
    const remote = await prisma.remoteShareAccount.findUniqueOrThrow({
      where: { origin_channel: { origin: PEER, channel: body.channel } },
      include: { consentsTargeted: true },
    });
    expect(remote).toMatchObject({
      userId: anna.id,
      localChannel: reply.channel,
      username: "ben",
      displayName: "Ben B",
    });
    expect(remote.consentsTargeted).toEqual([
      expect.objectContaining({ requesterId: anna.id, status: "accepted", targetId: null }),
    ]);
    // Neither channel is an id of anything on this server.
    expect(reply.channel).not.toBe(anna.id);
    expect(reply.channel).not.toBe(remote.id);
  });

  it("is single use: a second claim reads `used` and pairs nobody", async () => {
    const anna = await user();
    const { code } = await createTripInvite(anna.id);
    expect((await serveInviteClaim(PEER, claim(code))).accepted).toBe(true);
    const again = await serveInviteClaim(PEER, claim(code, { username: "eve" }));
    expect(again).toEqual({ kind: "invite-claim-reply", accepted: false, reason: "used" });
    expect(await prisma.remoteShareAccount.count({ where: { userId: anna.id } })).toBe(1);
  });

  it("lets only one of two racing claims win", async () => {
    const anna = await user();
    const { code } = await createTripInvite(anna.id);
    const replies = await Promise.all([
      serveInviteClaim(PEER, claim(code, { username: "ben" })),
      serveInviteClaim(PEER, claim(code, { username: "eve" })),
    ]);
    expect(replies.filter((r) => r.accepted)).toHaveLength(1);
    expect(await prisma.remoteShareAccount.count({ where: { userId: anna.id } })).toBe(1);
  });

  it("reads an expired code as `expired`", async () => {
    const anna = await user();
    const { id, code } = await createTripInvite(anna.id);
    await prisma.tripShareInvite.update({
      where: { id },
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    expect(await serveInviteClaim(PEER, claim(code))).toEqual({
      kind: "invite-claim-reply",
      accepted: false,
      reason: "expired",
    });
    expect(await listTripInvites(anna.id)).toEqual([]);
  });

  it("reads an unknown code, and one of a deactivated issuer, as `unknown`", async () => {
    expect(await serveInviteClaim(PEER, claim(`${ME}#trip:${"0".repeat(64)}`))).toMatchObject({
      accepted: false,
      reason: "unknown",
    });
    const gone = await user();
    const { code } = await createTripInvite(gone.id);
    await prisma.user.update({ where: { id: gone.id }, data: { isActive: false } });
    expect(await serveInviteClaim(PEER, claim(code))).toMatchObject({
      accepted: false,
      reason: "unknown",
    });
  });

  it("refuses a second pairing with the same person without spending the code", async () => {
    const anna = await user();
    const first = await createTripInvite(anna.id);
    await serveInviteClaim(PEER, claim(first.code));
    const second = await createTripInvite(anna.id);
    expect(await serveInviteClaim(PEER, claim(second.code))).toMatchObject({ reason: "duplicate" });
    const row = await prisma.tripShareInvite.findUniqueOrThrow({ where: { id: second.id } });
    expect(row.usedAt).toBeNull();
  });

  it("refuses a claimant channel that server already used for another pairing", async () => {
    const anna = await user();
    const carl = await user();
    const channel = randomUUID();
    await serveInviteClaim(PEER, claim((await createTripInvite(anna.id)).code, { channel }));
    const { id, code } = await createTripInvite(carl.id);
    await expect(serveInviteClaim(PEER, claim(code, { channel }))).rejects.toMatchObject({
      kind: "malformed",
    });
    expect((await prisma.tripShareInvite.findUniqueOrThrow({ where: { id } })).usedAt).toBeNull();
  });
});

describe("after a restore", () => {
  it("consumes every open code and turns remote consents back into a question", async () => {
    const anna = await user();
    const bea = await user();
    const open = await createTripInvite(anna.id);
    await serveInviteClaim(PEER, claim((await createTripInvite(anna.id)).code));
    const local = await prisma.shareConsent.create({
      data: { requesterId: anna.id, targetId: bea.id, status: "accepted", decidedAt: new Date() },
    });

    await suspendTripFederationAfterRestore();

    expect(await serveInviteClaim(PEER, claim(open.code, { username: "zoe" }))).toMatchObject({
      accepted: false,
      reason: "used",
    });
    expect(await listTripInvites(anna.id)).toEqual([]);
    const remote = await prisma.shareConsent.findFirstOrThrow({
      where: { requesterId: anna.id, remoteTargetId: { not: null } },
    });
    expect(remote).toMatchObject({ status: "pending", decidedAt: null });
    // A consent between two accounts on this server is not the restore's business.
    expect(await prisma.shareConsent.findUniqueOrThrow({ where: { id: local.id } })).toMatchObject({
      status: "accepted",
    });
  });
});
