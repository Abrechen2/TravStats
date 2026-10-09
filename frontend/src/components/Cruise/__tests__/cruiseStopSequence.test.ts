import { describe, it, expect } from "vitest";
import { moveStop, removeStop, stopShifts, undoSequenceOp } from "../cruiseStopSequence";
import { withCruiseDayNumbers } from "../cruiseDayNumbers";
import type { CruiseStopInput } from "../../../types";

const stop = (key: string, day: number, extra: Partial<CruiseStopInput> = {}): CruiseStopInput => ({
  uiKey: key,
  portId: day,
  dayNumber: day,
  isAtSea: false,
  ...extra,
});

/** forgejo#224: what a reorder does, said before it is done, and taken back after. */
describe("cruise stop sequence", () => {
  const list = [stop("kiel", 1), stop("oslo", 3), stop("bergen", 4)];

  it("names the day a move pushes on, and the derived date that follows it", () => {
    const moved = moveStop(list, 2, -1);
    expect(moved).not.toBeNull();
    const shifts = stopShifts(list, moved!.next, "2026-10-05");
    // Bergen keeps day 4; Oslo, now behind it, is pushed to day 5.
    expect(shifts.map((s) => [s.stop.uiKey, s.dayBefore, s.dayAfter])).toEqual([["oslo", 3, 5]]);
    expect(shifts[0].dateBefore).toBe("2026-10-07");
    expect(shifts[0].dateAfter).toBe("2026-10-09");
  });

  it("never re-dates a date the user typed", () => {
    const typed = [
      stop("kiel", 1),
      stop("oslo", 3, { date: "2026-10-07T00:00:00.000Z", dateSource: "user" }),
      stop("bergen", 4),
    ];
    const shifts = stopShifts(typed, moveStop(typed, 2, -1)!.next, "2026-10-05");
    expect(shifts[0]).toMatchObject({ dateBefore: "2026-10-07", dateAfter: "2026-10-07" });
  });

  it("says nothing for a move at the end of the list", () => {
    expect(moveStop(list, 0, -1)).toBeNull();
    expect(moveStop(list, 2, 1)).toBeNull();
  });

  it("takes back a remove with the stop as it was, keeping later edits elsewhere", () => {
    const withNote = [stop("kiel", 1), stop("oslo", 3, { excursionNote: "Holmenkollen" })];
    const { next, op } = removeStop(withNote, 1);
    const edited = next.map((s) =>
      s.uiKey === "kiel" ? { ...s, excursionNote: "Hafenrundfahrt" } : s
    );

    const back = withCruiseDayNumbers(undoSequenceOp(edited, op));
    expect(back.map((s) => [s.uiKey, s.dayNumber, s.excursionNote])).toEqual([
      ["kiel", 1, "Hafenrundfahrt"],
      ["oslo", 3, "Holmenkollen"],
    ]);
  });

  it("takes back a move, and the pushed day returns to its own", () => {
    const { next, op } = moveStop(list, 2, -1)!;
    const back = withCruiseDayNumbers(undoSequenceOp(withCruiseDayNumbers(next), op));
    expect(back.map((s) => [s.uiKey, s.dayNumber])).toEqual([
      ["kiel", 1],
      ["oslo", 3],
      ["bergen", 4],
    ]);
  });

  it("keeps a moved stop's excursion note with the stop", () => {
    const noted = [stop("kiel", 1), stop("oslo", 3, { excursionNote: "Holmenkollen" })];
    const { next } = moveStop(noted, 1, -1)!;
    expect(next[0]).toMatchObject({ uiKey: "oslo", excursionNote: "Holmenkollen" });
  });

  it("takes back an add", () => {
    const added = [...list, stop("new-1", 5)];
    expect(undoSequenceOp(added, { kind: "add", key: "new-1" })).toEqual(list);
  });
});
