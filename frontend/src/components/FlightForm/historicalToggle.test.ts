import { describe, it, expect } from "vitest";
import { applyHistoricalToggle } from "./historicalToggle";

const NOW = new Date("2026-09-05T12:00:00.000Z");

const base = {
  status: "historical",
  departureDate: "1998-07-15",
  departureTime: "",
  arrivalDate: "1998-07-15",
  arrivalTime: "",
  untouched: "kept",
};

describe("applyHistoricalToggle", () => {
  it("leaving keeps a real day, empties the clocks, and hints flown for a past date", () => {
    const next = applyHistoricalToggle(base, false, NOW);
    expect(next.status).toBe("flown");
    expect(next.departureDate).toBe("1998-07-15");
    expect(next.arrivalDate).toBe("1998-07-15");
    expect(next.departureTime).toBe("");
    expect(next.arrivalTime).toBe("");
    expect(next.untouched).toBe("kept");
  });

  it("leaving hints scheduled for a future date", () => {
    const next = applyHistoricalToggle({ ...base, departureDate: "2030-01-01" }, false, NOW);
    expect(next.status).toBe("scheduled");
  });

  it("leaving a year-only or year+month shape yields an empty date, never a fabricated day 01", () => {
    expect(
      applyHistoricalToggle({ ...base, departureDate: "1998" }, false, NOW).departureDate
    ).toBe("");
    const ym = applyHistoricalToggle({ ...base, departureDate: "1998-07" }, false, NOW);
    expect(ym.departureDate).toBe("");
    expect(ym.arrivalDate).toBe("");
    expect(ym.status).toBe("scheduled");
  });

  it("entering sets historical, mirrors the departure date onto arrival and drops both clocks", () => {
    const next = applyHistoricalToggle(
      {
        ...base,
        status: "flown",
        departureDate: "2026-06-01",
        departureTime: "10:00",
        arrivalDate: "2026-06-02",
        arrivalTime: "11:00",
      },
      true,
      NOW
    );
    expect(next.status).toBe("historical");
    expect(next.arrivalDate).toBe("2026-06-01");
    expect(next.departureTime).toBe("");
    expect(next.arrivalTime).toBe("");
  });

  it("returns a new object and leaves the input untouched", () => {
    const input = { ...base };
    const next = applyHistoricalToggle(input, false, NOW);
    expect(next).not.toBe(input);
    expect(input.status).toBe("historical");
  });
});
