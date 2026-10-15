import { createHash, createPrivateKey, createPublicKey, randomBytes, sign, verify } from "crypto";
import fs from "fs";
import { isAbsolute } from "path";
import { BlockList, isIP } from "net";
import { lookup } from "dns/promises";
import https from "https";
import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { origin as originSchema, signedEnvelope, type Envelope, type PeerBody } from "./contract";

export const refused = () => new AppError("Comparison request refused", 403);
export const hash = (v: string) => createHash("sha256").update(v).digest("hex");
export function identity() {
  const origin = originSchema.parse(process.env.FEDERATION_PUBLIC_ORIGIN);
  const file = process.env.FEDERATION_KEY_FILE;
  if (process.env.FEDERATION_ENABLED !== "1" || origin === "local" || !file || !isAbsolute(file))
    throw refused();
  const key = createPrivateKey(fs.readFileSync(file));
  if (key.asymmetricKeyType !== "ed25519") throw refused();
  const publicKey = createPublicKey(key).export({ type: "spki", format: "pem" }).toString();
  return { origin, key, publicKey, fingerprint: hash(publicKey) };
}
export function envelope(
  body: unknown,
  destination: string,
  nonce = randomBytes(32).toString("hex")
): Envelope {
  const local = identity();
  const unsigned = {
    origin: local.origin,
    destination,
    nonce,
    time: Date.now(),
    body: JSON.stringify(body),
  };
  const signature = sign(null, Buffer.from(JSON.stringify(unsigned)), local.key).toString("base64");
  return { ...unsigned, signature };
}
export function verifyEnvelope(
  value: unknown,
  publicKey: string,
  destination: string,
  now = Date.now()
): Envelope {
  const parsed = signedEnvelope.parse(value);
  const { signature, ...unsigned } = parsed;
  if (parsed.destination !== destination || Math.abs(parsed.time - now) > 300_000) throw refused();
  try {
    const key = createPublicKey(publicKey);
    if (
      key.asymmetricKeyType !== "ed25519" ||
      !verify(null, Buffer.from(JSON.stringify(unsigned)), key, Buffer.from(signature, "base64"))
    )
      throw refused();
  } catch {
    throw refused();
  }
  return parsed;
}
const blocked = new BlockList();
for (const [ip, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(ip, bits, "ipv4");
const global6 = new BlockList();
global6.addSubnet("2000::", 3, "ipv6");
for (const [ip, bits] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const)
  blocked.addSubnet(ip, bits, "ipv6");
export function publicAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4
    ? !blocked.check(address, "ipv4")
    : family === 6 && global6.check(address, "ipv6") && !blocked.check(address, "ipv6");
}
/** Connect to the exact DNS answer checked here; no redirects, proxy env or arbitrary media URLs. */
export async function exchange(remoteOrigin: string, body: PeerBody): Promise<unknown> {
  originSchema.parse(remoteOrigin);
  const local = identity();
  const peer = await prisma.comparisonPeer.findUnique({ where: { origin: remoteOrigin } });
  if (
    !peer?.enabled ||
    remoteOrigin === local.origin ||
    (body.action !== "ping" && !peer.verifiedAt)
  )
    throw refused();
  const url = new URL(remoteOrigin);
  if (isIP(url.hostname)) throw refused();
  const answers = await lookup(url.hostname, { all: true });
  if (!answers.length || !answers.every((a) => publicAddress(a.address))) throw refused();
  const selected = answers[0];
  const outgoing = envelope(body, remoteOrigin);
  const bytes = Buffer.from(JSON.stringify(outgoing));
  if (bytes.length > 16_384) throw refused();
  const raw = await new Promise<Buffer>((resolve, reject) => {
    const options: https.RequestOptions & { autoSelectFamily: boolean } = {
      hostname: url.hostname,
      servername: url.hostname,
      port: 443,
      path: "/api/v1/comparison-peer",
      method: "POST",
      agent: false,
      // A single vetted address is pinned; Node 22 otherwise asks lookup for an array.
      autoSelectFamily: false,
      family: selected.family,
      lookup: ((
        _host: string,
        _options: unknown,
        cb: (err: null, address: string, family: number) => void
      ) => cb(null, selected.address, selected.family)) as never,
      headers: { "Content-Type": "application/json", "Content-Length": bytes.length },
    };
    const request = https.request(options, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(refused());
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (b: Buffer) => {
        size += b.length;
        if (size > 10_000_000) {
          response.destroy();
          reject(refused());
        } else chunks.push(b);
      });
      response.on("end", () => resolve(Buffer.concat(chunks)));
      response.on("error", () => reject(refused()));
    });
    const deadline = setTimeout(() => request.destroy(), 10_000);
    request.on("close", () => clearTimeout(deadline));
    request.setTimeout(10_000, () => request.destroy());
    request.on("error", () => reject(refused()));
    request.end(bytes);
  });
  const received = verifyEnvelope(JSON.parse(raw.toString()), peer.publicKey, local.origin);
  if (received.origin !== remoteOrigin || received.nonce !== outgoing.nonce) throw refused();
  return JSON.parse(received.body) as unknown;
}
export async function authenticatePeer(value: unknown) {
  const local = identity();
  const candidate = signedEnvelope.parse(value);
  const peer = await prisma.comparisonPeer.findUnique({ where: { origin: candidate.origin } });
  if (!peer?.enabled) throw refused();
  const message = verifyEnvelope(candidate, peer.publicKey, local.origin);
  await prisma.comparisonNonce.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  try {
    await prisma.comparisonNonce.create({
      data: { id: hash(message.origin + message.nonce), expiresAt: new Date(Date.now() + 600_000) },
    });
  } catch {
    throw refused();
  }
  return message;
}
