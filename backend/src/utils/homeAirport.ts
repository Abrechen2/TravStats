/**
 * Home: where the user lived, and which airports they flew from — by date.
 *
 * Owner decision 2026-09-27 ("Zuhause" = Wohnort + Heimatflughäfen): home is a
 * dated history of PERIODS. Each period names a residence (coordinates) and one
 * to three home airports, exactly one of them the primary. There is no radius
 * region: somebody in Köln who flies from CGN and DUS names both airports, and
 * nothing within 60 km of home becomes "home" by accident.
 *
 * The three kinds of question this file answers, and the one rule each follows:
 *
 * - **Airport questions use membership** in the period's airport set — a chain
 *   from CGN back to DUS is a home loop, a change of planes at DUS is not a
 *   layover, DUS is a home airport on the passport.
 * - **Distance questions measure from the residence** — "away from home",
 *   "farthest from home". Measured from an airport, DUS was 54 km "away" from a
 *   CGN home, which is how the rework started.
 * - **Prefills use the primary airport** — the trip form's origin, the home leg
 *   of a fly & cruise.
 *
 * Every question is asked AT A DATE: a move in 2020 must not rewrite 2015.
 *
 * ## Storage and the old shape
 *
 * Periods live in `UserSettings.data.homePeriods`. The key that came before,
 * `homeAirportHistory` (`{iata, fromDate, toDate}`, one airport per entry), is
 * still WRITTEN beside it as a mirror of the primary airports, because older
 * clients (the Companion reads `GET /settings/home-airports`) and an older
 * server after a rollback read nothing else. When `homePeriods` is absent the
 * old key is migrated on read: one period per entry, its airport the primary,
 * the residence the airport's own coordinates, `residenceConfirmed: false`.
 * That residence is what every distance was measured from before the rework,
 * so an unconfirmed account keeps exactly the numbers it had — nothing changes
 * until the user confirms (one inbox question), and nothing is guessed.
 */

/** The legacy entry shape — still served to older clients, still accepted. */
export interface HomeAirportEntry {
  /** IATA code (preferred) or ICAO if IATA unknown. Always uppercased. */
  iata: string;
  /** Inclusive start date in YYYY-MM-DD. */
  fromDate: string;
  /** Exclusive end date in YYYY-MM-DD, or null if still active. */
  toDate: string | null;
}

export interface HomeResidence {
  /** What the user recognises: "Köln", "Ehrenfeld, Köln". */
  name: string;
  lat: number;
  lon: number;
  /** The geocoder's identity for the picked place (`osm:<type>/<id>`), when it had one. */
  placeRef?: string | null;
}

export interface HomeAirportChoice {
  code: string;
  primary: boolean;
}

export interface HomePeriod {
  /** Inclusive start, YYYY-MM-DD. */
  fromDate: string;
  /** Exclusive end, YYYY-MM-DD; null for the period that is still running. */
  toDate: string | null;
  /**
   * Null only for a migrated period whose airport the catalogue does not know:
   * there is nothing to measure from, and a guessed point would be worse.
   */
  residence: HomeResidence | null;
  /** False for a period migrated from the old shape until the user confirms it. */
  residenceConfirmed: boolean;
  /** One to three, exactly one `primary`. */
  airports: HomeAirportChoice[];
}

export interface Coordinate {
  lat: number;
  lon: number;
}

/** What the migration needs to know about an airport. */
export interface AirportForHome {
  lat: number;
  lon: number;
  /** Display name of the airport's town; null when the catalogue has none. */
  name: string | null;
}

export const MAX_HOME_AIRPORTS = 3;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function compareYmd(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function covers(fromDate: string, toDate: string | null, day: string): boolean {
  if (compareYmd(fromDate, day) > 0) return false;
  return toDate === null || compareYmd(toDate, day) > 0;
}

// ─── Questions at a date ──────────────────────────────────────────────────────

/** The period covering `day` (inclusive start, exclusive end), or null. */
export function periodAt(periods: readonly HomePeriod[], day: string): HomePeriod | null {
  return periods.find((p) => covers(p.fromDate, p.toDate, day)) ?? null;
}

/** The period with no end — the home right now — or null. */
export function currentPeriod(periods: readonly HomePeriod[]): HomePeriod | null {
  return periods.find((p) => p.toDate === null) ?? null;
}

export function primaryAirportOf(period: HomePeriod): string {
  return (period.airports.find((a) => a.primary) ?? period.airports[0]).code;
}

/** The home airports at `day` — the set a membership question asks. Empty when none. */
export function homeAirportsAt(periods: readonly HomePeriod[], day: string): ReadonlySet<string> {
  const period = periodAt(periods, day);
  return new Set(period ? period.airports.map((a) => a.code) : []);
}

export function isHomeAirportAt(
  periods: readonly HomePeriod[],
  day: string,
  code: string | null | undefined
): boolean {
  if (!code) return false;
  return homeAirportsAt(periods, day).has(code.toUpperCase());
}

/** The primary airport at `day` — for prefills and for naming a home. */
export function primaryAirportAt(periods: readonly HomePeriod[], day: string): string | null {
  const period = periodAt(periods, day);
  return period ? primaryAirportOf(period) : null;
}

export function currentPrimaryAirport(periods: readonly HomePeriod[]): string | null {
  const period = currentPeriod(periods);
  return period ? primaryAirportOf(period) : null;
}

/** Where the user lived at `day` — what a distance question measures from. */
export function residenceAt(periods: readonly HomePeriod[], day: string): Coordinate | null {
  const residence = periodAt(periods, day)?.residence;
  return residence ? { lat: residence.lat, lon: residence.lon } : null;
}

/** Every airport the user ever called home, newest period first, each once. */
export function allHomeAirports(periods: readonly HomePeriod[]): string[] {
  const codes: string[] = [];
  for (const period of [...periods].reverse()) {
    for (const airport of period.airports) {
      if (!codes.includes(airport.code)) codes.push(airport.code);
    }
  }
  return codes;
}

export function hasUnconfirmedResidence(periods: readonly HomePeriod[]): boolean {
  return periods.some((p) => !p.residenceConfirmed);
}

// ─── The old shape ────────────────────────────────────────────────────────────

export function sortHistory(history: HomeAirportEntry[]): HomeAirportEntry[] {
  return [...history].sort((a, b) => compareYmd(a.fromDate, b.fromDate));
}

/**
 * Validate and normalize a legacy history array loaded from persistence.
 * Drops malformed entries instead of throwing so a single bad record cannot
 * break stats for an entire user.
 */
export function normalizeHistory(raw: unknown): HomeAirportEntry[] {
  if (!Array.isArray(raw)) return [];
  const result: HomeAirportEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const iata = typeof rec.iata === "string" ? rec.iata.trim().toUpperCase() : null;
    const fromDate = typeof rec.fromDate === "string" ? rec.fromDate : null;
    const toDate =
      rec.toDate === null || rec.toDate === undefined
        ? null
        : typeof rec.toDate === "string"
          ? rec.toDate
          : undefined;
    if (!iata || !fromDate || toDate === undefined) continue;
    if (!ISO_DAY.test(fromDate)) continue;
    if (toDate !== null && !ISO_DAY.test(toDate)) continue;
    result.push({ iata, fromDate, toDate });
  }
  return sortHistory(result);
}

/** The legacy view of the periods: one entry per period, its primary airport. */
export function legacyHistoryOf(periods: readonly HomePeriod[]): HomeAirportEntry[] {
  return periods.map((p) => ({
    iata: primaryAirportOf(p),
    fromDate: p.fromDate,
    toDate: p.toDate,
  }));
}

/** An unconfirmed residence at the airport itself — what every distance used before. */
export function residenceFromAirport(
  airport: AirportForHome | null,
  code: string
): HomeResidence | null {
  if (!airport) return null;
  return { name: airport.name ?? code, lat: airport.lat, lon: airport.lon };
}

/** One migrated period per legacy entry. `lookup` answers null for an unknown airport. */
export function periodsFromLegacy(
  history: readonly HomeAirportEntry[],
  lookup: (code: string) => AirportForHome | null
): HomePeriod[] {
  return history.map((entry) => ({
    fromDate: entry.fromDate,
    toDate: entry.toDate,
    residence: residenceFromAirport(lookup(entry.iata), entry.iata),
    residenceConfirmed: false,
    airports: [{ code: entry.iata, primary: true }],
  }));
}

// ─── Reading the stored periods ───────────────────────────────────────────────

function readResidence(raw: unknown): HomeResidence | null | undefined {
  if (raw === null) return null;
  if (!raw || typeof raw !== "object") return undefined;
  const rec = raw as Record<string, unknown>;
  const { name, lat, lon, placeRef } = rec;
  if (typeof name !== "string" || typeof lat !== "number" || typeof lon !== "number") {
    return undefined;
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;
  return {
    name,
    lat,
    lon,
    ...(typeof placeRef === "string" ? { placeRef } : {}),
  };
}

function readAirports(raw: unknown): HomeAirportChoice[] | null {
  if (!Array.isArray(raw)) return null;
  const airports: HomeAirportChoice[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const rec = item as Record<string, unknown>;
    if (typeof rec.code !== "string" || rec.code.trim() === "") return null;
    const code = rec.code.trim().toUpperCase();
    if (airports.some((a) => a.code === code)) continue;
    airports.push({ code, primary: rec.primary === true });
  }
  if (airports.length === 0) return null;
  // Exactly one primary, whatever was stored: the first flagged one wins, the
  // first airport when none was.
  const primaryIndex = Math.max(
    0,
    airports.findIndex((a) => a.primary)
  );
  return airports.map((a, i) => ({ code: a.code, primary: i === primaryIndex }));
}

function readPeriod(raw: unknown): HomePeriod | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const { fromDate, toDate } = rec;
  if (typeof fromDate !== "string" || !ISO_DAY.test(fromDate)) return null;
  if (
    toDate !== null &&
    toDate !== undefined &&
    (typeof toDate !== "string" || !ISO_DAY.test(toDate))
  ) {
    return null;
  }
  const residence = readResidence(rec.residence);
  const airports = readAirports(rec.airports);
  if (residence === undefined || airports === null) return null;
  return {
    fromDate,
    toDate: typeof toDate === "string" ? toDate : null,
    residence,
    // Only an explicit true confirms; a missing flag is not a confirmation.
    residenceConfirmed: rec.residenceConfirmed === true && residence !== null,
    airports,
  };
}

export function sortPeriods(periods: readonly HomePeriod[]): HomePeriod[] {
  return [...periods].sort((a, b) => compareYmd(a.fromDate, b.fromDate));
}

/**
 * The stored periods, or null when the key is absent (the account still has
 * only the old shape). Malformed periods are dropped, like `normalizeHistory`.
 */
export function readStoredPeriods(raw: unknown): HomePeriod[] | null {
  if (!Array.isArray(raw)) return null;
  const periods: HomePeriod[] = [];
  for (const item of raw) {
    const period = readPeriod(item);
    if (period) periods.push(period);
  }
  return sortPeriods(periods);
}

// ─── Changes through the old API ─────────────────────────────────────────────

/**
 * "I moved" in the old shape: close the running period at `moveDate` and open
 * a new one with a single airport. The residence is the airport, unconfirmed —
 * an old client cannot say where the user lives, so the inbox asks.
 *
 * Idempotent when the running period's primary already is `iata`.
 */
export function applyLegacyMove(
  periods: readonly HomePeriod[],
  iata: string,
  moveDate: string,
  airport: AirportForHome | null
): HomePeriod[] {
  const code = iata.trim().toUpperCase();
  if (currentPrimaryAirport(periods) === code) return [...periods];
  const closed = periods.map((p) => (p.toDate === null ? { ...p, toDate: moveDate } : p));
  return sortPeriods([
    ...closed,
    {
      fromDate: moveDate,
      toDate: null,
      residence: residenceFromAirport(airport, code),
      residenceConfirmed: false,
      airports: [{ code, primary: true }],
    },
  ]);
}

/**
 * A correction through the old API, on the period at `index` of the legacy
 * view (which is the same list, in the same order). A new `iata` becomes the
 * primary: an airport already in the set is promoted, any other one replaces
 * the primary. An unconfirmed residence follows its airport, a confirmed one
 * is the user's and stays.
 */
export function applyLegacyEdit(
  period: HomePeriod,
  patch: { iata?: string; fromDate?: string; toDate?: string | null },
  airport: AirportForHome | null
): HomePeriod {
  let next: HomePeriod = {
    ...period,
    ...(patch.fromDate !== undefined ? { fromDate: patch.fromDate } : {}),
    ...(patch.toDate !== undefined ? { toDate: patch.toDate } : {}),
  };
  if (patch.iata === undefined) return next;
  const code = patch.iata.trim().toUpperCase();
  if (primaryAirportOf(period) === code) return next;
  const airports = period.airports.some((a) => a.code === code)
    ? period.airports.map((a) => ({ code: a.code, primary: a.code === code }))
    : period.airports.map((a) => (a.primary ? { code, primary: true } : a));
  next = { ...next, airports };
  if (!period.residenceConfirmed)
    next = { ...next, residence: residenceFromAirport(airport, code) };
  return next;
}
