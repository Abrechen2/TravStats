import type { JSX } from "react";
import type { Cruise } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";
import RowMenu from "../table/RowMenu";

export interface CruiseRowActionsProps {
  cruise: Cruise;
  onEdit: (c: Cruise) => void;
  onDuplicate: (c: Cruise) => void;
  onDelete: (id: string) => void;
}

/**
 * Edit / duplicate / delete on a cruise row, as one ⋯ (owner, 2026-11-22). The row navigates to
 * the cruise, so the shared row menu stops the click from reaching it.
 */
export default function CruiseRowActions({
  cruise,
  onEdit,
  onDuplicate,
  onDelete,
}: CruiseRowActionsProps): JSX.Element {
  const { t } = useTranslation(["cruise", "common"]);
  return (
    <RowMenu
      testId={`cruise-menu-${cruise.id}`}
      entries={[
        { key: "edit", label: t("common:buttons.edit"), onSelect: () => onEdit(cruise) },
        { key: "dup", label: t("cruise:list.duplicate"), onSelect: () => onDuplicate(cruise) },
        {
          key: "delete",
          label: t("common:buttons.delete"),
          danger: true,
          onSelect: () => onDelete(cruise.id),
        },
      ]}
    />
  );
}
