import { canonicalizeCompanionName } from "../../utils/companionName";

/**
 * An entry's denormalised `companions` name array after one person was renamed
 * or merged: every spelling whose canonical form is in `from` becomes `to`, and
 * that person then appears once, first occurrence kept — the same rule the
 * join rows follow (the lower position survives a merge).
 *
 * Returns `null` when nothing changes, so a caller writes (and bumps the row's
 * `updated_at`, which is what makes the phone re-read it) only the rows that
 * actually named the person.
 */
export function rewriteCompanionNames(
  names: readonly string[],
  from: ReadonlySet<string>,
  to: string
): string[] | null {
  const toCanonical = canonicalizeCompanionName(to);
  let touched = false;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    const canonical = canonicalizeCompanionName(name);
    const replaced = from.has(canonical);
    if (replaced) touched = true;
    const identity = replaced ? toCanonical : canonical;
    // A second occurrence of the renamed person (the merge put the source's
    // spelling beside the target's) collapses into the first. Other names are
    // left exactly as they are, duplicates included — not this write's business.
    if (identity === toCanonical) {
      if (seen.has(identity)) {
        touched = true;
        continue;
      }
      seen.add(identity);
    }
    out.push(replaced ? to : name);
  }
  if (!touched) return null;
  // A rename that only re-spells a name already spelled that way is no change.
  return out.length === names.length && out.every((n, i) => n === names[i]) ? null : out;
}
