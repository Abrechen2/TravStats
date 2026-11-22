import type { DomainKey } from "../../shared/domains";
import type { LocalDateValue } from "../../shared/time/wire";

/**
 * The dashboard's "Aktivität" list as the server sees it: one row per ENTRY of
 * every domain the account may see, newest first, planned ones on top.
 *
 * Order is `sortAt` DESCENDING (an instant), then `DOMAIN_RANK`, then the id
 * descending, rows without a date last. That is a total order, which is what
 * makes a cursor correct: the same row can neither repeat nor be skipped at a
 * page boundary. A plain descending sort already puts what has not happened
 * yet above what has — the owner's rule — so "planned" is a label, not a
 * second sort key. What the row SHOWS is `date`, the entry's own local day;
 * `sortAt` only orders.
 */

/** The domains that produce rows. `trip` is a container, not an activity, and has none. */
export const FEED_DOMAINS = [
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
] as const satisfies readonly DomainKey[];
export type FeedDomain = (typeof FEED_DOMAINS)[number];

/** Tie-break between domains at one instant: the registry order above. */
export const DOMAIN_RANK: Record<FeedDomain, number> = Object.fromEntries(
  FEED_DOMAINS.map((d, i) => [d, i])
) as Record<FeedDomain, number>;

export interface FeedPoint {
  lat: number;
  lon: number;
}

export interface FeedItem {
  /** `domain:id` — unique across domains, the client's React key. */
  key: string;
  domain: FeedDomain;
  /** The entry's own id (a stay's id for lodging, a visit's id for places). */
  id: string;
  /** The row a click should select: the lodging for a stay, the place for a visit. */
  subjectId: string;
  title: string;
  subtitle: string | null;
  /** Where it happened, as text — a route, a town, a station. */
  place: string | null;
  /** The entry's local day, in its own place's zone; null when it has none. */
  date: LocalDateValue | null;
  /** The instant that orders the row (ISO), or null for an undated entry. */
  sortAt: string | null;
  /** Booked and still ahead: `sortAt` is after the server's now. */
  planned: boolean;
  /** A single place to zoom to. Null when the entry has no coordinates, or is a route (see `bbox`). */
  point: FeedPoint | null;
  /** A route's extent `[west, south, east, north]` to fit the camera to. */
  bbox: [number, number, number, number] | null;
  /** Web route that opens the entry. */
  path: string;
}

export interface FeedCursor {
  /** `sortAt` of the last row, ms since epoch; null once the undated tail was reached. */
  t: number | null;
  r: number;
  i: string;
}

export function encodeCursor(cursor: FeedCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export function decodeCursor(raw: string): FeedCursor | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    const { t, r, i } = parsed as Record<string, unknown>;
    if (!(t === null || (typeof t === "number" && Number.isFinite(t)))) return null;
    if (typeof r !== "number" || !Number.isInteger(r) || typeof i !== "string") return null;
    return { t, r, i };
  } catch {
    return null;
  }
}

/**
 * The rows of one domain that sort AFTER the cursor, as a Prisma `where`
 * fragment on its date column `field` (and `id`).
 *
 * The order is (date desc, dated before undated, rank asc, id desc), so what
 * follows the cursor row depends on whether this domain's rank sits before,
 * at or after the cursor's at a shared instant. `nullable` says whether the
 * column can be null at all.
 */
export function afterCursor(
  field: string,
  rank: number,
  cursor: FeedCursor | null,
  nullable: boolean
): Record<string, unknown> {
  if (cursor === null) return {};
  const undated = nullable ? [{ [field]: null }] : [];
  if (cursor.t === null) {
    // Inside the undated tail: same domain continues by id, a later domain starts over.
    if (rank < cursor.r) return { id: { in: [] } };
    return { [field]: null, ...(rank === cursor.r ? { id: { lt: cursor.i } } : {}) };
  }
  const at = new Date(cursor.t);
  const older = { [field]: { lt: at } };
  if (rank === cursor.r) {
    return { OR: [older, { [field]: at, id: { lt: cursor.i } }, ...undated] };
  }
  if (rank < cursor.r) return { OR: [older, ...undated] };
  return { OR: [{ [field]: { lte: at } }, ...undated] };
}

/** Whether a row of `rank`/`id` at `t` sorts after the cursor — `afterCursor` for rows already in memory. */
export function isAfterCursor(
  t: number | null,
  rank: number,
  id: string,
  cursor: FeedCursor | null
): boolean {
  if (cursor === null) return true;
  if (cursor.t === null) {
    if (t !== null) return false;
    return rank > cursor.r || (rank === cursor.r && id < cursor.i);
  }
  if (t === null) return true;
  if (t !== cursor.t) return t < cursor.t;
  return rank > cursor.r || (rank === cursor.r && id < cursor.i);
}
