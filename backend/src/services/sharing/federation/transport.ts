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
 * trip's facts and a roster), `entries` 1 MB. The route refuses anything above the largest
 * before it reads the signature at all.
 */
export const BODY_BUDGET = {
  ping: 8_192,
  "invite-claim": 8_192,
  "offer-answer": 8_192,
  offer: 32_768,
  entries: 1_048_576,
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

/** The header every message carries. */
export const messageHeader = () => ({ messageId: randomUUID(), sentAt: new Date().toISOString() });

export const tripShareExchange = (origin: string, body: TripSharePacket): Promise<unknown> =>
  exchange(origin, body, TRIP_SHARE_TRANSPORT);
