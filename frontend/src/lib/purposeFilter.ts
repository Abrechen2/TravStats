import { useLayoutEffect } from "react";
import type { Location } from "react-router-dom";
import { PURPOSES } from "../shared/purpose";
import { isPurposeValue } from "../shared/purposeCatalogue";

/**
 * "Nach Zweck filtern" (spec 2026-11-22-private-business-purpose.md): the purpose a list page, the
 * trips list or the dashboard is narrowed to. It lives in the page URL (`?purpose=`), so a link or
 * a reload keeps it. While a page that takes it is shown, the API client adds `purposeFilter` to
 * every GET of the entry routes and the server narrows each of them alike — lists, their counts,
 * the map and the totals agree. Like "Nur belegte", it never outlives the page.
 */

/** The URL parameter on the page. */
export const PURPOSE_FILTER_PARAM = "purpose";
/** Entries without a purpose. */
export const PURPOSE_FILTER_UNKNOWN = "unknown";

/** The pages that take the filter (path prefixes). */
const PAGES = [
  "/flights",
  "/rail",
  "/lodging",
  "/bus",
  "/ferry",
  "/rentals",
  "/cruises",
  "/places",
  "/trips",
  "/tours",
  "/roadtrips",
  "/dashboard",
] as const;

/** Mirrors `ENTRY_SCOPE_PREFIXES` in the backend (`services/provenance/recordedOnly.ts`). */
const API_PREFIXES = [
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
  "/activity",
  "/upcoming",
  "/map-details",
  "/gap-calendar",
  "/companions",
  "/tours",
  "/roadtrips",
  "/place-lists",
] as const;

const startsWithPrefix = (path: string, prefixes: readonly string[]): boolean =>
  prefixes.some((p) => path === p || path.startsWith(`${p}/`) || path.startsWith(`${p}?`));

/** Is this a value the filter takes: a purpose key, a kind or `unknown`? */
export const isPurposeFilterValue = (v: string | null): v is string =>
  !!v &&
  (v === PURPOSE_FILTER_UNKNOWN ||
    (PURPOSES as readonly string[]).includes(v) ||
    isPurposeValue(v));

/** Does the page at `pathname` take a purpose filter? */
export const pageTakesPurposeFilter = (pathname: string): boolean =>
  startsWithPrefix(pathname, PAGES);

/** The filter a location asks for; null when none, or when the page does not take one. */
export function purposeFilterOf(location: Pick<Location, "pathname" | "search">): string | null {
  if (!pageTakesPurposeFilter(location.pathname)) return null;
  const value = new URLSearchParams(location.search).get(PURPOSE_FILTER_PARAM);
  return isPurposeFilterValue(value) ? value : null;
}

let active: string | null = null;

export function setPurposeFilter(value: string | null): void {
  active = value;
}

/** The `purposeFilter` a request must carry, or null. */
export function purposeFilterFor(
  method: string | undefined,
  url: string | undefined
): string | null {
  if (!active || (method ?? "get").toLowerCase() !== "get" || !url) return null;
  const path = url.startsWith("/") ? url : `/${url}`;
  return startsWithPrefix(path, API_PREFIXES) ? active : null;
}

/**
 * Holds the switch for the page that is shown. Returns the value, which the router puts into the
 * routes' key: a changed filter re-mounts the page, so every figure is read again under it.
 * A layout effect runs before any child's (fetching) passive effect.
 */
export function usePurposeFilterSync(
  location: Pick<Location, "pathname" | "search">
): string | null {
  const value = purposeFilterOf(location);
  useLayoutEffect(() => {
    setPurposeFilter(value);
  }, [value]);
  return value;
}
