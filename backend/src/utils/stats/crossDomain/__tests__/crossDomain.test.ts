import { computeStreaks } from "../streaks";
import { computeRhythm } from "../rhythm";
import { computeTimeShift, type TimeShiftFlight } from "../timeShift";
import { computeUnseen, wholeYearsBetween } from "../lastVisit";
import { computeSchengen } from "../schengen";
import { computePricePerKm } from "../pricePerKm";
import { computeNightsByCountry } from "../nightsByCountry";
import { computePhotoStats } from "../photoStats";
import type { AttributedNight } from "../../../../services/stats/travelAccount";

describe("computeStreaks (forgejo#399)", () => {
  it("abstains with no active day instead of reporting a zero streak", () => {
    expect(computeStreaks([], "2026-11-01")).toBeNull();
    // A planned day ahead of today is no streak either.
    expect(computeStreaks(["2026-12-01"], "2026-11-01")).toBeNull();
  });

  it("unions days across domains: duplicates are one day", () => {
    const s = computeStreaks(
      ["2026-10-30", "2026-10-30", "2026-10-31", "2026-11-01"],
      "2026-11-01"
    );
    expect(s?.longestDayStreak).toEqual({ days: 3, from: "2026-10-30", to: "2026-11-01" });
    expect(s?.activeDays).toBe(3);
  });

  it("reports no current streak when the last run ended before yesterday", () => {
    const s = computeStreaks(["2026-09-01", "2026-09-02"], "2026-11-01");
    expect(s?.longestDayStreak?.days).toBe(2);
    expect(s?.currentDayStreak).toBeNull();
    expect(s?.currentMonthStreak).toBeNull();
  });

  it("keeps a run alive through yesterday", () => {
    const s = computeStreaks(["2026-10-30", "2026-10-31"], "2026-11-01");
    expect(s?.currentDayStreak).toEqual({ days: 2, from: "2026-10-30", to: "2026-10-31" });
  });

  it("counts months in a row across a year boundary", () => {
    const s = computeStreaks(
      ["2025-11-05", "2025-12-24", "2026-01-02", "2026-03-01"],
      "2026-03-02"
    );
    expect(s?.longestMonthStreak).toEqual({ months: 3, from: "2025-11", to: "2026-01" });
    expect(s?.currentMonthStreak).toEqual({ months: 1, from: "2026-03", to: "2026-03" });
  });
});

describe("computeRhythm", () => {
  it("abstains without days", () => {
    expect(computeRhythm({ flight: [] }, "2026-11-01")).toBeNull();
  });

  it("counts a day shared by two domains once overall but once per domain", () => {
    // 2026-07-04 is a Saturday.
    const r = computeRhythm(
      { flight: ["2026-07-04"], lodging: ["2026-07-04", "2026-12-25"] },
      "2026-12-31"
    );
    expect(r?.overall.days).toBe(2);
    expect(r?.overall.bySeason).toEqual({ winter: 1, spring: 0, summer: 1, autumn: 0 });
    expect(r?.overall.byWeekday[5]).toBe(1);
    expect(r?.byDomain.flight.days).toBe(1);
    expect(r?.byDomain.lodging.days).toBe(2);
  });
});

describe("computeTimeShift", () => {
  const flight = (over: Partial<TimeShiftFlight>): TimeShiftFlight => ({
    id: "f1",
    departureTime: new Date("2026-01-10T08:00:00Z"),
    arrivalTime: new Date("2026-01-10T20:00:00Z"),
    depZone: "Europe/Berlin",
    arrZone: "Asia/Tokyo",
    instantsReal: true,
    depLabel: "FRA",
    arrLabel: "HND",
    ...over,
  });

  it("abstains when no flight can be measured (date-only or zoneless)", () => {
    expect(
      computeTimeShift([flight({ instantsReal: false }), flight({ arrZone: null })])
    ).toBeNull();
  });

  it("sums absolute shifts and finds the biggest jump; unmeasured flights are counted, not zeroed", () => {
    const out = computeTimeShift([
      flight({}), // +8 h (CET -> JST in winter)
      flight({ id: "f2", depZone: "Asia/Tokyo", arrZone: "Europe/Berlin" }), // -8 h
      flight({ id: "f3", instantsReal: false }),
    ]);
    expect(out?.flightsMeasured).toBe(2);
    expect(out?.unmeasured).toBe(1);
    expect(out?.hoursShifted).toBe(16);
    expect(out?.biggestJump?.hours).toBe(8);
    // east 8 h = 8 days, west 8 h = 4 days
    expect(out?.jetLagDays).toBe(12);
  });

  it("uses the offset at the instant flown: daylight saving changes the shift", () => {
    const summer = computeTimeShift([
      flight({
        departureTime: new Date("2026-07-10T08:00:00Z"),
        arrivalTime: new Date("2026-07-10T20:00:00Z"),
      }),
    ]);
    expect(summer?.hoursShifted).toBe(7);
  });

  it("does not call a same-zone hop a jump", () => {
    const out = computeTimeShift([flight({ arrZone: "Europe/Paris" })]);
    expect(out?.hoursShifted).toBe(0);
    expect(out?.biggestJump).toBeNull();
    expect(out?.jetLagDays).toBe(0);
  });
});

describe("computeUnseen", () => {
  it("counts whole years only: an anniversary not reached does not count", () => {
    expect(wholeYearsBetween("2024-06-15", "2026-06-14")).toBe(1);
    expect(wholeYearsBetween("2024-06-15", "2026-06-15")).toBe(2);
  });

  it("abstains (null) for a kind with no dated sighting and drops undated ones", () => {
    const out = computeUnseen(
      [
        { kind: "country", key: "JP", label: "JP", date: null },
        { kind: "place", key: "p", label: "P", date: "2030-01-01" },
      ],
      "2026-11-01"
    );
    expect(out).toEqual({ country: null, airport: null, place: null });
  });

  it("uses the LATEST sighting, lists only gaps of a year or more, longest first", () => {
    const out = computeUnseen(
      [
        { kind: "country", key: "IT", label: "IT", date: "2018-05-01" },
        { kind: "country", key: "IT", label: "IT", date: "2022-05-01" },
        { kind: "country", key: "ES", label: "ES", date: "2020-01-01" },
        { kind: "country", key: "FR", label: "FR", date: "2026-10-01" },
      ],
      "2026-11-01"
    );
    expect(out.country?.map((e) => [e.key, e.yearsAgo])).toEqual([
      ["ES", 6],
      ["IT", 4],
    ]);
  });
});

describe("computeSchengen", () => {
  it("abstains without any dated presence, rather than claiming 90 days left", () => {
    expect(computeSchengen([], "2026-11-01")).toBeNull();
  });

  it("derives 0 used when records exist only outside the area", () => {
    const out = computeSchengen([{ date: "2026-10-01", country: "GB" }], "2026-11-01");
    expect(out?.daysUsed).toBe(0);
    expect(out?.daysRemaining).toBe(90);
    expect(out?.lastDayUsed).toBeNull();
  });

  it("counts distinct days in the 180-day window only, and respects the join date", () => {
    const out = computeSchengen(
      [
        { date: "2026-10-01", country: "DE" },
        { date: "2026-10-01", country: "FR" }, // same day, still one
        { date: "2026-10-02", country: "FR" },
        { date: "2025-01-01", country: "DE" }, // outside the window
        { date: "2022-06-01", country: "HR" }, // before Croatia joined
      ],
      "2026-11-01"
    );
    expect(out?.daysUsed).toBe(2);
    expect(out?.daysRemaining).toBe(88);
    expect(out?.windowFrom).toBe("2026-05-06");
    expect(out?.lastDayUsed).toBe("2026-10-02");
  });
});

describe("computePricePerKm", () => {
  const ride = (over: object) => ({
    domain: "rail" as const,
    price: 50,
    currency: "EUR",
    distanceKm: 500,
    bookingPriced: false,
    ...over,
  });

  it("abstains with no priced ride", () => {
    expect(computePricePerKm([ride({ price: null })])).toBeNull();
    expect(computePricePerKm([])).toBeNull();
  });

  it("never adds across currencies", () => {
    const out = computePricePerKm([
      ride({}),
      ride({ currency: "CHF", price: 30, distanceKm: 100 }),
    ]);
    expect(out?.blocks.map((b) => [b.currency, b.spend, b.pricePerKm])).toEqual([
      ["CHF", 30, 0.3],
      ["EUR", 50, 0.1],
    ]);
  });

  it("leaves a booking-priced ride out and keeps a priced ride with no distance out of the rate", () => {
    const out = computePricePerKm([
      ride({ bookingPriced: true }),
      ride({}),
      ride({ distanceKm: null, price: 999 }),
    ]);
    expect(out?.bookedRides).toBe(1);
    expect(out?.blocks[0]).toMatchObject({
      rides: 2,
      spend: 1049,
      km: 500,
      pricePerKm: 0.1,
      ridesWithoutKm: 1,
    });
  });

  it("has no rate when no priced ride has a distance", () => {
    const out = computePricePerKm([ride({ distanceKm: null })]);
    expect(out?.blocks[0].pricePerKm).toBeNull();
    expect(out?.blocks[0].km).toBeNull();
  });
});

describe("computeNightsByCountry", () => {
  const night = (awardedTo: AttributedNight["awardedTo"], id: string): AttributedNight => ({
    day: 0,
    claims: { [awardedTo]: [id] },
    awardedTo,
    contested: false,
  });

  it("abstains without nights", () => {
    expect(computeNightsByCountry([], () => null)).toBeNull();
  });

  it("attributes by the winner's country and parks the rest as unattributed", () => {
    const out = computeNightsByCountry(
      [
        night("hotel", "s1"),
        night("hotel", "s1"),
        night("rail", "r1"),
        night("rail", "r2"),
        night("sea", "c1"),
      ],
      (source, id) => ({ "hotel:s1": "IT", "rail:r1": "IT" })[`${source}:${id}`] ?? null
    );
    expect(out?.countries).toEqual([{ country: "IT", hotel: 2, rail: 1, bus: 0, total: 3 }]);
    expect(out?.unattributed).toEqual({ hotel: 0, sea: 1, rail: 1, bus: 0, air: 0 });
    expect(out?.totalNights).toBe(5);
  });
});

describe("computePhotoStats", () => {
  it("abstains without photos", () => {
    expect(computePhotoStats([])).toBeNull();
  });

  it("keeps undated and coordinate-less photos out of days and countries, not out of the total", () => {
    const base = { tripId: "t", tripName: "T", placeId: null, placeName: null };
    const out = computePhotoStats([
      { ...base, day: "2026-05-01", country: "PT" },
      { ...base, day: "2026-05-01", country: null },
      { ...base, day: null, country: null },
    ]);
    expect(out).toMatchObject({ photos: 3, withoutDate: 1, withoutCountry: 2 });
    expect(out?.busiestDay).toEqual({ day: "2026-05-01", count: 2 });
    expect(out?.topCountries).toEqual([{ key: "PT", label: "PT", count: 1 }]);
    expect(out?.topPlaces).toEqual([]);
  });
});
