/**
 * Regression tests for the zero-padded flight number (prod, 2026-08-11).
 *
 * Airlines print "EK051" on itineraries; AirLabs, Aviationstack and
 * AeroDataBox key on the unpadded IATA form "EK51". Verified live against
 * AirLabs that day: `flight_iata=EK051` → 0 records, `flight_iata=EK51` →
 * the flight. Every zero-padded booking was invisible to live tracking.
 */
import { normalizeFlightNumber, toProviderFlightNumber } from "../schemas/flight";

describe("toProviderFlightNumber", () => {
  it("strips leading zeros from the number part", () => {
    expect(toProviderFlightNumber("EK051")).toBe("EK51");
    expect(toProviderFlightNumber("EK052")).toBe("EK52");
    expect(toProviderFlightNumber("EK050")).toBe("EK50");
    expect(toProviderFlightNumber("LH095")).toBe("LH95");
    expect(toProviderFlightNumber("QR070")).toBe("QR70");
    expect(toProviderFlightNumber("MS042")).toBe("MS42");
  });

  it("leaves already-unpadded numbers untouched", () => {
    expect(toProviderFlightNumber("EK415")).toBe("EK415");
    expect(toProviderFlightNumber("LH2424")).toBe("LH2424");
    expect(toProviderFlightNumber("AC907")).toBe("AC907");
  });

  it("handles alphanumeric IATA designators", () => {
    expect(toProviderFlightNumber("U20123")).toBe("U2123"); // easyJet
    expect(toProviderFlightNumber("9W008")).toBe("9W8"); // Jet Airways
    expect(toProviderFlightNumber("W60456")).toBe("W6456"); // Wizz
  });

  it("handles three-letter ICAO designators", () => {
    expect(toProviderFlightNumber("DLH400")).toBe("DLH400");
    expect(toProviderFlightNumber("UAE051")).toBe("UAE51");
  });

  it("normalises whitespace and case like normalizeFlightNumber", () => {
    expect(toProviderFlightNumber(" ek 051 ")).toBe("EK51");
    expect(toProviderFlightNumber("lh095")).toBe("LH95");
  });

  it("passes through anything it cannot parse, and stays nullish-safe", () => {
    expect(toProviderFlightNumber("NOTAFLIGHT")).toBe("NOTAFLIGHT");
    expect(toProviderFlightNumber("")).toBeUndefined();
    expect(toProviderFlightNumber(null)).toBeUndefined();
    expect(toProviderFlightNumber(undefined)).toBeUndefined();
  });

  it("never mutates what normalizeFlightNumber stores — the two differ on purpose", () => {
    // The stored value keeps the user's spelling; only outgoing provider
    // requests use the unpadded form. Conflating them would let auto-apply
    // rename the user's flight.
    expect(normalizeFlightNumber("EK051")).toBe("EK051");
    expect(toProviderFlightNumber("EK051")).toBe("EK51");
  });
});
