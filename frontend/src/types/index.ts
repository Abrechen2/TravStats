export interface User {
  id: string;
  username: string;
  isAdmin: boolean;
}

export interface Airport {
  id?: number;
  icao?: string;
  iata?: string;
  name?: string;
  city?: string | null;
  country?: string | null;
  lat: number;
  lon: number;
  altitude?: number | null;
  timezone?: string | null;
  isClosed?: boolean;
}

export interface Flight {
  id: string;
  userId: string;
  airline: string;
  operatingAirline?: string;
  flightNumber: string;
  callsign?: string;
  aircraft?: string;
  depIcao?: string;
  depIata?: string;
  depName?: string;
  depLat: number;
  depLon: number;
  arrIcao?: string;
  arrIata?: string;
  arrName?: string;
  arrLat: number;
  arrLon: number;
  departureTime: string | null;
  arrivalTime: string | null;
  // Time-correctness flag set by the backend.
  // 'UTC'       — departureTime/arrivalTime are real UTC instants
  // 'DATE_ONLY' — only the calendar date is real; the time component is a
  //               12:00 placeholder. Display layer must render duration via
  //               coord-based estimate (`getFlightDuration`).
  // 'UNKNOWN'   — neither date nor time is reliable.
  // 'LEGACY_FAKE_UTC' — pre-V1 row stored a local-as-UTC fake; do not trust.
  depTimeSemantics?: "UTC" | "DATE_ONLY" | "UNKNOWN" | "LEGACY_FAKE_UTC";
  arrTimeSemantics?: "UTC" | "DATE_ONLY" | "UNKNOWN" | "LEGACY_FAKE_UTC";
  status: "scheduled" | "flown" | "cancelled" | "historical" | "duplicated";
  notes?: string;
  createdAt: string;
  // Costs & categorization
  price?: number;
  currency?: "EUR" | "USD" | "GBP" | "CHF";
  taxes?: number;
  fees?: number;
  category?: "business" | "private" | "vacation";
  tags?: string[];
  receiptUrl?: string;
  // Extended fields
  seatNumber?: string;
  seatClass?: "economy" | "premium_economy" | "business" | "first";
  boardingGroup?: string;
  gate?: string;
  terminal?: string;
  bookingReference?: string;
  ticketNumber?: string;
  companions?: string[];
  // Route tracking
  actualRoute?: Array<{ lat: number; lon: number; timestamp?: string; country?: string }>;
  overflownCountries?: string[];
  routeDistance?: number;
  routeSource?: "live_tracking" | "historical_aggregation" | "estimated";
  hasLiveTracking?: boolean;
  // Data source tracking
  dataSource?:
    | "manual"
    | "email_import"
    | "boarding_pass_scan"
    | "historical_enrichment"
    | "live_update"
    | "api_lookup"
    | "bulk_import";
  lastModifiedBy?: "user" | "auto_update" | "historical_enrichment" | "api";
  enrichmentHistory?: Array<{
    type: string;
    timestamp: string;
    confidence?: number;
    source?: string;
    sourceFlightsCount?: number;
  }>;
  // Phase 3: Actual Times, Delay, CO₂
  actualDeparture?: string;
  actualArrival?: string;
  delayMinutes?: number;
  co2Kg?: number;
  // Computed by backend (timezone-aware)
  durationMinutes?: number;
  // Trips
  tripId?: string | null;
  bookingId?: string | null;
  trip?: { id: string; name: string; color: string } | null;
}

export interface Booking {
  id: string;
  userId: string;
  tripId: string | null;
  pnr: string | null;
  price: number | null;
  currency: "EUR" | "USD" | "GBP" | "CHF" | null;
}

export interface Trip {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  color: string;
  createdAt: string;
  updatedAt: string;
  _count?: { flights: number };
  bookings?: Booking[];
  flights?: Pick<
    Flight,
    | "id"
    | "depIata"
    | "arrIata"
    | "departureTime"
    | "arrivalTime"
    | "depLat"
    | "depLon"
    | "arrLat"
    | "arrLon"
  >[];
}

export interface FlightInput {
  airline?: string;
  operatingAirline?: string;
  flightNumber?: string;
  callsign?: string;
  aircraft?: string;
  departure: Airport;
  arrival: Airport;
  // Canonical-UTC submission contract: send local wall-clock + IANA timezone
  // and let the server build the real UTC instant via fromZonedTime().
  // Format: "YYYY-MM-DDTHH:mm" (no TZ suffix, no seconds required).
  departureLocal?: string;
  depTimezone?: string;
  arrivalLocal?: string;
  arrTimezone?: string;
  actualDepartureLocal?: string;
  actualDepartureTz?: string;
  actualArrivalLocal?: string;
  actualArrivalTz?: string;
  status?: "scheduled" | "flown" | "cancelled" | "historical" | "duplicated";
  notes?: string;
  // Extended fields
  seatNumber?: string;
  seatClass?: "economy" | "premium_economy" | "business" | "first";
  boardingGroup?: string;
  gate?: string;
  terminal?: string;
  bookingReference?: string;
  ticketNumber?: string;
  price?: number;
  currency?: "EUR" | "USD" | "GBP" | "CHF";
  taxes?: number;
  fees?: number;
  category?: "business" | "private" | "vacation";
  tags?: string[];
  companions?: string[];
  receiptUrl?: string;
  baggageAllowance?: string;
  frequentFlyerNumber?: string;
  bookingClassLetter?: string;
  coPassengers?: string[];
}

export interface ParsedBooking {
  airline?: string;
  flightNumber?: string;
  departureCode?: string;
  arrivalCode?: string;
  departureTime?: string;
  arrivalTime?: string;
  pnr?: string;
  seat?: string;
  terminal?: string;
  gate?: string;
  price?: string;
  currency?: string;
  aircraft?: string;
  seatClass?: string;
  bookingReference?: string;
  ticketNumber?: string;
  boardingGroup?: string;
  taxes?: string;
  fees?: string;
  // Phase 1: New fields
  baggageAllowance?: string;
  frequentFlyerNumber?: string;
  bookingClassLetter?: string;
  coPassengers?: string[];
  parserTemplate?: string;
  parserConfidence?: number;
  airlineNotice?: string; // Transient: not persisted to DB, UI-only notice when no template found
  // Field names that the parser inferred — assigned a value the source did not state
  // explicitly (e.g. picked a year for a date that omitted it). Surfaced as a
  // "please verify" badge in the import-review UI. Not persisted.
  inferredFields?: string[];
  missing?: string[];
  fieldSources?: Partial<
    Record<
      | "flightNumber"
      | "departureCode"
      | "arrivalCode"
      | "departureTime"
      | "arrivalTime"
      | "pnr"
      | "aircraft"
      | "seat"
      | "terminal"
      | "gate",
      "template" | "llm" | "empty"
    >
  >;
}

export interface FlightLookupResult {
  airline?: string;
  flightNumber?: string;
  aircraft?: string;
  departure?: Airport;
  arrival?: Airport;
  departureTime?: string;
  arrivalTime?: string;
}

export interface FlightFilters {
  airline?: string | string[];
  flightNumber?: string;
  departureAirport?: string;
  arrivalAirport?: string;
  fromDate?: string;
  toDate?: string;
  status?:
    | "scheduled"
    | "flown"
    | "cancelled"
    | "historical"
    | Array<"scheduled" | "flown" | "cancelled" | "historical">;
  category?: "business" | "private" | "vacation";
  tags?: string[];
  minPrice?: number;
  maxPrice?: number;
  limit?: number;
  offset?: number;
  // Frontend-only filter to hide infrequent routes on the globe; never sent to backend
  minRouteCount?: number;
}

export interface Stats {
  totalFlights: number;
  totalDistance: number;
  totalFlightTime: number;
  avgDistance: number;
  byStatus: Record<string, number>;
  byAirline: Record<string, number>;
  totalCost?: number;
  byCategory?: Record<string, number>;
}

export interface Route {
  route: string;
  count: number;
  departure: Airport;
  arrival: Airport;
  distance: number;
}

export interface GeoJSONFeature {
  type: "Feature";
  properties: {
    id: string;
    airline: string;
    flightNumber: string;
    callsign?: string;
    aircraft?: string;
    departureAirport: {
      icao?: string;
      iata?: string;
      name?: string;
      lat?: number;
      lon?: number;
    };
    arrivalAirport: {
      icao?: string;
      iata?: string;
      name?: string;
      lat?: number;
      lon?: number;
    };
    departureTime: string | null;
    arrivalTime: string | null;
    status: string;
    category?: "business" | "private" | "vacation";
    tags?: string[];
    price?: number;
    currency?: "EUR" | "USD" | "GBP" | "CHF";
    taxes?: number;
    fees?: number;
    distance: number;
  };
  geometry: {
    type: "LineString";
    coordinates: [number, number][];
  };
}

export interface GeoJSONFeatureCollection {
  type: "FeatureCollection";
  features: GeoJSONFeature[];
}

export interface Achievement {
  id: string;
  code: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  tier: "bronze" | "silver" | "gold" | "platinum" | "diamond";
  requirement: number;
  requirementType: string;
  points: number;
  isHidden: boolean;
  createdAt: string;
  isUnlocked?: boolean;
  unlockedAt?: string | null;
  progress?: number;
  progressPercentage?: number;
}

export interface AchievementSummary {
  totalAchievements: number;
  unlockedAchievements: number;
  totalPoints: number;
  categories: Record<string, { total: number; unlocked: number }>;
}

export interface AchievementsResponse {
  achievements: Achievement[];
  summary: AchievementSummary;
}

export interface UserAchievement {
  id: string;
  userId: string;
  achievementId: string;
  unlockedAt: string;
  progress: number;
  achievement: Achievement;
}

export interface LeaderboardEntry {
  rank: number;
  username: string;
  totalPoints: number;
  achievementCount: number;
}

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
  highestAirport: {
    code: string;
    name: string;
    altitude: number;
  } | null;
  northernmost: {
    lat: number;
    code: string;
  } | null;
  southernmost: {
    lat: number;
    code: string;
  } | null;
  longestTravelChain: number;
  fastestRoute: {
    route: string;
    speed: number;
  } | null;
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
  longestLayover: {
    hours: number;
    from: string;
    to: string;
  } | null;
  shortestLayover: {
    hours: number;
    from: string;
    to: string;
  } | null;
  roundTripMaster: number;
}

export interface AirportStats {
  airportCount: number;
  countryCount: number;
  continentCount: number;
  topAirports: Array<{
    code: string;
    name: string | null;
    country: string | null;
    visits: number;
  }>;
  rarestAirports: Array<{
    code: string;
    name: string | null;
    country: string | null;
  }>;
  newThisYear: Array<{
    code: string;
    name: string | null;
    country: string | null;
    firstVisitDate: string;
  }>;
  farthestFromHome: {
    code: string;
    name: string | null;
    country: string | null;
    distanceKm: number;
    homeCode: string;
  } | null;
  topCountries: Array<{ country: string; count: number }>;
  continentDistribution: Record<string, number>;
}

export interface SeatStats {
  windowCount: number;
  middleCount: number;
  aisleCount: number;
  unknownCount: number;
  noSeatCount: number;
  frontCount: number;
  middleZoneCount: number;
  backCount: number;
  mostCommonSeat: string | null;
  seatClassDistribution: Record<string, number>;
  avgRowNumber: number | null;
}

export interface ParseLogAirlineStat {
  airline: string;
  total: number;
  hits: number;
  hitRate: number;
  commonMissingFields: string[];
}

export interface ParseLogStats {
  totalLogs: number;
  overallHitRate: number;
  byAirline: ParseLogAirlineStat[];
}

export interface PromoteCorrectionsResult {
  promoted: number;
  message: string;
}

export interface AirlineRankingItem {
  airline: string;
  count: number;
  percentage: number;
}

export interface AirlineRankingResponse {
  airlines: AirlineRankingItem[];
  total: number;
}

export interface CountryStat {
  country: string;
  count: number;
}

export interface CountryStatsResponse {
  countries: CountryStat[];
  total: number;
}
