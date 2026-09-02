/**
 * Frontend MIRROR of `backend/src/shared/lodgingCounting.ts`, following the same
 * convention as `shared/domains.ts` and `shared/statusDerivation.ts`.
 *
 * Owner rule (2026-08-15): a stay counts as a visit only once its check-out is
 * past; until then it is *planned*. A cancelled stay counts nowhere, and a house
 * that is merely noted down (`Lodging.visited === false`) is not a visit at all.
 *
 * The client needs its own copy because the cross-domain adapters expand raw
 * stays into day buckets locally rather than asking the server for them — see
 * `lib/stats/domain-stats/lodgingStatsAdapter.ts`. Both sides are covered by
 * tests asserting the same truth table.
 */
import { deriveLodgingStatus } from "./statusDerivation";

export type LodgingCountState = "visited" | "planned" | "excluded";

export interface CountableStay {
  status: string;
  checkIn: Date | null;
  checkOut: Date | null;
}

export interface CountableLodging {
  visited: boolean;
}

/**
 * An in-progress stay counts as `planned` — the rule is "until the check-out is
 * past". A stay with no dates falls back to its stored status: there is nothing
 * to derive from, and an undated stay is one recorded after the fact, so
 * "completed" there is a statement rather than a stale cache.
 */
export function classifyStay(stay: CountableStay, now?: Date): LodgingCountState {
  const derived = deriveLodgingStatus({
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
    current: stay.status,
    now,
  });
  if (derived === "cancelled") return "excluded";
  if (derived === "completed") return "visited";
  return "planned";
}

/**
 * A house is visited when the user says they have been there AND a stay of
 * theirs is over. With no stays at all the claim stands on its own (an earlier
 * owner decision keeps a hand-entered hotel countable); with only future stays
 * it is planned, because `visited` defaults to `true` for anything parsed from a
 * booking — including a booking for next month.
 *
 * A house whose stays were ALL CANCELLED is `excluded` (owner's decision,
 * 2026-09-02). It looks exactly like the stay-less case — neither list holds
 * anything to count — and says the opposite: an absent stay is a forgotten date,
 * a cancelled stay is the record saying the visit did not happen. Separated by
 * whether any stay exists at all, never by what the states say.
 */
export function classifyLodging(
  lodging: CountableLodging,
  stayStates: readonly LodgingCountState[]
): LodgingCountState {
  if (!lodging.visited) return "excluded";
  if (stayStates.some((s) => s === "visited")) return "visited";
  if (stayStates.some((s) => s === "planned")) return "planned";
  if (stayStates.length > 0) return "excluded";
  return "visited";
}

export function isVisited(state: LodgingCountState): boolean {
  return state === "visited";
}
