import type { CruiseStopInput } from "../../types";
import { withCruiseDayNumbers, withDerivedStopDates } from "./cruiseDayNumbers";

/**
 * Edits to the ORDER of an itinerary — move, remove, add — as values, so the
 * editor can say what one would do before it is done and take it back after
 * (forgejo#224). Field edits (a time, a note) are not sequence edits and are
 * not undone here: the undo takes back the last reorder, never the typing
 * done since.
 *
 * Every function works on keyed stops (`withStopKeys`) and leaves day numbers
 * to `withCruiseDayNumbers`, the one rule for them (forgejo#126).
 */
export type SequenceOp =
  | { kind: "move"; key: string; from: number; to: number }
  | { kind: "remove"; stop: CruiseStopInput; index: number }
  | { kind: "add"; key: string };

export function moveStop(
  stops: readonly CruiseStopInput[],
  index: number,
  delta: -1 | 1
): { next: CruiseStopInput[]; op: SequenceOp } | null {
  const to = index + delta;
  if (to < 0 || to >= stops.length) return null;
  const next = [...stops];
  [next[index], next[to]] = [next[to], next[index]];
  return { next, op: { kind: "move", key: next[to].uiKey as string, from: index, to } };
}

export function removeStop(
  stops: readonly CruiseStopInput[],
  index: number
): { next: CruiseStopInput[]; op: SequenceOp } {
  return {
    next: stops.filter((_, i) => i !== index),
    op: { kind: "remove", stop: stops[index], index },
  };
}

/**
 * The list as it was before `op`, keeping every field edit made since: a
 * removed stop comes back as it was removed, a moved one goes back to its
 * place, an added one goes.
 */
export function undoSequenceOp(
  stops: readonly CruiseStopInput[],
  op: SequenceOp
): CruiseStopInput[] {
  if (op.kind === "add") return stops.filter((s) => s.uiKey !== op.key);
  if (op.kind === "remove") {
    const next = [...stops];
    next.splice(Math.min(op.index, next.length), 0, op.stop);
    return next;
  }
  const current = stops.findIndex((s) => s.uiKey === op.key);
  if (current < 0) return [...stops];
  const next = [...stops];
  const [moved] = next.splice(current, 1);
  next.splice(Math.min(op.from, next.length), 0, moved);
  return next;
}

/** The stops as they settle after an edit: days resolved, derived dates followed. */
function settle(stops: readonly CruiseStopInput[], startDate: string): CruiseStopInput[] {
  return withDerivedStopDates(withCruiseDayNumbers(stops), startDate);
}

/** A stop whose day of the cruise or calendar date an edit would change. */
export interface StopShift {
  stop: CruiseStopInput;
  dayBefore: number;
  dayAfter: number;
  /** `YYYY-MM-DD`, or null where the stop has no date. */
  dateBefore: string | null;
  dateAfter: string | null;
}

/**
 * Which OTHER days an edit moves, compared by key: a stop moved behind a later
 * day is pushed to the next free day, and a date derived from the start date
 * follows its day — so one tap on "Nach oben" can renumber two stops and
 * re-date them. Said before the tap, not discovered after the save.
 */
export function stopShifts(
  before: readonly CruiseStopInput[],
  after: readonly CruiseStopInput[],
  startDate: string
): StopShift[] {
  const was = new Map(settle(before, startDate).map((s) => [s.uiKey, s]));
  return settle(after, startDate).flatMap((stop) => {
    const old = was.get(stop.uiKey);
    if (!old) return [];
    const dateBefore = old.date?.slice(0, 10) ?? null;
    const dateAfter = stop.date?.slice(0, 10) ?? null;
    if (old.dayNumber === stop.dayNumber && dateBefore === dateAfter) return [];
    return [{ stop, dayBefore: old.dayNumber, dayAfter: stop.dayNumber, dateBefore, dateAfter }];
  });
}
