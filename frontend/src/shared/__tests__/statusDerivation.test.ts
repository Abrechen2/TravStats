import { describe, it, expect } from "vitest";
import { deriveCruiseStatus, deriveFlightStatus, deriveLodgingStatus } from "../statusDerivation";

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
    expect(
      deriveLodgingStatus({ checkIn: past(48), checkOut: now, current: "scheduled", now })
    ).toBe("completed");
  });

  it("a same-day stay is never in_progress once its date has arrived", () => {
    expect(deriveLodgingStatus({ checkIn: now, checkOut: now, current: "scheduled", now })).toBe(
      "completed"
    );
  });
});

/**
 * The flight half of the mirror. The truth table below is copied from
 * `backend/src/shared/__tests__/statusDerivation.test.ts` on purpose: the two
 * files exist to disagree loudly if the rules ever drift apart.
 */
describe("deriveFlightStatus (mirror of the backend rules)", () => {
  const H = 60 * 60 * 1000;
  const now = new Date("2026-07-17T12:00:00Z");
  const past = (h: number): Date => new Date(now.getTime() - h * H);
  const future = (h: number): Date => new Date(now.getTime() + h * H);

  it("passes through cancelled/historical/duplicated untouched", () => {
    for (const s of ["cancelled", "historical", "duplicated"]) {
      expect(
        deriveFlightStatus({ departureTime: past(100), arrivalTime: past(99), current: s, now })
      ).toBe(s);
    }
  });

  it("arrival more than 1h past -> flown; within the hour -> scheduled", () => {
    expect(
      deriveFlightStatus({
        departureTime: past(4),
        arrivalTime: past(1.5),
        current: "scheduled",
        now,
      })
    ).toBe("flown");
    expect(
      deriveFlightStatus({
        departureTime: past(2),
        arrivalTime: past(0.5),
        current: "scheduled",
        now,
      })
    ).toBe("scheduled");
  });

  it("future-dated 'flown' reverts to scheduled", () => {
    expect(
      deriveFlightStatus({
        departureTime: future(24),
        arrivalTime: future(26),
        current: "flown",
        now,
      })
    ).toBe("scheduled");
  });

  it("null arrival falls back to departure + 30h", () => {
    expect(
      deriveFlightStatus({ departureTime: past(31), arrivalTime: null, current: "scheduled", now })
    ).toBe("flown");
    expect(
      deriveFlightStatus({ departureTime: past(29), arrivalTime: null, current: "scheduled", now })
    ).toBe("scheduled");
  });

  it("with passthrough off, a duplicate is placed by its dates", () => {
    // The one thing the backend never asks, because it stores the marker
    // rather than drawing it: what does this row's TIME say?
    expect(
      deriveFlightStatus({
        departureTime: past(100),
        arrivalTime: past(99),
        current: "duplicated",
        now,
        passthrough: false,
      })
    ).toBe("flown");
    expect(
      deriveFlightStatus({
        departureTime: future(48),
        arrivalTime: future(50),
        current: "duplicated",
        now,
        passthrough: false,
      })
    ).toBe("scheduled");
  });
});

describe("deriveCruiseStatus (frontend mirror)", () => {
  const derive = (startDate: Date | null, endDate: Date | null, current = "scheduled") =>
    deriveCruiseStatus({ startDate, endDate, current, now });

  it("passes through cancelled/historical", () => {
    for (const s of ["cancelled", "historical"]) expect(derive(past(100), past(50), s)).toBe(s);
  });

  it("future start -> scheduled; between start and end -> in_progress; past end+48h -> completed", () => {
    expect(derive(future(24), future(120))).toBe("scheduled");
    expect(derive(past(24), future(72))).toBe("in_progress");
    expect(derive(past(200), past(49))).toBe("completed");
  });

  it("end within the 48h slack stays in_progress", () => {
    expect(derive(past(200), past(47), "completed")).toBe("in_progress");
  });

  it("null start + future end is not in_progress", () => {
    expect(derive(null, future(72))).toBe("scheduled");
  });

  it("missing end: scheduled until start+48h past, then completed", () => {
    expect(derive(past(47), null)).toBe("scheduled");
    expect(derive(past(49), null)).toBe("completed");
  });

  it("no dates keeps current", () => {
    expect(derive(null, null, "completed")).toBe("completed");
  });

  // #357: the retired flight word is read in today's vocabulary.
  it("reads a legacy 'flown' as 'completed', never returns it", () => {
    expect(derive(null, null, "flown")).toBe("completed");
  });
});

describe("deriveFlightStatus (frontend mirror)", () => {
  // A tester, 2026-10-02: landed two and a half hours ago, still "geplant".
  it("a flight that landed two and a half hours ago is flown", () => {
    expect(
      deriveFlightStatus({
        departureTime: past(5),
        arrivalTime: past(2.5),
        current: "scheduled",
        now,
      })
    ).toBe("flown");
  });

  it("a known actual arrival decides on its own, without the slack", () => {
    expect(
      deriveFlightStatus({
        departureTime: past(2),
        arrivalTime: future(0.2),
        actualArrival: past(1 / 6),
        current: "scheduled",
        now,
      })
    ).toBe("flown");
  });
});
