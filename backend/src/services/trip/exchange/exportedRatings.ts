import { MAX_CUSTOM_CATEGORY_NAME, isBuiltInCategory } from "../../../shared/ratingCategories";

export interface OwnCategoryInfo {
  name: string;
  deleted: boolean;
}

/**
 * The file name of every own category, allocated ONCE per export over all of
 * the account's categories - not per stay. Names are unique among LIVE
 * categories only, so a deleted "Aussicht" and a live one can coexist; if each
 * stay allocated on its own, the deleted one would be "Aussicht (2)" on a stay
 * that also carries the live one and plain "Aussicht" on a stay that does not,
 * and import would merge it into the live category. Live ones keep their name,
 * a later duplicate becomes "Aussicht (2)", "Aussicht (3)" ... in a stable
 * order, and imports back as its own category. The base is cut so the result
 * still fits the name limit.
 */
export function allocateOwnNames(own: Map<string, OwnCategoryInfo>): Map<string, string> {
  const ordered = [...own.keys()].sort(
    (a, b) => Number(own.get(a)!.deleted) - Number(own.get(b)!.deleted) || a.localeCompare(b)
  );
  const used = new Set<string>();
  const out = new Map<string, string>();
  for (const key of ordered) {
    const base = own.get(key)!.name;
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n += 1) {
      const suffix = ` (${n})`;
      name = `${base.slice(0, MAX_CUSTOM_CATEGORY_NAME - suffix.length)}${suffix}`;
    }
    used.add(name.toLowerCase());
    out.set(key, name);
  }
  return out;
}

/** Built-in values by key, own ones by the export-wide name from `allocateOwnNames`; a value whose category is unknown is left out. */
export function exportedRatings(
  values: Record<string, number>,
  exportNames: Map<string, string>
): { ratings?: Record<string, number>; ownRatings?: Record<string, number> } {
  const ratings: Record<string, number> = {};
  const ownRatings: Record<string, number> = {};
  for (const [key, value] of Object.entries(values)) {
    if (isBuiltInCategory(key)) ratings[key] = value;
    else {
      const name = exportNames.get(key);
      if (name !== undefined) ownRatings[name] = value;
    }
  }
  return {
    ...(Object.keys(ratings).length > 0 ? { ratings } : {}),
    ...(Object.keys(ownRatings).length > 0 ? { ownRatings } : {}),
  };
}
