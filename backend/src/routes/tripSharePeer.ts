/**
 * `POST /api/v1/trip-share-peer` — the trip-share protocol between admitted servers (spec
 * 2026-10-20 §4). A route of its own beside `/comparison-peer`: its own schemas
 * (`schemas/tripSharePeer.ts`), envelope version 2 with purpose `trip-share/1` only, the shared
 * crypto, pin table and nonce table. A packet signed for the comparison protocol — version 1 or
 * purpose `comparison/1` — is refused as `wrong-purpose`, even with a valid signature.
 *
 * Off is absent (G5): while the beta switch, the admin's trip-sharing switch or the identity is
 * missing, every request answers the app's plain 404, before any limiter or parser looks at it.
 */
import { Router } from "express";
import { ZodError } from "zod";
import rateLimit from "express-rate-limit";
import {
  authenticatePeer,
  consumeNonce,
  envelope,
  refused,
  PeerRefusal,
} from "../services/federation/security";
import { TRIP_SHARE_ACCEPTS } from "../services/federation/envelope";
import { tripFederationAvailability } from "../services/sharing/federation/availability";
import { serveInviteClaim } from "../services/sharing/federation/invites";
import { TRIP_SHARE_PURPOSE, TRIP_SHARE_VERSIONS, tripSharePacket } from "../schemas/tripSharePeer";
import logger from "../utils/logger";

const router = Router();
/** Control messages only (ping, invite pair); group messages get their own budget in F-S4c. */
const MAX_PACKET_BODY = 8_192;

router.use((_req, res, next) => {
  tripFederationAvailability().then(
    (state) => (state.available ? next() : res.status(404).json({ error: "Not found" })),
    next
  );
});
// Spec §4: 600 messages a minute per peer. The peer is not known before the signature is
// checked, so the bucket is the sending address (express-rate-limit's default, IPv6-masked).
router.use(
  rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: true, legacyHeaders: false })
);

router.post("/", async (req, res) => {
  try {
    // Size first, before the signature is checked or anything is parsed.
    const raw: unknown = req.body;
    if (
      !raw ||
      typeof raw !== "object" ||
      !("body" in raw) ||
      typeof raw.body !== "string" ||
      raw.body.length > MAX_PACKET_BODY
    )
      throw refused("packet-too-large");
    const { message, peer, local } = await authenticatePeer(raw, TRIP_SHARE_ACCEPTS);
    const body = tripSharePacket.parse(JSON.parse(message.body));
    // A replayed ping is harmless; anything else needs a verified peer BEFORE a nonce row is kept.
    if (body.kind !== "ping" && !peer.verifiedAt) throw refused("unverified-peer");
    if (peer.verifiedAt) await consumeNonce(message);
    const data =
      body.kind === "ping"
        ? { tripShare: [...TRIP_SHARE_VERSIONS] }
        : await serveInviteClaim(message.origin, body);
    res.setHeader("Cache-Control", "no-store");
    res.json(envelope(data, message.origin, local, message.nonce, TRIP_SHARE_PURPOSE));
  } catch (error) {
    // The peer learns nothing; the operator learns why it was turned away. Never a code or a fact.
    const kind =
      error instanceof PeerRefusal
        ? error.kind
        : error instanceof ZodError || error instanceof SyntaxError
          ? "malformed"
          : "refused";
    // An unexpected failure (not a refusal, not a malformed packet) keeps its error for the log.
    const unexpected = kind === "refused" && !(error instanceof PeerRefusal);
    logger.warn(
      { operation: "trip_share_peer_refused", kind, ...(unexpected ? { err: error } : {}) },
      "Trip-share peer packet refused"
    );
    res.status(403).json({ error: "TRIP_SHARE_REFUSED" });
  }
});

export default router;
