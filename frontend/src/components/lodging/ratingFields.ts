import type { RatingCategoriesView } from "../../lib/api/lodging";
import { RATING_CATEGORIES } from "../../shared/ratingCategories";

export interface RatingField {
  key: string;
  label: string;
}

/** A copy of `ratings` with one category set, or removed when `value` is null. */
export function withRating(
  ratings: Record<string, number>,
  key: string,
  value: number | null
): Record<string, number> {
  const next = { ...ratings };
  if (value === null) delete next[key];
  else next[key] = value;
  return next;
}

/**
 * What to send: the draft's values, plus an explicit null for every category
 * the stored stay carried and the draft no longer does. An absent key means
 * "leave it alone" to the server, so a cleared rating must be a null.
 */
export function ratingsPayload(
  stored: Record<string, number>,
  draft: Record<string, number>
): Record<string, number | null> {
  const out: Record<string, number | null> = { ...draft };
  for (const key of Object.keys(stored)) if (!(key in draft)) out[key] = null;
  return out;
}

/**
 * The pickers to draw. `active` are the switched-on built-in categories (in
 * vocabulary order) followed by the account's own, undeleted ones. `retired`
 * are categories NOT offered any more for which this stay still has a value -
 * shown so the user can see and clear what still counts in the overall.
 */
export function ratingFields(
  view: RatingCategoriesView,
  values: Record<string, number>,
  labelOf: (key: string) => string
): { active: RatingField[]; retired: RatingField[] } {
  const activeKeys = [
    ...RATING_CATEGORIES.filter((key) => view.active.includes(key)),
    ...view.custom.filter((c) => !c.deleted).map((c) => c.key),
  ];
  const retiredKeys = Object.keys(values).filter((key) => !activeKeys.includes(key));
  const toField = (key: string): RatingField => ({ key, label: labelOf(key) });
  return { active: activeKeys.map(toField), retired: retiredKeys.map(toField) };
}
