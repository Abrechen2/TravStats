/**
 * The trip-share protocol on the shared egress (`exchange()` in `services/federation/security.ts`):
 * its route, its budgets, envelope version 2 with purpose `trip-share/1` both ways. A reply signed
 * for the comparison protocol, or as version 1, is refused as `wrong-purpose`.
 */
import { randomUUID } from "crypto";
import { exchange, type PeerTransport } from "../../federation/security";
import { TRIP_SHARE_ACCEPTS } from "../../federation/envelope";
import { TRIP_SHARE_PURPOSE, type TripSharePacket } from "../../../schemas/tripSharePeer";
import { PLAN_DOC_BASE64_MAX } from "../../../schemas/tripSharePlans";

/**
 * Body budgets per message kind (spec §4), checked by the peer route on the signed body string
 * after the signature: control messages 8 KB (today's `MAX_PACKET_BODY`), an offer 32 KB (the
 * trip's facts and a roster), `entries` 1 MB, `fact-update` and `entry-create` 256 KB (one entry,
 * a line on the map included). The route refuses anything above the largest
 * before it reads the signature at all.
 */
export const BODY_BUDGET = {
  ping: 8_192,
  "invite-claim": 8_192,
  "offer-answer": 8_192,
  offer: 32_768,
  entries: 1_048_576,
  "fact-update": 262_144,
  "entry-create": 262_144,
  "entry-removed": 8_192,
  // F-S4e: a roster names up to a hundred people; the end of a membership and a request are short.
  roster: 32_768,
  leave: 8_192,
  revoke: 8_192,
  "add-request": 8_192,
  // The catch-up (2026-10-21): a request naming up to a hundred refs, a spoke's own entries as
  // `entries` carries them, and a nudge.
  resync: 8_192,
  "entries-up": 1_048_576,
  nudge: 8_192,
  // Simplified setup (2026-11-02): a lookup and a statistics read are short requests.
  "directory-pair": 8_192,
  "stats-read": 8_192,
  // User connections (2026-11-02): short control messages.
  "connect-request": 8_192,
  "connect-accept": 8_192,
  "connect-decline": 8_192,
  "connect-revoke": 8_192,
  "connect-settings": 8_192,
  // Plans over a connection (2026-11-02 §4): short control messages; a write is one plan
  // operation; a document travels as base64 (20 MB of bytes plus the envelope's quoting).
  "plan-invite": 8_192,
  "plan-join": 8_192,
  "plan-decline": 8_192,
  "plan-leave": 8_192,
  "plan-read": 8_192,
  "plan-mutate": 524_288,
  "plan-collab": 8_192,
  "plan-notices-read": 8_192,
  "plan-doc-list": 8_192,
  "plan-doc-get": 8_192,
  "plan-doc-put": PLAN_DOC_BASE64_MAX + 4_096,
  "plan-export": 8_192,
} as const satisfies Readonly<Record<TripSharePacket["kind"], number>>;
/**
 * The most any request may carry BEFORE its sender is known to be an admitted peer: control
 * messages and `entries`. `plan-doc-put` (a document as base64) is the one kind above it; it is
 * read only from a pinned, enabled and verified origin (`middleware/peerBody.ts`, the route).
 */
export const MAX_BODY = Math.max(
  ...Object.entries(BODY_BUDGET)
    .filter(([kind]) => kind !== "plan-doc-put")
    .map(([, budget]) => budget)
);
export const MAX_LARGE_BODY = BODY_BUDGET["plan-doc-put"];

/** What a signed envelope adds around its body (keys, origin, nonce, signature): generous. */
const ENVELOPE_OVERHEAD = 4_096;

/** One overall budget for a document transfer, where the ordinary 10 s is too short for 20 MB. */
const PLAN_FILE_BUDGET_MS = 120_000;

const transport = (maxRequest: number, maxReply: number, budgetMs?: number): PeerTransport => ({
  ...(budgetMs ? { budgetMs } : {}),
  path: "/api/v1/trip-share-peer",
  maxRequest,
  maxReply,
  sendPurpose: TRIP_SHARE_PURPOSE,
  accepts: TRIP_SHARE_ACCEPTS,
  beforeVerification: (body) => (body as { kind?: unknown }).kind === "ping",
});

/**
 * Control messages (ping, invite pair, offer answer): today's comparison request budget. The
 * reply is 64 KB, because a trip page's invitation answers with the offer inside it.
 */
export const TRIP_SHARE_TRANSPORT: PeerTransport = transport(16_384, 65_536);
/** An offer: the trip's facts and roster; acknowledged with a few bytes. */
export const OFFER_TRANSPORT: PeerTransport = transport(
  BODY_BUDGET.offer + ENVELOPE_OVERHEAD,
  16_384
);
/** Up to fifty entries; acknowledged with a few bytes. */
export const ENTRIES_TRANSPORT: PeerTransport = transport(
  BODY_BUDGET.entries + ENVELOPE_OVERHEAD,
  16_384
);

/**
 * A propagation message (F-S4d): one entry or one entry's changed facts. The reply can carry the
 * values a conflict met (`ack.conflicts`), so it gets the request's budget.
 */
export const PROPAGATION_TRANSPORT: PeerTransport = transport(
  BODY_BUDGET["fact-update"] + ENVELOPE_OVERHEAD,
  BODY_BUDGET["fact-update"] + ENVELOPE_OVERHEAD
);

/**
 * A statistics read (2026-11-02): a short request, answered with up to a page of entries (the
 * reply is as large as an `entries` message).
 */
export const STATS_TRANSPORT: PeerTransport = transport(
  BODY_BUDGET["stats-read"] + ENVELOPE_OVERHEAD,
  BODY_BUDGET.entries + ENVELOPE_OVERHEAD
);

/** A plan call (spec 2026-11-02 §4): a short request, a plan view of up to a few MB back. */
export const PLAN_TRANSPORT: PeerTransport = transport(
  BODY_BUDGET["plan-mutate"] + ENVELOPE_OVERHEAD,
  4_194_304
);
/** A document up (20 MB as base64): a long request, a few bytes back, a budget that fits a slow line. */
export const PLAN_UPLOAD_TRANSPORT: PeerTransport = transport(
  BODY_BUDGET["plan-doc-put"] + ENVELOPE_OVERHEAD,
  65_536,
  PLAN_FILE_BUDGET_MS
);
/** A document or the trip file down: a short request, up to 20 MB as base64 back. */
export const PLAN_DOWNLOAD_TRANSPORT: PeerTransport = transport(
  BODY_BUDGET["plan-doc-get"] + ENVELOPE_OVERHEAD,
  PLAN_DOC_BASE64_MAX + ENVELOPE_OVERHEAD,
  PLAN_FILE_BUDGET_MS
);

/** The header every message carries. */
export const messageHeader = () => ({ messageId: randomUUID(), sentAt: new Date().toISOString() });

export const tripShareExchange = (origin: string, body: TripSharePacket): Promise<unknown> =>
  exchange(origin, body, TRIP_SHARE_TRANSPORT);

/**
 * What a message costs on the wire, in UTF-8 bytes (F-S4d review): the body is serialised, then
 * quoted once more inside the signed envelope, and the transport and the receiving route count
 * bytes — a character count passes a CJK-heavy value that the wire refuses.
 */
export const wireBytes = (value: unknown): number =>
  Buffer.byteLength(JSON.stringify(JSON.stringify(value)), "utf8");
