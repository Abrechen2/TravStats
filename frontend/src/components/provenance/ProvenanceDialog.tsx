import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import type { ProvenanceEntryType, ProvenanceState } from "../../lib/api/provenance";
import Modal from "../Modal";
import RememberedEditor from "./RememberedEditor";

/** The origin editor of one entry in a dialog, opened from the entry's own ⋯. */
export default function ProvenanceDialog({
  entryType,
  entry,
  onClose,
  onSaved,
}: {
  entryType: ProvenanceEntryType;
  entry: Partial<ProvenanceState> & { id: string };
  onClose: () => void;
  onSaved?: (state: ProvenanceState) => void;
}): JSX.Element {
  const { t } = useTranslation(["provenance"]);
  return (
    <Modal
      open
      onClose={onClose}
      title={t("provenance:editor.legend")}
      maxWidth={480}
      testId={`provenance-dialog-${entry.id}`}
    >
      <RememberedEditor
        // Re-keyed on what is stored, so a reload shows the saved state, not the typed one.
        key={`${entry.provenance ?? ""}|${entry.rememberedOn ?? ""}|${entry.rememberedNote ?? ""}`}
        entryType={entryType}
        entryId={entry.id}
        initial={entry}
        onSaved={(state) => {
          onSaved?.(state);
          onClose();
        }}
      />
    </Modal>
  );
}
