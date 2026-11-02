/** FEDERATION_PRIVATE_PEERS: two servers on one LAN may federate when the operator opts in. */
import http from "http";
import { generateKeyPairSync, sign } from "crypto";
import { lookup } from "dns/promises";
import { exchange, PeerRefusal } from "../security";
import { prisma } from "../../../db";
import { encryptApiKey } from "../../../utils/encryption";
import { loadIdentity, resetIdentityCache } from "../identity";
import {
  peerAddressAllowed,
  peerOriginAcceptable,
  listedPrivateAddress,
} from "../peerAddressPolicy";
import { httpsOriginSchema, peerPinSchema } from "../../../schemas/federationAdmin";
import { buildServerQrPayload, readServerQrPayload } from "../connectionFile";
import { hash } from "../refusal";
import { signedEnvelope } from "../envelope";

jest.mock("../../../db", () => ({
  prisma: { comparisonPeer: { findUnique: jest.fn() }, adminSettings: { findFirst: jest.fn() } },
}));
jest.mock("dns/promises", () => ({ lookup: jest.fn() }));

const ENV = "FEDERATION_PRIVATE_PEERS";
const LAN = "http://192.168.178.187:3010";
const local = generateKeyPairSync("ed25519");
const remote = generateKeyPairSync("ed25519");
const remotePem = remote.publicKey.export({ type: "spki", format: "pem" }).toString();
let server: http.Server;
let seen: { host?: string; preauth?: string }[] = [];
let port = 0;

function setIdentity(origin: string) {
  jest.mocked(prisma.adminSettings.findFirst).mockResolvedValue({
    federationEnabled: true,
    federationOrigin: origin,
    federationPrivateKey: encryptApiKey(
      local.privateKey.export({ type: "pkcs8", format: "pem" }).toString()
    ),
  } as never);
  resetIdentityCache();
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let input = "";
    req.on("data", (b) => (input += b));
    req.on("end", () => {
      seen.push({
        host: req.headers.host,
        preauth: String(req.headers["x-travstats-peer-preauth"]),
      });
      const received = JSON.parse(input);
      const unsigned = {
        origin: received.destination,
        destination: received.origin,
        nonce: received.nonce,
        time: Date.now(),
        body: JSON.stringify({ ready: true }),
      };
      res.end(
        JSON.stringify({
          ...unsigned,
          signature: sign(null, Buffer.from(JSON.stringify(unsigned)), remote.privateKey).toString(
            "base64"
          ),
        })
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as { port: number }).port;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  delete process.env[ENV];
  seen = [];
  jest.mocked(lookup).mockReset();
  setIdentity("https://local.federation.test");
  jest.mocked(prisma.comparisonPeer.findUnique).mockResolvedValue({
    enabled: true,
    verifiedAt: new Date(),
    publicKey: remotePem,
  } as never);
});
afterEach(() => {
  jest.restoreAllMocks();
  delete process.env[ENV];
});

/** Sends the real (http) request to the local test server whatever address was pinned. */
function redirectHttp() {
  const actual = http.request.bind(http);
  const options: http.RequestOptions[] = [];
  jest.spyOn(http, "request").mockImplementation(((o: http.RequestOptions, cb: never) => {
    options.push(o);
    return actual({ ...o, port, lookup: undefined, hostname: "127.0.0.1", family: 4 }, cb);
  }) as never);
  return options;
}

describe("without FEDERATION_PRIVATE_PEERS (today's behaviour)", () => {
  it("refuses http, ports and private IP literals in every origin check", () => {
    expect(peerOriginAcceptable(LAN)).toBe(false);
    expect(peerOriginAcceptable("https://192.168.178.187:3010")).toBe(false);
    expect(peerOriginAcceptable("https://travstats.example.org")).toBe(true);
    expect(httpsOriginSchema.safeParse(LAN).success).toBe(false);
    expect(peerPinSchema.safeParse({ origin: LAN }).success).toBe(false);
    expect(listedPrivateAddress("192.168.178.5")).toBe(false);
  });

  it("refuses a LAN origin in a QR payload", () => {
    const fp = hash(remotePem);
    const qr = JSON.stringify({ v: 1, k: "server", u: LAN, key: remotePem, fp });
    expect(() => readServerQrPayload(qr)).toThrow();
  });

  it("refuses to exchange with an IP literal and with a private DNS answer", async () => {
    jest.mocked(prisma.comparisonPeer.findUnique).mockResolvedValue({
      enabled: true,
      verifiedAt: new Date(),
      publicKey: remotePem,
    } as never);
    await expect(exchange("https://1.2.3.4", { action: "ping" })).rejects.toBeInstanceOf(
      PeerRefusal
    );
    jest.mocked(lookup).mockResolvedValue([{ address: "192.168.178.9", family: 4 }] as never);
    await expect(exchange("https://peer.lan.test", { action: "ping" })).rejects.toMatchObject({
      kind: "private-address",
    });
  });

  it("reads an own http LAN origin as federation off, not as a crash", async () => {
    setIdentity(LAN);
    await expect(loadIdentity()).rejects.toMatchObject({ kind: "federation-off" });
  });
});

describe("with FEDERATION_PRIVATE_PEERS=192.168.178.0/24,fd00::/8", () => {
  beforeEach(() => {
    process.env[ENV] = "192.168.178.0/24, fd00::/8, bogus, 10.0.0.0/99";
  });

  it("accepts http and a port for a listed IP literal, in schemas, QR and file validation", () => {
    expect(peerOriginAcceptable(LAN)).toBe(true);
    expect(httpsOriginSchema.safeParse(LAN).success).toBe(true);
    expect(
      peerPinSchema.safeParse({ origin: "http://[fd00::5]:3010" }).error?.issues[0]?.path
    ).not.toEqual(["origin"]);
    expect(peerOriginAcceptable("http://[fd00::5]:3010")).toBe(true);
    expect(peerOriginAcceptable("http://nas.lan:3010")).toBe(true);
    const fp = hash(remotePem);
    const qr = buildServerQrPayload({ origin: LAN, publicKey: remotePem, fingerprint: fp });
    expect(readServerQrPayload(qr).origin).toBe(LAN);
  });

  it("still insists on canonical origins and on listed IP literals", () => {
    expect(peerOriginAcceptable("http://192.168.178.187:3010/")).toBe(false);
    expect(peerOriginAcceptable("http://u:p@192.168.178.187:3010")).toBe(false);
    expect(peerOriginAcceptable("http://192.168.178.187:3010/x")).toBe(false);
    expect(peerOriginAcceptable("http://192.168.1.5:3010")).toBe(false); // private, not listed
    expect(peerOriginAcceptable("ftp://192.168.178.5")).toBe(false);
  });

  it("refuses loopback, link-local and metadata even when a CIDR covers them", () => {
    process.env[ENV] = "127.0.0.0/8,169.254.0.0/16,::1/128,fe80::/10,0.0.0.0/8,192.168.0.0/16";
    for (const a of [
      "127.0.0.1",
      "169.254.169.254",
      "::1",
      "fe80::1",
      "0.0.0.0",
      "::ffff:127.0.0.1",
    ])
      expect(peerAddressAllowed(a)).toBe(false);
    expect(peerOriginAcceptable("http://127.0.0.1:3010")).toBe(false);
    expect(peerOriginAcceptable("http://[::1]:3010")).toBe(false);
    expect(peerAddressAllowed("192.168.5.5")).toBe(true);
  });

  it("uses an http LAN address as the local identity's own origin", async () => {
    setIdentity(LAN);
    await expect(loadIdentity()).resolves.toMatchObject({ origin: LAN });
  });

  it("exchanges over plain http with the vetted address, an explicit port and the right Host", async () => {
    setIdentity("http://192.168.178.20:3010");
    const options = redirectHttp();
    await expect(exchange(LAN, { action: "ping" })).resolves.toEqual({ ready: true });
    expect(options[0]).toMatchObject({ hostname: "192.168.178.187" });
    expect(lookup).not.toHaveBeenCalled();
    expect(seen[0]?.preauth).toMatch(/^http:\/\/192\.168\.178\.20:3010 /);
  });

  it("exchanges with a DNS name whose answers all lie in the list, on its explicit port", async () => {
    setIdentity("http://192.168.178.20:3010");
    jest.mocked(lookup).mockResolvedValue([{ address: "192.168.178.187", family: 4 }] as never);
    const options = redirectHttp();
    await expect(exchange("http://nas.lan:3010", { action: "ping" })).resolves.toEqual({
      ready: true,
    });
    expect(options[0]).toMatchObject({ port: 3010 });
  });

  it("refuses a DNS name that mixes a listed private and an unlisted private address", async () => {
    jest.mocked(lookup).mockResolvedValue([
      { address: "192.168.178.187", family: 4 },
      { address: "10.1.2.3", family: 4 },
    ] as never);
    await expect(exchange("http://nas.lan:3010", { action: "ping" })).rejects.toMatchObject({
      kind: "private-address",
    });
  });

  it("refuses plain http to a name that answers a public address", async () => {
    jest.mocked(lookup).mockResolvedValue([{ address: "8.8.8.8", family: 4 }] as never);
    await expect(exchange("http://pub.example:3010", { action: "ping" })).rejects.toMatchObject({
      kind: "private-address",
    });
  });

  it("refuses an explicit port on a name with a public answer, and a CIDR that covers public space", async () => {
    jest.mocked(lookup).mockResolvedValue([{ address: "8.8.8.8", family: 4 }] as never);
    await expect(exchange("https://pub.example:8443", { action: "ping" })).rejects.toMatchObject({
      kind: "private-address",
    });
    process.env[ENV] = "0.0.0.0/0";
    expect(listedPrivateAddress("8.8.8.8")).toBe(false);
  });

  it("refuses an IPv6 literal outside the list and a loopback literal", async () => {
    await expect(exchange("http://[fd01::5]:3010", { action: "ping" })).rejects.toBeInstanceOf(
      PeerRefusal
    );
    await expect(exchange("http://127.0.0.1:3010", { action: "ping" })).rejects.toBeInstanceOf(
      PeerRefusal
    );
  });

  it("accepts the envelope origin of a LAN peer in a signed packet's shape", () => {
    const shape = {
      origin: LAN,
      destination: "http://192.168.178.20:3010",
      nonce: "a".repeat(64),
      time: 1,
      body: "{}",
      signature: "x",
    };
    expect(signedEnvelope.safeParse(shape).success).toBe(true);
    delete process.env[ENV];
    expect(signedEnvelope.safeParse(shape).success).toBe(false);
  });

  it("fails an exchange to a stored LAN peer as a refusal once the opt-in is removed", async () => {
    delete process.env[ENV];
    await expect(exchange(LAN, { action: "ping" })).rejects.toBeInstanceOf(PeerRefusal);
  });
});
