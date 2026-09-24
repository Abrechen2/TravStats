import { describe, it, expect } from "vitest";

import { withCruiseDayNumbers } from "../cruiseDayNumbers";
import type { CruiseStopInput } from "../../../types";

/** The owner's four examples from forgejo#126, and the one the bug was found by. */

const stop = (dayNumber: number, originalDay?: number | null): CruiseStopInput => ({
  portId: null,
  dayNumber,
  isAtSea: false,
  ...(originalDay !== undefined ? { originalDay } : {}),
});
const days = (stops: CruiseStopInput[]) => withCruiseDayNumbers(stops).map((s) => s.dayNumber);

describe("withCruiseDayNumbers", () => {
  it("keeps the loaded days of an untouched cruise", () => {
    expect(days([stop(1), stop(8)])).toEqual([1, 8]);
  });

  it("gives a sea day added between them the next free day, and keeps disembarkation on day 8", () => {
    expect(days([stop(1), stop(1, null), stop(8)])).toEqual([1, 2, 8]);
  });

  it("closes no gap when the middle stop is removed", () => {
    expect(days([stop(1), stop(8)])).toEqual([1, 8]);
  });

  it("pushes a stop moved behind a later day to the next free day", () => {
    expect(days([stop(1), stop(8), stop(4)])).toEqual([1, 8, 9]);
  });

  it("remembers which stop was added, across a second edit", () => {
    // Added at the end first (day 9 behind day 8), then moved up between 1 and 8.
    const afterAdd = withCruiseDayNumbers([stop(1), stop(8), stop(1, null)]);
    expect(afterAdd.map((s) => s.dayNumber)).toEqual([1, 8, 9]);
    const movedUp = [afterAdd[0], afterAdd[2], afterAdd[1]];
    expect(days(movedUp)).toEqual([1, 2, 8]);
  });
});
