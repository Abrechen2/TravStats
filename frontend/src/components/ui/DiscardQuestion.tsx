import type { JSX } from "react";
import Dialog from "./Dialog";
import { useTranslation } from "../../hooks/useTranslation";
import { DELETE_BUTTON_CLASS } from "../../lib/deleteConfirm";

/**
 * "Änderungen verwerfen?" — drawn by `Dialog` itself rather than through
 * `useConfirmDialog`, because that hook renders `ConfirmModal`, which IS a
 * `Dialog`: importing it here would close a module cycle. Same frame, same
 * two-button shape, same red confirm.
 */
export function DiscardQuestion({
  onDiscard,
  onKeepEditing,
  discardLabel,
}: {
  onDiscard: () => void;
  onKeepEditing: () => void;
  discardLabel?: string;
}): JSX.Element {
  const { t } = useTranslation(["common"]);
  return (
    <Dialog
      open
      onClose={onKeepEditing}
      title={t("common:discard.title")}
      maxWidth={440}
      testId="discard-question"
      footer={
        <>
          <button
            type="button"
            onClick={onKeepEditing}
            className="inline-flex justify-center rounded-md border border-border px-4 py-2 text-sm font-medium text-(--text-primary) hover:bg-(--bg-base)"
          >
            {t("common:discard.keepEditing")}
          </button>
          <button
            type="button"
            onClick={onDiscard}
            className={`inline-flex justify-center rounded-md border border-transparent px-4 py-2 text-sm font-medium text-white ${DELETE_BUTTON_CLASS}`}
          >
            {discardLabel ?? t("common:discard.confirm")}
          </button>
        </>
      }
    >
      <p className="text-sm text-(--text-muted)">{t("common:discard.message")}</p>
    </Dialog>
  );
}
