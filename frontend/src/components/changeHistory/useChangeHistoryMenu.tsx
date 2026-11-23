import { useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import type { ChangeEntityType } from "../../lib/api/changeHistory";
import type { OverflowEntry } from "../ui/OverflowMenu";
import ChangeHistoryDialog from "./ChangeHistoryDialog";

export interface ChangeHistoryTarget {
  entityType: ChangeEntityType;
  entityId: string;
  onRestored?: () => Promise<void> | void;
}

/**
 * The "Änderungsverlauf" item of an entry's ⋯ menu and the dialog it opens (owner,
 * 2026-11-23). Hand `entry` to the menu's entries and render `node` among its
 * dialogs. The history is not on the page any more: nothing renders, and nothing is
 * requested, until the item is chosen.
 */
export function useChangeHistoryMenu(target: ChangeHistoryTarget): {
  entry: OverflowEntry;
  node: JSX.Element | null;
} {
  const { t } = useTranslation(["changeHistory"]);
  const [open, setOpen] = useState(false);
  return {
    entry: {
      key: "change-history",
      testId: "change-history-open",
      label: t("changeHistory:menu"),
      onSelect: () => setOpen(true),
    },
    node: open ? (
      <ChangeHistoryDialog
        entityType={target.entityType}
        entityId={target.entityId}
        onRestored={target.onRestored}
        onClose={() => setOpen(false)}
      />
    ) : null,
  };
}
