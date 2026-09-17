import { stayStartsAt, timezoneOfLodging } from "../utils/stayInstant";

/** The day anchor as it is stored: UTC-pinned midnight. */
const day = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

const BERLIN = { lat: 52.52, lon: 13.405 };
const TOKYO = { lat: 35.6762, lon: 139.6503 };

describe("timezoneOfLodging", () => {
  it("names the zone a hotel sits in", () => {
    expect(timezoneOfLodging(BERLIN.lat, BERLIN.lon)).toBe("Europe/Berlin");
    expect(timezoneOfLodging(TOKYO.lat, TOKYO.lon)).toBe("Asia/Tokyo");
  });

  it("abstains rather than guessing when there are no coordinates", () => {
    expect(timezoneOfLodging(null, null)).toBeNull();
    expect(timezoneOfLodging(undefined, undefined)).toBeNull();
    expect(timezoneOfLodging(52.52, null)).toBeNull();
    expect(timezoneOfLodging(null, 13.405)).toBeNull();
  });

  it("abstains on a coordinate that is not a number", () => {
    expect(timezoneOfLodging(Number.NaN, 13.405)).toBeNull();
    expect(timezoneOfLodging(52.52, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("stayStartsAt", () => {
  it("reads the check-in time on the HOTEL clock, not as UTC (#331)", () => {
    // The report: a 22:30 check-in in Berlin was counted down to 22:30Z, which
    // is 00:30 the next morning there, so the banner said "in 1 hour".
    const instant = stayStartsAt({
      checkIn: day("2026-09-20"),
      checkInTime: "22:30",
      ...BERLIN,
    });

    // September is CEST, UTC+2.
    expect(instant.toISOString()).toBe("2026-09-20T20:30:00.000Z");
    expect(instant.toISOString()).not.toBe("2026-09-20T22:30:00.000Z");
  });

  it("applies the winter offset on the same hotel", () => {
    // CET, UTC+1 — the zone is resolved per instant, not once per hotel.
    const instant = stayStartsAt({
      checkIn: day("2026-01-20"),
      checkInTime: "22:30",
      ...BERLIN,
    });
    expect(instant.toISOString()).toBe("2026-01-20T21:30:00.000Z");
  });

  it("works for a hotel on the other side of the world", () => {
    const instant = stayStartsAt({
      checkIn: day("2026-09-20"),
      checkInTime: "15:00",
      ...TOKYO,
    });
    expect(instant.toISOString()).toBe("2026-09-20T06:00:00.000Z");
  });

  it("keeps the old reading when the hotel has no coordinates", () => {
    // No location means no clock to borrow. Guessing a zone would put a wrong
    // number where the reader trusts an exact one, so the wall clock stands.
    const instant = stayStartsAt({
      checkIn: day("2026-09-20"),
      checkInTime: "22:30",
      lat: null,
      lon: null,
    });
    expect(instant.toISOString()).toBe("2026-09-20T22:30:00.000Z");
  });

  it("returns the day anchor untouched when only the day is known", () => {
    const anchor = day("2026-09-20");
    expect(stayStartsAt({ checkIn: anchor, checkInTime: null, ...BERLIN })).toEqual(anchor);
  });

  it("returns the day anchor when the stored time cannot be read", () => {
    const anchor = day("2026-09-20");
    expect(stayStartsAt({ checkIn: anchor, checkInTime: "nachmittags", ...BERLIN })).toEqual(
      anchor
    );
    expect(stayStartsAt({ checkIn: anchor, checkInTime: "", ...BERLIN })).toEqual(anchor);
  });

  it("agrees with the old behaviour for a stay in UTC", () => {
    // Reykjavík is UTC all year, so the conversion is a no-op there — which is
    // why the bug stayed invisible for anyone testing close to Greenwich.
    const instant = stayStartsAt({
      checkIn: day("2026-09-20"),
      checkInTime: "22:30",
      lat: 64.1466,
      lon: -21.9426,
    });
    expect(instant.toISOString()).toBe("2026-09-20T22:30:00.000Z");
  });
});
