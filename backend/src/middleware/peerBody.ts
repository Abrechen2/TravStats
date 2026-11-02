import express, { type RequestHandler } from "express";
import { prisma } from "../db";
import { FILE_LIMITS } from "../config/constants";
import { PEER_ORIGIN_HEADER } from "../services/federation/security";

/** Pinned, enabled and verified by this server's admin: the only senders that may send a large body. */
export async function largeBodyAllowed(origin: unknown): Promise<boolean> {
  if (typeof origin !== "string" || origin.length > 300) return false;
  const peer = await prisma.comparisonPeer.findUnique({ where: { origin } });
  return !!peer?.enabled && !!peer.verifiedAt;
}

const large = express.json({ limit: FILE_LIMITS.PEER_BODY_MAX_SIZE });

/**
 * Body parser of `/trip-share-peer`: an admitted peer's request may be as large as a plan document
 * needs; anyone else gets the ordinary parser's cap, so an unauthenticated sender cannot make
 * this server buffer tens of megabytes. The route repeats the check on the signed envelope.
 */
export const peerBodyParser: RequestHandler = (req, res, next) => {
  largeBodyAllowed(req.get(PEER_ORIGIN_HEADER)).then(
    (allowed) => (allowed ? large(req, res, next) : next()),
    next
  );
};
