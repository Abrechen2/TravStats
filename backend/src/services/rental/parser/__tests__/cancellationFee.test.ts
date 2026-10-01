import { cancellationFee, parseCancellation } from "../rentalBookingParser";

/**
 * A cancellation that bills a fee (owner, 2026-10-01: the fee is the
 * cancelled rental's cost). Synthetic text in the shape of a provider's fee
 * invoice — a German mail body and a French invoice page.
 */
const FEE_MAIL = [
  "Ihre Rechnung 1000000000000001 für die Buchung 1234567890",
  "Ihre Buchung wurde storniert, daher müssen wir Ihnen eine Stornogebühr berechnen.",
  "Zahlbarer Rechnungsbetrag: \t45,50 EUR",
  "Frais d'annulation de réservation 38,24 €",
  "Montant total brut 45,50 €",
  "Vous recevrez un remboursement de 54,50 €",
].join("\n");

describe("cancellation fees", () => {
  it("reads the billed total of a fee invoice", () => {
    expect(cancellationFee(FEE_MAIL)).toEqual({ amount: 45.5, currency: "EUR" });
  });

  it("falls back to the gross total when the payable line is missing", () => {
    const french = FEE_MAIL.replace(/Zahlbarer Rechnungsbetrag.*\n/, "");
    expect(cancellationFee(french)).toEqual({ amount: 45.5, currency: "EUR" });
  });

  it("reads no fee where none is named — a refund is not a cost", () => {
    expect(cancellationFee("Ihre Buchung wurde storniert.\nRückerstattung: 54,50 EUR")).toBeNull();
  });

  it("carries the fee on the cancellation it reads", () => {
    expect(parseCancellation(FEE_MAIL, "Sixt <rechnung@sixt.example>")).toMatchObject({
      kind: "cancellation",
      confirmationNumber: "1234567890",
      fee: { amount: 45.5, currency: "EUR" },
    });
  });
});
