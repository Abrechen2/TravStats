/**
 * Canonical airline spelling — the ONE grouping key for "which airline was
 * this?" (#268, forgejo#81).
 *
 * The statistics page used to count carriers two ways on one screen: the KPI
 * tile grouped the raw `flight.airline` string in the browser, while the
 * loyalty ranking below it grouped the server's normalised name. "Lufthansa"
 * and "Deutsche Lufthansa" were therefore two airlines in the tile and one in
 * the list directly underneath.
 *
 * The alias table fixed the spellings it knew and left the question of
 * identity to the NAME. On one real account that gave four surfaces four
 * answers — 31, 27, 26 and 25 airlines — because "SWISS" and "Swiss" are two
 * names, "LOT" and "LOT - Polish Airlines" are two names, and a null airline
 * is a name too (the empty string, drawn as an empty row). Since 2026-09-04
 * identity is the CODE: two rows are the same airline when they share an
 * IATA code, whether that code is stored in `airlineIata`, resolvable from
 * `airlineIcao`, or resolvable from the name through the catalogue. The
 * normalised name is only the fallback for a carrier no catalogue knows.
 *
 * Only the alias table and the pure functions live here. Code resolution
 * needs the airline catalogue, which each side owns in its own form
 * (`backend/src/utils/airlineNormalize.ts` `resolveAirlineCodes`,
 * `frontend/src/lib/airlineUtils.ts` `resolveAirlineIata`), so the functions
 * take the resolver as an argument instead of importing one.
 *
 * MIRRORED in `frontend/src/shared/airlineNormalize.ts` (the convention of
 * `shared/ratingDerivation.ts`). Both copies are covered by tests asserting the
 * same groupings.
 */

/**
 * Lowercased variant → canonical display name. Only add entries known to
 * actually appear in the database (different import sources, user typos).
 * NOT used for IATA/ICAO resolution — that goes through the catalogue.
 */
export const AIRLINE_ALIASES: Record<string, string> = {
  'egyptair': 'EgyptAir',
  'egypt air': 'EgyptAir',
  'air canada': 'Air Canada',
  'vietnam airline': 'Vietnam Airlines',
  'vietnam airlines': 'Vietnam Airlines',
  'dba': 'dba',
  'sas scandinavian airlines': 'SAS Scandinavian Airlines',
  'lot polish airlines': 'LOT Polish Airlines',
  'lot - polish airlines': 'LOT Polish Airlines',
  'lot': 'LOT Polish Airlines',
  'swiss': 'SWISS',
  'swiss international air lines': 'SWISS',
};

/**
 * Normalize an airline name to its canonical display form. Returns the
 * input trimmed (unchanged casing) if no alias maps it.
 */
export function normalizeAirline(name: string): string {
  const key = name.trim().toLowerCase();
  return AIRLINE_ALIASES[key] ?? name.trim();
}

/**
 * Merge airline counts that differ only by spelling/casing. Groups are
 * collapsed into the canonical name.
 */
export function mergeAirlineCounts(
  counts: Record<string, number>,
): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const [name, count] of Object.entries(counts)) {
    const canonical = normalizeAirline(name);
    merged[canonical] = (merged[canonical] || 0) + count;
  }
  return merged;
}

/** The three columns a flight carries about its carrier. */
export interface AirlineIdentity {
  airline: string | null | undefined;
  airlineIata?: string | null;
  airlineIcao?: string | null;
}

/** What the catalogue on either side has to answer. */
export interface AirlineResolvers {
  /** IATA code for a free-text name or a code-shaped string, or nothing. */
  iataForName: (name: string) => string | null | undefined;
  /** ICAO → IATA, or nothing. */
  iataForIcao: (icao: string) => string | null | undefined;
  /** The catalogue's display name for an IATA code, or nothing. */
  nameForIata: (iata: string) => string | null | undefined;
}

/**
 * The key two rows must share to be the same airline.
 *
 * `iata:LX` when a code is stored, resolvable from the ICAO column, or
 * resolvable from the name; `name:swiss air lines` when no catalogue knows
 * the carrier; `null` when the row names no airline at all — a nameless row
 * is not an airline and must never become a group (the empty row of
 * forgejo#81).
 */
export function airlineGroupKey(
  row: AirlineIdentity,
  resolvers: AirlineResolvers,
): string | null {
  const iata = row.airlineIata?.trim().toUpperCase();
  if (iata) return `iata:${iata}`;
  const icao = row.airlineIcao?.trim().toUpperCase();
  if (icao) {
    const fromIcao = resolvers.iataForIcao(icao);
    if (fromIcao) return `iata:${fromIcao.toUpperCase()}`;
  }
  const name = row.airline?.trim();
  if (!name) return null;
  // The raw spelling first, then the alias table's canonical one: the
  // catalogue knows "LOT Polish Airlines", the mail said "LOT - Polish Airlines".
  const fromName = resolvers.iataForName(name) ?? resolvers.iataForName(normalizeAirline(name));
  if (fromName) return `iata:${fromName.toUpperCase()}`;
  return `name:${normalizeAirline(name).toLowerCase()}`;
}

export interface AirlineGroup {
  key: string;
  /** The catalogue's name for a code-keyed group, else the most frequent normalised spelling. */
  label: string;
  /** The IATA code when the group is keyed by one. */
  iata: string | null;
  count: number;
}

/**
 * Fold rows into airline groups. `count` is per row (1 for a flight, the
 * grouped count for a database aggregate). Rows with no airline are not
 * grouped; they are returned as `withoutAirline` so a surface can say what
 * it left out rather than rank a carrier called "".
 */
export function groupAirlines(
  rows: ReadonlyArray<AirlineIdentity & { count: number }>,
  resolvers: AirlineResolvers,
): { groups: AirlineGroup[]; withoutAirline: number } {
  const acc = new Map<string, { count: number; spellings: Map<string, number> }>();
  let withoutAirline = 0;

  for (const row of rows) {
    const key = airlineGroupKey(row, resolvers);
    if (key === null) {
      withoutAirline += row.count;
      continue;
    }
    const entry = acc.get(key) ?? { count: 0, spellings: new Map<string, number>() };
    entry.count += row.count;
    const spelling = row.airline?.trim() ? normalizeAirline(row.airline) : null;
    if (spelling) entry.spellings.set(spelling, (entry.spellings.get(spelling) ?? 0) + row.count);
    acc.set(key, entry);
  }

  const groups: AirlineGroup[] = [];
  for (const [key, entry] of acc.entries()) {
    const iata = key.startsWith('iata:') ? key.slice(5) : null;
    const catalogueName = iata ? resolvers.nameForIata(iata) : null;
    const mostFrequent = [...entry.spellings.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    groups.push({
      key,
      iata,
      label: catalogueName ?? mostFrequent ?? iata ?? key,
      count: entry.count,
    });
  }
  groups.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return { groups, withoutAirline };
}
