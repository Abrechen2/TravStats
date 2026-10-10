import type { EvidenceEntry } from "../../../schemas/evidence";

/**
 * One family of badges: the rows a badge of that family is measured over, how
 * each row is shown in the evidence panel, and the badge's OWN progress over
 * any subset of those rows (`witness.ts` asks it repeatedly).
 */
export interface BadgeFamily<R> {
  rows: readonly R[];
  entryOf: (row: R) => Omit<EvidenceEntry, "contribution">;
  progress: (subset: readonly R[]) => Promise<number>;
  /** Per-row shares where the badge's measure is a plain sum of them (`witness.ts`). */
  shares?: ((rows: readonly R[]) => Promise<number[] | null>) | null;
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

/**
 * Most rows whose per-row shares a family folds one by one. Each fold is of
 * ONE row, so the work is linear in the account; past this the witness
 * search takes over, under its own budget.
 */
export const MAX_SHARE_ROWS = 20_000;

/** Per-row shares by folding each row alone, in turn — for a declared plain sum. */
export function sharesByFold<R>(
  progress: (subset: readonly R[]) => Promise<number>
): (rows: readonly R[]) => Promise<number[] | null> {
  return async (rows) => {
    if (rows.length > MAX_SHARE_ROWS) return null;
    const shares: number[] = [];
    for (const row of rows) shares.push(await progress([row]));
    return shares;
  };
}
