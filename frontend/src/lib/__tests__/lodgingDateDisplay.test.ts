import { describe, it, expect } from "vitest";
import {
  formatStayPeriod,
  hasUnknownLength,
  stayNights,
  type DisplayableStay,
} from "../lodgingDateDisplay";

const t = (key: string): string => key;

const stay = (o: Partial<DisplayableStay> = {}): DisplayableStay => ({
  checkIn: "2024-05-14T00:00:00.000Z",
  checkOut: "2024-05-16T00:00:00.000Z",
  datePrecision: "DAY",
  nights: null,
  ...o,
});

describe("formatStayPeriod", () => {
  it("writes an exact stay as a range", () => {
    expect(formatStayPeriod(stay(), "de-DE", t).label).toBe("14.05.2024 – 16.05.2024");
  });

  it("never renders a month-precision stay as a one-day range", () => {
    // "01.07.2011 – 01.07.2011" would read as a one-day stay somebody dated
    // exactly, which is the opposite of what the record says.
    const parts = formatStayPeriod(
      stay({ checkIn: "2011-07-01T00:00:00.000Z", checkOut: null, datePrecision: "MONTH" }),
      "de-DE",
      t
    );
    expect(parts.label).toBe("Juli 2011");
    expect(parts.precision).toBe("MONTH");
  });

  it("writes a year-precision stay as the bare year", () => {
    expect(
      formatStayPeriod(
        stay({ checkIn: "2011-01-01T00:00:00.000Z", checkOut: null, datePrecision: "YEAR" }),
        "de-DE",
        t
      ).label
    ).toBe("2011");
  });

  it("says so plainly when there is no date at all", () => {
    expect(
      formatStayPeriod(
        stay({ checkIn: null, checkOut: null, datePrecision: "NONE" }),
        "de-DE",
        t
      ).label
    ).toBe("lodging:period.unknown");
  });

  it("distinguishes an open start from an open end", () => {
    // Rendering either as a range would invent the missing side.
    expect(formatStayPeriod(stay({ checkOut: null }), "de-DE", t).label).toBe(
      "lodging:period.from 14.05.2024"
    );
    expect(formatStayPeriod(stay({ checkIn: null }), "de-DE", t).label).toBe(
      "lodging:period.until 16.05.2024"
    );
  });
});

describe("stayNights", () => {
  it("takes the dates when both are real", () => {
    expect(stayNights(stay())).toBe(2);
  });

  it("takes the explicit count when the dates cannot say", () => {
    expect(
      stayNights(stay({ checkIn: null, checkOut: null, datePrecision: "NONE", nights: 3 }))
    ).toBe(3);
  });

  it("reports an unknown length rather than pretending it is zero", () => {
    const unknown = stay({ checkIn: null, checkOut: null, datePrecision: "NONE", nights: null });
    expect(stayNights(unknown)).toBe(0);
    expect(hasUnknownLength(unknown)).toBe(true);
    // A real same-day stay is 0 nights and KNOWN to be.
    expect(hasUnknownLength(stay({ checkOut: "2024-05-14T00:00:00.000Z" }))).toBe(false);
  });
});
