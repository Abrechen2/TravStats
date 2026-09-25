import { describe, expect, it } from "vitest";
import { tripCoversDate, tripIdForDate, tripsContainingDate } from "../tripForDate";

// Trip dates arrive as stored timestamps (UTC midnight for a picked day); the
// entry's date as a date input value.
const summer = {
  id: "summer",
  startDate: "2026-07-01T00:00:00.000Z",
  endDate: "2026-07-14T00:00:00.000Z",
};
const autumn = {
  id: "autumn",
  startDate: "2026-10-03T00:00:00.000Z",
  endDate: "2026-10-05T00:00:00.000Z",
};

describe("tripCoversDate", () => {
  it("includes both boundary days", () => {
    expect(tripCoversDate(summer, "2026-07-01")).toBe(true);
    expect(tripCoversDate(summer, "2026-07-14")).toBe(true);
  });

  it("excludes the day before and the day after", () => {
    expect(tripCoversDate(summer, "2026-06-30")).toBe(false);
    expect(tripCoversDate(summer, "2026-07-15")).toBe(false);
  });

  it("reads the day of an ISO timestamp too", () => {
    expect(tripCoversDate(summer, "2026-07-14T21:30:00.000Z")).toBe(true);
  });

  it("treats a trip without an end as open-ended from its start", () => {
    const open = { id: "open", startDate: "2026-07-01T00:00:00.000Z", endDate: null };
    expect(tripCoversDate(open, "2026-06-30")).toBe(false);
    expect(tripCoversDate(open, "2026-07-01")).toBe(true);
    expect(tripCoversDate(open, "2027-01-01")).toBe(true);
  });

  it("places a trip without a start nowhere", () => {
    expect(tripCoversDate({ id: "x", startDate: null, endDate: null }, "2026-07-01")).toBe(false);
    expect(
      tripCoversDate(
        { id: "x", startDate: null, endDate: "2026-07-14T00:00:00.000Z" },
        "2026-07-01"
      )
    ).toBe(false);
  });

  it("matches nothing for an empty or malformed date", () => {
    expect(tripCoversDate(summer, "")).toBe(false);
    expect(tripCoversDate(summer, "07/05/2026")).toBe(false);
  });
});

describe("tripIdForDate", () => {
  it("names the one trip that covers the day", () => {
    expect(tripIdForDate([summer, autumn], "2026-07-05")).toBe("summer");
    expect(tripIdForDate([summer, autumn], "2026-10-05")).toBe("autumn");
  });

  it("abstains when no trip covers the day", () => {
    expect(tripIdForDate([summer, autumn], "2026-08-01")).toBeNull();
    expect(tripIdForDate([], "2026-07-05")).toBeNull();
  });

  it("abstains when several trips cover the day", () => {
    const overlap = {
      id: "overlap",
      startDate: "2026-07-10T00:00:00.000Z",
      endDate: "2026-07-20T00:00:00.000Z",
    };
    expect(tripsContainingDate([summer, overlap], "2026-07-12").map((t) => t.id)).toEqual([
      "summer",
      "overlap",
    ]);
    expect(tripIdForDate([summer, overlap], "2026-07-12")).toBeNull();
    // Outside the overlap the answer is unique again.
    expect(tripIdForDate([summer, overlap], "2026-07-05")).toBe("summer");
  });

  it("an open-ended trip competes with a dated one rather than winning", () => {
    const open = { id: "open", startDate: "2026-01-01T00:00:00.000Z", endDate: null };
    expect(tripIdForDate([open, summer], "2026-07-05")).toBeNull();
    expect(tripIdForDate([open, summer], "2026-03-01")).toBe("open");
  });
});
