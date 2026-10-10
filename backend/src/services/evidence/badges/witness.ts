/**
 * The entries a badge's progress stands on (forgejo#265), found by asking the
 * badge's OWN measure over subsets of its rows — never a second copy of the
 * rule. Every family (`badgeFamilies.ts`) supplies its rows and a `progress`
 * that runs the badge check over any subset of them.
 *
 * The answer is a WITNESS: a subset of rows whose progress equals the badge's
 * progress over all of them, as small as the budget allows. For a count that
 * is every counted row; for a set ("15 airlines") one row per member; for a
 * record or a yes/no badge the row that holds it; for "most flights on one
 * route" the flights on that route. Each listed row carries what it ADDED to
 * the progress in chronological order (`contribution`), so the contributions
 * always add up to the badge's figure — the evidence contract's sum rule holds
 * by construction, whatever the kind of badge.
 *
 * Monotone measures (more entries never lower the progress) give a minimal
 * witness. A non-monotone one still gets a valid witness: a row is only ever
 * dropped when the progress without it is unchanged.
 */

export interface Witness<R> {
  rows: R[];
  /** What each row added, in order; sums to the progress. */
  contributions: number[];
  progress: number;
}

export interface WitnessOptions {
  /** Upper bound on progress evaluations spent shrinking the set. */
  budget?: number;
}

const DEFAULT_BUDGET = 600;

export async function findWitness<R>(
  rows: readonly R[],
  progress: (subset: readonly R[]) => Promise<number>,
  options: WitnessOptions = {}
): Promise<Witness<R>> {
  const target = await progress(rows);
  if (target <= 0 || rows.length === 0) return { rows: [], contributions: [], progress: target };
  let budget = options.budget ?? DEFAULT_BUDGET;

  // Fast path — an additive measure: each row alone adds exactly what it adds
  // in company, so the rows with a share ARE the witness.
  const alone = await Promise.all(rows.map((row) => progress([row])));
  const sharing = rows.filter((_, i) => alone[i] > 0);
  const shares = alone.filter((p) => p > 0);
  if (
    shares.reduce((sum, p) => sum + p, 0) === target &&
    (sharing.length === rows.length || (await progress(sharing)) === target)
  ) {
    return { rows: sharing, contributions: shares, progress: target };
  }

  // Shrink: start from the rows with a share of their own when they reach the
  // target alone (sets, records, yes/no), else from every row (pairs such as a
  // tight connection, where no row scores alone).
  let keep: R[] =
    sharing.length < rows.length && (await progress(sharing)) === target ? [...sharing] : [...rows];
  for (
    let size = Math.ceil(keep.length / 2);
    size >= 1 && budget > 0;
    size = Math.floor(size / 2)
  ) {
    let i = 0;
    while (i < keep.length && budget > 0) {
      const candidate = [...keep.slice(0, i), ...keep.slice(i + size)];
      budget -= 1;
      if (candidate.length > 0 && (await progress(candidate)) === target) keep = candidate;
      else i += size;
    }
    if (size === 1) break;
  }

  // What each row added, in order. The prefix of all rows is the target, so
  // the shares telescope to it exactly.
  const contributions: number[] = [];
  let before = 0;
  for (let i = 0; i < keep.length; i += 1) {
    const now = i === keep.length - 1 ? target : await progress(keep.slice(0, i + 1));
    contributions.push(now - before);
    before = now;
  }
  return { rows: keep, contributions, progress: target };
}
