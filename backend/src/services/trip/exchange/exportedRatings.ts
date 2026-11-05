import { MAX_CUSTOM_CATEGORY_NAME, isBuiltInCategory } from "../../../shared/ratingCategories";

export interface OwnCategoryInfo {
  name: string;
  deleted: boolean;
}

/**
 * The file name of each own category a stay carries. Names are unique among an
 * account's LIVE categories only, so a deleted "Aussicht" and a live
 * (renamed) "Aussicht" can sit on one stay; writing both under the bare name
 * would let one overwrite the other. Live ones keep their name, a later
 * duplicate becomes "Aussicht (2)", "Aussicht (3)" ... in a stable order, and
 * imports back as its own category - no value is lost, at the price of a
 * visibly numbered twin. The base is cut so the result still fits the name limit.
 */
function fileNames(keys: string[], own: Map<string, OwnCategoryInfo>): Map<string, string> {
  const ordered = keys
    .filter((k) => own.has(k))
    .sort(
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

/** Built-in values by key, own ones by collision-free name; a value whose category is unknown is left out. */
export function exportedRatings(
  values: Record<string, number>,
  own: Map<string, OwnCategoryInfo>
): { ratings?: Record<string, number>; ownRatings?: Record<string, number> } {
  const ratings: Record<string, number> = {};
  const ownRatings: Record<string, number> = {};
  const names = fileNames(Object.keys(values), own);
  for (const [key, value] of Object.entries(values)) {
    if (isBuiltInCategory(key)) ratings[key] = value;
    else {
      const name = names.get(key);
      if (name !== undefined) ownRatings[name] = value;
    }
  }
  return {
    ...(Object.keys(ratings).length > 0 ? { ratings } : {}),
    ...(Object.keys(ownRatings).length > 0 ? { ownRatings } : {}),
  };
}
