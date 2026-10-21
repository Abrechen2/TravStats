/**
 * Two TravStats servers in one process (spec 2026-10-20, phases F-S4a/F-S4b), set up by
 * `twoServerHarness.ts`: pairing by invitation code across them, and the cross-purpose refusals
 * over real TLS.
 */
import https from "https";
import {
  A,
  B,
  pin,
  servers,
  setSwitch,
  user,
  useTwoServers,
  type Server,
} from "./twoServerHarness";

useTwoServers();
let a: Server;
let b: Server;
beforeAll(() => {
  ({ a, b } = servers);
});

const expectRefusal = (promise: Promise<unknown>, code: string, extra?: object) =>
  expect(promise).rejects.toMatchObject({ code, ...(extra ? { extra } : {}) });

describe("invite claimed across two servers", () => {
  it("pairs Anna on A with Ben on B, each server holding its side and both consents", async () => {
    const anna = await user(a, "Anna");
    const ben = await user(b, "Ben");
    const { code } = await a.invites.createTripInvite(anna);
    const person = await b.claim.claimTripInvite(ben, code);
    expect(person).toMatchObject({ origin: A, displayName: "Anna", consent: "accepted" });

    const onA = await a.prisma.remoteShareAccount.findFirstOrThrow({
      where: { userId: anna, origin: B },
      include: { consentsTargeted: true },
    });
    const onB = await b.prisma.remoteShareAccount.findFirstOrThrow({
      where: { userId: ben, origin: A },
      include: { consentsRequested: true },
    });
    expect(onA).toMatchObject({
      displayName: "Ben",
      channel: onB.localChannel,
      localChannel: onB.channel,
    });
    expect(onA.consentsTargeted).toEqual([
      expect.objectContaining({ requesterId: anna, status: "accepted" }),
    ]);
    expect(onB.consentsRequested).toEqual([
      expect.objectContaining({ targetId: ben, status: "accepted" }),
    ]);
    // A remote account is never a user row on the other side.
    expect(await a.prisma.user.count({ where: { id: { in: [onA.id, onA.channel] } } })).toBe(0);
  });

  it("is single use across servers: a second claim of the same code reads as used", async () => {
    const anna = await user(a, "Anna");
    const { code } = await a.invites.createTripInvite(anna);
    await b.claim.claimTripInvite(await user(b, "Ben"), code);
    await expectRefusal(
      b.claim.claimTripInvite(await user(b, "Cleo"), code),
      "SHARE_REMOTE_INVITE_USED"
    );
  });

  it("reports an expired code as expired", async () => {
    const anna = await user(a, "Anna");
    const { id, code } = await a.invites.createTripInvite(anna);
    await a.prisma.tripShareInvite.update({
      where: { id },
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    await expectRefusal(
      b.claim.claimTripInvite(await user(b, "Ben"), code),
      "SHARE_REMOTE_INVITE_EXPIRED"
    );
  });

  it("names A when B's admin has not admitted it, and sends nothing", async () => {
    await b.prisma.comparisonPeer.delete({ where: { origin: A } });
    const { code } = await a.invites.createTripInvite(await user(a, "Anna"));
    const request = jest.mocked(https.request);
    await expectRefusal(
      b.claim.claimTripInvite(await user(b, "Ben"), code),
      "SHARE_REMOTE_PEER_NOT_ADMITTED",
      {
        origin: A,
      }
    );
    expect(request).not.toHaveBeenCalled();
  });

  it("reads A's switched-off route as off there, and keeps the code unspent", async () => {
    const { id, code } = await a.invites.createTripInvite(await user(a, "Anna"));
    await setSwitch(a, false);
    await expectRefusal(
      b.claim.claimTripInvite(await user(b, "Ben"), code),
      "SHARE_REMOTE_PEER_DISABLED",
      {
        origin: A,
      }
    );
    expect((await a.prisma.tripShareInvite.findUniqueOrThrow({ where: { id } })).usedAt).toBeNull();
  });

  it("is unreachable when A has suspended B, and A spends nothing", async () => {
    const { id, code } = await a.invites.createTripInvite(await user(a, "Anna"));
    await pin(a, b, { enabled: false });
    await expectRefusal(
      b.claim.claimTripInvite(await user(b, "Ben"), code),
      "SHARE_REMOTE_UNREACHABLE",
      {
        origin: A,
      }
    );
    expect((await a.prisma.tripShareInvite.findUniqueOrThrow({ where: { id } })).usedAt).toBeNull();
  });
});

describe("cross-purpose over the wire", () => {
  const ping = () => ({ kind: "ping" as const, ...b.transport.messageHeader() });

  it("trip-share messages reach A's trip route and read its versions", async () => {
    await expect(b.transport.tripShareExchange(A, ping())).resolves.toEqual({ tripShare: [1] });
  });

  it("A's trip route refuses a comparison-signed packet", async () => {
    const asComparison = { ...b.security.COMPARISON_TRANSPORT, path: "/api/v1/trip-share-peer" };
    await expect(b.security.exchange(A, { action: "ping" }, asComparison)).rejects.toMatchObject({
      kind: "remote-refused",
    });
  });

  it("A's comparison route refuses a trip-share-signed packet", async () => {
    const asTrip = { ...b.transport.TRIP_SHARE_TRANSPORT, path: "/api/v1/comparison-peer" };
    await expect(b.security.exchange(A, { action: "ping" }, asTrip)).rejects.toMatchObject({
      kind: "remote-refused",
    });
  });

  it("the comparison ping between the same two servers still works", async () => {
    await expect(b.security.exchange(A, { action: "ping" })).resolves.toMatchObject({
      ready: true,
    });
  });

  it("B reading a comparison reply as trip-share refuses it as wrong-purpose", async () => {
    // A's comparison route answers in version 1; a trip-share reader must not take it.
    const readsTrip = {
      ...b.security.COMPARISON_TRANSPORT,
      accepts: b.transport.TRIP_SHARE_TRANSPORT.accepts,
    };
    await expect(b.security.exchange(A, { action: "ping" }, readsTrip)).rejects.toMatchObject({
      kind: "wrong-purpose",
    });
  });
});
