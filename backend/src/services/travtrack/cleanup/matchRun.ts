/**
 * "An Straßen anpassen" for one stretch (rc46 extras C2): the run behind
 * `POST /travtrack/cleanup/match`.
 *
 * Gates, each answering as itself: the catalogue switch `mapMatching` (off by
 * default) with a router address the admin entered (nothing is preset), the
 * internet master switch, then the account's confirmation of THIS router
 * (`useConsent.ts`) — without it the run returns the disclosure and sends
 * nothing. Only the stretch's privacy-safe points go, privacy zones cut out
 * once more right before the request (`pointsToSend`). A match below the
 * confidence threshold is not stored: the stretch stays as recorded.
 */
import { isEnabled, loadAdminState } from "../../externalServices/adminView";
import { getService } from "../../externalServices/catalogue";
import {
  hostOf,
  locationOf,
  requireUseConsent,
  type Disclosure,
  type UseConfirmation,
} from "../../externalServices/useConsent";
import type { FetchLike } from "../../egress/boundedFetch";
import { internetAllowed } from "../../internetGate";
import { privacyCirclesFor } from "../privacyCircles";
import { readSafeTravTrack, type Span } from "../readSafe";
import {
  MIN_CONFIDENCE,
  MapMatchError,
  matchPiece,
  pointsToSend,
  type MatchEngine,
} from "./mapMatch";
import { storeMatch, type MatchRow } from "./store";

/** One stretch, not a month: a day at most, and no more fixes than one request should carry. */
export const MATCH_MAX_SPAN_MS = 24 * 3_600_000;
export const MATCH_MAX_POINTS = 2_000;

export type MatchGateFailure = "serviceOff" | "notConfigured" | "internetOff";

export class MatchGateError extends Error {
  constructor(readonly reason: MatchGateFailure) {
    super(`Map matching unavailable: ${reason}`);
    this.name = "MatchGateError";
  }
}

export type MatchOutcome =
  { kind: "confirm"; disclosure: Disclosure } | { kind: "matched"; match: MatchRow };

type Router = { url: string; engine: MatchEngine };

async function router(): Promise<Router> {
  const service = getService("mapMatching");
  const state = await loadAdminState();
  if (!service || !isEnabled(service, state)) throw new MatchGateError("serviceOff");
  const url = state.admin?.mapMatchingUrl;
  if (typeof url !== "string" || url.trim() === "") throw new MatchGateError("notConfigured");
  if (!(await internetAllowed())) throw new MatchGateError("internetOff");
  const engine = state.admin?.mapMatchingEngine === "graphhopper" ? "graphhopper" : "valhalla";
  return { url: url.trim(), engine };
}

export async function mapMatchingAvailability(): Promise<{
  available: boolean;
  reason: MatchGateFailure | null;
}> {
  try {
    await router();
    return { available: true, reason: null };
  } catch (error) {
    if (error instanceof MatchGateError) return { available: false, reason: error.reason };
    throw error;
  }
}

export async function matchStretch(
  userId: string,
  span: Span,
  confirmation: UseConfirmation | undefined,
  fetchImpl?: FetchLike
): Promise<MatchOutcome> {
  const target = await router();
  const [read, circles] = await Promise.all([
    readSafeTravTrack(userId, span, MATCH_MAX_POINTS + 1),
    privacyCirclesFor(userId, span.fromMs),
  ]);
  const pieces = read.segments.flatMap((segment) => pointsToSend(segment, circles));
  const pointCount = pieces.reduce((n, p) => n + p.length, 0);
  if (pointCount === 0) throw new MapMatchError("tooFewPoints");
  if (read.next !== null || pointCount > MATCH_MAX_POINTS) throw new MapMatchError("tooLarge");

  const verdict = await requireUseConsent(
    userId,
    {
      serviceId: "mapMatching",
      host: hostOf(target.url),
      provider: target.engine,
      location: locationOf(target.url),
      fields: ["points", "costing"],
      pointCount,
      privacyZonesApplied: circles.length > 0,
    },
    confirmation
  );
  if (!verdict.ok) return { kind: "confirm", disclosure: verdict.disclosure };

  const matched = [];
  for (const piece of pieces)
    matched.push(await matchPiece(target.engine, target.url, piece, fetchImpl));
  const confidence = Math.min(...matched.map((m) => m.confidence));
  if (confidence < MIN_CONFIDENCE) throw new MapMatchError("lowConfidence");
  const match = await storeMatch(userId, {
    fromMs: span.fromMs,
    untilMs: span.untilMs,
    lines: matched.map((m) => m.coordinates),
    confidence,
    provider: hostOf(target.url),
    pointCount,
  });
  return { kind: "matched", match };
}
