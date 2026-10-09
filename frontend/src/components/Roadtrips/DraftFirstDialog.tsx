import type { JSX } from "react";

import Modal from "../Modal";
import Button from "../ui/Button";
import { useTranslation } from "../../hooks/useTranslation";
import { DELETE_BUTTON_CLASS } from "../../lib/deleteConfirm";

/**
 * "Bearbeiten" while unsent station edits from an earlier visit wait on this
 * device (review I1). Opening the editor over them used to let its first
 * keystroke replace the stored draft — a discard nobody chose. The reader
 * decides here: restore the draft, or discard it on purpose and edit afresh.
 */
export default function DraftFirstDialog({
  onRestore,
  onDiscard,
  onClose,
}: {
  onRestore: () => void;
  onDiscard: () => void;
  onClose: () => void;
}): JSX.Element {
  const { t } = useTranslation(["roadtrips", "common"]);
  return (
    <Modal
      open
      onClose={onClose}
      maxWidth={520}
      closeLabel={t("common:buttons.close")}
      title={t("roadtrips:draft.firstTitle")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common:buttons.cancel")}
          </Button>
          <button
            type="button"
            onClick={onDiscard}
            className={`inline-flex justify-center rounded-md px-4 py-2 text-sm font-medium text-white ${DELETE_BUTTON_CLASS}`}
          >
            {t("roadtrips:draft.discardAndEdit")}
          </button>
          <Button variant="primary" onClick={onRestore}>
            {t("roadtrips:draft.restore")}
          </Button>
        </>
      }
    >
      <p className="text-sm">{t("roadtrips:draft.firstMessage")}</p>
    </Modal>
  );
}
