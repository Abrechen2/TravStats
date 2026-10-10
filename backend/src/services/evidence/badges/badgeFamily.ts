import type { EvidenceEntry } from "../../../schemas/evidence";

/**
 * One family of badges: the rows a badge of that family is measured over, how
 * each row is shown in the evidence panel, and the badge's OWN progress over
 * any subset of those rows (`witness.ts` asks it repeatedly, under one budget).
 *
 * `progress` MUST BE PURE over the rows the family loaded: no database query,
 * no network, nothing but folding the subset it is handed (it is async only
 * because the core fold reads the in-memory airport cache, warmed by the
 * family's own first fold). The family loads everything once, up front.
 * `badgeFamilies.purity.test.ts` watches every query while each family's
 * `progress` runs and fails on one.
 */
export interface BadgeFamily<R> {
  rows: readonly R[];
  entryOf: (row: R) => Omit<EvidenceEntry, "contribution">;
  progress: (subset: readonly R[]) => Promise<number>;
  /**
   * A row's own share, from its own data, where the badge's measure is a
   * plain sum of them — pure, no `progress` call (`witness.ts`). Every family
   * that declares one is tested to sum to `progress(rows)`.
   */
  share?: ((row: R) => number) | null;
}

/** The two fields of an achievement every badge check reads. */
export interface BadgeRule {
  requirementType: string;
  requirement: number;
}

/** A check's verdict as a number: SKIP (an unmeasured source) and "not mine" read as 0. */
export function progressOf(verdict: { progress: number } | null | "skip"): number {
  return verdict && verdict !== "skip" ? verdict.progress : 0;
}

/** A family whose row type no caller needs to know: the witness only hands rows back. */
export type ErasedFamily = BadgeFamily<unknown>;

export function erase<R>(family: BadgeFamily<R>): ErasedFamily {
  return family as unknown as ErasedFamily;
}
