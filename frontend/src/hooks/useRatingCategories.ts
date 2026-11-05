import { useCallback, useEffect } from "react";

import { useTranslation } from "./useTranslation";
import { useAuthStore } from "../store/authStore";
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

  // The categories belong to the signed-in account: a different user (logout,
  // login on a shared browser) must never see the previous one's own names.
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const ownerOfView = useRatingCategoriesStore((s) => s.ownerId);
  useEffect(() => {
    if (userId === null) return;
    if (!loaded || ownerOfView !== userId) void load(userId);
  }, [loaded, ownerOfView, userId, load]);

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
