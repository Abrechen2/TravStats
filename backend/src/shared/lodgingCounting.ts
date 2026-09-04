/**
 * Single source of truth for "does this count?" in every lodging statistic.
 *
 * Owner rule (2026-08-15): a stay counts as a visit only once its check-out is
 * past. Until then it is *planned* — never part of an actual figure. A
 * cancelled stay counts nowhere, and a house that is merely noted down
 * (`Lodging.visited === false`, what a saved-places import produces) is not a
 * visit at all.
 *
 * Why this delegates to `deriveLodgingStatus` rather than reading
 * `LodgingStay.status`: that column is a CACHE converged by an hourly sweep
 * (see shared/statusDerivation.ts). A stay booked for 2024 and never touched
 * again still says "scheduled" between sweeps, and on a fresh import it may say
 * whatever the source said. Deriving from the dates makes the answer
 * independent of when the sweep last ran, while the passthrough inside the
 * deriver keeps "cancelled" authoritative — that one IS a user statement, not
 * an inference from the calendar.
 *
 * MIRRORED in `frontend/src/shared/lodgingCounting.ts` (same convention as
 * shared/domains.ts and shared/statusDerivation.ts). Change both together.
 */
import { deriveLodgingStatus } from "./statusDerivation";

/**
 * Which bucket a stay or a house belongs to.
 *
 * - `visited`  — happened, feeds every actual figure
 * - `planned`  — lies in the future, feeds forward-looking figures only
 * - `excluded` — cancelled, or a house the user only bookmarked
 * - `asserted` — a HOUSE with no stay at all whose `visited` flag is set: the
 *   user's own claim, with nothing to check it against. It counts as a house
 *   (owner decision, 2026-08-15) but proves no place — see `classifyLodging`.
 */
export type LodgingCountState = "visited" | "planned" | "excluded" | "asserted";

export interface CountableStay {
  status: string;
  checkIn: Date | null;
  checkOut: Date | null;
}

export interface CountableLodging {
  visited: boolean;
}

/**
 * An in-progress stay counts as `planned`, not `visited` — the rule is "until
 * the check-out is past", and a stay the user is sitting in right now has not
 * reached it. Nights already slept are therefore not yet in the totals; they
 * arrive the morning the stay ends. Counting a partial stay would mean the
 * figure changes every day on its own, which no other domain does.
 *
 * A stay with NO dates falls back to its stored status, because
 * `deriveLodgingStatus` has nothing to derive from — and that is the right
 * answer, not a gap: an undated stay is one the user is recording after the
 * fact, so the stored "completed" is a statement rather than a stale cache.
 * The default on the column is "completed" for exactly that reason.
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
  // "scheduled" and "in_progress" alike — not over yet.
  return "planned";
}

/**
 * A house is visited when the user says they have been there AND that claim is
 * backed by a stay that is over.
 *
 * A house with NO stays at all is `asserted`: `visited === true` is then the
 * user's own word with nothing to check it against. Two owner decisions meet
 * here and both hold. The first (2026-08-15): a hotel entered by hand without
 * a stay still counts as a house — dropping it would silently lose rows the
 * user deliberately added. The second (forgejo#80): it does NOT prove a city
 * or a country. The import sets the flag by default, so on one real account
 * 155 stay-less houses carried it, and "Länder besucht" said 31 where 21
 * countries had a stay that happened. Counting the house and not the place
 * is what keeps both decisions true; until 2026-09-04 this returned
 * `visited` and the statistics could not tell the two apart.
 *
 * A house whose only stays lie ahead is `planned`, however `visited` reads: the
 * flag defaults to `true` for everything parsed from a booking, including a
 * booking for next month, so the flag alone cannot tell "have been" from "will
 * be". The dates can.
 */
export function classifyLodging(
  lodging: CountableLodging,
  stayStates: readonly LodgingCountState[],
): LodgingCountState {
  if (!lodging.visited) return "excluded";
  if (stayStates.some((s) => s === "visited")) return "visited";
  if (stayStates.some((s) => s === "planned")) return "planned";
  if (stayStates.length === 0) return "asserted";
  // Every stay was cancelled — the house was not, and the user says they
  // have been there.
  return "asserted";
}

/** A house that counts as a house — visited, or asserted without a stay. */
export function countsAsLodging(state: LodgingCountState): boolean {
  return state === "visited" || state === "asserted";
}

/** Convenience for the common "only the ones that actually happened" filter. */
export function isVisited(state: LodgingCountState): boolean {
  return state === "visited";
}
