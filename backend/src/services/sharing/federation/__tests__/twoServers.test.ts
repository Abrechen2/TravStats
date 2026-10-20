/**
 * Two TravStats servers in one process (spec 2026-10-20, phases F-S4a/F-S4b): server A on the
 * run's database, server B on a second one (`peerDatabase.ts`), each with its own identity in
 * its own admin settings and its own pins. B runs its own module graph (`jest.isolateModules`)
 * so its identity cache, settings and routes are its own, with ONE exception: the generated
 * Prisma client is shared, and B gets a second client from it on B's database. Loading the
 * generated client twice in one process breaks its WebAssembly query compiler ("memory access
 * out of bounds" on the first query), so B's graph is handed this one's `prisma`,
 * `prismaClient` and `db` modules — with `db.prisma` pointing at B's database.
 *
 * They talk over real TLS through the production `exchange()` — only the socket's destination
 * and the DNS answer are redirected to the two local servers. No external host is contacted.
 */
import https from "https";
import dnsPromises from "dns/promises";
import express from "express";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { generateKeyPairSync, randomUUID, type KeyObject } from "crypto";
import type { AddressInfo } from "net";
import * as prismaModule from "../../../../prisma";
import * as prismaClientModule from "../../../../prismaClient";
import * as dbModule from "../../../../db";
import tripSharePeerRouter from "../../../../routes/tripSharePeer";
import comparisonPeerRouter from "../../../../routes/comparisonPeer";
import * as claimModule from "../claim";
import * as invitesModule from "../invites";
import * as securityModule from "../../../federation/security";
import * as transportModule from "../transport";
import { resetIdentityCache } from "../../../federation/identity";
import { encryptApiKey } from "../../../../utils/encryption";
import { preparePeerDatabase } from "./peerDatabase";

const A = "https://a.two-servers.test";
const B = "https://b.two-servers.test";

/** The parts of one server a test drives. */
interface Server {
  origin: string;
  prisma: typeof dbModule.prisma;
  claim: typeof claimModule;
  invites: typeof invitesModule;
  security: typeof securityModule;
  transport: typeof transportModule;
  resetIdentity: () => void;
  encrypt: (value: string) => string | null;
  app: express.Express;
}

function peerApp(trip: express.Router, comparison: express.Router): express.Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/v1/trip-share-peer", trip);
  app.use("/api/v1/comparison-peer", comparison);
  return app;
}

const serverA = (): Server => ({
  origin: A,
  prisma: dbModule.prisma,
  claim: claimModule,
  invites: invitesModule,
  security: securityModule,
  transport: transportModule,
  resetIdentity: resetIdentityCache,
  encrypt: encryptApiKey,
  app: peerApp(tripSharePeerRouter, comparisonPeerRouter),
});

function serverB(databaseUrl: string): Server {
  const prisma = prismaClientModule.createPrismaClient({ url: databaseUrl });
  const shared = ["../../../../prisma", "../../../../prismaClient", "../../../../db"];
  let server: Server | undefined;
  try {
    jest.isolateModules(() => {
      jest.doMock("../../../../prisma", () => prismaModule);
      jest.doMock("../../../../prismaClient", () => prismaClientModule);
      jest.doMock("../../../../db", () => ({ ...dbModule, prisma }));
      /* eslint-disable @typescript-eslint/no-require-imports */
      server = {
        origin: B,
        prisma: prisma as unknown as typeof dbModule.prisma,
        claim: require("../claim"),
        invites: require("../invites"),
        security: require("../../../federation/security"),
        transport: require("../transport"),
        resetIdentity: require("../../../federation/identity").resetIdentityCache,
        encrypt: require("../../../../utils/encryption").encryptApiKey,
        app: peerApp(
          require("../../../../routes/tripSharePeer").default,
          require("../../../../routes/comparisonPeer").default
        ),
      };
      /* eslint-enable @typescript-eslint/no-require-imports */
    });
  } finally {
    // The mock factories outlive the isolated registry; nothing after this may read them.
    for (const modulePath of shared) jest.dontMock(modulePath);
  }
  return server!;
}

const KEYS: Record<string, { publicKey: KeyObject; privateKey: KeyObject }> = {
  [A]: generateKeyPairSync("ed25519"),
  [B]: generateKeyPairSync("ed25519"),
};
const pem = (origin: string) =>
  KEYS[origin].publicKey.export({ type: "spki", format: "pem" }).toString();
const SETTINGS = [
  "betaFeaturesEnabled",
  "tripFederationEnabled",
  "federationEnabled",
  "federationOrigin",
  "federationPrivateKey",
] as const;

let a: Server;
let b: Server;
let saved: Record<string, unknown> | null = null;
let settingsId: Record<string, number> = {};
const listening: https.Server[] = [];
const ports: Record<string, number> = {};
let certificate: Buffer;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "two-servers-"));
const users: Record<string, string[]> = { [A]: [], [B]: [] };

async function settingsRow(s: Server): Promise<number> {
  const row = await s.prisma.adminSettings.findFirst({ orderBy: { id: "asc" } });
  return (row ?? (await s.prisma.adminSettings.create({ data: {} }))).id;
}
async function setSwitch(s: Server, on: boolean) {
  await s.prisma.adminSettings.update({
    where: { id: settingsId[s.origin] },
    data: { tripFederationEnabled: on },
  });
}
async function pin(
  on: Server,
  other: Server,
  data: { enabled?: boolean; verifiedAt?: Date | null } = {}
) {
  const row = { publicKey: pem(other.origin), enabled: true, verifiedAt: new Date(), ...data };
  await on.prisma.comparisonPeer.upsert({
    where: { origin: other.origin },
    create: { origin: other.origin, ...row },
    update: row,
  });
}
async function user(s: Server, firstName: string): Promise<string> {
  const u = await s.prisma.user.create({
    data: { username: `two-${randomUUID().slice(0, 8)}`, passwordHash: "test-only", firstName },
  });
  users[s.origin].push(u.id);
  return u.id;
}

beforeAll(async () => {
  for (const key of ["FEDERATION_ENABLED", "FEDERATION_PUBLIC_ORIGIN", "FEDERATION_KEY_FILE"])
    delete process.env[key];
  const peerUrl = await preparePeerDatabase();
  a = serverA();
  b = serverB(peerUrl);
  for (const s of [a, b]) {
    settingsId[s.origin] = await settingsRow(s);
    if (s === a)
      saved = await s.prisma.adminSettings.findUniqueOrThrow({
        where: { id: settingsId[A] },
        select: Object.fromEntries(SETTINGS.map((k) => [k, true])) as never,
      });
    await s.prisma.adminSettings.update({
      where: { id: settingsId[s.origin] },
      data: {
        betaFeaturesEnabled: true,
        tripFederationEnabled: true,
        federationEnabled: true,
        federationOrigin: s.origin,
        federationPrivateKey: s.encrypt(
          KEYS[s.origin].privateKey.export({ type: "pkcs8", format: "pem" }).toString()
        ),
      },
    });
    s.resetIdentity();
  }

  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      `${dir}/tls.key`,
      "-out",
      `${dir}/tls.crt`,
      "-days",
      "1",
      "-subj",
      "/CN=two-servers.test",
      "-addext",
      "subjectAltName=DNS:a.two-servers.test,DNS:b.two-servers.test",
    ],
    { stdio: "ignore" }
  );
  certificate = fs.readFileSync(`${dir}/tls.crt`);
  for (const s of [a, b]) {
    const server = https.createServer(
      { key: fs.readFileSync(`${dir}/tls.key`), cert: certificate },
      s.app
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    ports[new URL(s.origin).hostname] = (server.address() as AddressInfo).port;
    listening.push(server);
  }
}, 300_000);

beforeEach(async () => {
  // A public answer for both names, so the production address check passes as it would.
  jest
    .spyOn(dnsPromises, "lookup")
    .mockResolvedValue([{ address: "11.40.0.2", family: 4 }] as never);
  const actual = https.request.bind(https);
  // Only the physical socket moves: to the local server that plays that origin.
  jest.spyOn(https, "request").mockImplementation(((
    options: https.RequestOptions,
    callback: Parameters<typeof https.request>[1]
  ) =>
    actual(
      {
        ...options,
        port: ports[String(options.hostname)],
        ca: certificate,
        lookup: ((_h: string, _o: object, cb: (e: null, a: string, f: number) => void) =>
          cb(null, "127.0.0.1", 4)) as never,
      },
      callback as never
    )) as typeof https.request);
  for (const [on, other] of [
    [a, b],
    [b, a],
  ] as const)
    await pin(on, other);
  await setSwitch(a, true);
  await setSwitch(b, true);
});
afterEach(() => jest.restoreAllMocks());

afterAll(async () => {
  for (const server of listening)
    await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const s of [a, b]) {
    await s.prisma.user.deleteMany({ where: { id: { in: users[s.origin] } } });
    const other = s === a ? B : A;
    await s.prisma.comparisonPeer.deleteMany({ where: { origin: other } });
  }
  if (saved)
    await a.prisma.adminSettings.update({ where: { id: settingsId[A] }, data: saved as never });
  await b.prisma.adminSettings.update({
    where: { id: settingsId[B] },
    data: { federationEnabled: false, federationOrigin: null, federationPrivateKey: null },
  });
  a.resetIdentity();
  await Promise.all([a.prisma.$disconnect(), b.prisma.$disconnect()]);
  fs.rmSync(dir, { recursive: true, force: true });
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
