import { describe, it, vi } from "vitest";

import { LodgingImportPreviewModal } from "../../../components/lodging/LodgingImportPreviewModal";
import type { LodgingImportPreviewRow } from "../../../types/lodgingImport";
import { expectPreviewOwnsTheKeyboard } from "../../helpers/stackedDialog";

const row: LodgingImportPreviewRow = {
  sourceRowIndex: 0,
  lodging: { name: "QA Roma Hotel", city: "Rom" },
  stay: { checkIn: "2025-09-12", checkOut: "2025-09-16" },
  flags: [],
  dedupeHint: "none",
  matchedLodgingId: null,
  matchedLodgingName: null,
  matchedStayId: null,
  action: "create",
};

describe("LodgingImportPreviewModal — keyboard (forgejo#166)", () => {
  it("is a modal dialog that takes focus over the add chooser", async () => {
    const onCancel = vi.fn();
    await expectPreviewOwnsTheKeyboard(
      <LodgingImportPreviewModal
        rows={[row]}
        summary={{ newRows: 1, alreadyPresent: 0, needsInput: 0 }}
        onCommit={vi.fn()}
        onCancel={onCancel}
      />,
      "lodging:import.preview.title",
      onCancel
    );
  });
});
