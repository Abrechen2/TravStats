import { describe, it, expect } from "vitest";
import {
  resolveAirlineDisplay,
  resolveAirlineIata,
  getAirlineFromFlightNumber,
} from "./airlineUtils";

describe("resolveAirlineDisplay", () => {
  it("resolves a 3-letter ICAO code from the free-text airline field (issue #178)", () => {
    expect(resolveAirlineDisplay({ airline: "DLH" })).toBe("Lufthansa");
    expect(resolveAirlineDisplay({ airline: "EWG" })).toBe("Eurowings");
  });

  it("still resolves a 2-letter IATA code (no regression)", () => {
    expect(resolveAirlineDisplay({ airline: "LH" })).toBe("Lufthansa");
    expect(resolveAirlineDisplay({ airline: "EW" })).toBe("Eurowings");
  });

  it("prefers the structured airlineIcao column over a conflicting free-text airline value", () => {
    // airline free text says "LH" (Lufthansa) but the structured column says EWG (Eurowings) —
    // the structured column must win.
    expect(resolveAirlineDisplay({ airline: "LH", airlineIcao: "EWG" })).toBe("Eurowings");
  });

  it("prefers the structured airlineIata column over the free-text airline value", () => {
    expect(resolveAirlineDisplay({ airline: "some raw text", airlineIata: "LH" })).toBe(
      "Lufthansa"
    );
  });

  it("renders an unknown code raw, never empty or 'undefined'", () => {
    expect(resolveAirlineDisplay({ airline: "QQQ" })).toBe("QQQ");
    expect(resolveAirlineDisplay({ airline: "Q0" })).toBe("Q0");
  });

  it("falls back to the flight number prefix when airline is empty", () => {
    expect(resolveAirlineDisplay({ airline: undefined, flightNumber: "LH123" })).toBe("Lufthansa");
  });

  it("returns null when nothing is known", () => {
    expect(resolveAirlineDisplay({})).toBeNull();
  });

  it("returns the stored name as-is when the airline field already holds a full name", () => {
    expect(resolveAirlineDisplay({ airline: "Lufthansa" })).toBe("Lufthansa");
  });
});

describe("resolveAirlineIata", () => {
  it("returns the structured airlineIata column when present", () => {
    expect(resolveAirlineIata({ airlineIata: "lh" })).toBe("LH");
  });

  it("maps a structured ICAO column to its IATA code so the logo can load", () => {
    expect(resolveAirlineIata({ airlineIcao: "DLH" })).toBe("LH");
  });

  it("maps a free-text ICAO code to its IATA code", () => {
    expect(resolveAirlineIata({ airline: "EWG" })).toBe("EW");
  });

  it("keeps a free-text 2-letter IATA code as-is", () => {
    expect(resolveAirlineIata({ airline: "lh" })).toBe("LH");
  });

  it("returns undefined for an unknown code", () => {
    expect(resolveAirlineIata({ airline: "QQQ" })).toBeUndefined();
  });

  it("resolves a full airline name via the catalogue", () => {
    expect(resolveAirlineIata({ airline: "Lufthansa" })).toBe("LH");
    expect(resolveAirlineIata({ airline: "  lufthansa " })).toBe("LH");
  });

  it("derives a catalogue-known IATA prefix from the flight number", () => {
    expect(resolveAirlineIata({ flightNumber: "LH2462" })).toBe("LH");
  });

  it("does not derive from a flight number with an unknown prefix", () => {
    expect(resolveAirlineIata({ flightNumber: "Q0999" })).toBeUndefined();
  });

  it("does not let the flight number override a structured code", () => {
    expect(resolveAirlineIata({ airlineIata: "EW", flightNumber: "LH123" })).toBe("EW");
  });

  it("returns undefined for an unknown airline name", () => {
    expect(resolveAirlineIata({ airline: "Some Unknown Carrier" })).toBeUndefined();
  });
});

describe("getAirlineFromFlightNumber", () => {
  it("still resolves an IATA flight number prefix", () => {
    expect(getAirlineFromFlightNumber("LH123")).toBe("Lufthansa");
  });

  it("returns null for an unknown prefix", () => {
    expect(getAirlineFromFlightNumber("Q0123")).toBeNull();
  });

  // Seen on the 2.7.0-beta.1 build: a row with the flight number "UAT2" was
  // labelled "United Airlines", because the first two characters were read as
  // a carrier without asking what followed. `FlightReviewModal` writes this
  // derived name into the record, so the guess does not stay on the screen.
  it("refuses a string that is not a flight number, however it begins", () => {
    expect(getAirlineFromFlightNumber("UAT2")).toBeNull();
    expect(getAirlineFromFlightNumber("LHR")).toBeNull();
    expect(getAirlineFromFlightNumber("LH")).toBeNull();
    expect(getAirlineFromFlightNumber("LH12345")).toBeNull();
    expect(getAirlineFromFlightNumber("Lufthansa")).toBeNull();
    expect(getAirlineFromFlightNumber("")).toBeNull();
  });

  it("accepts the shapes a designator really takes", () => {
    // A digit may lead the code (4U = Eurowings), a letter may trail the
    // number, and a written space is the same flight.
    expect(getAirlineFromFlightNumber("LH 400")).toBe("Lufthansa");
    expect(getAirlineFromFlightNumber("lh400")).toBe("Lufthansa");
    expect(getAirlineFromFlightNumber("LH400A")).toBe("Lufthansa");
    expect(getAirlineFromFlightNumber("LH1")).toBe("Lufthansa");
  });
});
