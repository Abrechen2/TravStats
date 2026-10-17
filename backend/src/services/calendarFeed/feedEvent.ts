import { DOMAINS, type DomainKey } from "../../shared/domains";
import { endOfBounds } from "./eventBounds";
import type { EventBounds, IcsEvent } from "./ics";

/**
 * What every per-domain reader of the calendar feed shares (forgejo#310).
 *
 * The event text is language-neutral on purpose — names, codes, places and
 * the domain's icon — because the feed is read by a calendar app, outside the
 * DE/EN interface, and a label in one language would be wrong for the other.
 */

export interface FeedContext {
  userId: string;
  /** Entries that ended before this instant are left out (the look-back window). */
  cutoff: Date;
  /** The instance's public address, for the link back to each entry. */
  baseUrl: string;
}

/**
 * At most this many rows per domain and query. A bound on the work, not a
 * product limit: a year ahead of a very busy traveller is a few hundred
 * entries. Each query orders by its start and id, so the bound is total.
 */
export const FEED_ROW_LIMIT = 1000;

/**
 * The database filter starts this much before the cutoff. The precise test is
 * `isInWindow` on the event's real end; the margin lets a legacy fake-UTC time
 * (off by the zone's offset) or a day anchor reach that test instead of being
 * dropped by the coarse filter.
 */
const QUERY_MARGIN_MS = 2 * 86_400_000;

export const queryCutoff = (ctx: FeedContext): Date =>
  new Date(ctx.cutoff.getTime() - QUERY_MARGIN_MS);

export const isInWindow = (bounds: EventBounds, ctx: FeedContext): boolean =>
  endOfBounds(bounds) > ctx.cutoff;

export const iconOf = (domain: DomainKey): string => DOMAINS[domain].icon;

/** The non-empty parts, joined — so a missing field never leaves a dangling separator. */
export const joined = (separator: string, ...parts: Array<string | null | undefined>): string =>
  parts
    .map((p) => p?.trim())
    .filter((p): p is string => !!p)
    .join(separator);

/** A link back to the entry's page in this instance. */
export const pageUrl = (ctx: FeedContext, path: string): string => `${ctx.baseUrl}${path}`;

export interface FeedEventInput {
  uid: string;
  summary: string;
  bounds: EventBounds | null;
  location?: string | null;
  /** Lines of the description; empty ones are dropped. */
  details?: Array<string | null | undefined>;
  path: string;
  updatedAt?: Date | null;
}

/**
 * One calendar event, or null when the entry has no bounds a calendar can show
 * or ended before the window — the caller filters the nulls out.
 */
export function feedEvent(input: FeedEventInput, ctx: FeedContext): IcsEvent | null {
  if (!input.bounds || !isInWindow(input.bounds, ctx)) return null;
  const url = pageUrl(ctx, input.path);
  return {
    uid: `${input.uid}@travstats`,
    summary: input.summary,
    bounds: input.bounds,
    location: input.location ?? null,
    description: joined("\n", ...(input.details ?? []), url),
    url,
    lastModified: input.updatedAt ?? null,
  };
}

export const present = <T>(value: T | null): value is T => value !== null;
