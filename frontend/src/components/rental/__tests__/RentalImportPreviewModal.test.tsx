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
const getRental = vi.fn();
vi.mock("../../../lib/api/rental", () => ({
  rentalApi: {
    importDocument: (...a: unknown[]) => importDocument(...a),
    get: (...a: unknown[]) => getRental(...a),
    searchStations: () => Promise.resolve([]),
  },
}));

import { RentalImportPreviewModal } from "../RentalImportPreviewModal";
import type { RentalImportCandidate, RentalInvoiceReading } from "../../../types/rental";
import { makeRental } from "./rentalFixture";

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
    cancellationFee: null,
    confirmationNumber: "1234567890",
    provider: "Testcar",
    mailSentAt: null,
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
  beforeEach(() => {
    importDocument.mockReset();
    getRental.mockReset().mockResolvedValue(makeRental({ price: 120, currency: "EUR" }));
  });

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

  it("sends the mail's send time and the fee, and says when the mail was older", async () => {
    importDocument.mockResolvedValueOnce({ outcome: "stale" });
    const onSaved = vi.fn();
    const candidate = confirmation({
      kind: "cancellation",
      action: "cancel",
      input: null,
      stations: null,
      cancellationFee: { amount: 45.5, currency: "EUR" },
      mailSentAt: "2026-05-01T10:00:00.000Z",
    });
    render(<RentalImportPreviewModal candidate={candidate} onCancel={vi.fn()} onSaved={onSaved} />);
    expect(screen.getByTestId("rental-import-fee")).toHaveTextContent(
      "rental:import.cancellationFee"
    );
    fireEvent.click(screen.getByRole("button", { name: "rental:import.action.cancel" }));
    expect(await screen.findByTestId("rental-import-stale")).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
    expect(importDocument.mock.calls[0][0]).toMatchObject({
      kind: "cancellation",
      fee: { amount: 45.5, currency: "EUR" },
      mailSentAt: "2026-05-01T10:00:00.000Z",
    });
    expect(screen.queryByRole("button", { name: "rental:import.action.cancel" })).toBeNull();
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

  // forgejo#237: the invoice beside its booking, each reading taken on its own.
  describe("an invoice beside its booking", () => {
    const invoiceFor = (over: Partial<RentalInvoiceReading> = {}) =>
      confirmation({
        kind: "invoice",
        action: "invoice",
        existingId: "00000000-0000-4000-8000-000000000001",
        input: null,
        stations: null,
        invoice: { ...INVOICE, vehicleDriven: "Opel Corsa", ...over },
      });

    it("shows booked, invoiced and their difference, and says when no fee line was read", async () => {
      render(
        <RentalImportPreviewModal candidate={invoiceFor()} onCancel={vi.fn()} onSaved={vi.fn()} />
      );
      expect((await screen.findByTestId("rental-invoice-difference")).textContent).toMatch(/^\+30/);
      expect(screen.getByTestId("rental-invoice-no-fees")).toBeTruthy();
      expect(screen.getByTestId("rental-invoice-row-vehicleDriven")).toBeTruthy();
    });

    it("sends only the readings left ticked", async () => {
      importDocument.mockResolvedValue({ outcome: "invoiced" });
      const onSaved = vi.fn();
      render(
        <RentalImportPreviewModal candidate={invoiceFor()} onCancel={vi.fn()} onSaved={onSaved} />
      );
      const row = await screen.findByTestId("rental-invoice-row-vehicleDriven");
      fireEvent.click(row.querySelector("input[type=checkbox]") as HTMLInputElement);
      fireEvent.click(screen.getByRole("button", { name: "rental:import.action.invoice" }));
      await waitFor(() => expect(onSaved).toHaveBeenCalled());
      expect(importDocument.mock.calls[0][0].adopt).toMatchObject({
        vehicleDriven: false,
        finalAmount: true,
        distance: true,
      });
    });

    it("marks a reading the rental already holds as matching, with nothing to tick", async () => {
      getRental.mockResolvedValue(makeRental({ vehicleDriven: "Opel Corsa" }));
      render(
        <RentalImportPreviewModal candidate={invoiceFor()} onCancel={vi.fn()} onSaved={vi.fn()} />
      );
      await waitFor(() =>
        expect(
          screen.getByTestId("rental-invoice-row-vehicleDriven").querySelector("input")
        ).toBeNull()
      );
      expect(screen.getByText("rental:invoiceReview.same")).toBeTruthy();
    });

    // forgejo#237: each fee line the invoice lists is reviewed and taken on its own.
    it("lists the fee lines read, beside the difference, and sends only those left ticked", async () => {
      importDocument.mockResolvedValue({ outcome: "invoiced" });
      const onSaved = vi.fn();
      const fees = [
        { label: "Tankfüllung", amount: 18, currency: "EUR" },
        { label: "Mautgebühren", amount: 12, currency: "EUR" },
      ];
      render(
        <RentalImportPreviewModal
          candidate={invoiceFor({ fees })}
          onCancel={vi.fn()}
          onSaved={onSaved}
        />
      );
      expect(await screen.findByTestId("rental-invoice-fees-total")).toHaveTextContent(
        "rental:invoiceReview.fees.totalBesideDifference"
      );
      // Untick the first line; the second stays ticked.
      fireEvent.click(
        screen.getAllByRole("checkbox", { name: "rental:invoiceReview.fees.adoptLine" })[0]
      );
      fireEvent.click(screen.getByRole("button", { name: "rental:import.action.invoice" }));
      await waitFor(() => expect(onSaved).toHaveBeenCalled());
      expect(importDocument.mock.calls[0][0].adopt).toMatchObject({ fees: [1] });
    });

    it("offers no tick for a fee line the rental already holds", async () => {
      const fee = { label: "Mautgebühren", amount: 12, currency: "EUR" };
      getRental.mockResolvedValue(makeRental({ price: 120, currency: "EUR", invoiceFees: [fee] }));
      render(
        <RentalImportPreviewModal
          candidate={invoiceFor({ fees: [fee] })}
          onCancel={vi.fn()}
          onSaved={vi.fn()}
        />
      );
      expect(await screen.findByText("rental:invoiceReview.fees.recorded")).toBeTruthy();
      expect(screen.getByTestId("rental-invoice-fee-0").querySelector("input")).toBeNull();
    });

    it("says when the booking cannot be loaded, and retries", async () => {
      getRental
        .mockReset()
        .mockRejectedValueOnce(new Error("down"))
        .mockResolvedValue(makeRental());
      render(
        <RentalImportPreviewModal candidate={invoiceFor()} onCancel={vi.fn()} onSaved={vi.fn()} />
      );
      expect(await screen.findByText("rental:invoiceReview.loadFailed")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "common:buttons.retry" }));
      await waitFor(() => expect(screen.queryByText("rental:invoiceReview.loadFailed")).toBeNull());
      expect(getRental).toHaveBeenCalledTimes(2);
    });
  });
});
