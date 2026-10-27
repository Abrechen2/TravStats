import { snapshotTemplates } from "../../../parsers/templates/v2/__tests__/snapshotTemplates";
import {
  looksLikeParking,
  parseCancellation,
  parseRentalBookingText,
} from "../rentalBookingParser";
import { CONFIRMATION_READERS, INVOICE_READERS, v2Invoice } from "./readers";
import {
  SIXT_CANCELLATION_FEE_MAIL,
  SIXT_CANCELLATION_FEE_PDF,
  SIXT_INVOICE_NL,
  SIXT_INVOICE_ONE_CAR,
  SIXT_INVOICE_SWAP,
  SIXT_LAYOUT_A,
  SIXT_LAYOUT_B,
  SIXT_LAYOUT_B_LU,
} from "./sixtFixtures";

/**
 * The Sixt readers on synthetic documents in the measured shapes. The real
 * mails are the measuring corpus (`test-samples/Mietwagen/expectations.json`,
 * run by `scripts/parser-corpus.ts --domain rental`); nothing of them is here.
 *
 * Every case runs through BOTH readers: the compiled-in one it started as and
 * the v2 template file it became (plan 2026-10-09 P4b).
 */
describe.each(CONFIRMATION_READERS)("Sixt confirmation (%s)", (_name, parseSixtConfirmation) => {
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

  it("reads a Luxembourg station's mail past its protection upsell and deposit", () => {
    expect(parseSixtConfirmation(SIXT_LAYOUT_B_LU, "reservation@e.sixt.com")).toMatchObject({
      confirmationNumber: "7777777777",
      pickup: { stationName: "Exempleville Flughafen", local: "2026-05-13T08:45" },
      return: { stationName: "Exempleville Flughafen", local: "2026-05-15T19:15" },
      vehicleExample: "Probeauto C",
      paymentTiming: "prepaid",
      price: 150,
      currency: "EUR",
      mileagePolicy: "unlimited",
      inclusions: ["roadside", "cdw", "tp"],
      placeHints: { country: "LU" },
    });
  });

  it("declines a Sixt mail that is not a confirmation", () => {
    expect(parseSixtConfirmation("Sommerangebote bei SIXT", "news@e.sixt.com")).toBeNull();
  });

  it("declines a confirmation whose dates it cannot read rather than guessing them", () => {
    const broken = SIXT_LAYOUT_A.replace("Montag, 06. Jul, 2026 um 09:15", "bald");
    expect(parseSixtConfirmation(broken, "reservation@e.sixt.com")).toBeNull();
  });
});

describe.each(INVOICE_READERS)("Sixt invoice (%s)", (_name, parseSixtInvoice) => {
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

// forgejo#237: the template reads the invoice's single fee lines; the compiled
// reader it replaced never did, so this runs on the file alone.
describe("Sixt invoice fee lines (v2 template)", () => {
  const withFees = SIXT_INVOICE_ONE_CAR.replace(
    "Montant total brut 150,75 €",
    [
      "Prix de location 3 jours 90,00 €",
      "Carburant 1 33,25 €",
      "Péage 12,50 €",
      "Frais administratifs 15,00 €",
      "Montant total brut 150,75 €",
    ].join("\n")
  );

  it("reads each known fee line with its amount in the invoice's currency", () => {
    expect(v2Invoice(withFees)?.fees).toEqual([
      { label: "Carburant", amount: 33.25, currency: "EUR" },
      { label: "Péage", amount: 12.5, currency: "EUR" },
      { label: "Frais administratifs", amount: 15, currency: "EUR" },
    ]);
  });

  it("reads no line whose label it does not know — not the base rental, not a guess", () => {
    expect(v2Invoice(SIXT_INVOICE_ONE_CAR)?.fees).toEqual([]);
    const unknown = SIXT_INVOICE_ONE_CAR.replace(
      "Montant total brut",
      "Unbekannter Posten 9,99 €\nMontant total brut"
    );
    expect(v2Invoice(unknown)?.fees).toEqual([]);
  });
});

// forgejo#280: the Dutch PDF prints the line total first, then the unit
// price, the VAT code and the quantity. Before, no fee line was read at all.
describe("Sixt invoice, Dutch layout (v2 template)", () => {
  it("reads numbers, times, km, car and the gross total", () => {
    expect(
      v2Invoice(SIXT_INVOICE_NL, "Ihre Rechnung 9000000000000001 für die Miete 2222222222")
    ).toMatchObject({
      confirmationNumber: "1111111111",
      agreementNumber: "2222222222",
      invoiceNumber: "9000000000000001",
      actualPickupLocal: "2026-02-26T10:15",
      actualReturnLocal: "2026-03-01T18:40",
      odometerOutKm: 1000,
      odometerInKm: 1250,
      distanceKm: 250,
      vehicleDriven: "Peugeot 208",
      finalAmount: 255.31,
      finalCurrency: "EUR",
    });
  });

  it("takes each fee line's total, not its unit price, and leaves the rental days out", () => {
    expect(v2Invoice(SIXT_INVOICE_NL)?.fees).toEqual([
      { label: "Schade- en diefstaldekking", amount: 21, currency: "EUR" },
      { label: "Locatietoeslag", amount: 40, currency: "EUR" },
    ]);
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

  it("files a cancellation-fee invoice (PREPAID_INV_V2) as a cancellation with its gross fee", async () => {
    const result = await parseRentalBookingText(SIXT_CANCELLATION_FEE_MAIL, {
      from: "noreply@sixt.com",
      subject: "Ihre Rechnung",
      attachments: [],
      templates: snapshotTemplates("rental"),
    });
    // The PDF text reaches the readers the way the attachment would; here it
    // rides in the body so the test needs no PDF.
    const withPdf = await parseRentalBookingText(
      `${SIXT_CANCELLATION_FEE_MAIL}\n\n${SIXT_CANCELLATION_FEE_PDF}`,
      { from: "noreply@sixt.com", subject: "Ihre Rechnung", templates: snapshotTemplates("rental") }
    );
    for (const r of [result, withPdf]) {
      expect(r.document).toEqual({
        kind: "cancellation",
        source: "sixt-confirmation",
        provider: "Sixt",
        confirmationNumber: "4444444444",
        fee: { amount: 58.5, currency: "EUR" },
      });
    }
  });
});
