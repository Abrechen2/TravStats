import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import OverflowMenu from "../ui/OverflowMenu";
import { useChangeHistoryMenu, type ChangeHistoryTarget } from "./useChangeHistoryMenu";

/**
 * A bare ⋯ whose only item is "Änderungsverlauf", for the places that have no menu
 * of their own (a visit row, a cruise day, an expense dialog). Where the entry
 * already has a ⋯, its menu carries the item instead (`useChangeHistoryMenu`).
 */
export default function ChangeHistoryMenuButton(target: ChangeHistoryTarget): JSX.Element {
  const { t } = useTranslation(["common"]);
  const history = useChangeHistoryMenu(target);
  return (
    <OverflowMenu
      entries={[history.entry]}
      label={t("common:buttons.moreActions")}
      testId="change-history-menu"
      stopPropagation
    >
      {history.node}
    </OverflowMenu>
  );
}
