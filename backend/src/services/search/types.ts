import type { DomainKey } from "../../shared/domains";
import { localDay } from "../../shared/time/instant";
import { serializeDay, type LocalDateValue } from "../../shared/time/wire";
import { fromDbDate } from "../../shared/time/localDate";

/**
 * What a search hit belongs to. `trip` and `tour` are not domains in the
 * gating sense (a trip is the container, a tour has no enable switch) but a
 * client colours and groups by them all the same.
 */
export type SearchDomain = DomainKey | "trip" | "tour";

export const SEARCH_DOMAINS: readonly SearchDomain[] = [
  "flight",
  "cruise",
  "lodging",
  "poi",
  "rail",
  "bus",
  "ferry",
  "rental",
  "roadtrip",
  "tour",
  "trip",
] as const;

/** The entity a hit opens. `poi` holds two kinds: a place and a place list. */
export type SearchKind =
  | "flight"
  | "cruise"
  | "lodging"
  | "place"
  | "placeList"
  | "rail"
  | "bus"
  | "ferry"
  | "rental"
  | "roadtrip"
  | "tour"
  | "trip";

export interface SearchHit {
  domain: SearchDomain;
  kind: SearchKind;
  id: string;
  title: string;
  subtitle: string | null;
  /** The local day the entry starts on, in its own place's zone (`zone` null: no place known); null when it has none. */
  date: LocalDateValue | null;
  /** Web route that opens the entry, e.g. `/flights/<id>`. */
  path: string;
}

/** One searcher's answer: at most `limit` hits, and whether a further one existed. */
export interface DomainSearchResult {
  hits: SearchHit[];
  more: boolean;
}

export type DomainSearcher = (
  userId: string,
  q: string,
  limit: number
) => Promise<DomainSearchResult>;

export function joinParts(parts: Array<string | null | undefined>, sep = " · "): string | null {
  const kept = parts.map((p) => p?.trim()).filter((p): p is string => !!p);
  return kept.length > 0 ? kept.join(sep) : null;
}

/** The local day of an instant at a place (zone null: the UTC day, labelled by `zone: null`). */
export function dayAt(
  instant: Date | null | undefined,
  zone: string | null | undefined,
  precision: LocalDateValue["precision"] = "day"
): LocalDateValue | null {
  if (!instant) return null;
  const z = zone ?? null;
  return serializeDay(z ? localDay(instant, z) : instant.toISOString().slice(0, 10), z, precision);
}

/** A `@db.Date` column as a day in its stored zone. */
export function dbDay(
  value: Date | null | undefined,
  zone: string | null | undefined
): LocalDateValue | null {
  return value ? serializeDay(fromDbDate(value), zone ?? null) : null;
}

/** Splits `limit + 1` fetched rows into the shown rows and the "more exist" flag. */
export function page<T>(rows: T[], limit: number): { rows: T[]; more: boolean } {
  return { rows: rows.slice(0, limit), more: rows.length > limit };
}

/** The shortest query that is searched: one letter matches half a logbook. */
export const MIN_QUERY_LENGTH = 2;
/** Hits per domain, default and ceiling. */
export const DEFAULT_PER_DOMAIN = 5;
export const MAX_PER_DOMAIN = 20;
/** No answer carries more hits than this, whatever `limit` times the domains says. */
export const TOTAL_CAP = 60;
