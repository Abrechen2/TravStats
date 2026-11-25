import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
vi.mock("../../../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({ isEnabled: () => true }),
}));
const navigate = vi.fn();
vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));
const fetchFile = vi.fn();
vi.mock("../../../../lib/api/documents", () => ({
  documentsApi: { fetchFile: (id: string) => fetchFile(id) },
}));
const parsePdf = vi.fn();
vi.mock("../../../../lib/api/parse", () => ({
  parseApi: {
    parsePdf: (...a: unknown[]) => parsePdf(...a),
    parseEmailFile: vi.fn(),
  },
}));

import CreateFromDocumentDialog from "../CreateFromDocumentDialog";
import type { TravelDocument } from "../../../../lib/api/documents";

const DOC = {
  id: "doc-1",
  displayName: "booking.pdf",
  format: "pdf",
  mimetype: "application/pdf",
  parsedDomain: null,
} as unknown as TravelDocument;

describe("CreateFromDocumentDialog", () => {
  beforeEach(() => {
    navigate.mockReset();
    parsePdf.mockReset();
    fetchFile.mockResolvedValue(new Blob(["%PDF-1.4"], { type: "application/pdf" }));
  });
  afterEach(() => cleanup());

  it("stays on the inbox and shows the reason when the parser finds no stay", async () => {
    parsePdf.mockResolvedValue({ domain: "lodging", candidates: [], fallbackReason: "x" });
    render(<CreateFromDocumentDialog document={DOC} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("dataQuality:unfiledDocuments.create.domains.lodging"));
    expect((await screen.findByTestId("create-from-document-empty")).textContent).toContain(
      "lodging:import.noBookings"
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it("'Leer anlegen mit Dokument' opens the empty form with the document hand-off kept", async () => {
    parsePdf.mockResolvedValue({ domain: "rail", bookings: [], fallbackCode: "noTemplate" });
    render(<CreateFromDocumentDialog document={DOC} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("dataQuality:unfiledDocuments.create.domains.rail"));
    fireEvent.click(await screen.findByText("dataQuality:unfiledDocuments.create.createEmpty"));
    expect(navigate).toHaveBeenCalledTimes(1);
    const handoff = navigate.mock.calls[0][1].state.documentFilingHandoff;
    expect(handoff).toMatchObject({ documentId: "doc-1", domain: "rail", manual: true });
    expect(handoff.document.file).toBeInstanceOf(File);
  });

  it("Abbrechen closes without leaving the inbox", async () => {
    parsePdf.mockResolvedValue({ domain: "cruise", cruises: [] });
    const onClose = vi.fn();
    render(<CreateFromDocumentDialog document={DOC} onClose={onClose} />);
    fireEvent.click(screen.getByText("dataQuality:unfiledDocuments.create.domains.cruise"));
    fireEvent.click(await screen.findByText("common:buttons.cancel"));
    expect(onClose).toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("a failed parse request is a visible reason, not a jump", async () => {
    parsePdf.mockRejectedValue(Object.assign(new Error("x"), { response: { status: 429 } }));
    render(<CreateFromDocumentDialog document={DOC} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("dataQuality:unfiledDocuments.create.domains.rental"));
    expect((await screen.findByTestId("create-from-document-empty")).textContent).toContain(
      "import:errors.rateLimited"
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it("a reading with a result hands the reading over, so the dashboard does not read it again", async () => {
    const result = { domain: "lodging", candidates: [{ name: "Haus" }] };
    parsePdf.mockResolvedValue(result);
    render(<CreateFromDocumentDialog document={DOC} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("dataQuality:unfiledDocuments.create.domains.lodging"));
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    const handoff = navigate.mock.calls[0][1].state.documentFilingHandoff;
    expect(handoff.reading).toEqual({ kind: "pdf", result });
    expect(handoff.manual).toBeUndefined();
  });
});
