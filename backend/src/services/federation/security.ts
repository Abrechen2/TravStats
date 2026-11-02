import { isIP } from "net";
import http from "http";
import { lookup } from "dns/promises";
import https from "https";
import type { ComparisonPeer } from "../../prisma";
import { prisma } from "../../db";
import type { PeerBody } from "./contract";
import {
  COMPARISON_ACCEPTS,
  envelope,
  origin as originSchema,
  signedEnvelope,
  verifyEnvelope,
  type Acceptance,
  type Envelope,
  type EnvelopePurpose,
} from "./envelope";

import { refused, hash, PeerRefusal } from "./refusal";
import {
  bareHost,
  listedPrivateAddress,
  peerAddressAllowed,
  publicAddress,
} from "./peerAddressPolicy";
export { refused, hash, PeerRefusal, type PeerRefusalKind } from "./refusal";
import { sign } from "crypto";
import { loadIdentity, type Identity } from "./identity";
export { loadIdentity } from "./identity";
export { envelope, verifyEnvelope } from "./envelope";
export { publicAddress };
/**
 * How one protocol talks to a peer over the shared egress (spec 2026-10-20 §4): its route, its
 * size budgets, the envelope it signs and the envelopes it reads back. One implementation of
 * DNS pinning, address checks and timeouts, two budgets.
 */
export const PEER_PREAUTH_HEADER = "X-TravStats-Peer-Preauth";
const PREAUTH_DOMAIN = "travstats-peer-preauth/1";
export const preAuthBytes = (origin: string, destination: string, time: number, length: number) =>
  Buffer.from(`${PREAUTH_DOMAIN}\n${origin}\n${destination}\n${time}\n${length}`);

/** `<origin> <time> <signature>`: the signature covers sender, receiver, time and the exact request length. */
function preAuthHeader(local: Identity, destination: string, length: number): string {
  const time = Date.now();
  return `${local.origin} ${time} ${sign(null, preAuthBytes(local.origin, destination, time, length), local.key).toString("base64")}`;
}

export interface PeerTransport {
  path: string;
  /** Bytes of the signed request, envelope included. */
  maxRequest: number;
  /** Bytes of the reply. */
  maxReply: number;
  /** Signs version 2 with this purpose; absent signs version 1, which pre-v2 servers read. */
  sendPurpose?: EnvelopePurpose;
  /** Which reply envelopes count as an answer. */
  accepts: Acceptance;
  /** Overall time for the exchange; defaults to `EXCHANGE_BUDGET_MS`. A file transfer needs more. */
  budgetMs?: number;
  /** Whether `body` may reach an admitted peer no ping has verified yet (only a ping may). */
  beforeVerification: (body: object) => boolean;
}

/**
 * The comparison protocol's values, unchanged from before the parametrisation. It still SENDS
 * version 1: a peer one release behind refuses an envelope with fields it does not know, and the
 * cross-purpose guard does not need it — the trip-share route refuses every version-1 envelope.
 */
export const COMPARISON_TRANSPORT: PeerTransport = {
  path: "/api/v1/comparison-peer",
  maxRequest: 16_384,
  maxReply: 10_000_000,
  accepts: COMPARISON_ACCEPTS,
  beforeVerification: (body) => (body as { action?: unknown }).action === "ping",
};

/**
 * Connect to the exact DNS answer checked here; no redirects, proxy env or arbitrary media URLs.
 * Every failure is a `PeerRefusal` whose kind says which: `remote-absent` (404 — the route is
 * switched off or missing there), `remote-refused` (any other status), `unreachable` (network,
 * timeout), `packet-too-large`, or the verification kinds for a reply that does not check out.
 */
export async function exchange(
  remoteOrigin: string,
  body: object,
  transport: PeerTransport
): Promise<unknown>;
// Last, so `Parameters<typeof exchange>` (and a mock's recorded calls) stay the comparison shape.
export async function exchange(remoteOrigin: string, body: PeerBody): Promise<unknown>;
export async function exchange(
  remoteOrigin: string,
  body: object,
  transport: PeerTransport = COMPARISON_TRANSPORT
): Promise<unknown> {
  // A stored peer the policy no longer admits (the LAN opt-in was switched off) is a refusal.
  if (!originSchema.safeParse(remoteOrigin).success) throw refused();
  const local = await loadIdentity();
  const peer = await prisma.comparisonPeer.findUnique({ where: { origin: remoteOrigin } });
  if (!peer?.enabled) throw refused("unknown-peer");
  if (remoteOrigin === local.origin) throw refused();
  if (!peer.verifiedAt && !transport.beforeVerification(body)) throw refused("unverified-peer");
  const url = new URL(remoteOrigin);
  const host = bareHost(url.hostname);
  // Today's rule: an IP literal is a peer only inside a range the operator listed.
  if (isIP(host) && !listedPrivateAddress(host)) throw refused();
  const answers: { address: string; family: number }[] = isIP(host)
    ? // An IP literal is its own answer: the policy decides, there is nothing to resolve.
      [{ address: host, family: isIP(host) }]
    : // A name that does not resolve is the network's failure, not this server's (F-S4d leftover):
      // left raw, it would read as a local error to a caller that tells the two apart.
      await lookup(host, { all: true }).catch(() => {
        throw refused("unreachable");
      });
  // Every answer must be public or in a listed range; plain http only where NONE is public.
  if (!answers.length || !answers.every((a) => peerAddressAllowed(a.address)))
    throw refused("private-address");
  if (url.protocol === "http:" && !answers.every((a) => listedPrivateAddress(a.address)))
    throw refused("private-address");
  const outgoing = envelope(body, remoteOrigin, local, undefined, transport.sendPurpose);
  const bytes = Buffer.from(JSON.stringify(outgoing));
  if (bytes.length > transport.maxRequest) throw refused("packet-too-large");
  const raw = await postToFirstReachable(
    url,
    ipv4First(answers),
    bytes,
    transport,
    preAuthHeader(local, remoteOrigin, bytes.length)
  );
  const received = verifyEnvelope(
    JSON.parse(raw.toString()),
    peer.publicKey,
    local.origin,
    Date.now(),
    transport.accepts
  );
  if (received.origin !== remoteOrigin || received.nonce !== outgoing.nonce) throw refused();
  return JSON.parse(received.body) as unknown;
}
/** One overall budget for every address tried, so a dead first answer cannot double the wait. */
const EXCHANGE_BUDGET_MS = 10_000;

/**
 * IPv4 first, the rest in resolver order. A Cloudflare name answers A and AAAA, and a container
 * without an IPv6 route fails the AAAA one outright (2.7.0-rc.24 on prod, 2026-10-26).
 */
export function ipv4First<T extends { family: number }>(answers: readonly T[]): T[] {
  return [...answers.filter((a) => a.family === 4), ...answers.filter((a) => a.family !== 4)];
}

/**
 * Tries each vetted address in turn, never re-resolving. Only a connection that never came up
 * moves on to the next address; a reply, a refusal or the spent budget ends the exchange.
 */
async function postToFirstReachable(
  url: URL,
  addresses: readonly { address: string; family: number }[],
  bytes: Buffer,
  transport: PeerTransport,
  preAuth: string
): Promise<Buffer> {
  const deadline = Date.now() + (transport.budgetMs ?? EXCHANGE_BUDGET_MS);
  for (const pinned of addresses) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    try {
      return await postPinned(url, pinned, bytes, transport, remaining, preAuth);
    } catch (error) {
      // Anything but a PeerRefusal is a connection that never came up; the next address may answer.
      if (error instanceof PeerRefusal) throw error;
    }
  }
  throw refused("unreachable");
}

function postPinned(
  url: URL,
  pinned: { address: string; family: number },
  bytes: Buffer,
  transport: PeerTransport,
  budgetMs: number,
  preAuth: string
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    let connected = false;
    const secure = url.protocol === "https:";
    const hostname = bareHost(url.hostname);
    const options: https.RequestOptions & { autoSelectFamily: boolean } = {
      hostname,
      // SNI is for names only; a certificate for an IP literal is matched on its IP SAN.
      ...(secure && !isIP(hostname) ? { servername: hostname } : {}),
      port: url.port ? Number(url.port) : secure ? 443 : 80,
      path: transport.path,
      method: "POST",
      agent: false,
      // A single vetted address is pinned; Node 22 otherwise asks lookup for an array.
      autoSelectFamily: false,
      family: pinned.family,
      // Answer on the next tick, never synchronously. A synchronous answer lets the connect fail
      // inside `tls.connect` before the request has attached its socket error listener: the
      // ENETUNREACH was then emitted with no listener and took the process down (rc.24).
      lookup: ((
        _host: string,
        _options: unknown,
        cb: (err: null, address: string, family: number) => void
      ) => process.nextTick(cb, null, pinned.address, pinned.family)) as never,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": bytes.length,
        // Proves who is sending BEFORE the body is read, so the receiver can allow a large body
        // (a plan document) to admitted peers only: a signature over origin, destination, time and
        // length, checked against the pinned key (`middleware/peerBody.ts`).
        [PEER_PREAUTH_HEADER]: preAuth,
      },
    };
    const request = (secure ? https : http).request(options, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(refused(response.statusCode === 404 ? "remote-absent" : "remote-refused"));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (b: Buffer) => {
        size += b.length;
        if (size > transport.maxReply) {
          response.destroy();
          reject(refused("packet-too-large"));
        } else chunks.push(b);
      });
      response.on("end", () => resolve(Buffer.concat(chunks)));
      response.on("error", () => reject(refused("unreachable")));
    });
    request.on("socket", (socket) => socket.once("connect", () => (connected = true)));
    const deadline = setTimeout(() => request.destroy(), budgetMs);
    request.on("close", () => clearTimeout(deadline));
    request.setTimeout(budgetMs, () => request.destroy());
    request.on("error", (error) => reject(connected ? refused("unreachable") : error));
    request.end(bytes);
  });
}
/** Signature and admission only. The nonce is consumed separately, once the peer may act. */
export async function authenticatePeer(
  value: unknown,
  accepts: Acceptance = COMPARISON_ACCEPTS
): Promise<{ message: Envelope; peer: ComparisonPeer; local: Identity }> {
  const local = await loadIdentity();
  const candidate = signedEnvelope.parse(value);
  const peer = await prisma.comparisonPeer.findUnique({ where: { origin: candidate.origin } });
  if (!peer?.enabled) throw refused("unknown-peer");
  return {
    message: verifyEnvelope(candidate, peer.publicKey, local.origin, Date.now(), accepts),
    peer,
    local,
  };
}
/** Replay protection. Called only for a verified peer, so an unverified key cannot fill the table. */
export async function consumeNonce(message: Envelope) {
  await prisma.comparisonNonce.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  try {
    await prisma.comparisonNonce.create({
      data: { id: hash(message.origin + message.nonce), expiresAt: new Date(Date.now() + 600_000) },
    });
  } catch {
    throw refused("replay");
  }
}
