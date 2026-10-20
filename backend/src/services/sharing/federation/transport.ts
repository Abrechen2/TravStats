/**
 * The trip-share protocol on the shared egress (`exchange()` in `services/federation/security.ts`):
 * its route, its budgets, envelope version 2 with purpose `trip-share/1` both ways. A reply signed
 * for the comparison protocol, or as version 1, is refused as `wrong-purpose`.
 */
import { randomUUID } from "crypto";
import { exchange, type PeerTransport } from "../../federation/security";
import { TRIP_SHARE_ACCEPTS } from "../../federation/envelope";
import { TRIP_SHARE_PURPOSE, type TripSharePacket } from "../../../schemas/tripSharePeer";

/** Control messages (ping, invite pair): today's comparison request budget, 64 KB of reply. */
export const TRIP_SHARE_TRANSPORT: PeerTransport = {
  path: "/api/v1/trip-share-peer",
  maxRequest: 16_384,
  maxReply: 65_536,
  sendPurpose: TRIP_SHARE_PURPOSE,
  accepts: TRIP_SHARE_ACCEPTS,
  beforeVerification: (body) => (body as { kind?: unknown }).kind === "ping",
};

/** The header every message carries. */
export const messageHeader = () => ({ messageId: randomUUID(), sentAt: new Date().toISOString() });

export const tripShareExchange = (origin: string, body: TripSharePacket): Promise<unknown> =>
  exchange(origin, body, TRIP_SHARE_TRANSPORT);
