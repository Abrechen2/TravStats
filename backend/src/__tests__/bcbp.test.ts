import { decodeBcbp, looksLikeBcbp } from "../utils/bcbp";

// A valid IATA BCBP "M1" string, built field-by-field at the spec offsets.
const SAMPLE =
  "M" +
  "1" +
  "DESMARAIS/LUC".padEnd(20) + // passenger (2-22)
  "E" + // e-ticket indicator (22)
  "ABC123".padEnd(7) + // PNR (23-30)
  "YUL" + // from (30-33)
  "FRA" + // to (33-36)
  "AC".padEnd(3) + // carrier (36-39)
  "0834".padEnd(5) + // flight number (39-44)
  "326" + // julian date (44-47)
  "J" + // compartment (47)
  "001A" + // seat (48-52)
  "0025".padEnd(5) + // sequence (52-57)
  "0" + // passenger status (57)
  "00"; // variable-field size, hex (58-60) — 0 = no conditional data

const NOW = new Date("2026-11-20T00:00:00.000Z");

describe("decodeBcbp", () => {
  it("decodes the mandatory M1 fields of the first leg", () => {
    const d = decodeBcbp(SAMPLE, NOW);
    expect(d).not.toBeNull();
    expect(d?.flightNumber).toBe("AC834");
    expect(d?.fromCode).toBe("YUL");
    expect(d?.toCode).toBe("FRA");
    expect(d?.carrier).toBe("AC");
    expect(d?.seatNumber).toBe("1A");
    expect(d?.bookingClassLetter).toBe("J");
    expect(d?.pnr).toBe("ABC123");
    expect(d?.passengerName).toBe("DESMARAIS/LUC");
    expect(d?.legs).toBe(1);
  });

  it("resolves the Julian day to the calendar year closest to now", () => {
    // Day 326 of 2026 (non-leap) is 22 Nov; now is 20 Nov 2026.
    expect(decodeBcbp(SAMPLE, NOW)?.date).toBe("2026-11-22");
  });

  it("rejects non-BCBP strings", () => {
    expect(looksLikeBcbp("https://example.com")).toBe(false);
    expect(looksLikeBcbp("M1")).toBe(false); // too short
    expect(decodeBcbp("not a boarding pass")).toBeNull();
  });

  it("returns null when no useful leg data is present", () => {
    const empty = "M1" + " ".repeat(60);
    expect(decodeBcbp(empty)).toBeNull();
  });
});
