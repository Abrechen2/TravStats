/**
 * Test helper (not a suite): two TravStats servers in one process (spec 2026-10-20, phases
 * F-S4a–F-S4d), shared by `twoServers.test.ts`, `twoServersCopy.test.ts` and
 * `twoServersPropagation.test.ts`. Server A on the
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
import * as offersModule from "../offers";
import * as offerInboxModule from "../offerInbox";
import * as entriesModule from "../entries";
import * as tripRemoteSharingModule from "../tripRemoteSharing";
import * as outboxModule from "../outbox";
import * as inboundModule from "../inbound";
import * as conflictsModule from "../conflicts";
import * as propagateModule from "../../propagate";
import * as undoModule from "../../undo";
import * as noticesModule from "../../notices";
import * as securityModule from "../../../federation/security";
import * as transportModule from "../transport";
import { resetIdentityCache } from "../../../federation/identity";
import { encryptApiKey } from "../../../../utils/encryption";
import { preparePeerDatabase } from "./peerDatabase";

export const A = "https://a.two-servers.test";
export const B = "https://b.two-servers.test";

/** The parts of one server a test drives. */
export interface Server {
  origin: string;
  prisma: typeof dbModule.prisma;
  claim: typeof claimModule;
  invites: typeof invitesModule;
  offers: typeof offersModule;
  offerInbox: typeof offerInboxModule;
  entries: typeof entriesModule;
  tripRemoteSharing: typeof tripRemoteSharingModule;
  outbox: typeof outboxModule;
  inbound: typeof inboundModule;
  conflicts: typeof conflictsModule;
  propagate: typeof propagateModule;
  undo: typeof undoModule;
  notices: typeof noticesModule;
  security: typeof securityModule;
  transport: typeof transportModule;
  resetIdentity: () => void;
  encrypt: (value: string) => string | null;
  app: express.Express;
}

function peerApp(trip: express.Router, comparison: express.Router): express.Express {
  const app = express();
  app.use(express.json({ limit: "4mb" }));
  app.use("/api/v1/trip-share-peer", trip);
  app.use("/api/v1/comparison-peer", comparison);
  return app;
}

const serverA = (): Server => ({
  origin: A,
  prisma: dbModule.prisma,
  claim: claimModule,
  invites: invitesModule,
  offers: offersModule,
  offerInbox: offerInboxModule,
  entries: entriesModule,
  tripRemoteSharing: tripRemoteSharingModule,
  outbox: outboxModule,
  inbound: inboundModule,
  conflicts: conflictsModule,
  propagate: propagateModule,
  undo: undoModule,
  notices: noticesModule,
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
        offers: require("../offers"),
        offerInbox: require("../offerInbox"),
        entries: require("../entries"),
        tripRemoteSharing: require("../tripRemoteSharing"),
        outbox: require("../outbox"),
        inbound: require("../inbound"),
        conflicts: require("../conflicts"),
        propagate: require("../../propagate"),
        undo: require("../../undo"),
        notices: require("../../notices"),
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

/** Filled in `beforeAll`; read them inside tests and hooks only. */
export const servers = {} as { a: Server; b: Server };
let a: Server;
let b: Server;
let saved: Record<string, unknown> | null = null;
let settingsId: Record<string, number> = {};
const listening: https.Server[] = [];
const ports: Record<string, number> = {};
let certificate: Buffer;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "two-servers-"));
const users: Record<string, string[]> = { [A]: [], [B]: [] };
const offline = new Set<string>();

/** Take a server off the network (its socket refuses connections) or put it back. */
export function setOffline(origin: string, down: boolean): void {
  if (down) offline.add(new URL(origin).hostname);
  else offline.delete(new URL(origin).hostname);
}

async function settingsRow(s: Server): Promise<number> {
  const row = await s.prisma.adminSettings.findFirst({ orderBy: { id: "asc" } });
  return (row ?? (await s.prisma.adminSettings.create({ data: {} }))).id;
}
export async function setSwitch(s: Server, on: boolean) {
  await s.prisma.adminSettings.update({
    where: { id: settingsId[s.origin] },
    data: { tripFederationEnabled: on },
  });
}
export async function pin(
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
export async function user(s: Server, firstName: string): Promise<string> {
  const u = await s.prisma.user.create({
    data: { username: `two-${randomUUID().slice(0, 8)}`, passwordHash: "test-only", firstName },
  });
  users[s.origin].push(u.id);
  return u.id;
}

/** Registers the suite's hooks: two servers up before, everything put back after. */
export function useTwoServers(): void {
  beforeAll(async () => {
    for (const key of ["FEDERATION_ENABLED", "FEDERATION_PUBLIC_ORIGIN", "FEDERATION_KEY_FILE"])
      delete process.env[key];
    const peerUrl = await preparePeerDatabase();
    a = serverA();
    b = serverB(peerUrl);
    servers.a = a;
    servers.b = b;
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
          // Port 1 on loopback refuses the connection: a server that is down.
          port: offline.has(String(options.hostname)) ? 1 : ports[String(options.hostname)],
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
  afterEach(() => {
    offline.clear();
    jest.restoreAllMocks();
  });

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
}
