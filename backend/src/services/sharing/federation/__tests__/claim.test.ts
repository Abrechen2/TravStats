/**
 * The claiming side (spec 2026-10-20 F1, §7, phase F-S4b): every way a claim fails reaches the
 * user as itself — its own code, and the other server's origin where the sentence names it.
 * The other server is a mock here; `twoServers.test.ts` runs the same claim against a real one.
 */
import { randomUUID } from "crypto";
import { prisma } from "../../../../db";
import logger from "../../../../utils/logger";
import { refused } from "../../../federation/refusal";
import { claimTripInvite } from "../claim";
import { tripShareExchange } from "../transport";
import { setTripFlags } from "./instanceFlags";
import { withTripFederation } from "./federationEnv";

jest.mock("../transport", () => ({
  ...jest.requireActual("../transport"),
  tripShareExchange: jest.fn(),
}));

const ME = "https://me.trip-claim.test";
const PEER = "https://peer.trip-claim.test";
const STRANGER = "https://stranger.trip-claim.test";
const code = (origin = PEER) => `${origin}#trip:${"cd".repeat(32)}`;
const pong = { tripShare: [1] };
const accepted = (channel = randomUUID()) => ({
  kind: "invite-claim-reply",
  accepted: true,
  channel,
  username: "anna",
  displayName: "Anna A",
  federatedRef: null,
});
const users: string[] = [];
let restoreEnv: () => Promise<void>;
let ben: string;
let info: jest.SpyInstance;
const exchange = jest.mocked(tripShareExchange);

beforeAll(async () => {
  restoreEnv = await withTripFederation(ME);
  ben = (
    await prisma.user.create({
      data: {
        username: `claim-${randomUUID().slice(0, 8)}`,
        passwordHash: "test-only",
        firstName: "Ben",
      },
    })
  ).id;
  users.push(ben);
  await prisma.comparisonPeer.upsert({
    where: { origin: PEER },
    create: { origin: PEER, publicKey: "unused", enabled: true, verifiedAt: new Date() },
    update: { enabled: true, verifiedAt: new Date() },
  });
});
beforeEach(async () => {
  exchange.mockReset();
  info = jest.spyOn(logger, "info").mockImplementation(() => undefined as never);
  await prisma.remoteShareAccount.deleteMany({ where: { userId: ben } });
  await prisma.comparisonPeer.update({
    where: { origin: PEER },
    data: { enabled: true, verifiedAt: new Date() },
  });
});
afterEach(() => info.mockRestore());
afterAll(async () => {
  await prisma.comparisonPeer.deleteMany({ where: { origin: { endsWith: ".trip-claim.test" } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await restoreEnv();
  await prisma.$disconnect();
});

const fails = (code_: string, status: number, extra?: Record<string, string>) =>
  expect(claimTripInvite(ben, code_)).rejects.toMatchObject({
    statusCode: status,
    ...(extra ? { extra } : {}),
  });

it("records the pairing and the claimant's own yes once the other server accepts", async () => {
  const channel = randomUUID();
  exchange.mockResolvedValueOnce(pong).mockResolvedValueOnce(accepted(channel));
  const person = await claimTripInvite(ben, ` ${code()} `);
  expect(person).toMatchObject({
    origin: PEER,
    username: "anna",
    displayName: "Anna A",
    consent: "accepted",
  });
  const [ping, sent] = exchange.mock.calls.map(([origin, body]) => ({ origin, body }));
  expect(ping).toMatchObject({ origin: PEER, body: { kind: "ping" } });
  expect(sent.body).toMatchObject({
    kind: "invite-claim",
    code: "cd".repeat(32),
    displayName: "Ben",
  });
  const row = await prisma.remoteShareAccount.findUniqueOrThrow({
    where: { id: person.id },
    include: { consentsRequested: true },
  });
  expect(row).toMatchObject({
    userId: ben,
    channel,
    localChannel: (sent.body as { channel: string }).channel,
  });
  expect(row.consentsRequested).toEqual([
    expect.objectContaining({ targetId: ben, status: "accepted", requesterId: null }),
  ]);
});

it("names a leaderboard code as the wrong kind and asks nobody", async () => {
  await expect(claimTripInvite(ben, `${PEER}#${"cd".repeat(32)}`)).rejects.toMatchObject({
    statusCode: 400,
    code: "SHARE_REMOTE_INVITE_WRONG_TAG",
  });
  expect(exchange).not.toHaveBeenCalled();
});

it("refuses a code of this server itself", async () => {
  await expect(claimTripInvite(ben, code(ME))).rejects.toMatchObject({
    code: "SHARE_REMOTE_INVITE_OWN_SERVER",
  });
});

it.each([
  ["not pinned at all", async () => undefined],
  [
    "pinned but suspended",
    async () => prisma.comparisonPeer.update({ where: { origin: PEER }, data: { enabled: false } }),
  ],
  [
    "pinned but never verified",
    async () =>
      prisma.comparisonPeer.update({ where: { origin: PEER }, data: { verifiedAt: null } }),
  ],
])("names the origin of a server that is %s and asks nobody", async (name, setup) => {
  await setup();
  const origin = name === "not pinned at all" ? STRANGER : PEER;
  await expect(claimTripInvite(ben, code(origin))).rejects.toMatchObject({
    statusCode: 403,
    code: "SHARE_REMOTE_PEER_NOT_ADMITTED",
    extra: { origin },
  });
  expect(exchange).not.toHaveBeenCalled();
});

it("tells a server with the feature off (404) from one that does not answer", async () => {
  exchange.mockRejectedValueOnce(refused("remote-absent"));
  await expect(claimTripInvite(ben, code())).rejects.toMatchObject({
    statusCode: 409,
    code: "SHARE_REMOTE_PEER_DISABLED",
    extra: { origin: PEER },
  });
  exchange.mockRejectedValueOnce(refused("unreachable"));
  await expect(claimTripInvite(ben, code())).rejects.toMatchObject({
    statusCode: 502,
    code: "SHARE_REMOTE_UNREACHABLE",
    extra: { origin: PEER },
  });
});

it("refuses a server that serves no version this one reads, before sending the code", async () => {
  exchange.mockResolvedValueOnce({ tripShare: [2] });
  await expect(claimTripInvite(ben, code())).rejects.toMatchObject({
    code: "SHARE_REMOTE_PEER_OUTDATED",
  });
  expect(exchange).toHaveBeenCalledTimes(1);
});

it.each([
  ["unknown", "SHARE_REMOTE_INVITE_INVALID", 400],
  ["used", "SHARE_REMOTE_INVITE_USED", 400],
  ["expired", "SHARE_REMOTE_INVITE_EXPIRED", 400],
  ["duplicate", "SHARE_REMOTE_DUPLICATE", 409],
])("reports a code the other server read as `%s` as %s", async (reason, errorCode, status) => {
  exchange
    .mockResolvedValueOnce(pong)
    .mockResolvedValueOnce({ kind: "invite-claim-reply", accepted: false, reason });
  await expect(claimTripInvite(ben, code())).rejects.toMatchObject({
    statusCode: status,
    code: errorCode,
  });
  expect(await prisma.remoteShareAccount.count({ where: { userId: ben } })).toBe(0);
});

describe("a code redeemed here before, answered `used` (a retry)", () => {
  const used = { kind: "invite-claim-reply", accepted: false, reason: "used" };

  it("is reported as already connected, with the pairing it made", async () => {
    exchange.mockResolvedValueOnce(pong).mockResolvedValueOnce(accepted());
    const first = await claimTripInvite(ben, code());
    exchange.mockResolvedValueOnce(pong).mockResolvedValueOnce(used);
    await expect(claimTripInvite(ben, code())).resolves.toMatchObject({
      id: first.id,
      origin: PEER,
      alreadyConnected: true,
    });
    expect(await prisma.remoteShareAccount.count({ where: { userId: ben } })).toBe(1);
  });

  it("stays `used` for a different code, even with that server paired", async () => {
    exchange.mockResolvedValueOnce(pong).mockResolvedValueOnce(accepted());
    await claimTripInvite(ben, code());
    exchange.mockResolvedValueOnce(pong).mockResolvedValueOnce(used);
    await expect(claimTripInvite(ben, `${PEER}#trip:${"ef".repeat(32)}`)).rejects.toMatchObject({
      code: "SHARE_REMOTE_INVITE_USED",
    });
  });

  it("stays `used` for another account that redeemed nothing", async () => {
    exchange.mockResolvedValueOnce(pong).mockResolvedValueOnce(accepted());
    await claimTripInvite(ben, code());
    const cara = (
      await prisma.user.create({
        data: {
          username: `claim-${randomUUID().slice(0, 8)}`,
          passwordHash: "test-only",
          firstName: "Cara",
        },
      })
    ).id;
    users.push(cara);
    exchange.mockResolvedValueOnce(pong).mockResolvedValueOnce(used);
    await expect(claimTripInvite(cara, code())).rejects.toMatchObject({
      code: "SHARE_REMOTE_INVITE_USED",
    });
  });
});

it("stores nothing from a reply that does not parse", async () => {
  exchange.mockResolvedValueOnce(pong).mockResolvedValueOnce({ ...accepted(), userId: "victim" });
  await expect(claimTripInvite(ben, code())).rejects.toMatchObject({
    code: "SHARE_REMOTE_UNREACHABLE",
  });
  expect(await prisma.remoteShareAccount.count({ where: { userId: ben } })).toBe(0);
});

it("refuses an answer whose channel already names another pairing", async () => {
  const channel = randomUUID();
  exchange.mockResolvedValueOnce(pong).mockResolvedValueOnce(accepted(channel));
  await claimTripInvite(ben, code());
  exchange.mockResolvedValueOnce(pong).mockResolvedValueOnce(accepted(channel));
  await expect(claimTripInvite(ben, code())).rejects.toMatchObject({
    code: "SHARE_REMOTE_UNREACHABLE",
  });
  expect(await prisma.remoteShareAccount.count({ where: { userId: ben } })).toBe(1);
});

it("refuses everything with SHARE_REMOTE_DISABLED while the switch is off", async () => {
  const before = await setTripFlags({ tripFederationEnabled: false });
  try {
    await expect(claimTripInvite(ben, code())).rejects.toMatchObject({
      statusCode: 404,
      code: "SHARE_REMOTE_DISABLED",
    });
    expect(exchange).not.toHaveBeenCalled();
  } finally {
    await setTripFlags(before);
  }
});
