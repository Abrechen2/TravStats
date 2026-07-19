import { describe, it, expect } from "vitest";
import { cruiseStatusPillStyle } from "./cruiseStatusStyle";

describe("cruiseStatusPillStyle", () => {
  it("returns the purple in_progress style (#status-from-dates)", () => {
    expect(cruiseStatusPillStyle("in_progress")).toEqual({
      background: "rgba(163,113,247,0.15)",
      color: "#a371f7",
    });
  });

  it("in_progress is visually distinct from scheduled (blue) and flown (green)", () => {
    const inProgress = cruiseStatusPillStyle("in_progress");
    const scheduled = cruiseStatusPillStyle("scheduled");
    const flown = cruiseStatusPillStyle("flown");
    expect(inProgress.color).not.toBe(scheduled.color);
    expect(inProgress.color).not.toBe(flown.color);
    expect(inProgress.background).not.toBe(scheduled.background);
    expect(inProgress.background).not.toBe(flown.background);
  });
});
