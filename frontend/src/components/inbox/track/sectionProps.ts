import type { DawarichStay } from "../../../lib/api/dawarichStays";
import type { JourneyRun, LocationSuggestion } from "../../../lib/api/locationSuggestions";
import type { TrackSectionPanelProps } from "./TrackSectionPanel";

/**
 * Which section each kind of question stands on, and the facts only the
 * question knows. Pure, so the windows are tested without a map:
 *
 *   - a stay: its time there, plus the hour before it — how it was reached;
 *   - a country question: its window (whole UTC days, so read on UTC);
 *   - a journey: each run on its own;
 *   - a trip: its span.
 */

/** The approach shown before a stay: where it was reached from. */
export const STAY_LEAD_MS = 60 * 60_000;

/** A TravTrack stay's section; null for a Dawarich finding (no TravTrack history behind it). */
export function staySectionProps(row: DawarichStay): TrackSectionPanelProps | null {
  if (row.evidence.source !== "travtrack") return null;
  const startMs = Date.parse(row.startAt);
  const endMs = Date.parse(row.endAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || !(endMs > startMs)) return null;
  const kind = row.evidence.kind ?? "stay";
  const radius = Number(row.evidence.explanation?.params.radiusM);
  return {
    window: { fromMs: startMs - STAY_LEAD_MS, untilMs: endMs },
    zone: row.zone,
    why: { key: `track:inbox.why.${kind}` },
    coverage: row.evidence.readCoverage ?? null,
    ring:
      Number.isFinite(radius) && radius > 0
        ? { lat: row.lat, lon: row.lon, radiusM: radius }
        : null,
    facts: row.evidence.coveredBy
      ? [{ labelKey: "track:inbox.fact.matches", value: row.evidence.coveredBy.name }]
      : [],
  };
}

export function countrySectionProps(
  suggestion: LocationSuggestion,
  country: string
): TrackSectionPanelProps {
  return {
    window: suggestion.window,
    zone: "UTC",
    why: { key: "track:inbox.why.country", values: { country } },
    coverage: suggestion.coverage,
    countryCode: String(suggestion.explanation.params.country ?? "") || null,
  };
}

export function journeyRunSectionProps(
  suggestion: LocationSuggestion,
  run: JourneyRun
): TrackSectionPanelProps {
  return {
    window: { fromMs: run.fromMs, untilMs: run.untilMs },
    zone: run.startZone,
    why: { key: "track:inbox.why.journey" },
    coverage: suggestion.coverage,
  };
}

export function tripSectionProps(
  suggestion: LocationSuggestion,
  tripName: string
): TrackSectionPanelProps {
  const extending = suggestion.trip?.tripId != null;
  return {
    window: suggestion.window,
    zone: suggestion.trip?.zone ?? null,
    why: extending
      ? { key: "track:inbox.why.tripExtend", values: { trip: tripName } }
      : { key: "track:inbox.why.tripAway" },
    coverage: suggestion.coverage,
  };
}
