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
