import { describe, it, expect } from "vitest";
import { bcbpToScanResult } from "./bcbpToScanResult";
import type { BoardingPassData } from "../lib/airline-parsers/bcbpHelpers";

function makeBcbp(overrides: Partial<BoardingPassData> = {}): BoardingPassData {
  return {
    formatCode: "M",
    numberOfLegs: 1,
    passengerName: "MUSTERMANN/MAX",
    electronicTicketIndicator: "E",
    operatingCarrierPNR: "ABC123",
    departureAirport: "MUC",
    arrivalAirport: "JFK",
    operatingCarrierDesignator: "LH",
    flightNumber: "0400",
    dateOfFlight: "2026-12-05",
    compartmentCode: "Y",
    seatNumber: "12A",
    checkInSequenceNumber: "0042",
    passengerStatus: "0",
    raw: "M1MUSTERMANN/MAX...",
    ...overrides,
  };
}

describe("bcbpToScanResult", () => {
  it("flags departureTime as inferred — BCBP barcodes never carry a year, so the date is always heuristic", () => {
    const result = bcbpToScanResult(makeBcbp());

    expect(result.inferredFields).toBeDefined();
    expect(result.inferredFields).toContain("departureTime");
  });

  it("composes the flight number from operatingCarrierDesignator + flightNumber", () => {
    const result = bcbpToScanResult(
      makeBcbp({ operatingCarrierDesignator: "LH", flightNumber: "0400" })
    );

    expect(result.flightNumber).toBe("LH0400");
  });

  it("maps airport codes and date verbatim", () => {
    const result = bcbpToScanResult(
      makeBcbp({
        departureAirport: "FRA",
        arrivalAirport: "SFO",
        dateOfFlight: "2027-01-15",
      })
    );

    expect(result.departureCode).toBe("FRA");
    expect(result.arrivalCode).toBe("SFO");
    expect(result.departureTime).toBe("2027-01-15");
  });

  it("falls back to operatingCarrierDesignator when airlineName is absent", () => {
    const result = bcbpToScanResult(
      makeBcbp({ operatingCarrierDesignator: "AF", airlineName: undefined })
    );

    expect(result.airline).toBe("AF");
  });

  it("prefers airlineName when available", () => {
    const result = bcbpToScanResult(makeBcbp({ airlineName: "Lufthansa" }));

    expect(result.airline).toBe("Lufthansa");
  });

  it("defaults seatClass to economy when the BCBP payload doesn't carry one", () => {
    const result = bcbpToScanResult(makeBcbp({ seatClass: undefined }));

    expect(result.seatClass).toBe("economy");
  });

  it("propagates an explicit seatClass when present", () => {
    const result = bcbpToScanResult(makeBcbp({ seatClass: "business" }));

    expect(result.seatClass).toBe("business");
  });
});

// forgejo#172: a decoded barcode showed the flight and route in the review,
// but seat and booking reference stayed empty - the review reads `seat` and
// `pnr`, and the mapping produced only `seatNumber` and no reference at all.
describe("bcbpToScanResult - seat and booking reference reach the review", () => {
  it("fills the fields the flight review reads", () => {
    const result = bcbpToScanResult(
      makeBcbp({ seatNumber: "12A", operatingCarrierPNR: "QATEST1" })
    );

    expect(result.seat).toBe("12A");
    expect(result.pnr).toBe("QATEST1");
  });

  it("drops the barcode's zero padding from the seat", () => {
    // BCBP pads the row to three digits: "012A" is seat 12A.
    expect(bcbpToScanResult(makeBcbp({ seatNumber: "012A" })).seat).toBe("12A");
    expect(bcbpToScanResult(makeBcbp({ seatNumber: "001C" })).seat).toBe("1C");
  });

  it("leaves both empty rather than inventing a value when the barcode has none", () => {
    const result = bcbpToScanResult(makeBcbp({ seatNumber: "", operatingCarrierPNR: "" }));

    expect(result.seat).toBeUndefined();
    expect(result.pnr).toBeUndefined();
  });
});
