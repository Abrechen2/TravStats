/**
 * What a map marker may say about the time of the entries behind it, in ONE
 * place (forgejo map-planned, owner report on rc.43).
 *
 * Before this, the flight hover counted every flight that touched an airport
 * ("2 Flüge") while the pinned card counted only the ones that were not
 * scheduled ("0 Flüge"): two rules for one number, so a planned-only airport
 * read as visited on hover and as empty in the card. Now each entry is one of
 *
 *   - `visited` — it happened (or is happening); drawn solid, counted.
 *   - `planned` — booked, in the future; drawn as a hollow marker and said to
 *                 be planned, never added to the visited figure.
 *   - `hidden`  — cancelled; it never happened and never will, so it draws no
 *                 marker, no line and no count. It stays in the logbook.
 *
 * The per-domain "does it count" homes (`shared/flightCounting`,
 * `lodgingCounting`, `placeCounting`, `cruiseCounting`) are NOT replaced:
 * where a domain has one that classifies, the layer uses it (lodging, place).
 * This file only owns the status vocabulary the ride-shaped domains share
 * (`scheduled | in_progress | completed | cancelled`, flights and cruises
 * adding `flown | historical`) and the look of "planned".
 */

import { countedStays, plannedStays, type CountableStaySnapshot } from "./lodgingFormat";

export type MapPresenceClass = "visited" | "planned" | "hidden";

export function mapStatusClass(status: string | null | undefined): MapPresenceClass {
  if (status === "cancelled") return "hidden";
  if (status === "scheduled") return "planned";
  return "visited";
}

/** Counts behind one marker. */
export interface PresenceCounts {
  visited: number;
  planned: number;
}

/** True when the marker has planned entries and nothing that happened. */
export function isPlannedOnly(counts: PresenceCounts): boolean {
  return counts.planned > 0 && counts.visited === 0;
}

/** Fill alpha (0-255) of a planned-only marker: nearly empty, so it reads as hollow. */
export const PLANNED_FILL_ALPHA = 36;
/** Ring width in pixels of a planned-only marker — heavier than the 1 px outline of a visited one. */
export const PLANNED_RING_PX = 2.5;

/**
 * A lodging's pin, from the stays behind it — through `shared/lodgingCounting`
 * (a stay counts only after check-out), never a second reading. A house with
 * no stays on record keeps its pin as visited (the wishlist case is the
 * layer's own `visited` flag); a house whose every stay is cancelled draws
 * nothing.
 */
export function lodgingPresence(
  lodging: { stays?: readonly CountableStaySnapshot[] | null },
  now?: Date
): { class: MapPresenceClass; counts: PresenceCounts } {
  const stays = lodging.stays ?? [];
  if (stays.length === 0) return { class: "visited", counts: { visited: 0, planned: 0 } };
  const counts = {
    visited: countedStays(stays, now).length,
    planned: plannedStays(stays, now).length,
  };
  if (counts.visited === 0 && counts.planned === 0) return { class: "hidden", counts };
  return { class: counts.visited === 0 ? "planned" : "visited", counts };
}
