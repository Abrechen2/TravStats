import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PlaceDocumentImportTile } from "../PlaceDocumentImportTile";

/**
 * forgejo#124 — a place read from a document goes into the SAME preview as a
 * CSV row, and a document nothing read says why. The failure paths are driven
 * here on purpose: an empty answer that renders nothing is the defect class
 * "a provider failure becomes silent success".
 */

const readPlaceDocument = vi.fn();
const previewPlaceImport = vi.fn();
const commitPlaceImport = vi.fn();
vi.mock("../../../lib/api/placeImport", () => ({
  readPlaceDocument: (...args: unknown[]) => readPlaceDocument(...args),
  previewPlaceImport: (...args: unknown[]) => previewPlaceImport(...args),
  commitPlaceImport: (...args: unknown[]) => commitPlaceImport(...args),
}));
vi.mock("../../places/PlaceImportPreviewModal", () => ({
  PlaceImportPreviewModal: ({ rows }: { rows: Array<{ name: string }> }) => (
    <div data-testid="preview">{rows.map((r) => r.name).join(",")}</div>
  ),
}));

const TICKET = "Museum am Probeufer\nBesuchstag: 14.09.2027";

function pasteAndRead(): void {
  fireEvent.change(screen.getByLabelText("places:import.document.textLabel"), {
    target: { value: TICKET },
  });
  fireEvent.click(screen.getByText("places:import.document.read"));
}

describe("PlaceDocumentImportTile", () => {
  beforeEach(() => {
    readPlaceDocument.mockReset();
    previewPlaceImport.mockReset();
    commitPlaceImport.mockReset();
  });

  it("does not read an empty document", () => {
    render(<PlaceDocumentImportTile />);
    expect(screen.getByText("places:import.document.read")).toBeDisabled();
  });

  it("sends what the templates read through the import preview", async () => {
    const candidate = { sourceRowIndex: 0, name: "Museum am Probeufer", visitedAt: "2027-09-14" };
    readPlaceDocument.mockResolvedValue({ candidates: [candidate], templateId: "place:user-1" });
    previewPlaceImport.mockResolvedValue({
      rows: [
        {
          ...candidate,
          flags: [],
          dedupeHint: "none",
          matchedPlaceId: null,
          action: "needs_input",
        },
      ],
      summary: { newRows: 0, alreadyPresent: 0, needsInput: 1 },
    });
    render(<PlaceDocumentImportTile />);
    pasteAndRead();

    await waitFor(() =>
      expect(screen.getByTestId("preview")).toHaveTextContent("Museum am Probeufer")
    );
    expect(readPlaceDocument).toHaveBeenCalledWith(TICKET);
    expect(previewPlaceImport).toHaveBeenCalledWith([candidate]);
    // Nothing written before the user confirms in the preview.
    expect(commitPlaceImport).not.toHaveBeenCalled();
  });

  it.each(["noTemplate", "notRecognised", "timedOut"])(
    "says why nothing was read (%s), and opens no preview",
    async (code) => {
      readPlaceDocument.mockResolvedValue({ candidates: [], templateId: null, fallbackCode: code });
      render(<PlaceDocumentImportTile />);
      pasteAndRead();

      await waitFor(() =>
        expect(screen.getByText(`places:import.document.fallback.${code}`)).toBeInTheDocument()
      );
      expect(previewPlaceImport).not.toHaveBeenCalled();
    }
  );

  it("says the request failed, in its own words, when it did", async () => {
    readPlaceDocument.mockRejectedValue(new Error("Network Error"));
    render(<PlaceDocumentImportTile />);
    pasteAndRead();

    await waitFor(() =>
      expect(screen.getByText("places:import.document.readFailed")).toBeInTheDocument()
    );
    expect(screen.queryByText(/Network Error/)).toBeNull();
  });
});
