import { createPublicKey, verify } from "crypto";
import express, { type RequestHandler } from "express";
import { prisma } from "../db";
import { FILE_LIMITS } from "../config/constants";
import { loadIdentity } from "../services/federation/identity";
import { PEER_PREAUTH_HEADER, preAuthBytes } from "../services/federation/security";

const WINDOW_MS = 60_000;

/** Pinned, enabled and verified by this server's admin: the only senders that may send a large body. */
export async function admittedPeer(origin: unknown) {
  if (typeof origin !== "string" || origin.length > 300) return null;
  const peer = await prisma.comparisonPeer.findUnique({ where: { origin } });
  return peer?.enabled && peer.verifiedAt ? peer : null;
}

/** For the route, which has the envelope's origin and has not yet verified its signature. */
export async function largeBodyAllowed(origin: unknown): Promise<boolean> {
  return (await admittedPeer(origin)) !== null;
}

/**
 * The request header `<origin> <time> <signature>` proves the sender BEFORE the body is read: a signature by
 * the pinned key over sender, receiver, time and the exact `Content-Length`. A forged or replayed-late
 * header proves nothing, so an unauthenticated sender cannot make this server buffer a large body.
 */
async function preAuthenticated(header: string | undefined, length: number): Promise<boolean> {
  const [origin, time, signature] = (header ?? "").split(" ");
  const peer = await admittedPeer(origin);
  if (!peer || !origin || !Number.isFinite(length)) return false;
  const at = Number(time);
  if (!signature || !Number.isFinite(at) || Math.abs(Date.now() - at) > WINDOW_MS) return false;
  try {
    const local = await loadIdentity();
    return verify(
      null,
      preAuthBytes(origin, local.origin, at, length),
      createPublicKey(peer.publicKey),
      Buffer.from(signature, "base64")
    );
  } catch {
    return false;
  }
}

const large = express.json({ limit: FILE_LIMITS.PEER_BODY_MAX_SIZE });

/**
 * Body parser of `/trip-share-peer`: an admitted peer that proves itself in the header may send a
 * body as large as a plan document needs; anyone else gets the ordinary parser's cap. The route
 * repeats the admission check on the signed envelope's origin.
 */
export const peerBodyParser: RequestHandler = (req, res, next) => {
  preAuthenticated(req.get(PEER_PREAUTH_HEADER), Number(req.get("content-length"))).then(
    (allowed) => (allowed ? large(req, res, next) : next()),
    next
  );
};
