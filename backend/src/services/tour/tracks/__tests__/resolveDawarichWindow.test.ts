import { resolveDawarichWindow } from "../pullDawarichTrack";

/**
 * The default Dawarich window is the section's LOCAL calendar span. It used
 * to be the stored day anchors read as UTC instants: a one-day tour asked for
 * 00:00Z–00:00Z (nothing, so "no location data"), and a multi-day tour never
 * pulled its last day.
 */
const BERGEN = { lat: 60.39, lon: 5.32 }; // Europe/Oslo, UTC+2 in June
const day = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

describe("resolveDawarichWindow — local day bounds", () => {
  it("covers the whole local day of a one-day tour", () => {
    const w = resolveDawarichWindow(
      [{ startDate: day("2026-06-01"), endDate: day("2026-06-01"), ...BERGEN }],
      {}
    );
    expect(w?.startAt.toISOString()).toBe("2026-05-31T22:00:00.000Z");
    expect(w?.endAt.toISOString()).toBe("2026-06-01T22:00:00.000Z");
  });

  it("includes the last day of a multi-day tour", () => {
    const w = resolveDawarichWindow(
      [
        { startDate: day("2026-06-01"), endDate: null, ...BERGEN },
        { startDate: day("2026-06-03"), endDate: day("2026-06-03"), ...BERGEN },
      ],
      {}
    );
    expect(w?.startAt.toISOString()).toBe("2026-05-31T22:00:00.000Z");
    expect(w?.endAt.toISOString()).toBe("2026-06-03T22:00:00.000Z");
  });

  it("reads a timed stop as the stop's local wall clock", () => {
    const w = resolveDawarichWindow(
      [
        { startDate: new Date("2026-06-01T08:00:00Z"), endDate: null, ...BERGEN },
        { startDate: new Date("2026-06-01T18:30:00Z"), endDate: null, ...BERGEN },
      ],
      {}
    );
    expect(w?.startAt.toISOString()).toBe("2026-06-01T06:00:00.000Z");
    expect(w?.endAt.toISOString()).toBe("2026-06-01T16:30:00.000Z");
  });

  it("falls back to UTC days for stops without coordinates, still ending after the last day", () => {
    const w = resolveDawarichWindow([{ startDate: day("2026-06-01"), endDate: null }], {});
    expect(w?.startAt.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(w?.endAt.toISOString()).toBe("2026-06-02T00:00:00.000Z");
  });

  it("lets an explicit override win per side", () => {
    const override = new Date("2026-06-01T12:00:00Z");
    const w = resolveDawarichWindow(
      [{ startDate: day("2026-06-01"), endDate: day("2026-06-01"), ...BERGEN }],
      { endedAt: override }
    );
    expect(w?.startAt.toISOString()).toBe("2026-05-31T22:00:00.000Z");
    expect(w?.endAt).toBe(override);
  });

  it("returns null when no stop is dated", () => {
    expect(resolveDawarichWindow([{ startDate: null, endDate: null }], {})).toBeNull();
  });
});
