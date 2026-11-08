/**
 * `POST /api/v1/trip-share-peer` — the trip-share protocol between admitted servers (spec
 * 2026-10-20 §4). A route of its own beside `/comparison-peer`: its own schemas
 * (`schemas/tripSharePeer.ts`), envelope version 2 with purpose `trip-share/1` only, the shared
 * crypto, pin table and nonce table. A packet signed for the comparison protocol — version 1 or
 * purpose `comparison/1` — is refused as `wrong-purpose`, even with a valid signature.
 *
 * Off is absent (G5): while the beta switch, the admin's trip-sharing switch or the identity is
 * missing, every request answers the app's plain 404, before any limiter or parser looks at it.
 *
 * Budgets (spec §4): nothing above the largest kind's budget (`entries`, 1 MB) is read at all;
 * after the signature, each kind is held to its own (`BODY_BUDGET`, control messages 8 KB). A
 * group message (`GROUP_KINDS`: offer, answer, entries, F-S4d's propagation and F-S4e's roster,
 * leave, revoke and add-request) whose header
 * parses but whose body does not
 * is answered `ack { rejected: "schema", field }` under signature, so the sender learns which
 * field; anything less is the uniform 403.
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
import {
  connectionsAvailability,
  tripFederationAvailability,
} from "../services/sharing/federation/availability";
import { serveInviteClaim } from "../services/sharing/federation/invites";
import { serveEntries } from "../services/sharing/federation/entries";
import { serveOfferAnswer } from "../services/sharing/federation/offers";
import { serveOffer } from "../services/sharing/federation/offerInbox";
import { servePropagation } from "../services/sharing/federation/inbound";
import { serveRoster } from "../services/sharing/federation/roster";
import { serveLeave, serveRevoke } from "../services/sharing/federation/lifecycle";
import { serveAddRequest } from "../services/sharing/federation/addRequest";
import { serveResync } from "../services/sharing/federation/resync";
import { serveEntriesUp } from "../services/sharing/federation/entriesUp";
import { serveNudge } from "../services/sharing/federation/nudge";
import { serveDirectoryPair } from "../services/sharing/federation/directory";
import { serveStatsRead } from "../services/sharing/federation/remoteStats";
import { serveAchievementsRead } from "../services/sharing/federation/remoteAchievements";
import {
  serveConnectAccept,
  serveConnectDecline,
  serveConnectRequest,
  serveConnectRevoke,
  serveConnectSettings,
} from "../services/sharing/federation/connections/serve";
import {
  servePlanDecline,
  servePlanJoin,
  servePlanLeave,
  servePlanProxy,
} from "../services/sharing/federation/plans/hostServe";
import { servePlanInvite } from "../services/sharing/federation/plans/memberServe";
import { servedFeatures } from "../services/sharing/federation/peerFeatures";
import { largeBodyAllowed } from "../middleware/peerBody";
import { BODY_BUDGET, MAX_BODY, MAX_LARGE_BODY } from "../services/sharing/federation/transport";
import {
  GROUP_KINDS,
  TRIP_SHARE_PURPOSE,
  TRIP_SHARE_VERSIONS,
  groupHeaderSchema,
  unknownGroupKindSchema,
  tripSharePacket,
  type TripSharePacket,
} from "../schemas/tripSharePeer";
import logger from "../utils/logger";

const router = Router();

/** What a parsed, authenticated message is answered with. */
function serve(
  origin: string,
  local: string,
  body: TripSharePacket,
  connectionsOnly: boolean
): Promise<unknown> {
  switch (body.kind) {
    case "ping":
      return Promise.resolve({
        // Trip sharing off: no versions, so a trip-sharing sender reads "off" as before.
        tripShare: connectionsOnly ? [] : [...TRIP_SHARE_VERSIONS],
        // Trip sharing off: say so, or a peer would try plans and offers and meet a refusal.
        features: connectionsOnly
          ? servedFeatures().filter((f) => f === "connections")
          : servedFeatures(),
      });
    case "invite-claim":
      return serveInviteClaim(origin, body, local);
    case "offer":
      return serveOffer(origin, body);
    case "offer-answer":
      return serveOfferAnswer(origin, body);
    case "entries":
      return serveEntries(origin, body);
    case "fact-update":
    case "entry-create":
    case "entry-removed":
      return servePropagation(origin, body);
    case "roster":
      return serveRoster(origin, body);
    case "leave":
      return serveLeave(origin, body);
    case "revoke":
      return serveRevoke(origin, body);
    case "add-request":
      return serveAddRequest(origin, body);
    case "resync":
      return serveResync(origin, body);
    case "entries-up":
      return serveEntriesUp(origin, body);
    case "nudge":
      return serveNudge(origin, body);
    case "directory-pair":
      return serveDirectoryPair(origin, body);
    case "stats-read":
      return serveStatsRead(origin, body);
    case "achievements-read":
      return serveAchievementsRead(origin, body);
    case "connect-request":
      return serveConnectRequest(origin, body, local);
    case "connect-accept":
      return serveConnectAccept(origin, body);
    case "connect-decline":
      return serveConnectDecline(origin, body);
    case "connect-revoke":
      return serveConnectRevoke(origin, body);
    case "connect-settings":
      return serveConnectSettings(origin, body);
    case "plan-invite":
      return servePlanInvite(origin, body);
    case "plan-join":
      return servePlanJoin(origin, body);
    case "plan-decline":
      return servePlanDecline(origin, body);
    case "plan-leave":
      return servePlanLeave(origin, body);
    case "plan-read":
    case "plan-mutate":
    case "plan-collab":
    case "plan-notices-read":
    case "plan-doc-list":
    case "plan-doc-get":
    case "plan-doc-put":
    case "plan-export":
      return servePlanProxy(origin, body);
  }
}

const GROUP = new Set<string>(GROUP_KINDS);

/**
 * Serve a message; a group message this server failed to apply — its own database or code, not
 * the sender's message — is answered `ack { rejected: "error" }` under signature (F-S4d
 * leftover). The sender retries it and shows it as this server's error, instead of reading a 403
 * as a refusal and, fourteen days on, the server as unreachable. Nothing was written: the
 * message's transaction rolled back, and a retry is applied as if it were the first.
 */
async function serveOrFail(
  origin: string,
  local: string,
  body: TripSharePacket,
  connectionsOnly: boolean
) {
  try {
    return await serve(origin, local, body, connectionsOnly);
  } catch (error) {
    if (!GROUP.has(body.kind) || error instanceof PeerRefusal) throw error;
    logger.error(
      { operation: "trip_share_peer_apply_failed", kind: body.kind, err: error },
      "A trip-share message could not be applied here; the sender is told to retry"
    );
    return { kind: "ack" as const, rejected: "error" as const };
  }
}

/**
 * A group message that failed its schema: which field, if its header can be read at all. A group
 * message of a kind this server does not know (a newer peer's) is answered `unsupported`, so its
 * sender parks it instead of reading a refusal (catch-up of 2026-10-21).
 */
function schemaRejection(raw: unknown, error: ZodError) {
  if (unknownGroupKindSchema.safeParse(raw).success)
    return { kind: "ack" as const, rejected: "unsupported" as const };
  if (!groupHeaderSchema.safeParse(raw).success) return null;
  const field = error.issues[0]?.path.join(".").slice(0, 200);
  return { kind: "ack" as const, rejected: "schema" as const, ...(field ? { field } : {}) };
}

/**
 * Off is absent. With trip sharing off but federation on, only the ping and the user-connection
 * messages are served (spec 2026-11-08 §11.7): a friend works on a server that shares no trips.
 */
const CONNECTION_ONLY_KINDS: ReadonlySet<unknown> = new Set([
  "ping",
  "connect-request",
  "connect-accept",
  "connect-decline",
  "connect-revoke",
  "connect-settings",
]);
router.use((_req, res, next) => {
  const absent = () => res.status(404).json({ error: "Not found" });
  tripFederationAvailability()
    .then(async (state) => {
      if (state.available) return next();
      if ((await connectionsAvailability()).available) {
        res.locals.connectionsOnly = true;
        return next();
      }
      absent();
    })
    .catch(next);
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
      raw.body.length > MAX_LARGE_BODY
    )
      throw refused("packet-too-large");
    // Above the ordinary cap only an admitted origin is read at all (a document travels as base64).
    if (
      raw.body.length > MAX_BODY &&
      !(await largeBodyAllowed((raw as { origin?: unknown }).origin))
    )
      throw refused("packet-too-large");
    const { message, peer, local } = await authenticatePeer(raw, TRIP_SHARE_ACCEPTS);
    const parsedJson: unknown = JSON.parse(message.body);
    const kind = (parsedJson as { kind?: unknown } | null)?.kind;
    if (res.locals.connectionsOnly && !CONNECTION_ONLY_KINDS.has(kind)) {
      // Trip sharing is off here: a trip message meets the same plain 404 as before.
      res.status(404).json({ error: "Not found" });
      return;
    }
    const budget = BODY_BUDGET[kind as keyof typeof BODY_BUDGET] ?? BODY_BUDGET.ping;
    if (message.body.length > budget) throw refused("packet-too-large");
    const parsed = tripSharePacket.safeParse(parsedJson);
    const rejection = parsed.success ? null : schemaRejection(parsedJson, parsed.error);
    if (!parsed.success && !rejection) throw parsed.error;
    // A replayed ping is harmless; anything else needs a verified peer BEFORE a nonce row is kept.
    if (kind !== "ping" && !peer.verifiedAt) throw refused("unverified-peer");
    if (peer.verifiedAt) await consumeNonce(message);
    const data = parsed.success
      ? await serveOrFail(
          message.origin,
          local.origin,
          parsed.data,
          res.locals.connectionsOnly === true
        )
      : rejection;
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
