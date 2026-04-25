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
}

export interface CruiseStats {
  cruisesCount: number;
  cruisePortsUnique: number;
  cruisePortsSingleMax: number;
  cruiseShipsUnique: number;
  cruiseLines: Set<string>;
  cruiseLinesUnique: number;
  cruiseLineLoyaltyMax: number;
  seaDays: number;
  seaDaysStreak: number;
  regions: Set<string>;
  countries: Set<string>;
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
  /** Total number of port calls across all cruises (counts revisits).
   * `cruisePortsUnique` is the de-duplicated set; this is the gross
   * tally — needed for revisit-rate and average-ports-per-cruise. */
  totalPortCalls: number;
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
  const cruiseLines = new Set<string>();
  const regions = new Set<string>();
  const countries = new Set<string>();
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
  let totalPortCalls = 0;
  let totalCruiseDays = 0;
  const regionVisitCounts: Record<string, number> = {};

  for (const cruise of cruises) {
    if (cruise.shipId !== null) shipIds.add(cruise.shipId);
    if (cruise.cruiseLine) {
      cruiseLines.add(cruise.cruiseLine);
      lineCounts.set(cruise.cruiseLine, (lineCounts.get(cruise.cruiseLine) ?? 0) + 1);
    }
    if (cruise.cabinType === 'balcony' || cruise.cabinType === 'suite') hasBalconyCabin = true;
    if (cruise.cabinType === 'suite') hasSuiteCabin = true;
    if (cruise.deck !== null && cruise.deck > maxDeck) maxDeck = cruise.deck;

    const sortedStops = [...cruise.stops].sort((a, b) => a.dayNumber - b.dayNumber);
    let cruisePortCount = 0;
    let currentSeaStreak = 0;
    let prevPortPoint: { lat: number; lon: number } | null = null;

    for (const stop of sortedStops) {
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
          if (stop.port.country) countries.add(stop.port.country);
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
          // Approximate cruise distance: sum great-circle hops between
          // consecutive port calls. Sea days don't add distance directly
          // (ships in the sea-day window are en route between two ports
          // — the haversine between those ports already covers it).
          const here = { lat: stop.port.lat, lon: stop.port.lon };
          if (prevPortPoint !== null) {
            const legKm = haversineKm(prevPortPoint, here);
            totalDistanceKm += legKm;
            if (legKm > longestLegKm) longestLegKm = legKm;
            // Antimeridian crossing: large absolute longitude span
            // (>180°) collapses to a shorter great-circle path that
            // skips the dateline. Detect via raw longitude jump.
            const lonSpan = Math.abs(here.lon - prevPortPoint.lon);
            if (lonSpan > 180) hasDatelineCrossing = true;
          }
          prevPortPoint = here;
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
    totalPortCalls,
    totalCruiseDays,
    regionVisitCounts,
  };
}

function rangeContainsMonthDay(
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
