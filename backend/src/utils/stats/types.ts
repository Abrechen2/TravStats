import type { FlightTimeSemantics } from '../timezone';

export interface FunStats {
  timezoneHopper: number;
  earlyBird: number;
  afternoon: number;
  nightOwl: number;
  weekendWarrior: number;
  weekendPercentage: number;
  loyaltyScore: number;
  mostUsedAirline: string | null;
  shortHaulKing: number;
  longHaulPilot: number;
  fastestDay: string | null;
  fastestDayFlights: number;
  co2FootprintKg: number;
  co2InElephants: number;
  milestoneYear: number | null;
  milestoneYearFlights: number;
  routeMaster: string | null;
  routeMasterCount: number;
}

export interface BusinessStats {
  costPerKm: number;
  costPerHour: number;
  totalCost: number;
  totalDistance: number;
  seatClassDistribution: Record<string, number>;
  mostCommonCategory: string | null;
  airportDiversity: number;
  avgFlightDuration: number;
  busiestMonth: string | null;
  busiestMonthFlights: number;
  categoryDistribution: Record<string, number>;
}

export interface UniqueStats {
  timeTravelIndex: number;
  equatorCrossings: number;
  arcticFlights: number;
  oceanCrossings: number;
  highestAirport: { code: string; name: string; altitude: number } | null;
  northernmost: { lat: number; code: string } | null;
  southernmost: { lat: number; code: string } | null;
  longestTravelChain: number;
  fastestRoute: { route: string; speed: number } | null;
  mostCountriesInDay: number;
  mostCountriesDate: string | null;
  hemisphereHops: number;
  dateLineCrossings: number;
  continentalExplorer: number;
  continents: string[];
  tropicsTraveler: number;
  eastWestBalance: {
    eastward: number;
    westward: number;
    ratio: number;
  };
  sameDayFlights: number;
  midnightFlights: number;
  seasonalExplorer: boolean;
  seasonsCount: number;
  internationalVsDomestic: {
    international: number;
    domestic: number;
    ratio: number;
  };
  longestLayover: { hours: number; from: string; to: string } | null;
  shortestLayover: { hours: number; from: string; to: string } | null;
  roundTripMaster: number;
}

export interface FlightData {
  id: string;
  /**
   * IANA timezone of the DEPARTURE airport, resolved by the caller from the
   * airport cache. Every figure about *when* a flight happened is read on
   * this clock rather than on the UTC instant (#266). Null/absent means no
   * timezone is on file and the stored components are used as-is.
   */
  depTimezone?: string | null;
  /** Storage semantics of `departureTime` — decides how its clock is read. */
  depTimeSemantics?: FlightTimeSemantics;
  depLat: number;
  depLon: number;
  arrLat: number;
  arrLon: number;
  depIata?: string | null;
  depIcao?: string | null;
  arrIata?: string | null;
  arrIcao?: string | null;
  airline?: string | null;
  aircraft?: string | null;
  departureTime: Date | null;
  arrivalTime: Date | null;
  status: string;
  price?: number | null;
  taxes?: number | null;
  fees?: number | null;
  currency?: string | null;
  /** Base-currency value snapshotted on write (#267). */
  priceBase?: number | null;
  /** Which base currency that snapshot is in. */
  fxBaseCurrency?: string | null;
  category?: string | null;
  seatClass?: string | null;
  createdAt: Date;
  bookingId?: string | null;
  booking?: {
    id: string;
    price?: number | null;
    currency?: string | null;
    priceBase?: number | null;
    fxBaseCurrency?: string | null;
  } | null;
}
