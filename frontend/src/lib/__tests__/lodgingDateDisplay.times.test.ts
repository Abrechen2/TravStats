import { describe, expect, it } from "vitest";
import { formatStayPeriod, stayNights } from "../lodgingDateDisplay";

/**
 * A stay's days come from the server's `times` (ADR 0002 phase 4) — the
 * hotel's calendar as `YYYY-MM-DD` — not from the legacy timestamp column.
 *
 * The fixture is a row the phase-3b backfill had to read: written by a host
 * at UTC+2, its legacy column holds 22:00Z the evening BEFORE each day. The
 * server's `times` names the real days; the list must print those.
 */
const t = (key: string) => key;

const stay = {
  checkIn: "2026-05-01T22:00:00.000Z",
  checkOut: "2026-05-03T22:00:00.000Z",
  datePrecision: "DAY",
  nights: null,
  times: {
    checkIn: { date: "2026-05-02", zone: "Europe/Berlin", precision: "day" as const },
    checkOut: { date: "2026-05-04", zone: "Europe/Berlin", precision: "day" as const },
    checkInAt: null,
    checkOutAt: null,
  },
};

describe("a stay's period on the hotel's calendar", () => {
  it("prints the days the server names, not the legacy column's UTC date", () => {
    expect(formatStayPeriod(stay, "de-DE", t).label).toBe("02.05.2026 – 04.05.2026");
  });

  it("counts the nights between those days", () => {
    expect(stayNights(stay)).toBe(2);
  });

  it("still reads a payload without `times` from the legacy column", () => {
    const { times: _times, ...legacy } = stay;
    expect(
      formatStayPeriod(
        { ...legacy, checkIn: "2026-05-02T00:00:00.000Z", checkOut: "2026-05-04T00:00:00.000Z" },
        "de-DE",
        t
      ).label
    ).toBe("02.05.2026 – 04.05.2026");
  });
});
