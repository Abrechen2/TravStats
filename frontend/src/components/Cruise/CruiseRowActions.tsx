import type { JSX } from "react";
import type { Cruise } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";
import { RowActionButton, RowActions } from "../table/RowActionButton";

export interface CruiseRowActionsProps {
  cruise: Cruise;
  onEdit: (c: Cruise) => void;
  onDuplicate: (c: Cruise) => void;
  onDelete: (id: string) => void;
}

/**
 * Edit / duplicate / delete on a cruise row.
 *
 * These were tinted text buttons — three words that took roughly half a column
 * of width on the narrowest of the three tables. Icons say the same thing in a
 * quarter of the space, and every list now uses the same ones. The shared
 * component stops propagation, which matters here because the row navigates to
 * the cruise underneath.
 */
export default function CruiseRowActions({
  cruise,
  onEdit,
  onDuplicate,
  onDelete,
}: CruiseRowActionsProps): JSX.Element {
  const { t } = useTranslation(["cruise", "common"]);
  return (
    <RowActions>
      <RowActionButton
        icon="edit"
        label={t("common:buttons.edit")}
        onClick={() => onEdit(cruise)}
      />
      <RowActionButton
        icon="duplicate"
        label={t("cruise:list.duplicate")}
        onClick={() => onDuplicate(cruise)}
      />
      <RowActionButton
        icon="delete"
        label={t("common:buttons.delete")}
        onClick={() => onDelete(cruise.id)}
      />
    </RowActions>
  );
}
