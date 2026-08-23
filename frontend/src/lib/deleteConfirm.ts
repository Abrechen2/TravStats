/**
 * The sentence a delete dialog says, in one shape for every domain.
 *
 * Before this, six delete dialogs said six different things. The cruise list
 * named the ship but never warned that it was permanent; the cruise detail
 * page warned but never said which cruise; neither mentioned that legs, leg
 * routes, port calls and companions go with it. Only the lodging dialog named
 * a quantity, and only the trip dialog said what SURVIVES — which turned out
 * to be the most useful line of the six, and the one worth generalising.
 *
 * The shape is: **what · how much goes with it · what stays**. The words live
 * in the i18n files, because German sentences do not survive being assembled
 * from fragments; this module only decides WHICH of the two forms applies, so
 * that decision cannot drift between a domain's list and its detail page —
 * exactly where the six had drifted apart.
 */

type Translate = (key: string, options?: Record<string, unknown>) => string;

export interface CountedDeleteKeys {
  /** Plural-aware key naming the subject AND the quantity that goes with it. */
  counted: string;
  /** Used when the count is zero — "mit 0 Hafenanläufen" is noise, not information. */
  empty: string;
}

export function countedDeleteMessage(
  t: Translate,
  keys: CountedDeleteKeys,
  name: string,
  count: number
): string {
  return count > 0 ? t(keys.counted, { name, count }) : t(keys.empty, { name });
}

/** Red confirm button — the same one on every delete dialog. */
export const DELETE_BUTTON_CLASS = "bg-[var(--danger)] hover:opacity-90";
