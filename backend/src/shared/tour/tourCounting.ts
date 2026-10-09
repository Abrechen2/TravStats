import { todayAt } from "./roadtripTimeline";

/**
 * Whether a day tour has happened (forgejo#264, and the tours a roadtrip
 * station set out from in #260) — the ONE rule every tour figure and badge
 * asks.
 *
 *   - `completed` — a recording of it exists (a GPS track is proof it was
 *     walked, ridden or driven), or its day lies before today at its place.
 *   - `planned`   — its day is today or later and nothing was recorded yet.
 *     A guided excursion booked for Thursday is exactly this until Friday.
 *   - `undated`   — no day and no recording: a sketched line. It counts as
 *     nothing, and the screen says how many there are.
 *
 * Deliberately stricter than an undated stay or visit, which count: those are
 * records of something that happened; a tour without a day or a track is as
 * often a route someone drew to try out. `now` is a parameter so a test can
 * pin midnight.
 */
export type TourState = "completed" | "planned" | "undated";

export interface CountableTour {
  /** The local day at its place (`@db.Date`), or null. */
  tourDate: Date | null;
  /** The zone of its place, when known — today is asked there. */
  zone: string | null;
  tracks: ReadonlyArray<{ startedAt: Date }>;
}

export function classifyTour(tour: CountableTour, now: Date): TourState {
  if (tour.tracks.some((t) => t.startedAt.getTime() <= now.getTime())) return "completed";
  if (tour.tourDate === null) return "undated";
  const day = tour.tourDate.toISOString().slice(0, 10);
  return day < todayAt(tour.zone, now) ? "completed" : "planned";
}
