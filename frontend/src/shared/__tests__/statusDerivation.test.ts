import { describe, it, expect } from "vitest";
import { deriveLodgingStatus } from "../statusDerivation";

/**
 * The SAME truth table as backend/src/shared/__tests__/statusDerivation.test.ts.
 * These two suites exist to keep the mirror honest: if someone changes the
 * rules on one side only, one of them goes red.
 */
const H = 60 * 60 * 1000;
const now = new Date("2026-07-17T12:00:00Z");
const past = (h: number) => new Date(now.getTime() - h * H);
const future = (h: number) => new Date(now.getTime() + h * H);

describe("deriveLodgingStatus (frontend mirror)", () => {
  const derive = (checkIn: Date | null, checkOut: Date | null, current = "scheduled") =>
    deriveLodgingStatus({ checkIn, checkOut, current, now });

  it("passes cancelled through untouched, whatever the dates say", () => {
    expect(derive(past(72), past(24), "cancelled")).toBe("cancelled");
    expect(derive(future(24), future(72), "cancelled")).toBe("cancelled");
  });

  it("both dates in the future -> scheduled", () => {
    expect(derive(future(24), future(72))).toBe("scheduled");
  });

  it("check-in past, check-out future -> in_progress", () => {
    expect(derive(past(24), future(24))).toBe("in_progress");
  });

  it("both dates past -> completed", () => {
    expect(derive(past(72), past(24))).toBe("completed");
  });

  it("derives the same result no matter what the stored status claims", () => {
    for (const stored of ["scheduled", "in_progress", "completed"]) {
      expect(derive(past(72), past(24), stored)).toBe("completed");
    }
  });

  it("keeps the stored status when the stay has no dates at all", () => {
    expect(derive(null, null, "completed")).toBe("completed");
  });

  it("treats a one-ended stay by its known date rather than leaving it unconverged", () => {
    expect(derive(past(24), null)).toBe("completed");
    expect(derive(future(24), null)).toBe("scheduled");
    expect(derive(null, past(24))).toBe("completed");
    expect(derive(null, future(24))).toBe("scheduled");
  });

  it("counts a stay as completed the moment check-out is reached, not after it", () => {
    expect(deriveLodgingStatus({ checkIn: past(48), checkOut: now, current: "scheduled", now })).toBe(
      "completed"
    );
  });

  it("a same-day stay is never in_progress once its date has arrived", () => {
    expect(deriveLodgingStatus({ checkIn: now, checkOut: now, current: "scheduled", now })).toBe(
      "completed"
    );
  });
});
