/** Real Node TLS socket: catches Node 22's lookup callback contract and connect failures. */
import https from "https";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { generateKeyPairSync, sign } from "crypto";
import { lookup } from "dns/promises";
import { getDefaultAutoSelectFamily, setDefaultAutoSelectFamily } from "net";
import { exchange, ipv4First, PeerRefusal } from "../security";
import { prisma } from "../../../db";
jest.mock("../../../db", () => ({ prisma: { comparisonPeer: { findUnique: jest.fn() } } }));
jest.mock("dns/promises", () => ({ lookup: jest.fn() }));

const CLOUDFLARE_V6 = "2606:4700:3035::6815:434f";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "federation-tls-"));
const originalEnv = { ...process.env };
const previousAutoSelect = getDefaultAutoSelectFamily();
const local = generateKeyPairSync("ed25519"),
  remote = generateKeyPairSync("ed25519");
let server: https.Server;
let port = 0;
let certificate: Buffer;

beforeAll(async () => {
  setDefaultAutoSelectFamily(true);
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
      "/CN=remote.federation.test",
      "-addext",
      "subjectAltName=DNS:remote.federation.test",
    ],
    { stdio: "ignore" }
  );
  fs.writeFileSync(`${dir}/peer.key`, local.privateKey.export({ type: "pkcs8", format: "pem" }), {
    mode: 0o600,
  });
  process.env.FEDERATION_ENABLED = "1";
  process.env.FEDERATION_PUBLIC_ORIGIN = "https://local.federation.test";
  process.env.FEDERATION_KEY_FILE = `${dir}/peer.key`;
  certificate = fs.readFileSync(`${dir}/tls.crt`);
  server = https.createServer(
    { key: fs.readFileSync(`${dir}/tls.key`), cert: certificate },
    (req, res) => {
      let input = "";
      req.on("data", (b) => {
        input += b;
      });
      req.on("end", () => {
        const received = JSON.parse(input);
        const unsigned = {
          origin: "https://remote.federation.test",
          destination: received.origin,
          nonce: received.nonce,
          time: Date.now(),
          body: JSON.stringify({ ready: true }),
        };
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            ...unsigned,
            signature: sign(
              null,
              Buffer.from(JSON.stringify(unsigned)),
              remote.privateKey
            ).toString("base64"),
          })
        );
      });
    }
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as { port: number }).port;
});

beforeEach(() => {
  jest.mocked(prisma.comparisonPeer.findUnique).mockResolvedValue({
    enabled: true,
    verifiedAt: new Date(),
    publicKey: remote.publicKey.export({ type: "spki", format: "pem" }).toString(),
  } as never);
});

afterEach(() => jest.restoreAllMocks());

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  setDefaultAutoSelectFamily(previousAutoSelect);
  for (const key of ["FEDERATION_ENABLED", "FEDERATION_PUBLIC_ORIGIN", "FEDERATION_KEY_FILE"]) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  for (const name of ["tls.key", "tls.crt", "peer.key"])
    if (fs.existsSync(`${dir}/${name}`)) fs.unlinkSync(`${dir}/${name}`);
  fs.rmdirSync(dir);
});

type Physical = { address: string; family: number };
type ProductionLookup = (
  host: string,
  options: object,
  callback: (error: Error | null, address: unknown, family: number) => void
) => void;

/**
 * Redirects only the physical socket: the production lookup still runs with Node's options and
 * callback timing, and `route` turns each pinned answer into a local address. Returns the
 * pinned answers in the order they were tried.
 */
function redirect(route: (pinned: string) => Physical): string[] {
  const tried: string[] = [];
  const actual = https.request.bind(https);
  jest.spyOn(https, "request").mockImplementation(((
    options: https.RequestOptions,
    callback: Parameters<typeof https.request>[1]
  ) => {
    const productionLookup = options.lookup as unknown as ProductionLookup;
    return actual(
      {
        ...options,
        port,
        ca: certificate,
        lookup: ((host: string, opts: object, cb: (...args: unknown[]) => void) => {
          productionLookup(host, opts, (error, address) => {
            tried.push(address as string);
            const target = route(address as string);
            cb(error, target.address, target.family);
          });
        }) as never,
      },
      callback as never
    );
  }) as typeof https.request);
  return tried;
}

function answers(...list: Physical[]) {
  jest.mocked(lookup).mockResolvedValue(list as never);
}

it("connects to the pinned IPv4 address with Node's automatic family selection enabled globally", async () => {
  answers({ address: "11.40.0.2", family: 4 });
  const tried = redirect(() => ({ address: "127.0.0.1", family: 4 }));
  await expect(exchange("https://remote.federation.test", { action: "ping" })).resolves.toEqual({
    ready: true,
  });
  expect(tried).toEqual(["11.40.0.2"]);
}, 20000);

it("refuses as unreachable, without an uncaught exception, when the pinned connect fails at once", async () => {
  // rc.24 on prod: an AAAA answer in a container with no IPv6 route failed synchronously inside
  // `tls.connect`. A mismatched family is the same synchronous failure on any host.
  answers({ address: CLOUDFLARE_V6, family: 6 });
  redirect(() => ({ address: "127.0.0.1", family: 6 }));
  const uncaught: unknown[] = [];
  const onUncaught = (error: unknown) => uncaught.push(error);
  process.on("uncaughtException", onUncaught);
  try {
    const result = exchange("https://remote.federation.test", { action: "ping" });
    await expect(result).rejects.toBeInstanceOf(PeerRefusal);
    await expect(result).rejects.toMatchObject({ kind: "unreachable" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(uncaught).toEqual([]);
  } finally {
    process.off("uncaughtException", onUncaught);
  }
}, 20000);

it("tries IPv4 first and moves on to the next vetted answer when a connect fails", async () => {
  answers(
    { address: CLOUDFLARE_V6, family: 6 },
    { address: "11.40.0.2", family: 4 },
    { address: "11.40.0.3", family: 4 }
  );
  // 127.0.0.2 is loopback with nothing listening: connection refused.
  const tried = redirect((pinned) =>
    pinned === "11.40.0.2"
      ? { address: "127.0.0.2", family: 4 }
      : { address: "127.0.0.1", family: 4 }
  );
  await expect(exchange("https://remote.federation.test", { action: "ping" })).resolves.toEqual({
    ready: true,
  });
  expect(tried).toEqual(["11.40.0.2", "11.40.0.3"]);
}, 20000);

it("still reaches a host that answers only AAAA", async () => {
  answers({ address: CLOUDFLARE_V6, family: 6 });
  const tried = redirect(() => ({ address: "127.0.0.1", family: 4 }));
  await expect(exchange("https://remote.federation.test", { action: "ping" })).resolves.toEqual({
    ready: true,
  });
  expect(tried).toEqual([CLOUDFLARE_V6]);
}, 20000);

it("refuses as unreachable once every vetted answer has failed to connect", async () => {
  answers({ address: "11.40.0.2", family: 4 }, { address: CLOUDFLARE_V6, family: 6 });
  const tried = redirect(() => ({ address: "127.0.0.2", family: 4 }));
  await expect(
    exchange("https://remote.federation.test", { action: "ping" })
  ).rejects.toMatchObject({ kind: "unreachable" });
  expect(tried).toEqual(["11.40.0.2", CLOUDFLARE_V6]);
}, 20000);

it("orders IPv4 answers first and keeps resolver order within a family", () => {
  expect(
    ipv4First([
      { address: "a", family: 6 },
      { address: "b", family: 4 },
      { address: "c", family: 6 },
      { address: "d", family: 4 },
    ]).map((a) => a.address)
  ).toEqual(["b", "d", "a", "c"]);
});
