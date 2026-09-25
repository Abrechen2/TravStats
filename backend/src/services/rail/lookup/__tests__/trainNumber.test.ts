import { isOnDay, labelMatches, parseTrainNumber } from "../trainNumber";

describe("parseTrainNumber", () => {
  it.each([
    ["ICE 578", null, { number: "578", category: "ICE" }],
    ["578", null, { number: "578", category: null }],
    ["578", "ic", { number: "578", category: "IC" }],
    ["TGV 9876/9877", null, { number: "9876", category: "TGV" }],
    ["ICE 0578", null, { number: "578", category: "ICE" }],
  ])("reads %p (category %p)", (raw, category, expected) => {
    expect(parseTrainNumber(raw, category)).toEqual(expected);
  });

  it("answers null when there is no number to look for", () => {
    expect(parseTrainNumber("ICE")).toBeNull();
  });
});

describe("labelMatches", () => {
  it("matches the number as a whole token — 578 is not 1578", () => {
    expect(labelMatches(["ICE 1578"], "578", null)).toBe(false);
    expect(labelMatches(["ICE 578"], "578", null)).toBe(true);
  });

  it("takes the category from any label (the SNCF feed says only '9586')", () => {
    expect(labelMatches(["9586", "ICE 9586"], "9586", "ICE")).toBe(true);
    expect(labelMatches(["IC 2441"], "2441", "ICE")).toBe(false);
  });
});

describe("isOnDay", () => {
  it("reads the day on the station's clock, not in UTC", () => {
    // 23:30 UTC on the 25th is 01:30 on the 26th in Berlin.
    const instant = new Date("2026-09-25T23:30:00Z");
    expect(isOnDay(instant, "2026-09-26", "Europe/Berlin")).toBe(true);
    expect(isOnDay(instant, "2026-09-26", null)).toBe(false);
  });
});
