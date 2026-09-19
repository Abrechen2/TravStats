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

/**
 * The extra line about the kept originals that go with the record.
 *
 * Appended rather than woven in, for the same reason the counted form is a
 * key and not an assembly: five domains phrase their own sentence five ways,
 * and there is no German clause that can be spliced into all of them. A line
 * of its own says the one thing every one of them was silent about.
 *
 * `null` is "unknown", not "none" — the count is fetched while the dialog is
 * already opening (`hooks/useDocumentCount.ts`), so the first paint has no
 * answer yet, and neither does a paint after a failed request. Both show the
 * base message; when the answer arrives the line appears. The alternative,
 * holding the dialog until the count is in, would make a delete button feel
 * broken to buy a warning nobody asked to wait for.
 *
 * Why it is worth saying at all: `Document` cascades from all five entry
 * types, measured live against the database by
 * `backend/src/__tests__/integrity/cascades.integrity.test.ts`, and the
 * write-path audit of 2026-09-19 (findings 3 and 6) found no dialog that
 * named it.
 */
export function withDocumentNote(
  message: string,
  t: Translate,
  documentCount: number | null
): string {
  if (documentCount === null || documentCount <= 0) return message;
  return `${message}\n${t("documents:deleteCascadeNote", { count: documentCount })}`;
}

/** Red confirm button — the same one on every delete dialog. */
export const DELETE_BUTTON_CLASS = "bg-[var(--danger)] hover:opacity-90";
