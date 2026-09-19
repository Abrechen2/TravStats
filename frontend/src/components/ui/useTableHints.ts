import type { ReactNode } from "react";
import { useTranslation } from "../../hooks/useTranslation";

/**
 * The two sentences a logbook table says under itself — columns that stepped
 * aside, and a sideways scroll. The Table primitive carries no copy, and four
 * pages spelling the same two props out is how one of them drifts.
 */
export function useTableHints(): {
  hiddenColumnsHint: (count: number) => ReactNode;
  scrollHint: ReactNode;
} {
  const { t } = useTranslation(["common"]);
  return {
    hiddenColumnsHint: (count) => t("common:table.hiddenColumns", { count }),
    scrollHint: t("common:table.scrollHint"),
  };
}
