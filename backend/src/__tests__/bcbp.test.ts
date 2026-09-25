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

  // SRV-BCBP-DATE-001 (audit 2026-09-20): asked on 20.09.2026 for day 366,
  // the decoder answered 2027-01-01 with nothing reported missing.
  // `setUTCDate(366)` does not fail on a 365-day year, it rolls into January
  // — so a pass for 31 December was proposed as New Year's Day and the field
  // looked fully recognised.
  describe("Julian day 366", () => {
    const withJulian = (julian: string): string => SAMPLE.slice(0, 44) + julian + SAMPLE.slice(47);

    it("abstains when none of the candidate years is a leap year", () => {
      // 2025, 2026 and 2027 all have 365 days.
      expect(decodeBcbp(withJulian("366"), NOW)?.date).toBeUndefined();
    });

    it("still decodes the rest of the pass, so only the date needs asking", () => {
      const d = decodeBcbp(withJulian("366"), NOW);
      expect(d?.flightNumber).toBe("AC834");
      expect(d?.pnr).toBe("ABC123");
    });

    it("resolves it to 31 December when a candidate year IS a leap year", () => {
      expect(decodeBcbp(withJulian("366"), new Date("2024-12-20T00:00:00.000Z"))?.date).toBe(
        "2024-12-31"
      );
    });

    it("leaves day 365 alone — every year has one", () => {
      expect(decodeBcbp(withJulian("365"), NOW)?.date).toBe("2026-12-31");
    });

    it("still picks the nearer year across the December/January boundary", () => {
      // Day 001 asked on 28 Dec 2026 is 1 Jan 2027, not 1 Jan 2026.
      expect(decodeBcbp(withJulian("001"), new Date("2026-12-28T00:00:00.000Z"))?.date).toBe(
        "2027-01-01"
      );
    });
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
