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
          if (stop.port.country) countries.add(stop.port.country);
          if (stop.port.region) regions.add(stop.port.region);
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
          if (prevPortPoint !== null) totalDistanceKm += haversineKm(prevPortPoint, here);
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
