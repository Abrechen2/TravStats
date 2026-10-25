import type { TravTrackDayEntry } from "../../lib/api/travtrack";

/**
 * The words for one label of a day (TravTrack plan E10), shared by the
 * timeline and the map. Every kind the web knows has its own copy; a domain
 * the server added after this build reads "Eintrag" — listed, never dropped.
 * A moving stretch nothing covers is "Unterwegs, ohne Eintrag": the copy names
 * no mode, because the server guessed none.
 */

type Translate = (key: string, options?: Record<string, unknown>) => string;

const KNOWN_KINDS = new Set([
  "flight",
  "trip",
  "home",
  "rail",
  "bus",
  "ferry",
  "cruise",
  "rental",
  "roadtrip",
  "lodging",
  "poi",
]);

export function contextLabel(item: TravTrackDayEntry, t: Translate): string {
  if (item.unlabelled) return t("track:timeline.movement");
  const key =
    item.kind === "suggestion"
      ? `track:timeline.suggestion.${item.suggestion === "journey" ? "journey" : "stay"}`
      : KNOWN_KINDS.has(item.kind)
        ? `track:timeline.${item.kind}`
        : "track:timeline.entry";
  return t(key, { label: item.label }).trim();
}

export type DayAnchor = { lat: number; lon: number; kind: string; text: string };

/** The labels the map shows: only those whose server gave an anchor. */
export function dayAnchors(context: readonly TravTrackDayEntry[], t: Translate): DayAnchor[] {
  return context.flatMap((item) =>
    item.anchor
      ? [
          {
            lat: item.anchor.lat,
            lon: item.anchor.lon,
            kind: item.kind,
            text: contextLabel(item, t),
          },
        ]
      : []
  );
}
