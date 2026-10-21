/**
 * The trip-share protocol on the shared egress (`exchange()` in `services/federation/security.ts`):
 * its route, its budgets, envelope version 2 with purpose `trip-share/1` both ways. A reply signed
 * for the comparison protocol, or as version 1, is refused as `wrong-purpose`.
 */
import { randomUUID } from "crypto";
import { exchange, type PeerTransport } from "../../federation/security";
import { TRIP_SHARE_ACCEPTS } from "../../federation/envelope";
import { TRIP_SHARE_PURPOSE, type TripSharePacket } from "../../../schemas/tripSharePeer";

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
} as const satisfies Readonly<Record<TripSharePacket["kind"], number>>;
export const MAX_BODY = Math.max(...Object.values(BODY_BUDGET));

/** What a signed envelope adds around its body (keys, origin, nonce, signature): generous. */
const ENVELOPE_OVERHEAD = 4_096;

const transport = (maxRequest: number, maxReply: number): PeerTransport => ({
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
