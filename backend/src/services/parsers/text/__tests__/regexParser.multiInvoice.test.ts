import { RegexTextParser } from "../regexParser";
import { isPlausibleLegArrival } from "../../shared/legTiming";
import { extractFlightDataFromText, normalizeParsedBooking } from "../../shared/utils";

jest.mock("../../../../utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

/**
 * A document holding two invoices must not come back as one flight built out
 * of both of them.
 *
 * Measured 2026-09-20 on 2.7.0-beta.13 (audit SRV-PARSER-001):
 * `multiple-invoices.pdf` produced a single BA117 departing 15.07.2025 and
 * arriving 10.07.2025, with booking reference "ERENCE". Two separate
 * wrongnesses, and the candidate announced neither — it named its missing
 * airport codes and said nothing about arriving five days before it left.
 *
 * The fixture is reconstructed here from its two visible symptoms rather than
 * shipped as a PDF: the parser reads text, and the shape that produces the
 * defect is a labelled date from the second invoice with an unlabelled
 * earlier date from the first behind it. Checked against the archived
 * behaviour — the reconstruction reproduced departure 2025-07-15 / arrival
 * 2025-07-10 / "ERENCE" exactly.
 */
describe("regex parsing of a document holding two invoices", () => {
  /** Second invoice first, so the labelled departure is the LATER date. */
  const TWO_INVOICES = [
    "INVOICE 2 of 2",
    "Booking Reference: 87654321",
    "Flight BA117",
    "Departure: 15.07.2025",
    "Total: EUR 234,56",
    "",
    "INVOICE 1 of 2",
    "Booking Reference: 12345678",
    "Flight BA117",
    "10.07.2025",
    "Total: EUR 123,45",
  ].join("\n");

  it("does not report a flight that arrives five days before it departs", async () => {
    const flights = await new RegexTextParser().parseEmail("Invoices", TWO_INVOICES);

    expect(flights).not.toHaveLength(0);
    for (const flight of flights) {
      expect(flight.departureTime).toBeDefined();
      // The departure is real; what cannot be true is the arrival that was
      // borrowed from the other invoice.
      expect(flight.arrivalTime).toBeUndefined();
      expect(flight.missing).toContain("arrivalTime");
    }
  });

  it("never reads the booking reference out of the word 'Reference' itself", () => {
    // The seven-digit value is the trigger: `[A-Z0-9]{6}\b` cannot match it,
    // so the engine used to back out of `Reference` into the shorter `Ref`
    // alternative and capture "erence" as the value.
    const extracted = extractFlightDataFromText(TWO_INVOICES.toUpperCase());

    expect(extracted.pnr).not.toBe("ERENCE");
    expect(extracted.bookingReference).not.toBe("ERENCE");
  });

  it("still reads a booking reference the label really carries", () => {
    const extracted = extractFlightDataFromText("BOOKING REFERENCE: QA7T3T\nFLIGHT BA117");

    expect(extracted.pnr).toBe("QA7T3T");
  });

  it("reports the arrival it dropped as missing, rather than leaving it unsaid", () => {
    const booking = normalizeParsedBooking({
      flightNumber: "BA117",
      departureTime: "2025-07-15T00:00",
      arrivalTime: "2025-07-10T00:00",
    });

    expect(booking.arrivalTime).toBeUndefined();
    expect(booking.missing).toContain("arrivalTime");
  });
});

describe("isPlausibleLegArrival", () => {
  it("rejects the measured five-day inversion", () => {
    expect(isPlausibleLegArrival("2025-07-15T00:00", "2025-07-10T00:00")).toBe(false);
  });

  it("rejects the seven-day span an outbound paired with its return produces", () => {
    expect(isPlausibleLegArrival("2025-10-10T11:00", "2025-10-17T16:00")).toBe(false);
  });

  it("keeps a westward leg that lands at an earlier clock reading", () => {
    // Tokyo 17:00 to Honolulu 05:00 the same day — twelve hours "back".
    expect(isPlausibleLegArrival("2025-07-15T17:00", "2025-07-15T05:00")).toBe(true);
  });

  it("keeps a date-line leg that lands on the previous calendar day", () => {
    // Apia to Pago Pago: half an hour long, arrives yesterday.
    expect(isPlausibleLegArrival("2025-07-15T08:00", "2025-07-14T09:30")).toBe(true);
  });

  it("keeps an ordinary long-haul leg", () => {
    expect(isPlausibleLegArrival("2025-07-15T10:00", "2025-07-16T06:30")).toBe(true);
  });

  it("abstains when a timestamp is absent or unreadable", () => {
    expect(isPlausibleLegArrival(undefined, "2025-07-10T00:00")).toBe(true);
    expect(isPlausibleLegArrival("2025-07-15T00:00", undefined)).toBe(true);
    expect(isPlausibleLegArrival("not a date", "2025-07-10T00:00")).toBe(true);
  });
});
