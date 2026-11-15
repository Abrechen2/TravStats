import type { JSX } from "react";
import SelectCheckbox from "../flightsTable/bulk/SelectCheckbox";
import { useTranslation } from "../../hooks/useTranslation";
import type { BulkRow, RowSelection } from "./useRowSelection";

/**
 * A row's tick for the bulk selection (forgejo#405 A4): nothing outside
 * selection mode. A rail entry with changes is several rides and ticks them
 * all at once.
 */
export default function BulkRowCheck({
  selection,
  rows,
}: {
  selection: RowSelection;
  rows: readonly BulkRow[];
}): JSX.Element | null {
  const { t } = useTranslation(["bulkEdit"]);
  if (!selection.selecting || rows.length === 0) return null;
  return (
    <SelectCheckbox
      checked={selection.allSelected(rows)}
      label={t("bulkEdit:selectOne", { name: rows.map((r) => r.label).join(" · ") })}
      onToggle={() => selection.toggle(rows)}
    />
  );
}
