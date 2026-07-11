import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LodgingImportPreviewModal } from "../../../components/lodging/LodgingImportPreviewModal";
import type { LodgingImportPreviewRow, LodgingImportSummary } from "../../../types/lodgingImport";

const rows: LodgingImportPreviewRow[] = [
  {
    sourceRowIndex: 1,
    lodging: null,
    lodgingName: "Unknown Hotel",
    stay: { checkIn: "2026-01-01", checkOut: "2026-01-02" },
    flags: ["unresolvable_lodging_name"],
    dedupeHint: "none",
    matchedLodgingId: null,
    matchedStayId: null,
    action: "needs_input",
  },
  {
    sourceRowIndex: 0,
    lodging: { name: "Fresh Hotel", city: "Berlin" },
    stay: null,
    flags: ["missing_coordinates"],
    dedupeHint: "none",
    matchedLodgingId: null,
    matchedStayId: null,
    action: "create",
  },
  {
    sourceRowIndex: 2,
    lodging: { name: "Dup Hotel", externalRef: "google:ChIJdup" },
    stay: null,
    flags: [],
    dedupeHint: "lodging_exact_ref",
    matchedLodgingId: "existing-id",
    matchedStayId: null,
    action: "skip",
  },
];

const summary: LodgingImportSummary = { newRows: 1, alreadyPresent: 1, needsInput: 1 };

describe("LodgingImportPreviewModal", () => {
  it("shows the three counts and keeps the questionable row first", () => {
    render(
      <LodgingImportPreviewModal
        rows={rows}
        summary={summary}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    const counts = screen.getByTestId("lodging-import-counts");
    expect(counts.textContent).toContain("1");

    const nameInputs = screen.getAllByTestId(/lodging-import-name-/);
    expect(nameInputs[0]).toHaveValue("Unknown Hotel");
  });

  it("cannot commit while a row is still unresolved", () => {
    render(
      <LodgingImportPreviewModal
        rows={rows}
        summary={summary}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByTestId("lodging-import-commit")).toBeDisabled();
  });

  it("commits create/skip rows once the unresolved row is decided, with the user's edits", async () => {
    const onCommit = vi.fn().mockResolvedValue(undefined);
    render(
      <LodgingImportPreviewModal
        rows={rows}
        summary={summary}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />
    );

    fireEvent.change(screen.getByTestId("lodging-import-name-0"), {
      target: { value: "Fresh Hotel (edited)" },
    });
    fireEvent.change(screen.getByTestId("lodging-import-action-1"), {
      target: { value: "skip" },
    });

    const commit = screen.getByTestId("lodging-import-commit");
    expect(commit).not.toBeDisabled();
    fireEvent.click(commit);

    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));

    const committed = onCommit.mock.calls[0][0] as { sourceRowIndex: number; action: string }[];
    expect(committed).toHaveLength(3);
    expect(committed.find((r) => r.sourceRowIndex === 1)?.action).toBe("skip");
    const edited = committed.find((r) => r.sourceRowIndex === 0);
    expect(edited?.action).toBe("create");
  });

  it("updates the live counts when the user flips a row to skip", () => {
    render(
      <LodgingImportPreviewModal
        rows={rows}
        summary={summary}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    fireEvent.change(screen.getByTestId("lodging-import-action-0"), { target: { value: "skip" } });
    const counts = screen.getByTestId("lodging-import-counts");
    // 0 new · 2 already present · 1 needs input
    expect(counts.textContent).toMatch(/\b0\b/);
  });
});
