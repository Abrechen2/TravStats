/**
 * The dashboard domain filter's own vocabulary — seven rows, fixed order.
 *
 * ClaudeDesign/handoff/2026-09-27-dashboard-domain-filter-rueckmeldung.md,
 * decision 5: "Reihenfolge fest, wie die heutigen Tabs: Flüge, Kreuzfahrten,
 * Unterkünfte, Orte, Touren, Roadtrips."
 *
 * `rail` was left out of that list and joined on 2026-09-28 (owner: "Bahn
 * fehlt im Filter"). Leaving it out had stopped being tenable twice over:
 * rail is a domain with a tab, a logbook and a map layer like any other, and
 * the control that DID govern its layer — the map-options domain pills — was
 * removed the same day, so without this row the Bahn layer had no switch at
 * all. It goes last because that is where its tab sits.
 *
 * `tour` has no `DomainKey` of its own (`shared/domains.ts`) — a day tour is
 * not a domain in the gating sense, it is a colour the map needs. This type
 * is therefore its own union, not `DomainKey`.
 */
export const FILTER_DOMAIN_ORDER = [
  "flight",
  "cruise",
  "lodging",
  "poi",
  "tour",
  "roadtrip",
  "rail",
  "rental",
] as const;

export type FilterDomainKey = (typeof FILTER_DOMAIN_ORDER)[number];

export function isFilterDomainKey(value: string): value is FilterDomainKey {
  return (FILTER_DOMAIN_ORDER as readonly string[]).includes(value);
}

/** localStorage key — a viewer preference, per browser/device (decision 2). */
export const HIDDEN_DOMAINS_STORAGE_KEY = "travstats.dashboard.hiddenDomains.v1";

/**
 * Parses the persisted hidden-domain list. Storage carries the ABGEWÄHLTE
 * (hidden) set, not the visible one — decision 6/"Bau-Vorgaben": a newly
 * unlocked domain (beta switched on, area enabled) then appears
 * automatically, because the default is always "everything visible".
 * Anything that is not a recognised key (a stale value from a future
 * version, a corrupted blob) is dropped rather than surfaced — a storage
 * read must never crash the page.
 */
export function parseHiddenDomains(raw: string | null): ReadonlySet<FilterDomainKey> {
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter((v): v is FilterDomainKey => typeof v === "string" && isFilterDomainKey(v))
    );
  } catch {
    return new Set();
  }
}

export function serializeHiddenDomains(hidden: ReadonlySet<FilterDomainKey>): string {
  return JSON.stringify(FILTER_DOMAIN_ORDER.filter((key) => hidden.has(key)));
}

/**
 * Parses `?domains=flight,cruise` (the VISIBLE keys, unlike storage) into a
 * set. `null` means the parameter is absent — "ohne Parameter gilt immer die
 * eigene Auswahl" (decision 3), distinct from an empty string, which is a
 * link whose sender had hidden everything and is a legitimate (if odd)
 * state, not "no link". Unknown tokens are dropped silently — a stale or
 * foreign link degrades to fewer rows rather than failing.
 */
export function parseDomainsParam(raw: string | null): ReadonlySet<FilterDomainKey> | null {
  if (raw === null) return null;
  const keys = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is FilterDomainKey => isFilterDomainKey(s));
  return new Set(keys);
}

export function serializeDomainsParam(visible: ReadonlySet<FilterDomainKey>): string {
  return FILTER_DOMAIN_ORDER.filter((key) => visible.has(key)).join(",");
}
