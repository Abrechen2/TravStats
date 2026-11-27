import type { JSX } from "react";
import type { CustomPlaceCategory } from "../../lib/api/placeCategories";
import { placeCategoryIcon } from "../../lib/placeCategoryDisplay";
import { Icon } from "../ui/Icon";

/** A place category as its line icon (built-in, or a custom one's stored glyph mapped). */
export function PlaceCategoryGlyph({
  category,
  customs,
  size = 16,
}: {
  category: string;
  customs: readonly CustomPlaceCategory[];
  size?: 14 | 16 | 18 | 20;
}): JSX.Element {
  return <Icon name={placeCategoryIcon(category, customs)} size={size} />;
}
