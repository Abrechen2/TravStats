import type { RailDistanceSource } from "../../types/rail";

/**
 * What a ride's distance measures, as a label key — one home for the list row,
 * the detail page and the statistics (review 2026-09-26, finding 7: a converted
 * roadtrip leg's length was labelled "along the track, Transitous").
 * `includeTicket` is for the detail page; the list leaves a typed figure bare.
 */
export function railDistanceNoteKey(
  source: RailDistanceSource | string | null,
  { includeTicket = false }: { includeTicket?: boolean } = {}
): string | null {
  switch (source) {
    case "great_circle":
      return "rail:straightLine";
    case "route":
      return "rail:tracedLine";
    case "roadtrip":
      return "rail:roadtripLine";
    case "user":
      return includeTicket ? "rail:detail.typedDistance" : null;
    default:
      return null;
  }
}

/** Whether a ride was converted from a roadtrip — the structured marker, not prose. */
export function isConvertedFromRoadtrip(journey: { externalRef?: string | null }): boolean {
  return journey.externalRef?.startsWith("roadtrip:") ?? false;
}
