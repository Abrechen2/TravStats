import { useCallback, useEffect } from "react";

import { useTranslation } from "./useTranslation";
import { useRatingCategoriesStore } from "../store/lodgingRatingCategoriesStore";
import { customCategoryId, isBuiltInCategory } from "../shared/ratingCategories";

/**
 * The rating categories of the account plus a labeller. Loads once per
 * session (the first consumer asks), and `labelOf` resolves a built-in key
 * through i18n and an own key through its stored name - deleted ones included,
 * because a stay can still carry a value under a deleted category.
 */
export function useRatingCategories() {
  const { t } = useTranslation(["lodging"]);
  const view = useRatingCategoriesStore((s) => s.view);
  const loaded = useRatingCategoriesStore((s) => s.loaded);
  const load = useRatingCategoriesStore((s) => s.load);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const labelOf = useCallback(
    (key: string): string => {
      if (isBuiltInCategory(key)) return t(`lodging:ratingCategory.${key}`);
      const id = customCategoryId(key);
      const own = id === null ? undefined : view.custom.find((c) => c.id === id);
      // Not (yet) known: show something honest rather than a raw uuid.
      return own?.name ?? t("lodging:ratingCategory.unknown");
    },
    [t, view.custom]
  );

  return { view, loaded, labelOf };
}
