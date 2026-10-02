import { parseSixtConfirmation } from "../sixtConfirmation";
import { parseSixtInvoice } from "../sixtInvoice";
import { looksLikeParking, parseCancellation } from "../rentalBookingParser";
import {
  SIXT_INVOICE_ONE_CAR,
  SIXT_INVOICE_SWAP,
  SIXT_LAYOUT_A,
  SIXT_LAYOUT_B,
} from "./sixtFixtures";

/**
 * The Sixt readers on synthetic documents in the measured shapes. The real
 * mails are the measuring corpus (`test-samples/Mietwagen/expectations.json`,
 * run by `scripts/parser-corpus.ts --domain rental`); nothing of them is here.
 */
describe("Sixt confirmation", () => {
  it("reads layout A: station line, then its date", () => {
    const r = parseSixtConfirmation(SIXT_LAYOUT_A, "reservation@e.sixt.com");
    expect(r).toMatchObject({
      provider: "Sixt",
      confirmationNumber: "1234567890",
      pickup: { stationName: "Frankfurt Flughafen", local: "2026-07-06T09:15" },
      return: { stationName: "Frankfurt Flughafen", local: "2026-07-08T18:45" },
      vehicleExample: "Testmobil Kompakt",
      paymentTiming: "pay_at_counter",
      price: 123.45,
      currency: "EUR",
      mileagePolicy: "unlimited",
    });
  });

  it("counts only what the booking includes, not what it offers", () => {
    // Layout A lists collision cover as an upsell above the included block.
    expect(parseSixtConfirmation(SIXT_LAYOUT_A, "reservation@e.sixt.com")?.inclusions).toEqual([
      "roadside",
    ]);
  });

  it("reads layout B: date first, then 'Abholung in', a one-way return and a prepaid total", () => {
    const r = parseSixtConfirmation(SIXT_LAYOUT_B, "buchung@sixt.com");
    expect(r).toMatchObject({
      confirmationNumber: "2345678901",
      pickup: { stationName: "Frankfurt Flughafen", local: "2026-09-03T15:30" },
      return: { stationName: "München Flughafen", local: "2026-09-06T10:30" },
      paymentTiming: "prepaid",
      price: 1234.5,
      placeHints: { country: "DE", airportWords: [] },
    });
    expect(r?.inclusions.sort()).toEqual(["cdw", "roadside", "tp"]);
  });

  it("declines a Sixt mail that is not a confirmation", () => {
    expect(parseSixtConfirmation("Sommerangebote bei SIXT", "news@e.sixt.com")).toBeNull();
  });

  it("declines a confirmation whose dates it cannot read rather than guessing them", () => {
    const broken = SIXT_LAYOUT_A.replace("Montag, 06. Jul, 2026 um 09:15", "bald");
    expect(parseSixtConfirmation(broken, "reservation@e.sixt.com")).toBeNull();
  });
});

describe("Sixt invoice", () => {
  it("reads the booking number, km, car, actual times and the gross total", () => {
    expect(
      parseSixtInvoice(
        SIXT_INVOICE_ONE_CAR,
        "Ihre Rechnung 1111222233334444 für die Miete 9876543210"
      )
    ).toMatchObject({
      kind: "invoice",
      confirmationNumber: "1234567890",
      agreementNumber: "9876543210",
      invoiceNumber: "1111222233334444",
      odometerOutKm: 10000,
      odometerInKm: 10412,
      distanceKm: 412,
      vehicleDriven: "Opel Corsa",
      actualPickupLocal: "2026-07-06T09:20",
      actualReturnLocal: "2026-07-08T18:10",
      finalAmount: 150.75,
      finalCurrency: "EUR",
    });
  });

  it("adds the km of a car swap and claims no single odometer pair", () => {
    const r = parseSixtInvoice(SIXT_INVOICE_SWAP);
    expect(r).toMatchObject({ distanceKm: 300, odometerOutKm: null, odometerInKm: null });
    expect(r?.vehicleDriven).toBe("Peugeot 208 / Volvo XC40");
    expect(r?.finalAmount).toBe(1300);
  });

  it("does not read a vehicle row whose km do not add up — null, never a guess", () => {
    const wrong = SIXT_INVOICE_ONE_CAR.replace("10000 10412 412", "10000 10412 999");
    expect(parseSixtInvoice(wrong)).toMatchObject({ distanceKm: null, vehicleDriven: null });
  });
});

describe("declines", () => {
  it("files an airport-parking booking as parking, not a rental", () => {
    const parking =
      "Ihre Parkbuchung 556677 am Flughafen Testhausen\nEinfahrt: 01.07.2026 08:00\nAusfahrt: 08.07.2026 20:00\nParkhaus P3, 59,00 €";
    expect(looksLikeParking(parking)).toBe(true);
    expect(looksLikeParking(SIXT_LAYOUT_A)).toBe(false);
  });

  // UNMEASURED: neither corpus holds a cancellation; the shape is synthetic.
  it("reads a provider cancellation by its booking number", () => {
    const text = "Ihre Buchung wurde storniert.\nBuchungsnummer: 1234567890";
    expect(parseCancellation(text, "reservation@e.sixt.com")).toMatchObject({
      kind: "cancellation",
      provider: "Sixt",
      confirmationNumber: "1234567890",
    });
    expect(parseCancellation(text, "someone@example.invalid")).toBeNull();
  });
});
