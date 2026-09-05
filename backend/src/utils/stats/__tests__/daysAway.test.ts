import { computeDaysAway } from "../daysAway";

/**
 * forgejo#92 — days away per domain, and ONE total that is a union.
 *
 * The charter forbids summing across domains; the only shared measure is a
 * calendar day. These tests pin the two things a client cannot check from the
 * numbers alone: that a day carrying a flight and a hotel night is one day in
 * `total`, and that an undated record contributes no day rather than a
 * placeholder one.
 */
const d = (iso: string): Date => new Date(iso);

describe("computeDaysAway", () => {
  it("answers all zeros for an empty account", () => {
    expect(computeDaysAway({ flights: [], cruises: [], lodging: [], places: [] })).toEqual({
      flight: 0,
      cruise: 0,
      lodging: 0,
      place: 0,
      total: 0,
    });
  });

  it("counts a day with a flight AND a hotel night once in the total", () => {
    // Fly out on the 10th, sleep the 10th to the 12th, fly home the 12th.
    const out = computeDaysAway({
      flights: [
        { from: d("2024-05-10T06:00:00Z"), to: d("2024-05-10T09:00:00Z") },
        { from: d("2024-05-12T18:00:00Z"), to: d("2024-05-12T21:00:00Z") },
      ],
      cruises: [],
      lodging: [{ from: d("2024-05-10T00:00:00Z"), to: d("2024-05-12T00:00:00Z") }],
      places: [{ at: d("2024-05-11T00:00:00Z") }],
    });

    expect(out.flight).toBe(2);
    expect(out.lodging).toBe(3);
    expect(out.place).toBe(1);
    // 10th, 11th, 12th — not 2 + 3 + 1.
    expect(out.total).toBe(3);
    expect(out.total).toBeLessThan(out.flight + out.lodging + out.place);
  });

  it("gives a flight its departure day and its arrival day, nothing between", () => {
    const redEye = computeDaysAway({
      flights: [{ from: d("2024-05-10T22:00:00Z"), to: d("2024-05-11T06:00:00Z") }],
      cruises: [],
      lodging: [],
      places: [],
    });
    expect(redEye.flight).toBe(2);

    const dayFlight = computeDaysAway({
      flights: [{ from: d("2024-05-10T08:00:00Z"), to: d("2024-05-10T10:00:00Z") }],
      cruises: [],
      lodging: [],
      places: [],
    });
    expect(dayFlight.flight).toBe(1);
  });

  it("gives a cruise every day from departure to arrival inclusive", () => {
    const out = computeDaysAway({
      flights: [],
      cruises: [{ from: d("2024-06-01T00:00:00Z"), to: d("2024-06-08T00:00:00Z") }],
      lodging: [],
      places: [],
    });
    expect(out.cruise).toBe(8);
    expect(out.total).toBe(8);
  });

  it("merges two overlapping records of one domain into distinct days", () => {
    const out = computeDaysAway({
      flights: [],
      cruises: [],
      lodging: [
        { from: d("2024-05-01T00:00:00Z"), to: d("2024-05-04T00:00:00Z") },
        { from: d("2024-05-03T00:00:00Z"), to: d("2024-05-05T00:00:00Z") },
      ],
      places: [],
    });
    expect(out.lodging).toBe(5);
  });

  it("lets an undated record contribute no day rather than a placeholder", () => {
    const out = computeDaysAway({
      flights: [{ from: null, to: null }],
      cruises: [{ from: null, to: null }],
      lodging: [{ from: null, to: null }],
      places: [{ at: null }],
    });
    expect(out).toEqual({ flight: 0, cruise: 0, lodging: 0, place: 0, total: 0 });
  });

  it("names only the end a half-dated span has", () => {
    const out = computeDaysAway({
      flights: [{ from: d("2024-05-10T08:00:00Z"), to: null }],
      cruises: [{ from: null, to: d("2024-06-08T00:00:00Z") }],
      lodging: [{ from: null, to: d("2024-05-04T00:00:00Z") }],
      places: [],
    });
    expect(out).toEqual({ flight: 1, cruise: 1, lodging: 1, total: 3, place: 0 });
  });

  it("clips a stay that straddles the window to the days inside it", () => {
    // 29 December to 3 January, asked for 2024 only: 29, 30, 31.
    const out = computeDaysAway({
      flights: [],
      cruises: [],
      lodging: [{ from: d("2024-12-29T00:00:00Z"), to: d("2025-01-03T00:00:00Z") }],
      places: [{ at: d("2025-01-02T00:00:00Z") }],
      window: { from: "2024-01-01", to: "2024-12-31" },
    });
    expect(out.lodging).toBe(3);
    expect(out.place).toBe(0);
    expect(out.total).toBe(3);
  });

  it("reads every domain on the UTC date of the stored instant", () => {
    // 23:30 UTC on the 10th is still the 10th here — no local clock is applied,
    // so a stay pinned to UTC midnight and a flight instant land on one day.
    const out = computeDaysAway({
      flights: [{ from: d("2024-05-10T23:30:00Z"), to: d("2024-05-10T23:45:00Z") }],
      cruises: [],
      lodging: [{ from: d("2024-05-10T00:00:00Z"), to: d("2024-05-10T00:00:00Z") }],
      places: [],
    });
    expect(out.total).toBe(1);
  });
});
