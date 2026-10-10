/**
 * Ocean or river (#359) — the one home of the vocabulary and of the rule that
 * decides a new cruise's kind.
 *
 * A river cruise is not a short ocean cruise: its days without a port are
 * spent on the river, not at sea, and a statistic that called them "sea days"
 * would say something that never happened. The catalogue carries the kind on
 * the ship, the cruise carries its own (a ship is not always enough — a
 * free-text ship has no catalogue row), and this file decides how the two meet.
 */
export const CRUISE_KINDS = ["ocean", "river"] as const;
export type CruiseKind = (typeof CRUISE_KINDS)[number];

export const DEFAULT_CRUISE_KIND: CruiseKind = "ocean";

export function isCruiseKind(value: unknown): value is CruiseKind {
  return typeof value === "string" && (CRUISE_KINDS as readonly string[]).includes(value);
}

/**
 * The kind a cruise is written with: what the client said, else what its
 * catalogue ship is, else ocean. An explicit choice always wins — a river
 * ship can be chartered for a coastal leg, and the user knows which it was.
 */
export function resolveCruiseKind(
  requested: CruiseKind | undefined,
  shipKind: string | null | undefined
): CruiseKind {
  if (requested) return requested;
  if (isCruiseKind(shipKind)) return shipKind;
  return DEFAULT_CRUISE_KIND;
}

/** Whether a stored row is a river cruise. Anything unknown reads as ocean. */
export function isRiverCruise(cruise: { kind?: string | null }): boolean {
  return cruise.kind === "river";
}

/**
 * Whether a stop is a SEA DAY — the one rule every cruise figure asks (the
 * rollup's sea days and streak, the badges, the day pattern of the insights).
 * A stop marked at sea is one only on an ocean cruise: a river cruise's day
 * between ports is spent on the river, and calling it a sea day would say
 * something that never happened (#359). It is not a port day either — it is
 * neither, and each caller says so in its own terms.
 */
export function isSeaDay(cruise: { kind?: string | null }, stop: { isAtSea: boolean }): boolean {
  return stop.isAtSea && !isRiverCruise(cruise);
}
