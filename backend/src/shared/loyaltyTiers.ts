/**
 * Which status a loyalty card held in a given calendar year
 * (loyalty-status-history-dated).
 *
 * Hotel programmes count status per calendar year, and the lodging statistics
 * list nights per programme and year. Until a card carried dated periods the
 * only tier there was to show was today's, and printing it beside 2019 claimed
 * a status that may not have existed then (`d0fb0be1` stopped that). A dated
 * history makes the per-year value derivable, and this is the one place that
 * derives it.
 *
 * Two answers that must not be confused:
 *   - `null` — the card has NO dated history. Nothing is known about the year.
 *   - `[]`   — the history exists and no period touches the year: the user
 *              has said what they held and when, and that year is not in it.
 *
 * A year can hold several tiers (Silver until March, Gold after), so the
 * answer is a list, in the order they were reached, each tier once.
 */

export interface DatedTier {
  tier: string;
  validFrom: Date;
  /** null: still held. */
  validUntil: Date | null;
}

export function tiersHeldInYear(
  periods: readonly DatedTier[] | null | undefined,
  year: number
): string[] | null {
  if (!periods || periods.length === 0) return null;
  const yearStart = Date.UTC(year, 0, 1);
  const yearEnd = Date.UTC(year, 11, 31);
  const touching = periods
    .filter(
      (p) =>
        p.validFrom.getTime() <= yearEnd &&
        (p.validUntil === null || p.validUntil.getTime() >= yearStart)
    )
    .sort((a, b) => a.validFrom.getTime() - b.validFrom.getTime());
  const tiers: string[] = [];
  for (const period of touching) {
    if (!tiers.includes(period.tier)) tiers.push(period.tier);
  }
  return tiers;
}
