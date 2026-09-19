import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import UnfiledDocumentsSection from "../UnfiledDocumentsSection";
import { documentsApi, type UnfiledDocument } from "../../../lib/api/documents";

/**
 * The announcement the document sweep never made.
 *
 * An unfiled upload is deleted, row and bytes, once it is older than the TTL.
 * The 2026-09-19 integrity audit found that at seven days with nothing on
 * screen and no locale string mentioning it anywhere. So the two things worth
 * pinning are that the DATE is shown — a block that only said "these will be
 * removed eventually" would be the same silence in more words — and that the
 * row offers a way to open the file, because a user told a document is about
 * to go needs to see which one it is.
 */

vi.mock("../../../lib/api/documents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api/documents")>();
  return {
    ...actual,
    documentsApi: { listUnfiled: vi.fn() },
  };
});

function unfiled(overrides: Partial<UnfiledDocument> = {}): UnfiledDocument {
  return {
    id: "doc-1",
    format: "pdf",
    kind: null,
    mimetype: "application/pdf",
    sizeBytes: 1024,
    sha256: "a".repeat(64),
    originalName: "bordkarte.pdf",
    displayName: "bordkarte.pdf",
    issuedOn: null,
    source: "companion",
    parsedDomain: null,
    entry: null,
    createdAt: "2026-09-01T10:00:00Z",
    linkedAt: null,
    url: "/api/v1/documents/doc-1/file",
    deletesAt: "2026-10-01T10:00:00Z",
    ...overrides,
  } as UnfiledDocument;
}

describe("UnfiledDocumentsSection", () => {
  beforeEach(() => {
    vi.mocked(documentsApi.listUnfiled).mockReset();
  });

  it("names each document and the date it will be deleted", async () => {
    vi.mocked(documentsApi.listUnfiled).mockResolvedValue([unfiled()]);

    render(<UnfiledDocumentsSection />);

    await screen.findByText("bordkarte.pdf");

    // The deletion date, machine-readable and formatted. Without this the block
    // is the old silence with a heading on it.
    const dates = document.querySelectorAll("time");
    expect(Array.from(dates).map((el) => el.getAttribute("datetime"))).toEqual([
      "2026-09-01T10:00:00Z",
      "2026-10-01T10:00:00Z",
    ]);
    // And it is rendered, not just in an attribute.
    expect(dates[1].textContent).toMatch(/01\.10\.2026|10\/01\/2026|2026-10-01/);
  });

  it("links at the file so the user can see what is about to go", async () => {
    vi.mocked(documentsApi.listUnfiled).mockResolvedValue([unfiled()]);

    render(<UnfiledDocumentsSection />);

    const link = await screen.findByRole("link");
    // A plain anchor: the JWT is an HttpOnly cookie, which a top-level
    // navigation carries and a fetch-and-blob would have to work around.
    expect(link).toHaveAttribute("href", expect.stringContaining("/documents/doc-1/file"));
  });

  it("renders nothing when everything is filed", async () => {
    vi.mocked(documentsApi.listUnfiled).mockResolvedValue([]);

    const { container } = render(<UnfiledDocumentsSection />);

    await waitFor(() => expect(documentsApi.listUnfiled).toHaveBeenCalled());
    // Not an empty-state card: a permanent heading with nothing under it would
    // be a standing warning about a problem the user does not have.
    expect(container).toBeEmptyDOMElement();
  });

  it("stays away when the endpoint is missing, instead of breaking the inbox", async () => {
    // An older server answers 404 here. The reader came for their own
    // questions; losing the page over a capability probe would be a bad trade.
    vi.mocked(documentsApi.listUnfiled).mockRejectedValue(new Error("Request failed with 404"));

    const { container } = render(<UnfiledDocumentsSection />);

    await waitFor(() => expect(documentsApi.listUnfiled).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
