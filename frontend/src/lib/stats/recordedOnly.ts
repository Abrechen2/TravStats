/**
 * "Nur belegte" on the statistics page (docs/superpowers/specs/2026-11-22-remembered-facts.md).
 *
 * One module-level switch, held only while the statistics page is mounted
 * (`RecordedOnlyBoundary`). While it is on, the API client adds `onlyRecorded=true` to every GET
 * of the routes the page reads, and the server narrows each of them the same way. It is never
 * persisted and never outlives the page, so another page's lists are not filtered by accident.
 */
let active = false;

/** Mirrors `RECORDED_ONLY_PREFIXES` in the backend (`services/provenance/recordedOnly.ts`). */
const PREFIXES = [
  "/stats",
  "/achievements",
  "/flights",
  "/cruises",
  "/trips",
  "/rail",
  "/bus",
  "/ferry",
  "/rentals",
  "/lodging",
  "/places",
] as const;

export function setRecordedOnly(on: boolean): void {
  active = on;
}

/** True when a GET of `url` (relative to `/api/v1`) must carry `onlyRecorded=true`. */
export function wantsRecordedOnly(method: string | undefined, url: string | undefined): boolean {
  if (!active || (method ?? "get").toLowerCase() !== "get" || !url) return false;
  const path = url.startsWith("/") ? url : `/${url}`;
  return PREFIXES.some((p) => path === p || path.startsWith(`${p}/`) || path.startsWith(`${p}?`));
}
