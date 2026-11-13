import { prisma } from "../../../db";
import {
  ENTRY_WINDOW_ADAPTERS,
  logbookWindows,
  overlapShare,
} from "../../locationEvidence/journeys/entryWindows";
import { localDay } from "../../../shared/time/instant";
import { profileZoneOf } from "../../../shared/time/profileZone";
import { foldContextFor } from "../places/places";
import { staySuggestionsEnabled } from "../../settings/suggestionSwitches";
import type { SafeSpan, Span } from "../readSafe";
import { deriveLegs } from "./derive";
import type { Leg, LegMode, LegOverride, StayCandidate, Stop, StopPlaceRow } from "./types";

/**
 * A day's legs and stops (spec 2026-11-03-travtrack-legs, S1), derived on
 * read from the privacy-safe segments, the logbook's movement entries and the
 * owner's stored mode corrections. Only the corrections are stored.
 */

export type { Leg, LegMode, Stop } from "./types";
export { LEG_MODES } from "./types";

async function movementWindows(userId: string, window: Span) {
  const windows = await logbookWindows(userId, window);
  return windows.filter((w) => {
    const adapter = ENTRY_WINDOW_ADAPTERS[w.domain];
    return !("none" in adapter) && adapter.movement === true;
  });
}

async function overridesIn(userId: string, window: Span): Promise<LegOverride[]> {
  const rows = await prisma.travTrackLegMode.findMany({
    where: {
      userId,
      fromMs: { lt: BigInt(window.untilMs) },
      untilMs: { gt: BigInt(window.fromMs) },
    },
    select: { fromMs: true, untilMs: true, mode: true, updatedAt: true },
  });
  return rows.map((r) => ({
    fromMs: Number(r.fromMs),
    untilMs: Number(r.untilMs),
    mode: r.mode as LegMode,
    updatedAtMs: r.updatedAt.getTime(),
  }));
}

async function stopPlacesIn(userId: string, window: Span): Promise<StopPlaceRow[]> {
  const rows = await prisma.travTrackStopPlace.findMany({
    where: {
      userId,
      fromMs: { lt: BigInt(window.untilMs) },
      untilMs: { gt: BigInt(window.fromMs) },
    },
    select: { fromMs: true, untilMs: true, name: true, lat: true, lon: true, updatedAt: true },
  });
  return rows.map((r) => ({
    fromMs: Number(r.fromMs),
    untilMs: Number(r.untilMs),
    name: r.name,
    lat: r.lat,
    lon: r.lon,
    updatedAtMs: r.updatedAt.getTime(),
  }));
}

/** The spans the owner dismissed as "only a wait" (`stops/dismissed`). */
async function dismissalsIn(userId: string, window: Span): Promise<Span[]> {
  const rows = await prisma.travTrackStopDismissal.findMany({
    where: {
      userId,
      fromMs: { lt: BigInt(window.untilMs) },
      untilMs: { gt: BigInt(window.fromMs) },
    },
    select: { fromMs: true, untilMs: true },
  });
  return rows.map((r) => ({ fromMs: Number(r.fromMs), untilMs: Number(r.untilMs) }));
}

/** The TravTrack stay questions a stop may point at; none while stay suggestions are off. */
async function staysIn(userId: string, window: Span): Promise<StayCandidate[]> {
  if (!(await staySuggestionsEnabled(userId))) return [];
  const rows = await prisma.dawarichStay.findMany({
    where: {
      userId,
      provider: "travtrack",
      startAt: { lt: new Date(window.untilMs) },
      endAt: { gt: new Date(window.fromMs) },
    },
    select: { id: true, status: true, startAt: true, endAt: true },
  });
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    fromMs: r.startAt.getTime(),
    untilMs: r.endAt.getTime(),
  }));
}

export async function travTrackLegs(
  userId: string,
  window: Span,
  read: SafeSpan
): Promise<{ legs: Leg[]; stops: Stop[] }> {
  // The day the window opens on, on the profile clock: the home that was valid then folds it.
  const { zone } = await profileZoneOf(userId);
  const day = localDay(new Date(window.fromMs), zone);
  const [windows, overrides, stays, places, fold, dismissals] = await Promise.all([
    movementWindows(userId, window),
    overridesIn(userId, window),
    staysIn(userId, window),
    stopPlacesIn(userId, window),
    foldContextFor(userId, window, day),
    dismissalsIn(userId, window),
  ]);
  const derived = deriveLegs(read, { windows, overrides, stays, places, fold });
  // Flagged, never removed: the stop stays in the list so it can be restored, and nothing
  // derived from the points (legs, distances, totals) changes.
  return {
    legs: derived.legs,
    stops: derived.stops.map((s) =>
      dismissals.some((d) => overlapShare(s, d) > 0.5) ? { ...s, dismissed: true as const } : s
    ),
  };
}
