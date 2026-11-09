/**
 * A friend on another server needs federation and a peer that speaks `connections` — not the
 * trip-sharing beta key (spec 2026-11-08 §11.7). Before, a request from a server with the beta
 * key off failed, and a redeemed link fell back to comparison-only although both servers
 * supported connections.
 */
import { B, OFF, pin, servers, user, useTwoServers, type Server } from "./twoServerHarness";

useTwoServers();
let a: Server;
let b: Server;
beforeAll(async () => {
  ({ a, b } = servers);
  for (const s of [a, b])
    await s.prisma.adminSettings.updateMany({
      data: { betaFeaturesEnabled: false, tripFederationEnabled: false },
    });
  await pin(a, b);
  await pin(b, a);
});
afterEach(() => jest.restoreAllMocks());

async function findable(s: Server, name: string) {
  const id = await user(s, name);
  await s.prisma.user.update({ where: { id }, data: { federationFindable: true } });
  const { username } = await s.prisma.user.findUniqueOrThrow({ where: { id } });
  return { id, username };
}

it("a remote friend request needs federation and the connections feature, not the trip-sharing beta key", async () => {
  const anna = await user(a, "Anna");
  const ben = await findable(b, "Ben");
  const asked = await a.connections.requestConnection(anna, {
    origin: B,
    username: ben.username,
    switches: OFF,
  });
  expect(asked.state).toBe("pending_out");
  expect(
    await b.prisma.remoteShareAccount.count({ where: { userId: ben.id, state: "pending_in" } })
  ).toBe(1);
});

it("with trip sharing off the peer names only `connections` in its ping, so nobody tries plans or offers", async () => {
  a.peerFeatures.forgetPeerFeatures();
  expect([...(await a.peerFeatures.peerFeatures(B))]).toEqual(["connections"]);
});

it("a peer without the connections feature is not asked: SHARE_REMOTE_PEER_OUTDATED, the case the link falls back to comparison-only for", async () => {
  jest.spyOn(b.peerFeatures, "servedFeatures").mockReturnValue([]);
  a.peerFeatures.forgetPeerFeatures();
  const anna = await user(a, "Anna3");
  const ben = await findable(b, "Ben3");
  await expect(
    a.connections.requestConnection(anna, { origin: B, username: ben.username, switches: OFF })
  ).rejects.toMatchObject({ code: "SHARE_REMOTE_PEER_OUTDATED" });
  expect(await a.prisma.remoteShareAccount.count({ where: { userId: anna } })).toBe(0);
});
