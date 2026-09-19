/**
 * Where the flight form remembers which of its groups you left open
 * (forgejo#88, point 9).
 *
 * Its own module because two callers need the same answer and must not drift:
 * `FlightFormSection` writes it when the user clicks the heading, and
 * `focusFirstMissingRequired` writes it when a refused save has to unfold a
 * group to reach the field that is missing. A second copy of the key prefix
 * would be a bug that only shows up as "it forgot", which nobody reports.
 *
 * `sessionStorage`, not `localStorage`: this is "what I am doing today", and a
 * preference that outlives the browser should be a setting rather than the side
 * effect of a click. Every access is wrapped — a private window, blocked site
 * data or a quota error must cost the fold, never the form.
 */

const STORAGE_PREFIX = "travstats.flightForm.section.";

/** What the session decided for this group, or null if it never has. */
export function readSectionFold(id: string): boolean | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_PREFIX + id);
    return raw === null ? null : raw === "open";
  } catch {
    return null;
  }
}

export function writeSectionFold(id: string, open: boolean): void {
  try {
    window.sessionStorage.setItem(STORAGE_PREFIX + id, open ? "open" : "closed");
  } catch {
    // A session that cannot remember is still a session that works.
  }
}
