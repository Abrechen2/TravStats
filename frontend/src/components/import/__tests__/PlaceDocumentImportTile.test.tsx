import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PlaceDocumentImportTile } from "../PlaceDocumentImportTile";

/**
 * forgejo#124 — a place read from a document goes into the SAME preview as a
 * CSV row, and a document nothing read says why. The failure paths are driven
 * here on purpose: an empty answer that renders nothing is the defect class
 * "a provider failure becomes silent success".
 */

// The tile reads through the shared parse routes with `domain: "place"`.
const parseEmail = vi.fn();
const parseEmailFile = vi.fn();
const parsePdf = vi.fn();
const previewPlaceImport = vi.fn();
const commitPlaceImport = vi.fn();
vi.mock("../../../lib/api/parse", () => ({
  parseApi: {
    parseEmail: (...args: unknown[]) => parseEmail(...args),
    parseEmailFile: (...args: unknown[]) => parseEmailFile(...args),
    parsePdf: (...args: unknown[]) => parsePdf(...args),
  },
}));
vi.mock("../../../lib/api/placeImport", () => ({
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
    parseEmail.mockReset();
    parseEmailFile.mockReset();
    parsePdf.mockReset();
    previewPlaceImport.mockReset();
    commitPlaceImport.mockReset();
  });

  it("does not read an empty document", () => {
    render(<PlaceDocumentImportTile />);
    expect(screen.getByText("places:import.document.read")).toBeDisabled();
  });

  it("sends what the templates read through the import preview", async () => {
    const candidate = { sourceRowIndex: 0, name: "Museum am Probeufer", visitedAt: "2027-09-14" };
    parseEmail.mockResolvedValue({ candidates: [candidate], templateId: "place:user-1" });
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
    expect(parseEmail).toHaveBeenCalledWith(TICKET, undefined, "place");
    expect(previewPlaceImport).toHaveBeenCalledWith([candidate]);
    // Nothing written before the user confirms in the preview.
    expect(commitPlaceImport).not.toHaveBeenCalled();
  });

  it.each(["noTemplate", "notRecognised", "timedOut"])(
    "says why nothing was read (%s), and opens no preview",
    async (code) => {
      parseEmail.mockResolvedValue({ candidates: [], templateId: null, fallbackCode: code });
      render(<PlaceDocumentImportTile />);
      pasteAndRead();

      await waitFor(() =>
        expect(screen.getByText(`places:import.document.fallback.${code}`)).toBeInTheDocument()
      );
      expect(previewPlaceImport).not.toHaveBeenCalled();
    }
  );

  it("reads a PDF ticket through the shared PDF route, as a place document", async () => {
    const candidate = { sourceRowIndex: 0, name: "Museum am Probeufer" };
    parsePdf.mockResolvedValueOnce({ candidates: [candidate], templateId: "place:user-1" });
    previewPlaceImport.mockResolvedValueOnce({
      rows: [
        { ...candidate, flags: [], dedupeHint: "none", matchedPlaceId: null, action: "create" },
      ],
      summary: { newRows: 1, alreadyPresent: 0, needsInput: 0 },
    });
    render(<PlaceDocumentImportTile />);
    const pdf = new File(["%PDF-1.4 invented"], "ticket.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("places:import.document.uploadLabel"), {
      target: { files: [pdf] },
    });
    await waitFor(() => expect(screen.getByTestId("preview")).toHaveTextContent("Museum"));
    expect(parsePdf).toHaveBeenCalledWith(btoa("%PDF-1.4 invented"), "place");
    expect(parseEmailFile).not.toHaveBeenCalled();
  });

  it("reads a mail file through the shared file route, as a place document", async () => {
    parseEmailFile.mockResolvedValueOnce({
      candidates: [],
      templateId: null,
      fallbackCode: "notRecognised",
    });
    render(<PlaceDocumentImportTile />);
    const file = new File([TICKET], "ticket.eml", { type: "message/rfc822" });
    fireEvent.change(screen.getByLabelText("places:import.document.uploadLabel"), {
      target: { files: [file] },
    });
    await waitFor(() => expect(parseEmailFile).toHaveBeenCalledWith(file, "place"));
    expect(
      await screen.findByText("places:import.document.fallback.notRecognised")
    ).toBeInTheDocument();
  });

  it("says the request failed, in its own words, when it did", async () => {
    parseEmail.mockRejectedValueOnce(new Error("Network Error"));
    render(<PlaceDocumentImportTile />);
    pasteAndRead();

    await waitFor(() =>
      expect(screen.getByText("places:import.document.readFailed")).toBeInTheDocument()
    );
    expect(screen.queryByText(/Network Error/)).toBeNull();
  });
});
