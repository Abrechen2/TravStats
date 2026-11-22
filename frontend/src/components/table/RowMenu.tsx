import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import OverflowMenu from "../ui/OverflowMenu";
import type { OverflowEntry } from "../ui/OverflowMenu";

/**
 * The ⋯ at the end of a list row (owner, 2026-11-22): edit, duplicate and delete used to be
 * two or three icons per row, next to a row that already opens the detail. One ⋯ replaces
 * them; the click never reaches the row underneath (`stopPropagation`), which is the bug
 * `RowActionButton` documents for the delete icon.
 *
 * Delete is last and red (the shared menu sorts it); the page keeps its own confirm dialog,
 * so the entry carries no `confirm` of its own.
 */
export default function RowMenu({
  entries,
  label,
  testId,
}: {
  entries: OverflowEntry[];
  /** Names the trigger: "Weitere Aktionen". Defaults to the common wording. */
  label?: string;
  testId?: string;
}): JSX.Element | null {
  const { t } = useTranslation("common");
  return (
    <div className="flex items-center justify-end">
      <OverflowMenu
        entries={entries}
        label={label ?? t("buttons.moreActions")}
        testId={testId}
        stopPropagation
      />
    </div>
  );
}
