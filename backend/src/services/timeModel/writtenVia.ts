/**
 * Who wrote a row whose time meaning depended on the writer (ADR 0002 Q4).
 *
 * `PlaceVisit.visitedAt` is the column that taught this: the web stored the
 * place's wall clock as fake UTC, the Companion a real instant, and once
 * written the two cannot be told apart. Every visit write from phase 2 on
 * records its writer, so the phase-3b backfill never has to guess for them.
 */

export const WRITTEN_VIA = ["web", "companion", "import", "suggestion", "api"] as const;
export type WrittenVia = (typeof WRITTEN_VIA)[number];

/** The request's writer: a paired device is the Companion, any other token a script. */
export function writtenViaOf(req: { apiToken?: { deviceId?: string | null } }): WrittenVia {
  if (!req.apiToken) return "web";
  return req.apiToken.deviceId ? "companion" : "api";
}
