import { travelWindows } from "./windows";

const at = (iso: string) => new Date(iso);

describe("folding recorded travel into explained time", () => {
  it("takes a flight from departure to arrival", () => {
    const windows = travelWindows({
      flights: [
        {
          departureTime: at("2026-05-01T08:00:00Z"),
          arrivalTime: at("2026-05-01T11:00:00Z"),
          status: "flown",
        },
      ],
    });
    expect(windows).toEqual([
      {
        startMs: at("2026-05-01T08:00:00Z").getTime(),
        endMs: at("2026-05-01T11:00:00Z").getTime(),
      },
    ]);
  });

  it("still bounds a flight that knows only one of its times", () => {
    // A hand-entered flight routinely has a departure and nothing else.
    // Discarding it would leave its own photos looking unexplained.
    const windows = travelWindows({
      flights: [
        {
          departureTime: at("2026-05-01T08:00:00Z"),
          arrivalTime: null,
          status: "flown",
        },
      ],
    });
    expect(windows).toHaveLength(1);
    expect(windows[0].startMs).toBe(windows[0].endMs);
  });

  it("ignores a flight that knows neither", () => {
    expect(
      travelWindows({
        flights: [
          { departureTime: null, arrivalTime: null, status: "flown" },
        ],
      }),
    ).toHaveLength(0);
  });

  it("explains nothing with a cancelled flight", () => {
    // The one status that means the travel did NOT happen. Photos on that
    // date are evidence of whatever the user did instead — which is the
    // entire point of this feature.
    expect(
      travelWindows({
        flights: [
          {
            departureTime: at("2026-05-01T08:00:00Z"),
            arrivalTime: at("2026-05-01T11:00:00Z"),
            status: "cancelled",
          },
        ],
      }),
    ).toHaveLength(0);
  });

  it("takes trips and cruises as the ranges they are", () => {
    const windows = travelWindows({
      trips: [
        { startDate: at("2026-06-01T00:00:00Z"), endDate: at("2026-06-08T00:00:00Z") },
      ],
      cruises: [
        { startDate: at("2026-07-01T00:00:00Z"), endDate: at("2026-07-10T00:00:00Z") },
      ],
    });
    expect(windows).toHaveLength(2);
  });

  it("takes a stay from check-in to check-out", () => {
    const windows = travelWindows({
      stays: [
        { checkIn: at("2026-06-01T00:00:00Z"), checkOut: at("2026-06-04T00:00:00Z") },
      ],
    });
    expect(windows).toHaveLength(1);
    expect(windows[0].endMs - windows[0].startMs).toBe(3 * 86_400_000);
  });

  it("survives a range recorded back to front", () => {
    // Bad data exists, and a window with end before start would silently
    // explain nothing at all rather than the days it names.
    const windows = travelWindows({
      trips: [
        { startDate: at("2026-06-08T00:00:00Z"), endDate: at("2026-06-01T00:00:00Z") },
      ],
    });
    expect(windows[0].startMs).toBeLessThan(windows[0].endMs);
  });

  it("answers empty for an account with nothing recorded", () => {
    expect(travelWindows({})).toEqual([]);
  });
});
