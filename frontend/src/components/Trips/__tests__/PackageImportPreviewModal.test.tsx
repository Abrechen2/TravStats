import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PackageImportPreviewModal } from "../PackageImportPreviewModal";
import type { PackageReading } from "../../../lib/api/parse";
import type { PackageProposal } from "../../../lib/api/tripPackage";

vi.mock("../../../hooks/useTranslation", async () => {
  const { germanUseTranslation } = await import("../../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslation };
});

const preview = vi.fn();
const commit = vi.fn();
vi.mock("../../../lib/api/tripPackage", () => ({
  tripPackageApi: {
    preview: (...args: unknown[]) => preview(...args),
    commit: (...args: unknown[]) => commit(...args),
  },
}));

const reading: PackageReading = {
  bookingReference: "9Z123456",
  issuedOn: "2026-03-02",
  totalPrice: 3249,
  currency: "EUR",
  flights: [{ flightNumber: "ET707", date: "2026-05-18", depCity: "Nairobi", arrIata: "ADD" }],
  stays: [{ name: "Savanna Example Lodge", checkIn: "2026-05-19", checkOut: "2026-05-23" }],
};

const proposal = (overrides: Partial<PackageProposal> = {}): PackageProposal => ({
  trip: {
    action: "create",
    id: null,
    name: "Kenia · Mai 2026",
    startDate: "2026-05-18",
    endDate: "2026-05-23",
    matchedBy: null,
  },
  booking: {
    action: "create",
    id: null,
    reference: "9Z123456",
    issuedOn: "2026-03-02",
    price: 3249,
    currency: "EUR",
    travellers: 2,
  },
  flights: [
    {
      index: 0,
      action: "skip",
      id: null,
      reason: "unresolvedAirport",
      flightNumber: "ET707",
      airline: null,
      date: "2026-05-18",
      depTime: "21:35",
      arrTime: "06:25",
      arrDayOffset: 1,
      departure: {
        iata: null,
        city: "Nairobi",
        status: "ambiguous",
        candidates: [
          { iata: "NBO", name: "Jomo Kenyatta International Airport", city: "Nairobi" },
          { iata: "WIL", name: "Nairobi Wilson Airport", city: "Nairobi" },
        ],
      },
      arrival: { iata: "ADD", city: null, status: "given" },
    },
  ],
  stays: [
    {
      index: 0,
      action: "create",
      id: null,
      lodging: { action: "create", id: null },
      name: "Savanna Example Lodge",
      checkIn: "2026-05-19",
      checkOut: "2026-05-23",
      address: null,
      city: null,
      country: null,
      board: null,
      room: null,
    },
  ],
  cruise: null,
  document: { id: "doc-1", action: "file" },
  warnings: [{ code: "airportAmbiguous", subject: "Nairobi" }],
  ...overrides,
});

describe("PackageImportPreviewModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    preview.mockResolvedValue(proposal());
  });

  const renderModal = (onSaved = vi.fn()) =>
    render(
      <PackageImportPreviewModal
        reading={reading}
        documentId="doc-1"
        issuer="Berge & Meer"
        onCancel={vi.fn()}
        onSaved={onSaved}
      />
    );

  it("shows what will be created, skipped and why, and the warnings", async () => {
    renderModal();
    expect(await screen.findByText(/Savanna Example Lodge/)).toBeInTheDocument();
    expect(preview).toHaveBeenCalledWith({
      reading,
      documentId: "doc-1",
      choices: { airports: {} },
    });
    const badges = screen.getAllByTestId("package-action").map((b) => b.textContent);
    expect(badges).toContain("Übersprungen · Flughafen unklar");
    expect(badges).toContain("Neu");
    expect(screen.getByText(/passt zu mehreren Flughäfen/)).toBeInTheDocument();
    expect(screen.getByDisplayValue("Kenia · Mai 2026")).toBeInTheDocument();
  });

  it("asks the server again with the airport the reviewer picked", async () => {
    renderModal();
    const select = await screen.findByRole("combobox");
    fireEvent.change(select, { target: { value: "NBO" } });
    await waitFor(() =>
      expect(preview).toHaveBeenLastCalledWith({
        reading,
        documentId: "doc-1",
        choices: { airports: { Nairobi: "NBO" } },
      })
    );
  });

  it("commits through the server with the reviewer's choices and reports success", async () => {
    const result = { trip: { action: "create", id: "t1" } };
    commit.mockResolvedValue(result);
    const onSaved = vi.fn();
    renderModal(onSaved);
    await screen.findByText(/Savanna Example Lodge/);
    fireEvent.change(screen.getByDisplayValue("Kenia · Mai 2026"), {
      target: { value: "Kenia mit Oma" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reise übernehmen" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(result));
    expect(commit).toHaveBeenCalledWith({
      reading,
      documentId: "doc-1",
      choices: { airports: {}, tripName: "Kenia mit Oma" },
    });
  });

  it("shows a refused commit as itself, keeps the dialog open and never reports saved", async () => {
    commit.mockRejectedValue({
      response: {
        status: 422,
        data: { code: "PACKAGE_FLIGHT_INVALID", field: "flights[0]", error: "x" },
      },
    });
    const onSaved = vi.fn();
    renderModal(onSaved);
    await screen.findByText(/Savanna Example Lodge/);
    fireEvent.click(screen.getByRole("button", { name: "Reise übernehmen" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Flug ET707 kann so nicht angelegt werden");
    expect(alert).toHaveTextContent("Es wurde nichts angelegt");
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Reise übernehmen" })).toBeEnabled();
  });

  it("says when the comparison itself failed, and offers no commit", async () => {
    preview.mockRejectedValue({ response: { status: 500, data: {} } });
    renderModal();
    expect(await screen.findByRole("alert")).toHaveTextContent("Der Abgleich ist fehlgeschlagen");
    expect(screen.getByRole("button", { name: "Reise übernehmen" })).toBeDisabled();
  });
});
