import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";

import UnfiledDocumentsSection from "../UnfiledDocumentsSection";
import type { UnfiledDocument, UnfiledDocuments } from "../../../lib/api/documents";

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

const api = vi.hoisted(() => ({
  listUnfiled: vi.fn(),
  limits: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  update: vi.fn(),
  addLinks: vi.fn(),
  linkCandidates: vi.fn(),
  fetchFile: vi.fn(),
}));

vi.mock("../../../lib/api/documents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api/documents")>();
  return { ...actual, documentsApi: api };
});
vi.mock("../../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({ enabled: [], isEnabled: () => true }),
}));

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

/** The endpoint sends the TTL with the list — see `UnfiledDocuments`. */
function listOf(...documents: UnfiledDocument[]): UnfiledDocuments {
  return { ttlDays: 30, documents };
}

const ENTRY = { type: "flight", id: "f1", label: "LH400 FRA → JFK", parentId: null, tripId: null };

/** Shows the router state so the hand-off to the import dialog can be asserted. */
function LocationProbe(): JSX.Element {
  const { state } = useLocation();
  return <output data-testid="route-state">{JSON.stringify(Object.keys(state ?? {}))}</output>;
}

function renderSection(): void {
  render(
    <MemoryRouter>
      <UnfiledDocumentsSection />
      <LocationProbe />
    </MemoryRouter>
  );
}

const rowOf = (name: string): HTMLElement =>
  screen.getByText(name).closest("[data-testid=unfiled-document]") as HTMLElement;

async function openMenuEntry(name: string, entry: string): Promise<void> {
  fireEvent.click(within(rowOf(name)).getByRole("button", { name: /rowMenuLabel/ }));
  fireEvent.click(await screen.findByRole("menuitem", { name: entry }));
}

describe("UnfiledDocumentsSection", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.limits.mockResolvedValue({
      image: 10_000_000,
      pdf: 10_000_000,
      eml: 10_000_000,
      emailText: 1,
      pkpass: 1,
    });
    api.linkCandidates.mockResolvedValue({ tripEntries: [], otherEntries: [ENTRY] });
  });

  it("names each document and the date it will be deleted", async () => {
    api.listUnfiled.mockResolvedValue(listOf(unfiled()));
    renderSection();
    await screen.findByText("bordkarte.pdf");

    // The deletion date, machine-readable and formatted. Without this the block
    // is the old silence with a heading on it.
    const dates = document.querySelectorAll("time");
    expect(Array.from(dates).map((el) => el.getAttribute("datetime"))).toEqual([
      "2026-09-01T10:00:00Z",
      "2026-10-01T10:00:00Z",
    ]);
    expect(dates[1].textContent).toMatch(/01\.10\.2026|10\/01\/2026|2026-10-01/);
  });

  it("shows a PDF inline in the viewer, with a download that points at the original bytes", async () => {
    api.listUnfiled.mockResolvedValue(listOf(unfiled()));
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: /previewLabel/ }));

    const frame = await screen.findByTitle("bordkarte.pdf");
    expect(frame).toHaveAttribute("src", expect.stringContaining("/documents/doc-1/file"));
    expect(
      screen.getByRole("link", { name: "dataQuality:unfiledDocuments.preview.download" })
    ).toHaveAttribute("href", expect.stringContaining("/documents/doc-1/file"));
  });

  it("shows an image as an image and says when it cannot be loaded", async () => {
    api.listUnfiled.mockResolvedValue(
      listOf(unfiled({ format: "image", displayName: "foto.jpg" }))
    );
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: /previewLabel/ }));
    const img = await screen.findByAltText("foto.jpg");
    fireEvent.error(img);
    expect(await screen.findByRole("alert")).toHaveTextContent("preview.imageFailed");
  });

  it("explains what the list is, instead of vanishing, when nothing is unassigned", async () => {
    api.listUnfiled.mockResolvedValue(listOf());
    renderSection();
    expect(await screen.findByTestId("unfiled-empty")).toHaveTextContent(
      "unfiledDocuments.empty.title"
    );
    expect(screen.getByText("dataQuality:unfiledDocuments.empty.body")).toBeInTheDocument();
    // …and the way to put something into it is right there.
    expect(screen.getByRole("button", { name: "documents:add" })).toBeInTheDocument();
  });

  it("says the list could not be loaded, with a retry, instead of looking empty", async () => {
    api.listUnfiled.mockRejectedValueOnce(new Error("Request failed with 500"));
    renderSection();
    expect(await screen.findByRole("alert")).toHaveTextContent("errors.loadFailed");
    expect(screen.queryByTestId("unfiled-empty")).not.toBeInTheDocument();

    api.listUnfiled.mockResolvedValue(listOf(unfiled()));
    fireEvent.click(screen.getByRole("button", { name: "common:buttons.retry" }));
    await screen.findByText("bordkarte.pdf");
  });

  it("uploads dropped files into the list and names every file that failed, with its own reason", async () => {
    api.listUnfiled.mockResolvedValue(listOf());
    api.upload.mockImplementation(async ({ file }: { file: File }) => {
      if (file.name === "kaputt.pdf") throw new Error("boom");
      return unfiled();
    });
    renderSection();
    const zone = await screen.findByTestId("unfiled-documents");
    const files = [
      new File(["a"], "gut.pdf", { type: "application/pdf" }),
      new File(["b"], "kaputt.pdf", { type: "application/pdf" }),
    ];
    fireEvent.drop(zone, { dataTransfer: { files } });

    await waitFor(() => expect(api.upload).toHaveBeenCalledTimes(2));
    // No entry: the document is kept unfiled.
    expect(api.upload.mock.calls[0][0]).toEqual({ file: files[0] });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("kaputt.pdf");
    expect(alert).toHaveTextContent("documents:uploadFailed");
    expect(alert).not.toHaveTextContent("gut.pdf");
    // The one that arrived is not hidden behind the failure: the list is re-read.
    await waitFor(() => expect(api.listUnfiled.mock.calls.length).toBeGreaterThan(1));
  });

  it("refuses a file over the limit before uploading it, and says which", async () => {
    api.listUnfiled.mockResolvedValue(listOf());
    api.limits.mockResolvedValue({ image: 10, pdf: 10, eml: 10, emailText: 10, pkpass: 10 });
    renderSection();
    await screen.findByTestId("unfiled-empty");
    await waitFor(() => expect(api.limits).toHaveBeenCalled());
    await Promise.resolve();
    const big = new File(["x".repeat(50)], "gross.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByTestId("unfiled-file-input"), { target: { files: [big] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("gross.pdf");
    expect(api.upload).not.toHaveBeenCalled();
  });

  it("deletes after the confirmation and shows a failure instead of dropping the row quietly", async () => {
    api.listUnfiled.mockResolvedValue(listOf(unfiled()));
    api.remove.mockRejectedValue(new Error("boom"));
    renderSection();
    await screen.findByText("bordkarte.pdf");
    await openMenuEntry("bordkarte.pdf", "dataQuality:unfiledDocuments.actions.delete");
    // Asked first: nothing is deleted by choosing the entry.
    expect(api.remove).not.toHaveBeenCalled();
    const confirm = await screen.findByTestId("confirm-modal");
    fireEvent.click(
      within(confirm).getByRole("button", { name: "dataQuality:unfiledDocuments.actions.delete" })
    );

    await waitFor(() => expect(api.remove).toHaveBeenCalledWith("doc-1"));
    expect(await screen.findByRole("alert")).toHaveTextContent("documents:deleteFailed");
  });

  it("saves a rename through PATCH and shows a refusal", async () => {
    api.listUnfiled.mockResolvedValue(listOf(unfiled()));
    api.update.mockRejectedValueOnce(new Error("boom"));
    renderSection();
    await screen.findByText("bordkarte.pdf");
    await openMenuEntry("bordkarte.pdf", "dataQuality:unfiledDocuments.actions.edit");
    const dialog = await screen.findByTestId("edit-document-dialog");
    fireEvent.change(within(dialog).getByDisplayValue("bordkarte.pdf"), {
      target: { value: "Hinflug Lissabon" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "common:buttons.save" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("errors.saveFailed");
    expect(api.update).toHaveBeenCalledWith("doc-1", { displayName: "Hinflug Lissabon" });

    api.update.mockResolvedValueOnce(unfiled({ displayName: "Hinflug Lissabon" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "common:buttons.save" }));
    await waitFor(() =>
      expect(screen.queryByTestId("edit-document-dialog")).not.toBeInTheDocument()
    );
  });

  it("links to an entry found by SEARCH (the server, not the recent subset) and re-reads the list", async () => {
    api.listUnfiled.mockResolvedValue(listOf(unfiled()));
    api.addLinks.mockResolvedValue([]);
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: /linkLabel/ }));
    const dialog = await screen.findByTestId("link-document-dialog");
    await within(dialog).findByText("LH400 FRA → JFK");

    fireEvent.change(within(dialog).getByRole("searchbox"), { target: { value: "LH400" } });
    await waitFor(() => expect(api.linkCandidates).toHaveBeenCalledWith("doc-1", "LH400"));

    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: /linkSelected/ }));
    await waitFor(() =>
      expect(api.addLinks).toHaveBeenCalledWith("doc-1", [{ entry: { type: "flight", id: "f1" } }])
    );
    await waitFor(() => expect(api.listUnfiled.mock.calls.length).toBeGreaterThan(1));
  });

  it("says why linking failed, in the dialog, and keeps it open", async () => {
    api.listUnfiled.mockResolvedValue(listOf(unfiled()));
    api.addLinks.mockRejectedValue(new Error("boom"));
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: /linkLabel/ }));
    const dialog = await screen.findByTestId("link-document-dialog");
    fireEvent.click(await within(dialog).findByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: /linkSelected/ }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "documents:links.errors.failed"
    );
  });

  it("links several selected documents to ONE entry and names the ones that failed", async () => {
    api.listUnfiled.mockResolvedValue(
      listOf(unfiled(), unfiled({ id: "doc-2", displayName: "rechnung.pdf" }))
    );
    api.addLinks.mockImplementation(async (id: string) => {
      if (id === "doc-2") throw new Error("boom");
      return [];
    });
    renderSection();
    await screen.findByText("rechnung.pdf");
    for (const box of screen.getAllByRole("checkbox")) fireEvent.click(box);
    fireEvent.click(screen.getByRole("button", { name: "dataQuality:unfiledDocuments.bulk.link" }));

    const dialog = await screen.findByTestId("link-document-dialog");
    // One entry only: a radio, not a checkbox.
    fireEvent.click(await within(dialog).findByRole("radio"));
    fireEvent.click(within(dialog).getByRole("button", { name: /linkDocsToEntry/ }));

    await waitFor(() => expect(api.addLinks).toHaveBeenCalledTimes(2));
    const alert = await within(dialog).findByRole("alert");
    // The sentence names the failed documents (the test translator returns the key only).
    expect(alert).toHaveTextContent("links.errors.someFailed");
    // doc-1 went through, so the list behind is re-read.
    await waitFor(() => expect(api.listUnfiled.mock.calls.length).toBeGreaterThan(1));
  });

  it("hands the document to the import dialog, and says so when the file cannot be fetched", async () => {
    api.listUnfiled.mockResolvedValue(listOf(unfiled({ parsedDomain: "flight" })));
    api.fetchFile.mockRejectedValueOnce(new Error("boom"));
    renderSection();
    await screen.findByText("bordkarte.pdf");
    await openMenuEntry("bordkarte.pdf", "dataQuality:unfiledDocuments.actions.create");
    const dialog = await screen.findByTestId("create-from-document-dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /create\.domains\.flight/ }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("create.fetchFailed");
    expect(screen.getByTestId("route-state")).toHaveTextContent("[]");

    api.fetchFile.mockResolvedValueOnce(new Blob(["%PDF"], { type: "application/pdf" }));
    fireEvent.click(within(dialog).getByRole("button", { name: /create\.domains\.flight/ }));
    await waitFor(() =>
      expect(screen.getByTestId("route-state")).toHaveTextContent("documentFilingHandoff")
    );
  });
});

describe("UnfiledDocumentsSection — link search ordering", () => {
  it("keeps the results of the newest search when an older one answers late", async () => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.limits.mockResolvedValue({ image: 1e7, pdf: 1e7, eml: 1e7, emailText: 1, pkpass: 1 });
    api.listUnfiled.mockResolvedValue(listOf(unfiled()));
    let releaseOld: (value: unknown) => void = () => {};
    api.linkCandidates.mockImplementation((_id: string, q?: string) =>
      q === "alt"
        ? new Promise((resolve) => {
            releaseOld = resolve;
          })
        : Promise.resolve({
            tripEntries: [],
            otherEntries: [{ ...ENTRY, label: q ? "NEU-TREFFER" : "START" }],
          })
    );
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: /linkLabel/ }));
    const dialog = await screen.findByTestId("link-document-dialog");
    await within(dialog).findByText("START");

    fireEvent.change(within(dialog).getByRole("searchbox"), { target: { value: "alt" } });
    await waitFor(() => expect(api.linkCandidates).toHaveBeenCalledWith("doc-1", "alt"));
    fireEvent.change(within(dialog).getByRole("searchbox"), { target: { value: "neu" } });
    await within(dialog).findByText("NEU-TREFFER");

    releaseOld({ tripEntries: [], otherEntries: [{ ...ENTRY, label: "ALT-TREFFER" }] });
    await Promise.resolve();
    expect(within(dialog).queryByText("ALT-TREFFER")).not.toBeInTheDocument();
    expect(within(dialog).getByText("NEU-TREFFER")).toBeInTheDocument();
  });
});
