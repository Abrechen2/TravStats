import { isBuiltInCategory } from "../../../shared/ratingCategories";

/** Built-in values by key, own ones by name; a value whose category is unknown is left out. */
export function exportedRatings(
  values: Record<string, number>,
  ownNames: Map<string, string>
): { ratings?: Record<string, number>; ownRatings?: Record<string, number> } {
  const ratings: Record<string, number> = {};
  const ownRatings: Record<string, number> = {};
  for (const [key, value] of Object.entries(values)) {
    if (isBuiltInCategory(key)) ratings[key] = value;
    else {
      const name = ownNames.get(key);
      if (name !== undefined) ownRatings[name] = value;
    }
  }
  return {
    ...(Object.keys(ratings).length > 0 ? { ratings } : {}),
    ...(Object.keys(ownRatings).length > 0 ? { ownRatings } : {}),
  };
}
