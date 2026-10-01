import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" }, ready: true }),
}));
vi.mock("../../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock("../../location/LocationInput", () => ({ LocationInput: () => null }));

const importDocument = vi.fn();
vi.mock("../../../lib/api/rental", () => ({
  rentalApi: {
    importDocument: (...a: unknown[]) => importDocument(...a),
    searchStations: () => Promise.resolve([]),
  },
}));

import { RentalImportPreviewModal } from "../RentalImportPreviewModal";
import type { RentalImportCandidate } from "../../../types/rental";

const AIRPORT_A = { airportId: 1, iata: "AAA", name: "Testport A", country: "DE" };
const AIRPORT_B = { airportId: 2, iata: "BBB", name: "Testport B", country: "DE" };

function confirmation(over: Partial<RentalImportCandidate> = {}): RentalImportCandidate {
  return {
    kind: "confirmation",
    action: "create",
    declineCode: null,
    existingId: null,
    parserTemplate: "sixt-confirmation",
    input: {
      provider: "Testcar",
      confirmationNumber: "1234567890",
      pickupStation: { name: "Testport Flughafen" },
      returnStation: null,
      pickupLocal: "2026-07-06T09:15",
      returnLocal: "2026-07-08T18:45",
    },
    stations: {
      pickup: { status: "ambiguous", candidates: [AIRPORT_A, AIRPORT_B] },
      return: { status: "unresolved" },
    },
    invoice: null,
    confirmationNumber: "1234567890",
    provider: "Testcar",
    ...over,
  };
}

const INVOICE = {
  provider: "Testcar",
  confirmationNumber: "1234567890",
  agreementNumber: null,
  invoiceNumber: null,
  odometerOutKm: 100,
  odometerInKm: 512,
  distanceKm: 412,
  vehicleDriven: null,
  actualPickupLocal: null,
  actualReturnLocal: null,
  finalAmount: 150,
  finalCurrency: "EUR",
};

describe("RentalImportPreviewModal", () => {
  beforeEach(() => importDocument.mockReset());

  it("keeps the save closed until an ambiguous station is answered, offering every candidate", async () => {
    importDocument.mockResolvedValue({});
    const onSaved = vi.fn();
    render(
      <RentalImportPreviewModal candidate={confirmation()} onCancel={vi.fn()} onSaved={onSaved} />
    );
    const save = screen.getByRole("button", {
      name: "rental:import.action.create",
    }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(screen.getByText("Testport A (AAA)")).toBeTruthy();
    fireEvent.click(screen.getByText("Testport B (BBB)"));
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(importDocument.mock.calls[0][0].input.pickupStation).toMatchObject({ airportId: 2 });
  });

  it("starts from the geocoder's proposal and saves it as a position", async () => {
    importDocument.mockResolvedValue({});
    const onSaved = vi.fn();
    const candidate = confirmation({
      stations: {
        pickup: {
          status: "geocoded",
          place: { label: "Testplatz 1, Testhausen", lat: 48.1, lon: 11.5, country: "DE" },
        },
        return: { status: "unresolved" },
      },
    });
    render(<RentalImportPreviewModal candidate={candidate} onCancel={vi.fn()} onSaved={onSaved} />);
    expect(screen.getByTestId("rental-import-pickup-geocoded")).toHaveTextContent(
      "rental:import.geocoded"
    );
    fireEvent.click(screen.getByRole("button", { name: "rental:import.action.create" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(importDocument.mock.calls[0][0].input.pickupStation).toMatchObject({
      lat: 48.1,
      lon: 11.5,
      country: "DE",
    });
  });

  it("says an unreachable geocoder instead of a bare unplaced station", () => {
    const candidate = confirmation({
      stations: {
        pickup: { status: "unresolved", geocoderUnavailable: true },
        return: { status: "unresolved" },
      },
    });
    render(<RentalImportPreviewModal candidate={candidate} onCancel={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByText("rental:import.geocoderUnavailable")).toHaveAttribute("role", "alert");
  });

  it("offers no save for an invoice of an unknown booking and says why", () => {
    const candidate = confirmation({
      kind: "invoice",
      action: "declined",
      declineCode: "unknownBooking",
      input: null,
      stations: null,
      invoice: INVOICE,
    });
    render(<RentalImportPreviewModal candidate={candidate} onCancel={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByText("rental:import.unknownBooking")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /rental:import.action/ })).toBeNull();
  });

  it("shows a km conflict and saves the invoice's figure only on the user's choice", async () => {
    importDocument
      .mockRejectedValueOnce({
        response: { status: 409, data: { code: "RENTAL_INVOICE_KM_CONFLICT" } },
      })
      .mockResolvedValueOnce({});
    const onSaved = vi.fn();
    const candidate = confirmation({
      kind: "invoice",
      action: "invoice",
      input: null,
      stations: null,
      invoice: INVOICE,
    });
    render(<RentalImportPreviewModal candidate={candidate} onCancel={vi.fn()} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole("button", { name: "rental:import.action.invoice" }));
    expect(await screen.findByText("rental:import.kmConflict")).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "rental:import.useInvoiceKm" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(importDocument.mock.calls[1][0]).toMatchObject({
      kind: "invoice",
      replaceUserDistance: true,
    });
  });

  it("names a refused save instead of closing as if it had worked", async () => {
    importDocument.mockRejectedValueOnce({
      response: { status: 404, data: { code: "RENTAL_UNKNOWN_BOOKING" } },
    });
    const onSaved = vi.fn();
    const candidate = confirmation({
      kind: "cancellation",
      action: "cancel",
      input: null,
      stations: null,
    });
    render(<RentalImportPreviewModal candidate={candidate} onCancel={vi.fn()} onSaved={onSaved} />);
    const save = screen.getByRole("button", { name: "rental:import.action.cancel" });
    fireEvent.click(save);
    expect(await screen.findByText("rental:form.errors.unknownBooking")).toBeTruthy();
    await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false));
    expect(onSaved).not.toHaveBeenCalled();
    expect(importDocument).toHaveBeenCalledTimes(1);
  });
});
