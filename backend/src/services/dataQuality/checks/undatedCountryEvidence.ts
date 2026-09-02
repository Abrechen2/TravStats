import type { FlaggedRecord } from "../../../schemas/dataQualityFlag";
import { resolveEvidenceCountry } from "../countryText";
import type { DataQualityFinding } from "../types";

/**
 * A country the account holds NO dated evidence for.
 *
 * This is design §1.4 applied honestly. The owner decided on 2026-09-02 that a
 * lodging with no stay counts as a night — "somebody took the trouble to enter
 * the house, so they were there, they simply no longer remember when". The
 * decision is right and it has a price the design names out loud: **data
 * quality becomes decisive**, because one wrongly imported house is now a
 * country. Five countries in the owner's own account exist this way.
 *
 * So the flag is not "this country is wrong". It is "this country rests on
 * evidence that carries no date, and here are the records it rests on" — which
 * is exactly how the Bucharest hotel was found in the first place: by looking at
 * WHY a country was listed, never at the total.
 *
 * **The count does not move.** The country keeps counting under the stated rule
 * while the question is open. Withholding it because a check was suspicious
 * would be the same invisible arithmetic from the other direction.
 *
 * ## The grain is the country, not the house
 *
 * An undated house is ordinary and flagging every one of them would be noise
 * nobody reads. A country whose ENTIRE case is undated is the finding, so there
 * is one flag per country and `details.records` names every record behind it —
 * §3.4's "one click away and editable".
 *
 * ## What counts as dated, and the limit that follows
 *
 * Dated evidence is contributed by flights, port calls, stays with dates and
 * place visits with dates. Undated evidence is contributed ONLY by a house or a
 * place: those are the two records a user can enter without a date and still
 * mean "I was there".
 *
 * Callers therefore pass flights and port calls only where they carry a date —
 * the same cut the passport's own gathering makes for flights. The limit that
 * buys: a country whose only evidence is an UNDATED port call is neither dated
 * nor flagged here. It is a real gap, and it is preferred to the alternative,
 * which would be a flag naming records the UI has no page to link to.
 */

/** One record's claim on a country, reduced to what this check reads. */
export interface CountryTouch {
  /** Free text or a code, as the record stores it. */
  country: string | null;
  /** Null means the record carries no date at all — the case this check is about. */
  at: Date | null;
  /**
   * The subject to link to, for an undated touch. Null for a dated one: a dated
   * touch only ever votes "this country has a date" and is never named.
   */
  record: FlaggedRecord | null;
}

export function findUndatedCountryEvidence(touches: readonly CountryTouch[]): DataQualityFinding[] {
  const dated = new Set<string>();
  const undated = new Map<string, FlaggedRecord[]>();

  for (const touch of touches) {
    const code = resolveEvidenceCountry(touch.country);
    // A touch whose country cannot be resolved contributes nothing rather than
    // a guess — the same cut `shared/countryEvidence.ts` makes, and it must be
    // the same one, or a flag could name a country nothing counts.
    if (!code) continue;

    if (touch.at !== null) {
      dated.add(code);
      continue;
    }
    if (!touch.record) continue;

    const records = undated.get(code);
    if (records) {
      records.push(touch.record);
    } else {
      undated.set(code, [touch.record]);
    }
  }

  const findings: DataQualityFinding[] = [];
  // Sorted so a re-run writes the same rows in the same order; the flags are
  // keyed by country anyway, but a stable order keeps a diff of two runs
  // readable when something does go wrong.
  for (const code of [...undated.keys()].sort()) {
    if (dated.has(code)) continue;
    findings.push({
      entityType: "country",
      entityId: code,
      kind: "undated_country_evidence",
      details: { countryCode: code, records: undated.get(code) ?? [] },
    });
  }

  return findings;
}
