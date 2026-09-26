import { cruiseLegWindow, cruiseWindow } from "../cruiseLegWindow";

const day = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

describe("cruiseLegWindow", () => {
  const cruise = { startDate: day("2026-06-01"), endDate: day("2026-06-08") };

  it("runs from the departure day to the arrival day, widened by 14 h on each side", () => {
    const window = cruiseLegWindow(
      { date: day("2026-06-03") },
      { date: day("2026-06-04") },
      cruise
    );
    expect(window).toEqual({
      startAt: new Date("2026-06-02T10:00:00.000Z"),
      endAt: new Date("2026-06-05T14:00:00.000Z"),
    });
  });

  it("uses the cruise's own dates for the departure and arrival ports", () => {
    const window = cruiseLegWindow(null, null, cruise);
    expect(window?.startAt).toEqual(new Date("2026-05-31T10:00:00.000Z"));
    expect(window?.endAt).toEqual(new Date("2026-06-09T14:00:00.000Z"));
  });

  it("abstains without a day, or with an inverted pair", () => {
    expect(cruiseLegWindow({ date: null }, null, { startDate: null, endDate: null })).toBeNull();
    expect(
      cruiseLegWindow({ date: day("2026-06-05") }, { date: day("2026-06-02") }, cruise)
    ).toBeNull();
  });

  it("falls back to the stops' own days for the whole voyage", () => {
    const window = cruiseWindow([{ date: day("2026-06-04") }, { date: day("2026-06-02") }], {
      startDate: null,
      endDate: null,
    });
    expect(window?.startAt).toEqual(new Date("2026-06-01T10:00:00.000Z"));
    expect(window?.endAt).toEqual(new Date("2026-06-05T14:00:00.000Z"));
  });
});
