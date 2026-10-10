/**
 * The entries a badge's progress stands on (forgejo#265), found by asking the
 * badge's OWN measure over subsets of its rows — never a second copy of the
 * rule. Every family (`badgeFamily.ts`) supplies its rows and a `progress`
 * that runs the badge check over any subset of them.
 *
 * The answer is a WITNESS: a subset of rows whose progress equals the badge's
 * progress over all of them. For a count that is every counted row; for a set
 * ("15 airlines") one row per member; for a record or a yes/no badge the row
 * that holds it; for "most flights on one route" the flights on that route.
 * Each listed row carries what it ADDED to the progress in chronological
 * order, so the contributions add up to the badge's figure — the evidence
 * contract's sum rule holds by construction.
 *
 * THE WORK IS BOUNDED (security review of forgejo#265). Every evaluation of
 * `progress` is charged to one budget — the number of evaluations AND the
 * rows they fold, summed — evaluations run one at a time, never as an
 * unbounded `Promise.all`, and a family that knows its per-row shares
 * (`shares`) skips the subset search entirely. When the budget runs out the
 * witness ABSTAINS (`exhausted`): the caller reports the figure with no
 * per-entry split, never a half-shrunk set presented as the answer.
 */

export interface WitnessBudget {
  /** Most `progress` evaluations per witness. */
  evaluations: number;
  /** Most rows folded per witness, summed over every evaluation's subset. */
  rows: number;
}

/** Sized for a few thousand entries per badge on a single request. */
export const DEFAULT_WITNESS_BUDGET: WitnessBudget = { evaluations: 2_000, rows: 400_000 };

export type Witness<R> =
  | { exhausted: false; rows: R[]; contributions: number[]; progress: number }
  /** The budget ran out: the progress is known, the split is not given. */
  | { exhausted: true; progress: number };

class BudgetExhausted extends Error {}

/** Charges every evaluation; throws once either bound would be passed. */
function metered<R>(
  progress: (subset: readonly R[]) => Promise<number>,
  budget: WitnessBudget
): (subset: readonly R[]) => Promise<number> {
  let evaluations = 0;
  let rows = 0;
  return async (subset) => {
    evaluations += 1;
    rows += subset.length;
    if (evaluations > budget.evaluations || rows > budget.rows) throw new BudgetExhausted();
    return progress(subset);
  };
}

export interface WitnessOptions<R> {
  budget?: WitnessBudget;
  /**
   * Each row's own share, for a family whose measure is a plain sum of
   * per-row shares — the witness is then the rows with a share, with no
   * subset evaluated. Null when the family cannot say for this badge.
   */
  shares?: ((rows: readonly R[]) => Promise<number[] | null>) | null;
}

export async function findWitness<R>(
  rows: readonly R[],
  progress: (subset: readonly R[]) => Promise<number>,
  options: WitnessOptions<R> = {}
): Promise<Witness<R>> {
  // The figure itself is one fold of every row, outside the budget: it is the
  // badge's own number and must be answered even when its split is not.
  const target = await progress(rows);
  if (target <= 0 || rows.length === 0) {
    return { exhausted: false, rows: [], contributions: [], progress: target };
  }
  const direct = options.shares ? await options.shares(rows) : null;
  if (direct !== null && direct.reduce((sum, s) => sum + s, 0) === target) {
    const kept = rows.flatMap((row, i) => (direct[i] > 0 ? [{ row, share: direct[i] }] : []));
    return {
      exhausted: false,
      rows: kept.map((k) => k.row),
      contributions: kept.map((k) => k.share),
      progress: target,
    };
  }
  const evaluate = metered(progress, options.budget ?? DEFAULT_WITNESS_BUDGET);
  try {
    return { exhausted: false, ...(await search(rows, target, evaluate)), progress: target };
  } catch (error) {
    if (error instanceof BudgetExhausted) return { exhausted: true, progress: target };
    throw error;
  }
}

async function search<R>(
  rows: readonly R[],
  target: number,
  evaluate: (subset: readonly R[]) => Promise<number>
): Promise<{ rows: R[]; contributions: number[] }> {
  // An additive measure: each row alone adds exactly what it adds in company,
  // so the rows with a share ARE the witness. One row per evaluation, in turn.
  const alone: number[] = [];
  for (const row of rows) alone.push(await evaluate([row]));
  const sharing = rows.filter((_, i) => alone[i] > 0);
  const shares = alone.filter((p) => p > 0);
  const additive = shares.reduce((sum, p) => sum + p, 0) === target;
  if (additive && (sharing.length === rows.length || (await evaluate(sharing)) === target)) {
    return { rows: sharing, contributions: shares };
  }

  // Shrink: start from the rows with a share of their own when they reach the
  // target alone (sets, records, yes/no), else from every row (pairs such as a
  // tight connection, where no row scores alone).
  let keep: R[] =
    sharing.length > 0 && sharing.length < rows.length && (await evaluate(sharing)) === target
      ? [...sharing]
      : [...rows];
  for (let size = Math.ceil(keep.length / 2); size >= 1; size = Math.floor(size / 2)) {
    let i = 0;
    while (i < keep.length) {
      const candidate = [...keep.slice(0, i), ...keep.slice(i + size)];
      if (candidate.length > 0 && (await evaluate(candidate)) === target) keep = candidate;
      else i += size;
    }
    if (size === 1) break;
  }

  // What each row added, in order; the shares telescope to the target.
  const contributions: number[] = [];
  let before = 0;
  for (let i = 0; i < keep.length; i += 1) {
    const now = i === keep.length - 1 ? target : await evaluate(keep.slice(0, i + 1));
    contributions.push(now - before);
    before = now;
  }
  return { rows: keep, contributions };
}
