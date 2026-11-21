import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import type { TravelDocument } from "../../../lib/api/documents";

/**
 * Plan D2: a covers document names where it was filed, one link can be removed
 * and put back, "delete everywhere" lists what it reaches, and every failure of
 * the link requests reaches the user as its own sentence.
 */
const api = vi.hoisted(() => ({
  listForEntry: vi.fn(),
  limits: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  links: vi.fn(),
  unlinkFromEntry: vi.fn(),
  addLinks: vi.fn(),
  linkCandidates: vi.fn(),
  tripCandidates: vi.fn(),
}));

vi.mock("../../../lib/api/documents", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/api/documents")>(
    "../../../lib/api/documents"
  );
  return { ...actual, documentsApi: api };
});
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => false }));

import DocumentsSection from "../DocumentsSection";

const FLIGHT = { type: "flight", id: "f1" } as const;
const TRIP_INFO = { type: "trip", id: "t1", label: "Rundreise USA", parentId: null } as const;

function doc(over: Partial<TravelDocument> = {}): TravelDocument {
  return {
    id: "d1",
    format: "pdf",
    kind: "booking",
    mimetype: "application/pdf",
    sizeBytes: 1000,
    sha256: "abc",
    originalName: "Rundreise.pdf",
    displayName: "Rundreise.pdf",
    issuedOn: null,
    source: "upload",
    parsedDomain: null,
    entry: { type: "trip", id: "t1" },
    createdAt: "2026-09-18T10:00:00.000Z",
    linkedAt: null,
    url: "/api/v1/documents/d1/file",
    linkRole: "covers",
    evidenceFrom: TRIP_INFO,
    linkCount: 2,
    ...over,
  };
}
const axiosError = (status: number, code: string) =>
  Object.assign(new Error(code), { response: { status, data: { code } } });
const candidate = (type: string, id: string, label: string, tripId: string | null = "t1") => ({
  type,
  id,
  label,
  parentId: null,
  tripId,
});

describe("DocumentsSection — links (D2)", () => {
  beforeEach(() => {
    Object.values(api).forEach((m) => m.mockReset());
    api.listForEntry.mockResolvedValue([doc()]);
    api.limits.mockResolvedValue({ image: 1, pdf: 1, eml: 1, emailText: 1, pkpass: 1 });
    api.links.mockResolvedValue([]);
  });

  it("says where a covers document was filed, with a link to that entry", async () => {
    render(<DocumentsSection entry={FLIGHT} />);
    const note = await screen.findByTestId("document-evidence-from");
    expect(note).toHaveTextContent("documents:links.evidenceFrom");
    expect(within(note).getByRole("link", { name: "Rundreise USA" })).toHaveAttribute(
      "href",
      "/trips/t1"
    );
  });

  it("shows no evidence note for a document filed at this entry", async () => {
    api.listForEntry.mockResolvedValue([doc({ linkRole: "primary", evidenceFrom: null })]);
    render(<DocumentsSection entry={FLIGHT} />);
    await screen.findByText("Rundreise.pdf");
    expect(screen.queryByTestId("document-evidence-from")).toBeNull();
  });

  it("removes only this entry's link, then puts exactly that link back on undo", async () => {
    const removed = { role: "covers", provenance: "user", rentalCategory: null, entry: FLIGHT };
    api.unlinkFromEntry.mockResolvedValue(removed);
    api.addLinks.mockResolvedValue([]);
    render(<DocumentsSection entry={FLIGHT} />);
    fireEvent.click(await screen.findByRole("button", { name: "documents:links.unlinkLabel" }));
    await waitFor(() => expect(api.unlinkFromEntry).toHaveBeenCalledWith("d1", FLIGHT));
    expect(api.remove).not.toHaveBeenCalled();
    expect(await screen.findByTestId("documents-undo")).toBeInTheDocument();
    expect(screen.queryByText("Rundreise.pdf")).toBeNull();

    api.listForEntry.mockResolvedValue([doc()]);
    fireEvent.click(screen.getByRole("button", { name: "documents:links.undo" }));
    await waitFor(() =>
      expect(api.addLinks).toHaveBeenCalledWith("d1", [
        { entry: FLIGHT, role: "covers", provenance: "user", rentalCategory: null },
      ])
    );
    expect(await screen.findByText("Rundreise.pdf")).toBeInTheDocument();
  });

  it("tells the user the link was already gone and re-reads the list", async () => {
    api.unlinkFromEntry.mockRejectedValue(axiosError(404, "DOCUMENT_LINK_NOT_FOUND"));
    render(<DocumentsSection entry={FLIGHT} />);
    fireEvent.click(await screen.findByRole("button", { name: "documents:links.unlinkLabel" }));
    expect(await screen.findByText("documents:links.errors.linkGone")).toBeInTheDocument();
    await waitFor(() => expect(api.listForEntry).toHaveBeenCalledTimes(2));
  });

  it("names every entry 'delete everywhere' reaches before it asks", async () => {
    api.links.mockResolvedValue([
      {
        id: "l1",
        role: "primary",
        provenance: "user",
        rentalCategory: null,
        entry: candidate("trip", "t1", "Rundreise USA"),
      },
      {
        id: "l2",
        role: "covers",
        provenance: "user",
        rentalCategory: null,
        entry: candidate("flight", "f1", "LH400 · FRA → JFK"),
      },
    ]);
    render(<DocumentsSection entry={FLIGHT} />);
    fireEvent.click(await screen.findByRole("button", { name: "documents:removeLabel" }));
    const modal = await screen.findByTestId("confirm-modal");
    await waitFor(() => expect(modal.textContent).toContain("Rundreise USA"));
    const message = modal;
    expect(message.textContent).toContain("LH400 · FRA → JFK");
    expect(message.textContent).toContain("documents:links.deleteAffects");
    expect(api.remove).not.toHaveBeenCalled();
  });

  it("keeps 'delete everywhere' unanswerable until the affected entries are known", async () => {
    let resolve!: (v: never[]) => void;
    api.links.mockReturnValue(new Promise<never[]>((r) => (resolve = r)));
    render(<DocumentsSection entry={FLIGHT} />);
    fireEvent.click(await screen.findByRole("button", { name: "documents:removeLabel" }));
    // While the read is pending the confirm button is the disabled "processing" one.
    expect(screen.queryByRole("button", { name: "common:buttons.delete" })).toBeNull();
    resolve([]);
    expect(await screen.findByRole("button", { name: "common:buttons.delete" })).toBeEnabled();
  });

  it("says so when the affected entries could not be read, instead of deleting blind", async () => {
    api.links.mockRejectedValue(new Error("boom"));
    render(<DocumentsSection entry={FLIGHT} />);
    fireEvent.click(await screen.findByRole("button", { name: "documents:removeLabel" }));
    expect(await screen.findByText(/documents:links\.errors\.impactFailed/)).toBeInTheDocument();
  });

  it("offers no category control on a covers row, which has none of its own", async () => {
    api.listForEntry.mockResolvedValue([doc({ rentalCategory: "pickup" })]);
    render(<DocumentsSection entry={{ type: "rentalBooking", id: "r1" }} rentalCategories />);
    await screen.findByText("Rundreise.pdf");
    expect(screen.queryByLabelText("documents:rentalCategory.rowLabel")).toBeNull();
    expect(screen.getByTestId("documents-group-none")).toBeInTheDocument();
  });

  describe("also link to …", () => {
    const open = async () => {
      render(<DocumentsSection entry={FLIGHT} />);
      fireEvent.click(
        await screen.findByRole("button", { name: "documents:links.alsoLinkActionLabel" })
      );
      return screen.findByTestId("link-document-dialog");
    };

    it("lists trip entries before the rest and links the picked ones as the user's", async () => {
      api.linkCandidates.mockResolvedValue({
        tripEntries: [candidate("flight", "f2", "Rückflug")],
        otherEntries: [candidate("railJourney", "r1", "Berlin → Hamburg", null)],
      });
      api.addLinks.mockResolvedValue([]);
      const dialog = await open();
      await within(dialog).findByText("Rückflug");
      const boxes = within(dialog).getAllByRole("checkbox");
      expect(boxes).toHaveLength(2);
      fireEvent.click(boxes[0]);
      fireEvent.click(boxes[1]);
      fireEvent.click(within(dialog).getByRole("button", { name: "documents:links.linkSelected" }));
      await waitFor(() =>
        expect(api.addLinks).toHaveBeenCalledWith("d1", [
          { entry: { type: "flight", id: "f2" } },
          { entry: { type: "railJourney", id: "r1" } },
        ])
      );
    });

    it("says the document is already linked (409) and reloads the candidates", async () => {
      api.linkCandidates.mockResolvedValue({
        tripEntries: [candidate("flight", "f2", "Rückflug")],
        otherEntries: [],
      });
      api.addLinks.mockRejectedValue(axiosError(409, "DOCUMENT_LINK_EXISTS"));
      const dialog = await open();
      fireEvent.click(await within(dialog).findByRole("checkbox"));
      fireEvent.click(within(dialog).getByRole("button", { name: "documents:links.linkSelected" }));
      expect(await within(dialog).findByText("documents:links.errors.exists")).toBeInTheDocument();
      await waitFor(() => expect(api.linkCandidates).toHaveBeenCalledTimes(2));
    });

    it("says the entry is gone (404) instead of a generic failure", async () => {
      api.linkCandidates.mockResolvedValue({
        tripEntries: [candidate("flight", "f2", "Rückflug")],
        otherEntries: [],
      });
      api.addLinks.mockRejectedValue(axiosError(404, "DOCUMENT_ENTRY_NOT_FOUND"));
      const dialog = await open();
      fireEvent.click(await within(dialog).findByRole("checkbox"));
      fireEvent.click(within(dialog).getByRole("button", { name: "documents:links.linkSelected" }));
      expect(
        await within(dialog).findByText("documents:links.errors.entryGone")
      ).toBeInTheDocument();
    });

    it("says when the candidate list could not be loaded", async () => {
      api.linkCandidates.mockRejectedValue(new Error("boom"));
      const dialog = await open();
      expect(
        await within(dialog).findByText("documents:links.errors.candidatesFailed")
      ).toBeInTheDocument();
    });
  });

  describe("link a document from the trip", () => {
    it("links the picked documents and names the one that failed", async () => {
      api.tripCandidates.mockResolvedValue([
        doc({ id: "a", displayName: "A.pdf" }),
        doc({ id: "b", displayName: "B.pdf" }),
      ]);
      api.addLinks.mockImplementation(async (id: string) => {
        if (id === "b") throw axiosError(404, "DOCUMENT_NOT_FOUND");
        return [];
      });
      render(<DocumentsSection entry={FLIGHT} />);
      fireEvent.click(
        await screen.findByRole("button", { name: "documents:links.fromTripAction" })
      );
      const dialog = await screen.findByTestId("trip-document-dialog");
      for (const box of await within(dialog).findAllByRole("checkbox")) fireEvent.click(box);
      fireEvent.click(
        within(dialog).getByRole("button", { name: "documents:links.linkSelectedDocs" })
      );
      expect(
        await within(dialog).findByText(/documents:links\.errors\.documentGone.*B\.pdf/)
      ).toBeInTheDocument();
      expect(api.addLinks).toHaveBeenCalledWith("a", [{ entry: FLIGHT }]);
    });
  });
});
