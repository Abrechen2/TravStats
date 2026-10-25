import { draftFrom as busDraftFrom, type BusFormDraft } from "../../bus/busFormModel";
import { draftFrom as railDraftFrom, type RailFormDraft } from "../../rail/railFormModel";
import { EMPTY_STATION } from "../../rail/RailStationField";
import { EMPTY_TERMINAL } from "../../bus/BusStationField";
import { classifyWallClock, localDay, storedFold, toLocal } from "../../../shared/time";
import type { StationInput } from "../../../types/roadtrip";
import type { JourneyEntryKind, JourneyRun } from "../../../lib/api/locationSuggestions";

/**
 * A journey question opens the TravStats form with what TravTrack saw
 * (TravTrack plan E7): both ends as positions — the user names the stations —
 * and both times on each end's own clock, as the forms take them. Nothing is
 * saved by opening; the user saves the form, and the card then links the
 * saved entry to the run.
 *
 * A form saved whose link failed leaves the entry standing and the run open.
 * The entry is remembered here (per question and run, this browser only) so
 * the card offers "mit gespeichertem Eintrag verknüpfen" next time instead of
 * a second form.
 */

/** `YYYY-MM-DDTHH:mm` on `zone`'s clock — the forms' local time field. */
const localMinute = (ms: number, zone: string): string => toLocal(ms, zone).local.slice(0, 16);

/**
 * Which occurrence of a repeated autumn hour the instant is — the forms send
 * it beside the wall clock, which alone would be read as the earlier one.
 * Null when the clock is not repeated.
 */
function foldAt(ms: number, zone: string): "earlier" | "later" | null {
  const local = localMinute(ms, zone);
  if (classifyWallClock(local, zone) !== "repeated") return null;
  return storedFold(local, zone, new Date(ms).toISOString()) === "later" ? "later" : "earlier";
}

const ends = (run: JourneyRun) => ({
  departureLocal: localMinute(run.fromMs, run.startZone),
  arrivalLocal: localMinute(run.untilMs, run.endZone),
  departureFold: foldAt(run.fromMs, run.startZone),
  arrivalFold: foldAt(run.untilMs, run.endZone),
});

export function railDraftFromRun(run: JourneyRun): RailFormDraft {
  return {
    ...railDraftFrom(null),
    departure: { ...EMPTY_STATION, lat: run.start.lat, lon: run.start.lon },
    arrival: { ...EMPTY_STATION, lat: run.end.lat, lon: run.end.lon },
    ...ends(run),
  };
}

export function busDraftFromRun(run: JourneyRun): BusFormDraft {
  return {
    ...busDraftFrom(null),
    departure: { ...EMPTY_TERMINAL, lat: run.start.lat, lon: run.start.lon },
    arrival: { ...EMPTY_TERMINAL, lat: run.end.lat, lon: run.end.lon },
    ...ends(run),
  };
}

/**
 * A roadtrip's first two stations from the run: its ends as pass-through
 * stations on their local days — what makes the roadtrip hold the run (its
 * attested days), so the card can link it. The user sees them before saving.
 */
export function roadtripStationsFromRun(
  run: JourneyRun,
  titles: { start: string; end: string }
): StationInput[] {
  return [
    {
      title: titles.start,
      lat: run.start.lat,
      lon: run.start.lon,
      startDate: localDay(run.fromMs, run.startZone),
      night: { kind: "pass" },
    },
    {
      title: titles.end,
      lat: run.end.lat,
      lon: run.end.lon,
      startDate: localDay(run.untilMs, run.endZone),
      night: { kind: "pass" },
    },
  ];
}

export interface PendingLink {
  entryKind: JourneyEntryKind;
  entryId: string;
}

const KINDS: readonly string[] = ["rail", "bus", "roadtrip"];
const storeKey = (suggestionId: string, runIndex: number) =>
  `travstats.journeyLink.${suggestionId}.${runIndex}`;

/** The entry saved for this run whose link has not gone through, or null. */
export function pendingLink(suggestionId: string, runIndex: number): PendingLink | null {
  try {
    const raw = localStorage.getItem(storeKey(suggestionId, runIndex));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PendingLink>;
    return typeof value.entryId === "string" && KINDS.includes(String(value.entryKind))
      ? { entryKind: value.entryKind as JourneyEntryKind, entryId: value.entryId }
      : null;
  } catch {
    // An unreadable or blocked store holds nothing; the card simply offers the form.
    return null;
  }
}

export function savePendingLink(suggestionId: string, runIndex: number, link: PendingLink): void {
  try {
    localStorage.setItem(storeKey(suggestionId, runIndex), JSON.stringify(link));
  } catch {
    // Blocked storage: the entry still stands; only the shortcut to link it is lost.
  }
}

export function clearPendingLink(suggestionId: string, runIndex: number): void {
  try {
    localStorage.removeItem(storeKey(suggestionId, runIndex));
  } catch {
    // Nothing to clear in a blocked store.
  }
}
