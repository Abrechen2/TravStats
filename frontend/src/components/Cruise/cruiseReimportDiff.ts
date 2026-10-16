import type { CruiseStopInput } from "../../types";
import { normalizePortName } from "./cruiseUnresolved";

/**
 * A booking read a second time against the itinerary already stored
 * (forgejo#225). Both sides are stops as the editor holds them; they are
 * matched by DAY OF THE CRUISE, the one thing an updated confirmation keeps
 * when a line swaps a port or shifts a time.
 *
 * - **port**: the day calls somewhere else now (or became a sea day).
 * - **times**: same place, a different arrival or departure. Only a time the
 *   new plan STATES counts — a re-read without times never clears the times
 *   someone typed in.
 * - **added** / **removed**: a day only one side has.
 *
 * What is the user's own is not compared and never overwritten: the
 * excursion note, the all-aboard time and a typed date (forgejo#223/#224) —
 * except that a taken PORT change drops the old port's all-aboard time and
 * clock times, which belonged to that port, not to the day (review I3).
 */
export type ReimportChange =
  | { id: string; kind: "added"; day: number; imported: CruiseStopInput }
  | { id: string; kind: "removed"; day: number; stored: CruiseStopInput }
  | { id: string; kind: "port"; day: number; stored: CruiseStopInput; imported: CruiseStopInput }
  | { id: string; kind: "times"; day: number; stored: CruiseStopInput; imported: CruiseStopInput };

/** Where a stop is: a catalogue port, a sea day, or an imported name. */
function place(stop: CruiseStopInput): string {
  if (stop.isAtSea) return "sea";
  if (stop.portId != null) return `port:${stop.portId}`;
  return `name:${normalizePortName(stop.unresolvedPortName ?? "")}`;
}

/** The port's wall clock of a stop time, `YYYY-MM-DDTHH:mm`, or null. */
const clock = (value: string | null | undefined): string | null =>
  value ? value.slice(0, 16) : null;

function timesDiffer(stored: CruiseStopInput, imported: CruiseStopInput): boolean {
  const arrival = clock(imported.arrivalTime);
  const departure = clock(imported.departureTime);
  return (
    (arrival !== null && arrival !== clock(stored.arrivalTime)) ||
    (departure !== null && departure !== clock(stored.departureTime))
  );
}

const MS_PER_DAY = 86_400_000;

/** The calendar day of a stop's date as a UTC day count, or null without one. */
function dayIndex(date: string | null | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date ?? "");
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(ms) ? null : Math.round(ms / MS_PER_DAY);
}

/**
 * An import numbers its days by list position (a booking that leaves the
 * sea days out calls Oslo "day 2"), the stored itinerary by day of the
 * cruise — keyed as they came, every port after a missing sea day read as
 * one removed and one added call. A dated imported stop therefore takes
 * the day the stored itinerary gives that date, or the day the date falls
 * on counted from a dated stored stop; only an undated one keeps its own.
 */
export function alignImportedDays(
  stored: readonly CruiseStopInput[],
  imported: readonly CruiseStopInput[]
): CruiseStopInput[] {
  const anchor = stored.find((s) => dayIndex(s.date) !== null);
  if (!anchor) return [...imported];
  const anchorIndex = dayIndex(anchor.date) as number;
  return imported.map((stop) => {
    const index = dayIndex(stop.date);
    if (index === null) return stop;
    const day = anchor.dayNumber + (index - anchorIndex);
    return day >= 1 && day !== stop.dayNumber ? { ...stop, dayNumber: day } : stop;
  });
}

/** Accent- and case-blind, so "Colon" and "Colón" are one name. */
const fold = (name: string | null | undefined): string =>
  normalizePortName(name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/** Does an imported name name this catalogue port (its name or its city)? */
function namesPort(name: string, stop: CruiseStopInput): boolean {
  const wanted = fold(name);
  if (!wanted) return false;
  return [stop.port?.name, stop.port?.city].some((candidate) => {
    const known = fold(candidate);
    return known !== "" && (known === wanted || known.includes(wanted) || wanted.includes(known));
  });
}

function byDay(stops: readonly CruiseStopInput[]): Map<number, CruiseStopInput[]> {
  const days = new Map<number, CruiseStopInput[]>();
  for (const stop of stops) days.set(stop.dayNumber, [...(days.get(stop.dayNumber) ?? []), stop]);
  return days;
}

export function diffItinerary(
  stored: readonly CruiseStopInput[],
  imported: readonly CruiseStopInput[]
): ReimportChange[] {
  const storedDays = byDay(stored);
  const importedDays = byDay(alignImportedDays(stored, imported));
  const days = [...new Set([...storedDays.keys(), ...importedDays.keys()])].sort((a, b) => a - b);
  const changes: ReimportChange[] = [];

  for (const day of days) {
    const left = [...(storedDays.get(day) ?? [])];
    const right = [...(importedDays.get(day) ?? [])];
    // Same place first, so a day with two calls is not read as two swaps.
    for (let i = right.length - 1; i >= 0; i -= 1) {
      const match = left.findIndex((s) => place(s) === place(right[i]));
      if (match < 0) continue;
      const [s] = left.splice(match, 1);
      const [m] = right.splice(i, 1);
      if (timesDiffer(s, m)) {
        changes.push({
          id: `times-${day}-${changes.length}`,
          kind: "times",
          day,
          stored: s,
          imported: m,
        });
      }
    }
    // A port the user assigned (#222 work list) against the same day's name
    // the parser still cannot match: the same call, already resolved. It is
    // never offered as a change back to the unresolved name, which would
    // drop the call from the map and the sea miles (review I2). The other
    // way round — an imported catalogue port for a stored name — is an
    // upgrade and stays a proposed change. The pairing needs the name to
    // name that port, or the day to hold one call on each side: paired with
    // ANY resolved port, another port's times landed on it and the port
    // change itself was never shown.
    const soleCall =
      (storedDays.get(day) ?? []).length === 1 && (importedDays.get(day) ?? []).length === 1;
    for (let i = right.length - 1; i >= 0; i -= 1) {
      const name = right[i].unresolvedPortName;
      if (right[i].isAtSea || right[i].portId != null || !name) continue;
      const resolved = (s: CruiseStopInput) => !s.isAtSea && s.portId != null;
      const named = left.findIndex((s) => resolved(s) && namesPort(name, s));
      const match = named >= 0 || !soleCall ? named : left.findIndex(resolved);
      if (match < 0) continue;
      const [s] = left.splice(match, 1);
      const [m] = right.splice(i, 1);
      if (timesDiffer(s, m)) {
        changes.push({
          id: `times-${day}-${changes.length}`,
          kind: "times",
          day,
          stored: s,
          imported: m,
        });
      }
    }
    // What is left on both sides on one day is the same call, somewhere else.
    while (left.length > 0 && right.length > 0) {
      const s = left.shift() as CruiseStopInput;
      const m = right.shift() as CruiseStopInput;
      changes.push({
        id: `port-${day}-${changes.length}`,
        kind: "port",
        day,
        stored: s,
        imported: m,
      });
    }
    for (const s of left) {
      changes.push({ id: `removed-${day}-${changes.length}`, kind: "removed", day, stored: s });
    }
    for (const m of right) {
      changes.push({ id: `added-${day}-${changes.length}`, kind: "added", day, imported: m });
    }
  }
  return changes;
}

/** The new plan's times, where it states them; the stored ones elsewhere. */
function withImportedTimes(stop: CruiseStopInput, imported: CruiseStopInput): CruiseStopInput {
  return {
    ...stop,
    ...(imported.arrivalTime
      ? { arrivalTime: imported.arrivalTime, arrivalFold: imported.arrivalFold }
      : {}),
    ...(imported.departureTime
      ? { departureTime: imported.departureTime, departureFold: imported.departureFold }
      : {}),
  };
}

/** What the user wrote stays; an empty own field may take the booking's. */
function keepOwn(stop: CruiseStopInput, imported: CruiseStopInput): CruiseStopInput {
  return {
    ...stop,
    excursionNote: stop.excursionNote?.trim() ? stop.excursionNote : imported.excursionNote,
    date: stop.date ?? imported.date,
  };
}

/**
 * The stored itinerary with the ACCEPTED changes applied, in day order.
 * Applying the same plan again finds nothing left to change, so a second
 * re-read never adds a port call twice.
 */
export function mergeItinerary(
  stored: readonly CruiseStopInput[],
  changes: readonly ReimportChange[],
  accepted: ReadonlySet<string>
): CruiseStopInput[] {
  const taken = changes.filter((c) => accepted.has(c.id));
  let next = stored.map((stop) => {
    const change = taken.find((c) => c.kind !== "added" && c.stored === stop);
    if (!change || change.kind === "removed" || change.kind === "added") return stop;
    if (change.kind === "times")
      return keepOwn(withImportedTimes(stop, change.imported), change.imported);
    // Another port, or a sea day: what belonged to the OLD port goes with it
    // (review I3). Its all-aboard time is that port's; its clock times are
    // replaced as a pair by the new plan's (missing ones become null, not
    // the old port's); a sea day keeps none. The note stays — it is the
    // user's, and the row says so.
    const imported = change.imported;
    const sea = imported.isAtSea;
    return keepOwn(
      {
        ...stop,
        isAtSea: sea,
        portId: imported.portId,
        port: imported.port ?? null,
        unresolvedPortName: imported.unresolvedPortName ?? null,
        allAboardTime: null,
        arrivalTime: sea ? null : (imported.arrivalTime ?? null),
        arrivalFold: sea ? undefined : imported.arrivalFold,
        departureTime: sea ? null : (imported.departureTime ?? null),
        departureFold: sea ? undefined : imported.departureFold,
      },
      imported
    );
  });
  const removed = new Set(taken.flatMap((c) => (c.kind === "removed" ? [c.stored] : [])));
  next = next.filter((stop) => !removed.has(stop));
  const added = taken.flatMap((c) => (c.kind === "added" ? [c.imported] : []));
  return [...next, ...added]
    .map((stop, order) => ({ stop, order }))
    .sort((a, b) => a.stop.dayNumber - b.stop.dayNumber || a.order - b.order)
    .map(({ stop }) => stop);
}
