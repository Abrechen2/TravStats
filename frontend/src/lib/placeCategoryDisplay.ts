import type { CustomPlaceCategory } from "./api/placeCategories";
import type { IconName } from "../components/ui/Icon";
import { PLACE_CATEGORY_ICONS, PLACE_GLYPH_ICON, isPlaceCategory } from "../shared/placeCategories";

/** The shape of the project's `useTranslation().t`. */
export type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Pin glyph for a category nothing defines (an imported label, a deleted one). */
const UNKNOWN_CATEGORY_ICON = PLACE_CATEGORY_ICONS.other;

/**
 * A category's label: a built-in key is translated, anything else is the
 * user's own name (or an imported label) and is shown as written. Looking a
 * custom name up as a translation key would also split it at every ".".
 */
export function placeCategoryLabel(t: Translate, category: string): string {
  return isPlaceCategory(category) ? t(`places:categories.${category}`) : category;
}

/** The line icon for a category; a custom one is looked up in `customs`, its stored glyph mapped. */
export function placeCategoryIcon(
  category: string,
  customs: readonly CustomPlaceCategory[] = []
): IconName {
  if (isPlaceCategory(category)) return PLACE_CATEGORY_ICONS[category];
  const glyph = customs.find((c) => c.name === category)?.icon;
  return (glyph && (PLACE_GLYPH_ICON as Record<string, IconName>)[glyph]) || UNKNOWN_CATEGORY_ICON;
}
