import { addDays, daysBetween } from "../../shared/time";
import { dayKey } from "./roadtripView";
import type { EditorStation } from "./editorStation";

/**
 * Shifting the days from one station on (forgejo#241): a late ferry, a day
 * longer at the lake, and every following station moves by the same number of
 * days. Dates are CALENDAR days (`YYYY-MM-DD`), moved with `shared/time`'s
 * `addDays` — no instant, no zone, nothing a reader's clock can shift.
 *
 * What is never moved: a linked stay. The stay owns its night (design
 * 2026-09-24 §2) and is a booking with a hotel's own dates; rewriting it
 * because the trip moved would change a record the reader did not open. It is
 * listed for checking instead, with a way to it.
 */

export interface ShiftRow {
  station: EditorStation;
  before: { start: string | null; end: string | null };
  after: { start: string | null; end: string | null };
}

export interface StayRef {
  id: string;
  lodgingId: string;
  label: string;
  /** Calendar days; null when the stay does not name exact days. */
  checkIn: string | null;
  checkOut: string | null;
  cancelled: boolean;
}

export interface SpanRef {
  id: string;
  name: string;
  start: string | null;
  end: string | null;
}

export type ShiftNotice =
  /** The chosen station would then begin before the one in front of it ends. */
  | { kind: "beforePrevious"; station: EditorStation; previous: EditorStation }
  /** Days left between the station in front and the moved one. */
  | { kind: "gap"; station: EditorStation; previous: EditorStation; days: number }
  /** A shifted station's linked stay keeps its own dates — check it. */
  | { kind: "linkedStay"; station: EditorStation; stay: StayRef | null; fits: boolean }
  /** A shifted night now falls into another stay's nights. */
  | { kind: "otherStay"; station: EditorStation; stay: StayRef }
  /** The roadtrip's span then runs outside its own trip. */
  | { kind: "outsideTrip"; trip: SpanRef }
  /** The span then overlaps another trip or roadtrip it did not overlap. */
  | { kind: "overlapsTrip"; trip: SpanRef }
  | { kind: "overlapsRoadtrip"; roadtrip: SpanRef };

const day = (value: string | null | undefined): string | null => dayKey(value ?? null);
const shift = (value: string | null, days: number): string | null =>
  value === null ? null : addDays(value, days);

/** The list with every own date from `fromIndex` on moved by `days`. */
export function shiftStations(
  drafts: readonly EditorStation[],
  fromIndex: number,
  days: number
): EditorStation[] {
  return drafts.map((s, i) => {
    if (i < fromIndex || days === 0) return s;
    const start = day(s.startDate);
    const end = day(s.endDate);
    if (start === null && end === null) return s;
    return { ...s, startDate: shift(start, days), endDate: shift(end, days) };
  });
}

/** The span a list covers, as calendar days. */
function spanOf(list: readonly EditorStation[]): { start: string | null; end: string | null } {
  const days = list.flatMap((s) => [day(s.startDate), day(s.endDate)]).filter(Boolean) as string[];
  if (days.length === 0) return { start: null, end: null };
  const sorted = [...days].sort();
  return { start: sorted[0], end: sorted[sorted.length - 1] };
}

/** Two closed day ranges share a day. */
function overlaps(
  a: { start: string | null; end: string | null },
  b: { start: string | null; end: string | null }
): boolean {
  if (!a.start || !b.start) return false;
  const aEnd = a.end ?? a.start;
  const bEnd = b.end ?? b.start;
  return a.start <= bEnd && b.start <= aEnd;
}

/** A station's nights as `[arrival, departure)`; null when it is no night or not dated. */
function nightsOf(s: EditorStation): { from: string; to: string } | null {
  if (s.night.kind !== "stay" && s.night.kind !== "free") return null;
  const from = day(s.startDate);
  const to = day(s.endDate);
  return from && to && to > from ? { from, to } : null;
}

export interface ShiftPreview {
  rows: ShiftRow[];
  notices: ShiftNotice[];
  shifted: EditorStation[];
}

/**
 * The preview the reader sees before anything moves: each dated station's old
 * and new days, and every reason to look twice — never a block, the reader
 * decides. Only an overlap the shift CREATES is named; one that was already
 * there is not news.
 */
export function shiftPreview(
  drafts: readonly EditorStation[],
  fromIndex: number,
  days: number,
  context: {
    stays: readonly StayRef[];
    ownTrip: SpanRef | null;
    trips: readonly SpanRef[];
    roadtrips: readonly SpanRef[];
  }
): ShiftPreview {
  const shifted = shiftStations(drafts, fromIndex, days);
  const rows: ShiftRow[] = drafts.flatMap((s, i) => {
    if (i < fromIndex) return [];
    const before = { start: day(s.startDate), end: day(s.endDate) };
    if (before.start === null && before.end === null) return [];
    return [
      {
        station: s,
        before,
        after: { start: day(shifted[i].startDate), end: day(shifted[i].endDate) },
      },
    ];
  });
  const notices: ShiftNotice[] = [];
  if (days === 0) return { rows, notices, shifted };

  // The station in front: the last dated one before the chosen station.
  const previous = [...drafts.slice(0, fromIndex)].reverse().find((s) => day(s.startDate) !== null);
  const movedAt = shifted.findIndex((s, i) => i >= fromIndex && day(s.startDate) !== null);
  if (previous && movedAt >= 0) {
    const moved = shifted[movedAt];
    const prevEnd = (day(previous.endDate) ?? day(previous.startDate)) as string;
    const start = day(moved.startDate) as string;
    const oldStart = day(drafts[movedAt].startDate) as string;
    if (start < prevEnd) {
      notices.push({ kind: "beforePrevious", station: moved, previous });
    } else if (daysBetween(prevEnd, start) > Math.max(0, daysBetween(prevEnd, oldStart))) {
      // Days with no station where there were none before: not wrong, but news.
      notices.push({ kind: "gap", station: moved, previous, days: daysBetween(prevEnd, start) });
    }
  }

  const linkedIds = new Set(
    drafts.flatMap((s) =>
      s.night.kind === "stay" && s.night.lodgingStayId ? [s.night.lodgingStayId] : []
    )
  );
  for (const [i, s] of shifted.entries()) {
    if (i < fromIndex) continue;
    const night = s.night;
    if (night.kind === "stay" && night.lodgingStayId) {
      const stay = context.stays.find((x) => x.id === night.lodgingStayId) ?? null;
      const fits =
        stay !== null && stay.checkIn === day(s.startDate) && stay.checkOut === day(s.endDate);
      notices.push({ kind: "linkedStay", station: s, stay, fits });
    }
    const nights = nightsOf(s);
    const before = nightsOf(drafts[i]);
    if (!nights) continue;
    for (const stay of context.stays) {
      if (stay.cancelled || linkedIds.has(stay.id) || !stay.checkIn || !stay.checkOut) continue;
      const hits = (n: { from: string; to: string } | null): boolean =>
        n !== null && n.from < (stay.checkOut as string) && (stay.checkIn as string) < n.to;
      if (hits(nights) && !hits(before)) notices.push({ kind: "otherStay", station: s, stay });
    }
  }

  const oldSpan = spanOf(drafts);
  const newSpan = spanOf(shifted);
  if (context.ownTrip?.start && newSpan.start) {
    const tripEnd = context.ownTrip.end ?? context.ownTrip.start;
    const inside = (span: typeof newSpan): boolean =>
      span.start !== null &&
      span.start >= (context.ownTrip?.start as string) &&
      (span.end ?? span.start) <= tripEnd;
    if (inside(oldSpan) && !inside(newSpan)) {
      notices.push({ kind: "outsideTrip", trip: context.ownTrip });
    }
  }
  for (const trip of context.trips) {
    if (trip.id === context.ownTrip?.id) continue;
    if (overlaps(newSpan, trip) && !overlaps(oldSpan, trip)) {
      notices.push({ kind: "overlapsTrip", trip });
    }
  }
  for (const roadtrip of context.roadtrips) {
    if (overlaps(newSpan, roadtrip) && !overlaps(oldSpan, roadtrip)) {
      notices.push({ kind: "overlapsRoadtrip", roadtrip });
    }
  }
  return { rows, notices, shifted };
}
