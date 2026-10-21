/**
 * What another server's trip sharing knows beyond version 1 as rc.18 shipped it (spec 2026-10-20,
 * catch-up of 2026-10-21): the ping answer's `features`. A server from before them answers a
 * message kind it does not know with the uniform 403, which reads like any refusal — so a sender
 * asks first and does not send what the other side does not name.
 *
 * The answer is kept ten minutes per origin: a resync, a push and a nudge are rare, and a peer
 * updated meanwhile is asked again soon enough. A ping that fails is not cached and throws, so the
 * caller treats it like the transport failure it is (retried), never as "unsupported".
 */
import {
  TRIP_SHARE_FEATURES,
  tripPingReplySchema,
  type TripShareFeature,
} from "../../../schemas/tripSharePeer";
import { messageHeader, tripShareExchange } from "./transport";

const KEEP_MS = 10 * 60_000;

/** What this server's ping answer names (a function, so a test can play a server from rc.18). */
export function servedFeatures(): TripShareFeature[] {
  return [...TRIP_SHARE_FEATURES];
}
const known = new Map<string, { features: ReadonlySet<string>; at: number }>();

/** The features `origin` names in its ping answer (cached); throws when the ping fails. */
export async function peerFeatures(origin: string): Promise<ReadonlySet<string>> {
  const cached = known.get(origin);
  if (cached && Date.now() - cached.at < KEEP_MS) return cached.features;
  const reply = tripPingReplySchema.parse(
    await tripShareExchange(origin, { kind: "ping", ...messageHeader() })
  );
  const features = new Set(reply.features ?? []);
  known.set(origin, { features, at: Date.now() });
  return features;
}

export async function peerSupports(origin: string, feature: TripShareFeature): Promise<boolean> {
  return (await peerFeatures(origin)).has(feature);
}

/** Tests: forget what was asked, so a peer that changed its answer is asked again. */
export function forgetPeerFeatures(): void {
  known.clear();
}
