import { prisma } from "../../../db";
import {
  ENTRY_WINDOW_ADAPTERS,
  logbookWindows,
} from "../../locationEvidence/journeys/entryWindows";
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
  const [windows, overrides, stays, places] = await Promise.all([
    movementWindows(userId, window),
    overridesIn(userId, window),
    staysIn(userId, window),
    stopPlacesIn(userId, window),
  ]);
  return deriveLegs(read, { windows, overrides, stays, places });
}
