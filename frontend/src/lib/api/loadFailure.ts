import axios from "axios";

/**
 * Telling "this entry is gone" apart from "I could not ask".
 *
 * Both detail pages used to turn EVERY failure into `notFound`, so a dropped
 * connection answered "Kreuzfahrt nicht gefunden" — the page denying a record
 * that exists. That is the same lie the domain lists told when a filter
 * emptied them ("Noch keine Kreuzfahrten erfasst" over 22 rows), one level
 * further in.
 *
 * The distinction matters because the two states offer different ways out:
 * "gone" sends you back to the list, "could not load" invites a retry. Fusing
 * them removes the retry from a situation that is almost always temporary.
 *
 * The vocabulary is deliberately two-valued rather than a kind-per-status. The
 * page has exactly two things to render; a richer taxonomy (see
 * `immichFailureKind`, which needs six) would only be an invitation to invent
 * screens nobody asked for.
 */

/** True only for a real HTTP 404 — the record is genuinely not there. */
export function isNotFound(error: unknown): boolean {
  return axios.isAxiosError(error) && error.response?.status === 404;
}

export type LoadFailure = "notFound" | "loadError";

/**
 * Classify a failed detail fetch. Anything that is not a 404 — a network drop,
 * a 500, a timeout, a parse error — is a load error, because none of them say
 * anything about whether the record exists.
 */
export function classifyLoadFailure(error: unknown): LoadFailure {
  return isNotFound(error) ? "notFound" : "loadError";
}
