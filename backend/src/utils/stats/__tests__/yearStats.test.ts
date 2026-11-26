import { buildYearStats } from "../yearStats";

describe("year statistics aggregation", () => {
  it("sums per year and month across domains, newest year first, twelve months each", () => {
    const out = buildYearStats({
      entries: [
        { domain: "flight", month: "2024-03", km: 1000 },
        { domain: "rail", month: "2024-03", km: 250.25 },
        { domain: "flight", month: "2024-07", km: 500 },
        { domain: "bus", month: "2023-12", km: 80 },
      ],
      recordedMonths: null,
      recordedPoints: null,
    });
    expect(out.years.map((y) => y.year)).toEqual([2024, 2023]);
    const y24 = out.years[0];
    expect(y24.months).toHaveLength(12);
    expect(y24.months[2]).toMatchObject({
      month: 3,
      loggedKm: 1250.3,
      byDomain: { flight: 1000, rail: 250.3 },
    });
    expect(y24.loggedKm).toBe(1750.3);
    expect(out.totals.loggedKm).toBe(1830.3);
  });

  it("keeps recorded km apart from logged km — never added into either figure", () => {
    const out = buildYearStats({
      entries: [{ domain: "rail", month: "2024-05", km: 300 }],
      recordedMonths: [{ month: "2024-05", km: 310 }],
      recordedPoints: 1234,
    });
    expect(out.years[0].loggedKm).toBe(300);
    expect(out.years[0].recordedKm).toBe(310);
    expect(out.totals).toEqual({ loggedKm: 300, recordedKm: 310, recordedPoints: 1234 });
  });

  it("a year whose entries measured nothing exists with null, not 0", () => {
    const out = buildYearStats({
      entries: [
        { domain: "flight", month: "2022-06", km: null },
        { domain: "rail", month: "2022-06", km: 0 },
      ],
      recordedMonths: null,
      recordedPoints: null,
    });
    expect(out.years).toHaveLength(1);
    expect(out.years[0].loggedKm).toBeNull();
    expect(out.years[0].months.every((m) => m.loggedKm === null)).toBe(true);
    expect(out.totals.loggedKm).toBeNull();
    expect(out.totals.recordedKm).toBeNull();
  });

  it("a recording-only year has no logged figure", () => {
    const out = buildYearStats({
      entries: [],
      recordedMonths: [{ month: "2025-01", km: 42 }],
      recordedPoints: 10,
    });
    expect(out.years[0]).toMatchObject({ year: 2025, loggedKm: null, recordedKm: 42 });
  });

  it("no data at all gives no years", () => {
    expect(buildYearStats({ entries: [], recordedMonths: [], recordedPoints: null }).years).toEqual(
      []
    );
  });
});

// UAT rc.45 retest D22: a year whose TravTrack months are still being derived showed no
// recorded km at all, as if nothing had been recorded.
describe("buildYearStats — months the projection still owes", () => {
  it("marks the month and its year as pending, without inventing km", () => {
    const stats = buildYearStats({
      entries: [],
      recordedMonths: [],
      recordedPoints: 1000,
      recordedPending: ["2025-03", "2025-04"],
    });
    const y2025 = stats.years.find((y) => y.year === 2025)!;
    expect(y2025.recordedPending).toBe(true);
    expect(y2025.recordedKm).toBeNull();
    expect(y2025.months[2].recordedPending).toBe(true);
    expect(y2025.months[0].recordedPending).toBe(false);
  });

  it("breaks a year down by purpose: counts and km, unknown kept apart, never read as private", () => {
    const out = buildYearStats({
      entries: [
        { domain: "flight", month: "2024-03", km: 1000, purposeKey: "builtin:trade_fair" },
        { domain: "rail", month: "2024-04", km: 200.04, purposeKey: "builtin:trade_fair" },
        { domain: "bus", month: "2024-05", km: null, purposeKey: "builtin:vacation" },
        { domain: "flight", month: "2024-06", km: 300, purposeKey: null },
      ],
      recordedMonths: null,
      recordedPoints: null,
    });
    expect(out.years[0].byPurpose).toEqual([
      { key: "builtin:trade_fair", count: 2, km: 1200 },
      { key: "builtin:vacation", count: 1, km: null },
      { key: null, count: 1, km: 300 },
    ]);
  });
});
