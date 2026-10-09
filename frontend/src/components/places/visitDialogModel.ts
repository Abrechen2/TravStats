import { wallClockInput } from "../../lib/api/timeInput";
import { splitTimeValue } from "../../lib/tripTimeline";
import { visitTime } from "../../lib/entityTimes";
import type { PlaceVisit, VisitInput } from "../../types/place";

/**
 * When the visit was (forgejo#231): the three answers a quick record needs.
 *
 * - `today`: the user's today, in the zone "today" is always asked in
 *   (`todayIn(useTodayZone())`, ADR 0002 Q1) — never the browser's.
 * - `other`: a day the user types or picks from the suggestions.
 * - `unknown`: "I was here, no idea when" — sent as `null`, never as a made-up
 *   day. Such a visit still counts (`shared/placeCounting.ts`).
 */
export type VisitDateMode = "today" | "other" | "unknown";

/** The trip picker's "on no trip" — distinct from "" (let the server file it by date). */
export const NO_TRIP = "none";

export interface VisitDraft {
  mode: VisitDateMode;
  /** `YYYY-MM-DD`, used in `other` mode. */
  date: string;
  /** `HH:mm` or "", used in `today` and `other` mode. */
  time: string;
  notes: string;
  /** "" = file by date (create only), `NO_TRIP`, or a trip id. */
  tripId: string;
}

/**
 * ONE function for the dialog's starting values and the dirty guard's
 * baseline. A new visit starts on "today" — the quick record this dialog
 * exists for; an existing one opens on what it stores, an undated one on
 * "unknown", so opening and closing it changes nothing.
 */
export function visitDraft(visit: PlaceVisit | null | undefined): VisitDraft {
  if (!visit) return { mode: "today", date: "", time: "", notes: "", tripId: "" };
  const shown = visitTime(visit);
  const { date, time } = shown ? splitTimeValue(shown) : { date: "", time: "" };
  return {
    mode: date ? "other" : "unknown",
    date,
    time,
    notes: visit.notes ?? "",
    tripId: visit.tripId ?? NO_TRIP,
  };
}

/** The calendar day the draft names, or null for "unknown" (or an empty "other"). */
export function draftDay(draft: VisitDraft, today: string): string | null {
  if (draft.mode === "today") return today;
  if (draft.mode === "other") return draft.date || null;
  return null;
}

/**
 * Whether the chosen day is still ahead. Only for what the dialog SHOWS — a
 * hint that it will not count yet, and no photo field for a visit that has not
 * happened. What counts is decided by `shared/placeCounting.ts`, never here.
 * Both are `YYYY-MM-DD`, so the string order is the calendar order.
 */
export function isAheadOf(day: string | null, today: string): boolean {
  return day !== null && day > today;
}

/**
 * The request body. The wall clock as typed, at THIS place: the server
 * resolves the place's zone and stores the instant (ADR 0002 D3). A day
 * without a time is the day alone; "unknown" is null.
 *
 * `tripId`: "" leaves it out, so the server files a NEW visit under the one
 * trip whose days hold its day; `NO_TRIP` says "on no trip"; an id is that
 * trip. On an edit "" never occurs — the picker offers it on create only.
 */
export function visitPayload(draft: VisitDraft, today: string, placeId: string): VisitInput {
  const day = draftDay(draft, today);
  const visitedAt =
    day === null
      ? null
      : wallClockInput("visitedAt", day, draft.time, { placeRef: { kind: "place", id: placeId } });
  const trip =
    draft.tripId === "" ? {} : { tripId: draft.tripId === NO_TRIP ? null : draft.tripId };
  return { visitedAt, notes: draft.notes.trim() || null, ...trip };
}
