import { busiestDayOf } from "../busiestDay";

/** One busiest-day rule for every figure (forgejo#256). Mirrored on both sides. */
describe("busiestDayOf", () => {
  it("names the day with the most flights", () => {
    expect(
      busiestDayOf([
        ["2024-01-02", 2],
        ["2024-03-04", 3],
      ])
    ).toEqual({ day: "2024-03-04", flights: 3 });
  });

  it("names the LATEST of equally busy days, whatever order they come in", () => {
    const latest = { day: "2025-06-01", flights: 2 };
    expect(
      busiestDayOf([
        ["2025-06-01", 2],
        ["2023-01-01", 2],
      ])
    ).toEqual(latest);
    expect(
      busiestDayOf([
        ["2023-01-01", 2],
        ["2025-06-01", 2],
      ])
    ).toEqual(latest);
  });

  it("answers null for no day", () => {
    expect(busiestDayOf([])).toBeNull();
  });
});
