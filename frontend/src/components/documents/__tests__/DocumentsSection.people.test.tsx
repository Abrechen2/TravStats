import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import type { TravelDocument } from "../../../lib/api/documents";
import type { EntryTraveller } from "../../../lib/api/entryTravellers";

/**
 * Plan D7: a document is FOR a person at an entry (set by hand or from a parsed
 * name, and then says so), and each person on the entry has their own facts.
 * Every failure reaches the user as itself.
 */
const api = vi.hoisted(() => ({
  listForEntry: vi.fn(),
  limits: vi.fn(),
  assignCompanion: vi.fn(),
  links: vi.fn(),
}));
const travellers = vi.hoisted(() => ({ list: vi.fn(), setFacts: vi.fn() }));

vi.mock("../../../lib/api/documents", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/api/documents")>(
    "../../../lib/api/documents"
  );
  return { ...actual, documentsApi: api };
});
vi.mock("../../../lib/api/entryTravellers", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/api/entryTravellers")>(
    "../../../lib/api/entryTravellers"
  );
  return { ...actual, entryTravellersApi: travellers };
});
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => false }));

import DocumentsSection from "../DocumentsSection";

const FLIGHT = { type: "flight", id: "f1" } as const;
const axiosError = (status: number) => Object.assign(new Error("x"), { response: { status } });

function doc(over: Partial<TravelDocument> = {}): TravelDocument {
  return {
    id: "d1",
    format: "pdf",
    kind: "boardingPass",
    mimetype: "application/pdf",
    sizeBytes: 1000,
    sha256: "abc",
    originalName: "BoardingPass.pdf",
    displayName: "BoardingPass.pdf",
    issuedOn: null,
    source: "upload",
    parsedDomain: null,
    entry: FLIGHT,
    createdAt: "2026-09-18T10:00:00.000Z",
    linkedAt: null,
    url: "/api/v1/documents/d1/file",
    linkRole: "primary",
    evidenceFrom: null,
    linkCount: 1,
    forCompanion: null,
    forSource: null,
    ...over,
  };
}
const traveller = (over: Partial<EntryTraveller> = {}): EntryTraveller => ({
  companionId: "c1",
  displayName: "Norbert Nord",
  position: 0,
  facts: {
    seatNumber: null,
    seatClass: null,
    ticketNumber: null,
    bookingReference: null,
    loyaltyNumber: null,
  },
  factsSource: null,
  documents: [],
  ...over,
});

describe("DocumentsSection — people (D7)", () => {
  beforeEach(() => {
    [...Object.values(api), ...Object.values(travellers)].forEach((m) => m.mockReset());
    api.listForEntry.mockResolvedValue([doc()]);
    api.limits.mockResolvedValue({ image: 1, pdf: 1, eml: 1, emailText: 1, pkpass: 1 });
    api.links.mockResolvedValue([]);
    travellers.list.mockResolvedValue([
      traveller(),
      traveller({ companionId: "c2", displayName: "Erika Muster", position: 1 }),
    ]);
  });

  it("says a document is not assigned yet instead of pretending it is the owner's", async () => {
    render(<DocumentsSection entry={FLIGHT} />, { wrapper: MemoryRouter });
    const person = await screen.findByTestId("document-person");
    expect(person).toHaveTextContent("documents:person.pickUndecided");
  });

  it("names the person and that a parsed name set it", async () => {
    api.listForEntry.mockResolvedValue([
      doc({ forCompanion: { id: "c1", displayName: "Norbert Nord" }, forSource: "auto" }),
    ]);
    render(<DocumentsSection entry={FLIGHT} />, { wrapper: MemoryRouter });
    const person = await screen.findByTestId("document-person");
    expect(person).toHaveTextContent("documents:person.forPerson");
    expect(screen.getByTestId("document-person-auto")).toHaveTextContent("documents:person.auto");
  });

  it("assigns the picked companion to this entry's link and shows the saved answer", async () => {
    api.assignCompanion.mockResolvedValue({ companionId: "c2", companionSource: "user" });
    render(<DocumentsSection entry={FLIGHT} />, { wrapper: MemoryRouter });
    const select = await screen.findByRole("combobox", { name: "documents:person.pickLabel" });
    await waitFor(() => expect(within(select).getAllByRole("option").length).toBeGreaterThan(2));
    fireEvent.change(select, { target: { value: "c2" } });
    await waitFor(() => expect(api.assignCompanion).toHaveBeenCalledWith("d1", FLIGHT, "c2"));
    expect(await screen.findByTestId("document-person")).toHaveTextContent(
      "documents:person.forPerson"
    );
    expect(screen.queryByTestId("document-person-auto")).toBeNull();
  });

  it("says the assignment failed and keeps the old person", async () => {
    api.assignCompanion.mockRejectedValue(axiosError(500));
    render(<DocumentsSection entry={FLIGHT} />, { wrapper: MemoryRouter });
    const select = await screen.findByRole("combobox", { name: "documents:person.pickLabel" });
    await waitFor(() => expect(within(select).getAllByRole("option").length).toBeGreaterThan(2));
    fireEvent.change(select, { target: { value: "c2" } });
    expect(await screen.findByText("documents:person.saveFailed")).toBeInTheDocument();
    expect(screen.getByTestId("document-person")).toHaveTextContent(
      "documents:person.pickUndecided"
    );
  });

  it("says the person is gone (404) and reloads instead of a generic failure", async () => {
    api.assignCompanion.mockRejectedValue(axiosError(404));
    render(<DocumentsSection entry={FLIGHT} />, { wrapper: MemoryRouter });
    const select = await screen.findByRole("combobox", { name: "documents:person.pickLabel" });
    await waitFor(() => expect(within(select).getAllByRole("option").length).toBeGreaterThan(2));
    fireEvent.change(select, { target: { value: "c1" } });
    expect(await screen.findByText("documents:person.companionGone")).toBeInTheDocument();
    await waitFor(() => expect(api.listForEntry.mock.calls.length).toBeGreaterThan(1));
  });

  describe("per-person facts", () => {
    it("lists each companion with their facts, documents and the automatic source", async () => {
      travellers.list.mockResolvedValue([
        traveller({
          facts: {
            seatNumber: "12A",
            seatClass: null,
            ticketNumber: null,
            bookingReference: "ABC123",
            loyaltyNumber: null,
          },
          factsSource: "auto",
          documents: [{ id: "d1", displayName: "BoardingPass.pdf", kind: "boardingPass" }],
        }),
      ]);
      render(<DocumentsSection entry={FLIGHT} />, { wrapper: MemoryRouter });
      const panel = await screen.findByTestId("travellers-panel");
      expect(panel).toHaveTextContent("Norbert Nord");
      const facts = within(panel).getByTestId("traveller-facts");
      expect(facts).toHaveTextContent("12A");
      expect(facts).toHaveTextContent("ABC123");
      expect(facts).toHaveTextContent("documents:travellers.auto");
    });

    it("saves one person's facts and re-reads", async () => {
      travellers.setFacts.mockResolvedValue(traveller());
      render(<DocumentsSection entry={FLIGHT} />, { wrapper: MemoryRouter });
      fireEvent.click(
        (await screen.findAllByRole("button", { name: "documents:travellers.editLabel" }))[0]
      );
      const seat = await screen.findByLabelText("documents:travellers.fact.seatNumber");
      fireEvent.change(seat, { target: { value: "14C" } });
      fireEvent.click(screen.getByRole("button", { name: "documents:travellers.save" }));
      await waitFor(() =>
        expect(travellers.setFacts).toHaveBeenCalledWith(
          "flight",
          "f1",
          "c1",
          expect.objectContaining({ seatNumber: "14C" })
        )
      );
      await waitFor(() => expect(travellers.list.mock.calls.length).toBeGreaterThan(1));
    });

    it("says the facts could not be saved, and keeps the form open", async () => {
      travellers.setFacts.mockRejectedValue(axiosError(500));
      render(<DocumentsSection entry={FLIGHT} />, { wrapper: MemoryRouter });
      fireEvent.click(
        (await screen.findAllByRole("button", { name: "documents:travellers.editLabel" }))[0]
      );
      fireEvent.click(await screen.findByRole("button", { name: "documents:travellers.save" }));
      expect(await screen.findByText("documents:travellers.saveFailed")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "documents:travellers.save" })).toBeInTheDocument();
    });

    it("draws no panel for an entry type that has no travellers", async () => {
      render(<DocumentsSection entry={{ type: "trip", id: "t1" }} />);
      await screen.findByText("BoardingPass.pdf");
      expect(screen.queryByTestId("travellers-panel")).toBeNull();
      expect(travellers.list).not.toHaveBeenCalled();
    });
  });
});
