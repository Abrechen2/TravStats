import { haversineKm } from '../shared/geo/haversine';

export interface CruisePortData {
  id: number;
  name: string;
  city: string | null;
  country: string | null;
  region: string | null;
  unlocode: string | null;
  lat: number;
  lon: number;
  timezone: string | null;
  isUserAdded: boolean;
}

export interface CruiseStopData {
  portId: number | null;
  port: CruisePortData | null;
  dayNumber: number;
  isAtSea: boolean;
  arrivalTime?: Date | null;
  departureTime?: Date | null;
  /** Set on an unresolved port (portId=null, isAtSea=false). Counts as a port call. */
  unresolvedPortName?: string | null;
}

export interface CruiseData {
  id: string;
  shipId: number | null;
  cruiseLine: string | null;
  cabinType: string | null;
  deck: number | null;
  startDate: Date | null;
  endDate: Date | null;
  stops: CruiseStopData[];
  /**
   * Departure/arrival ports from the Cruise row. They participate in
   * the effective port sequence (departure → stops → arrival) so a
   * minimal A-to-B cruise without a detailed stop list still produces
   * port, country, region and distance stats. Skipped when they
   * duplicate the first/last port-call stop.
   */
  departurePort?: CruisePortData | null;
  arrivalPort?: CruisePortData | null;
  /**
   * Per-leg distances (km) in effective-sequence order (departure port
   * → port calls → arrival port), as persisted in `cruise_legs` and
   * routed by the cruiseDistance pipeline. When present, distance stats
   * use these instead of the inline haversine fallback. Length must
   * equal `effectivePortCalls - 1`; mismatched length means the legs
   * are stale and the calculator falls back to haversine for the
   * affected cruise.
   */
  legDistancesKm?: number[];
}

export interface CruiseStats {
  cruisesCount: number;
  cruisePortsUnique: number;
  cruisePortsSingleMax: number;
  cruiseShipsUnique: number;
  cruiseLines: Set<string>;
  /**
   * How often each line was sailed. The set alone cannot answer "top lines" —
   * the cross-domain tile slices the first five entries and labels them Top,
   * so an alphabetical list put AIDA and Costa there for their initials.
   */
  cruiseLineCounts: Record<string, number>;
  cruiseLinesUnique: number;
  cruiseLineLoyaltyMax: number;
  seaDays: number;
  seaDaysStreak: number;
  regions: Set<string>;
  countries: Set<string>;
  /**
   * Countries keyed by the cruise's START year — the year-scoped counterpart
   * to `countries`. The overview's "countries visited" tile used to render
   * the lifetime set no matter which year was selected (34 for 2026, 34 for
   * 2017 with three cruises), and put a year-over-year delta badge on top of
   * it that could only ever read "0 (0%)". A comparison that cannot exist was
   * being presented as data.
   *
   * The year comes from `startDate` in UTC, not local time: cruise dates are
   * stored date-only and UTC-pinned, so `getFullYear()` would move a
   * 1 January departure into the previous year for every user west of UTC.
   * A cruise without a start date contributes to `countries` but to no year.
   */
  countriesByYear: Map<number, Set<string>>;
  hasBalconyCabin: boolean;
  hasSuiteCabin: boolean;
  maxDeck: number;
  hasCanalTransit: boolean;
  hasPolar: boolean;
  hasColdWater: boolean;
  hasBirthdayAtSea: boolean;
  hasNewYearsAtSea: boolean;
  /** Sum of great-circle distances (km) between consecutive port stops
   * across all cruises. Approximation — ignores at-sea-day routing
   * and assumes ships travel roughly along a great circle between
   * port pairs. Good enough as an achievement signal. */
  totalDistanceKm: number;
  /** Single longest leg between consecutive port calls across any
   * cruise (km). Used to detect true open-water crossings. */
  longestLegKm: number;
  /** True when any cruise has a leg where the longitude jumps across
   * the antimeridian (lon ±180°), e.g. an Auckland → Tahiti hop. */
  hasDatelineCrossing: boolean;
  /** True when any leg connects ports on opposite sides of the equator —
   * the classic line-crossing ceremony ("Äquatortaufe"). Chord check
   * between consecutive catalog ports, same approximation as distance. */
  hasEquatorCrossing: boolean;
  /** Most cruises taken on one and the same ship. */
  shipLoyaltyMax: number;
  /** Number of cruises booked in an inside cabin. */
  insideCabinCount: number;
  /** Total number of port calls across all cruises (counts revisits).
   * `cruisePortsUnique` is the de-duplicated set; this is the gross
   * tally — needed for revisit-rate and average-ports-per-cruise. */
  totalPortCalls: number;
  /**
   * Port calls whose stop matched a catalogue port. `totalPortCalls` also
   * counts unresolved ones — an imported name nothing matched. They are real
   * calls, so they belong in the total, but they can never appear in
   * `cruisePortsUnique`, which is keyed by catalogue id. Any ratio comparing
   * the two therefore needs THIS denominator, or unresolved calls read as
   * revisits.
   */
  resolvedPortCalls: number;
  /** Sum of (endDate − startDate + 1) days across cruises that have
   * both timestamps. Cruises missing dates contribute zero. */
  totalCruiseDays: number;
  /** Per-region port-call count (e.g. {"mediterranean": 12,
   * "caribbean": 5}). Sorted bar-chart input on the frontend. */
  regionVisitCounts: Record<string, number>;
}

const CANAL_UNLOCODES = new Set(['PACTB', 'EGPSD']); // Panama Colón, Port Said
const POLAR_REGIONS = new Set(['antarctic', 'polar']);
const COLD_WATER_COUNTRIES = new Set(['Iceland', 'Antarctica', 'Greenland']);
const COLD_WATER_REGIONS = new Set(['alaska', 'polar', 'antarctic']);

export function calculateCruiseStats(
  cruises: CruiseData[],
  userBirthday?: { month: number; day: number },
): CruiseStats {
  const portIds = new Set<number>();
  const shipIds = new Set<number>();
  const shipCounts = new Map<number, number>();
  const cruiseLines = new Set<string>();
  const cruiseLineCounts = new Map<string, number>();
  const regions = new Set<string>();
  const countries = new Set<string>();
  const countriesByYear = new Map<number, Set<string>>();
  const lineCounts = new Map<string, number>();

  let seaDays = 0;
  let seaDaysStreak = 0;
  let cruisePortsSingleMax = 0;
  let hasBalconyCabin = false;
  let hasSuiteCabin = false;
  let maxDeck = 0;
  let hasCanalTransit = false;
  let hasPolar = false;
  let hasColdWater = false;
  let hasBirthdayAtSea = false;
  let hasNewYearsAtSea = false;
  let totalDistanceKm = 0;
  let longestLegKm = 0;
  let hasDatelineCrossing = false;
  let hasEquatorCrossing = false;
  let insideCabinCount = 0;
  let totalPortCalls = 0;
  let resolvedPortCalls = 0;
  let totalCruiseDays = 0;
  const regionVisitCounts: Record<string, number> = {};

  for (const cruise of cruises) {
    if (cruise.shipId !== null) {
      shipIds.add(cruise.shipId);
      shipCounts.set(cruise.shipId, (shipCounts.get(cruise.shipId) ?? 0) + 1);
    }
    if (cruise.cabinType === 'inside') insideCabinCount += 1;
    if (cruise.cruiseLine) {
      cruiseLines.add(cruise.cruiseLine);
      cruiseLineCounts.set(cruise.cruiseLine, (cruiseLineCounts.get(cruise.cruiseLine) ?? 0) + 1);
      lineCounts.set(cruise.cruiseLine, (lineCounts.get(cruise.cruiseLine) ?? 0) + 1);
    }
    if (cruise.cabinType === 'balcony' || cruise.cabinType === 'suite') hasBalconyCabin = true;
    if (cruise.cabinType === 'suite') hasSuiteCabin = true;
    if (cruise.deck !== null && cruise.deck > maxDeck) maxDeck = cruise.deck;

    // Year bucket for this cruise's ports. UTC on purpose — see the
    // countriesByYear doc comment. An undated cruise gets no bucket at all
    // rather than a guessed one.
    const startYear = cruise.startDate ? cruise.startDate.getUTCFullYear() : null;
    let yearCountries: Set<string> | null = null;
    if (startYear !== null) {
      yearCountries = countriesByYear.get(startYear) ?? new Set<string>();
      countriesByYear.set(startYear, yearCountries);
    }

    // Effective itinerary: departure port → sorted stops → arrival port.
    // Mirrors buildEffectivePortSequence (shared/cruise/portSequence) —
    // departure/arrival are skipped when they duplicate the first/last
    // port-call stop.
    const sortedStops = [...cruise.stops].sort((a, b) => a.dayNumber - b.dayNumber);
    const portCallStops = sortedStops.filter((s) => !s.isAtSea && s.port);
    const effectiveStops: CruiseStopData[] = [...sortedStops];
    if (cruise.departurePort && cruise.departurePort.id !== portCallStops[0]?.port?.id) {
      effectiveStops.unshift({
        portId: cruise.departurePort.id,
        port: cruise.departurePort,
        dayNumber: 0,
        isAtSea: false,
      });
    }
    if (
      cruise.arrivalPort &&
      cruise.arrivalPort.id !== portCallStops[portCallStops.length - 1]?.port?.id
    ) {
      effectiveStops.push({
        portId: cruise.arrivalPort.id,
        port: cruise.arrivalPort,
        dayNumber: Number.MAX_SAFE_INTEGER,
        isAtSea: false,
      });
    }
    const portCallCount = effectiveStops.filter((s) => !s.isAtSea && s.port).length;
    const persistedLegs = cruise.legDistancesKm;
    const usePersistedLegs =
      Array.isArray(persistedLegs) &&
      persistedLegs.length === Math.max(0, portCallCount - 1);
    let cruisePortCount = 0;
    let portCallIndex = 0;
    let currentSeaStreak = 0;
    let prevPortPoint: { lat: number; lon: number } | null = null;

    for (const stop of effectiveStops) {
      if (stop.isAtSea) {
        seaDays += 1;
        currentSeaStreak += 1;
        if (currentSeaStreak > seaDaysStreak) seaDaysStreak = currentSeaStreak;
      } else {
        currentSeaStreak = 0;
        if (stop.port) {
          portIds.add(stop.port.id);
          cruisePortCount += 1;
          totalPortCalls += 1;
          resolvedPortCalls += 1;
          if (stop.port.country) {
            countries.add(stop.port.country);
            yearCountries?.add(stop.port.country);
          }
          if (stop.port.region) {
            regions.add(stop.port.region);
            regionVisitCounts[stop.port.region] =
              (regionVisitCounts[stop.port.region] ?? 0) + 1;
          }
          if (stop.port.unlocode && CANAL_UNLOCODES.has(stop.port.unlocode)) hasCanalTransit = true;
          if (stop.port.region && POLAR_REGIONS.has(stop.port.region)) hasPolar = true;
          if (
            (stop.port.country && COLD_WATER_COUNTRIES.has(stop.port.country)) ||
            (stop.port.region && COLD_WATER_REGIONS.has(stop.port.region))
          ) {
            hasColdWater = true;
          }
          // Distance per leg: prefer persisted cruise_legs values
          // (routed by the cruiseDistance pipeline), fall back to
          // inline haversine when none are available. Sea days don't
          // add distance — they're inside the leg between surrounding
          // port calls.
          const here = { lat: stop.port.lat, lon: stop.port.lon };
          if (prevPortPoint !== null) {
            const legIdx = portCallIndex - 1;
            const legKm =
              usePersistedLegs && persistedLegs
                ? persistedLegs[legIdx]
                : haversineKm(prevPortPoint, here);
            totalDistanceKm += legKm;
            if (legKm > longestLegKm) longestLegKm = legKm;
            // Antimeridian crossing: large absolute longitude span
            // (>180°) collapses to a shorter great-circle path that
            // skips the dateline. Detect via raw longitude jump.
            const lonSpan = Math.abs(here.lon - prevPortPoint.lon);
            if (lonSpan > 180) hasDatelineCrossing = true;
            // Equator crossing: leg endpoints in opposite hemispheres.
            if (
              (prevPortPoint.lat > 0 && here.lat < 0) ||
              (prevPortPoint.lat < 0 && here.lat > 0)
            ) {
              hasEquatorCrossing = true;
            }
          }
          prevPortPoint = here;
          portCallIndex += 1;
        } else if (stop.unresolvedPortName) {
          // Unresolved port: a real port call (name preserved) but coordinate-
          // less, so it counts toward port-call totals only — no distance, no
          // unique-port id, no country/region. It does not advance
          // prevPortPoint/portCallIndex (those track routed legs between
          // catalog ports).
          totalPortCalls += 1;
        }
      }
    }
    if (cruisePortCount > cruisePortsSingleMax) cruisePortsSingleMax = cruisePortCount;

    if (userBirthday && cruise.startDate && cruise.endDate) {
      if (rangeContainsMonthDay(cruise.startDate, cruise.endDate, userBirthday)) {
        hasBirthdayAtSea = true;
      }
    }
    if (cruise.startDate && cruise.endDate) {
      if (rangeContainsMonthDay(cruise.startDate, cruise.endDate, { month: 12, day: 31 })) {
        hasNewYearsAtSea = true;
      }
      // Inclusive day count: a Sat–Sun trip counts as 2 days. Cruises
      // missing either timestamp simply don't contribute.
      const dayMs = 24 * 60 * 60 * 1000;
      const days =
        Math.floor((cruise.endDate.getTime() - cruise.startDate.getTime()) / dayMs) + 1;
      if (days > 0) totalCruiseDays += days;
    }
  }

  let cruiseLineLoyaltyMax = 0;
  for (const count of lineCounts.values()) {
    if (count > cruiseLineLoyaltyMax) cruiseLineLoyaltyMax = count;
  }

  let shipLoyaltyMax = 0;
  for (const count of shipCounts.values()) {
    if (count > shipLoyaltyMax) shipLoyaltyMax = count;
  }

  return {
    cruisesCount: cruises.length,
    cruisePortsUnique: portIds.size,
    cruisePortsSingleMax,
    cruiseShipsUnique: shipIds.size,
    cruiseLines,
    cruiseLinesUnique: cruiseLines.size,
    cruiseLineLoyaltyMax,
    seaDays,
    seaDaysStreak,
    regions,
    countries,
    countriesByYear,
    hasBalconyCabin,
    hasSuiteCabin,
    maxDeck,
    hasCanalTransit,
    hasPolar,
    hasColdWater,
    hasBirthdayAtSea,
    hasNewYearsAtSea,
    totalDistanceKm,
    longestLegKm,
    hasDatelineCrossing,
    hasEquatorCrossing,
    shipLoyaltyMax,
    insideCabinCount,
    totalPortCalls,
    resolvedPortCalls,
    cruiseLineCounts: Object.fromEntries(cruiseLineCounts),
    totalCruiseDays,
    regionVisitCounts,
  };
}

/**
 * Whether a date range (inclusive, UTC day-walk) contains a given
 * month/day, year-agnostic. Exported for the lodging birthday/Christmas
 * stay flags in `achievements.ts` — same semantics as the cruise
 * birthday-at-sea check.
 */
export function rangeContainsMonthDay(
  start: Date,
  end: Date,
  md: { month: number; day: number },
): boolean {
  const cur = new Date(start);
  cur.setUTCHours(0, 0, 0, 0);
  const endMs = end.getTime();
  while (cur.getTime() <= endMs) {
    if (cur.getUTCMonth() + 1 === md.month && cur.getUTCDate() === md.day) return true;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return false;
}
