/** Real Node TLS socket: catches Node 22's all-address lookup callback contract. */
import https from "https";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { generateKeyPairSync, sign } from "crypto";
import { getDefaultAutoSelectFamily, setDefaultAutoSelectFamily } from "net";
import { exchange } from "../security";
import { prisma } from "../../../db";
jest.mock("../../../db", () => ({ prisma: { comparisonPeer: { findUnique: jest.fn() } } }));
jest.mock("dns/promises", () => ({
  lookup: jest.fn(async () => [{ address: "11.40.0.2", family: 4 }]),
}));
it("connects to the pinned IPv4 address with Node's automatic family selection enabled globally", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "federation-tls-"));
  const originalEnv = { ...process.env };
  const previous = getDefaultAutoSelectFamily();
  const local = generateKeyPairSync("ed25519"),
    remote = generateKeyPairSync("ed25519");
  let server: https.Server | undefined;
  try {
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
    jest.mocked(prisma.comparisonPeer.findUnique).mockResolvedValue({
      enabled: true,
      verifiedAt: new Date(),
      publicKey: remote.publicKey.export({ type: "spki", format: "pem" }).toString(),
    } as never);
    const certificate = fs.readFileSync(`${dir}/tls.crt`);
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
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    const actual = https.request.bind(https);
    // Redirect only the physical test socket. Keep production lookup options/callback semantics.
    jest.spyOn(https, "request").mockImplementation(((
      options: https.RequestOptions,
      callback: Parameters<typeof https.request>[1]
    ) => {
      const productionLookup = options.lookup!;
      return actual(
        {
          ...options,
          port,
          ca: certificate,
          lookup: ((host: string, opts: object, cb: (...args: unknown[]) => void) => {
            (
              productionLookup as (
                host: string,
                options: object,
                callback: (error: Error | null, address: unknown, family: number) => void
              ) => void
            )(host, opts, (error: Error | null, address: unknown, family: number) => {
              expect(address).toBe("11.40.0.2");
              cb(error, "127.0.0.1", family);
            });
          }) as never,
        },
        callback as never
      );
    }) as typeof https.request);
    await expect(exchange("https://remote.federation.test", { action: "ping" })).resolves.toEqual({
      ready: true,
    });
  } finally {
    jest.restoreAllMocks();
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    setDefaultAutoSelectFamily(previous);
    for (const key of ["FEDERATION_ENABLED", "FEDERATION_PUBLIC_ORIGIN", "FEDERATION_KEY_FILE"]) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
    for (const name of ["tls.key", "tls.crt", "peer.key"])
      if (fs.existsSync(`${dir}/${name}`)) fs.unlinkSync(`${dir}/${name}`);
    fs.rmdirSync(dir);
  }
}, 20000);
