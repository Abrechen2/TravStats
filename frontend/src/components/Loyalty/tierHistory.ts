import type { TierPeriod } from "../../types/loyalty";

/** A period as the editor holds it: every field a string, the end possibly empty. */
export interface TierPeriodDraft {
  key: string;
  tier: string;
  validFrom: string;
  validUntil: string;
}

let nextKey = 0;
const freshKey = (): string => `period-${(nextKey += 1)}`;

export function toDrafts(periods: readonly TierPeriod[]): TierPeriodDraft[] {
  return periods.map((p) => ({
    key: p.id ?? freshKey(),
    tier: p.tier,
    validFrom: p.validFrom,
    validUntil: p.validUntil ?? "",
  }));
}

export function emptyDraft(): TierPeriodDraft {
  return { key: freshKey(), tier: "", validFrom: "", validUntil: "" };
}

/**
 * The drafts as the server takes them, or null when one would be refused —
 * the same rule as `tierPeriodSchema` on the server (a status, a start, and
 * an end not before the start), checked here so the reader sees which row is
 * wrong before a round trip says only that something was.
 */
export function draftsToPeriods(
  drafts: readonly TierPeriodDraft[]
): Array<Omit<TierPeriod, "id">> | null {
  const periods: Array<Omit<TierPeriod, "id">> = [];
  for (const draft of drafts) {
    const tier = draft.tier.trim();
    if (!tier || !draft.validFrom) return null;
    if (draft.validUntil && draft.validUntil < draft.validFrom) return null;
    periods.push({ tier, validFrom: draft.validFrom, validUntil: draft.validUntil || null });
  }
  return periods;
}
