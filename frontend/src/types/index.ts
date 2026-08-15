import type { Lodging, LodgingStay } from "./lodging";
import type { LinkedAlbum } from "./immich";

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
  airlineIata?: string;
  airlineIcao?: string;
  operatingAirline?: string;
  operatingAirlineIata?: string;
  operatingAirlineIcao?: string;
  isCodeshare?: boolean;
  flightNumber: string;
  callsign?: string;
  aircraft?: string;
  aircraftRegistration?: string;
  aircraftModeS?: string;
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
  /** ISO 4217 alpha-3 code (EUR, USD, GBP, CHF, INR, JPY, …). */
  currency?: string;
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
  // BP / email-import fields (parser-populated, user-editable)
  baggageAllowance?: string;
  frequentFlyerNumber?: string;
  bookingClassLetter?: string;
  coPassengers?: string[];
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
  // Sonder-Flug (special flights) — flight subtype, see backend schema.
  // null/undefined → standard line flight, the rest of these fields unused.
  specialType?:
    | "sightseeing"
    | "eclipse"
    | "rocket_launch"
    | "zerog"
    | "aurora"
    | "training"
    | "ferry"
    | "test"
    | null;
  eventLat?: number | null;
  eventLon?: number | null;
  eventLabel?: string | null;
  patternLat?: number | null;
  patternLon?: number | null;
  specialData?: Record<string, unknown> | null;
  // Display helpers (populated by backend for enriched flights)
  depCountry?: string | null;
  arrCountry?: string | null;
  depTimezone?: string | null;
  arrTimezone?: string | null;
}

export interface Booking {
  id: string;
  userId: string;
  tripId: string | null;
  pnr: string | null;
  price: number | null;
  /** ISO 4217 alpha-3 code (EUR, USD, GBP, CHF, INR, JPY, …) or null. */
  currency: string | null;
}

export interface UpdateBookingInput {
  pnr?: string | null;
  price?: number | null;
  currency?: string | null;
}

export type TripStatus = "planned" | "in_progress" | "completed";
export type TripCategory = "vacation" | "business" | "weekend" | "family" | "other";

export interface TripStop {
  id: string;
  tripId: string;
  orderIdx: number;
  domain: string | null;
  sourceId: string | null;
  title: string;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  lat: number | null;
  lon: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TripJournalEntry {
  id: string;
  tripId: string;
  date: string;
  title: string | null;
  body: string;
  mood: string | null;
  weather: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Trip {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  color: string;
  createdAt: string;
  updatedAt: string;

  // Phase-1 metadata redesign — see migration 20260509120000_trip_metadata.
  // Optional / defaulted on the server. Older rows return defaults.
  startDate: string | null;
  endDate: string | null;
  status: TripStatus;
  category: TripCategory | null;
  tags: string[];
  companions: string[];
  notes: string | null;
  summary: string | null;
  originLabel: string | null;
  destinationLabel: string | null;
  coverImageUrl: string | null;
  icon: string | null;
  countries: string[];

  _count?: { flights: number; cruises?: number; lodgingStays?: number };
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
    // Needed to render each end in ITS airport's zone. Without them the trip
    // timeline fell back to the viewer's clock and disagreed with the flights
    // table by the whole UTC offset.
    | "depTimezone"
    | "arrTimezone"
    | "depTimeSemantics"
    | "arrTimeSemantics"
    // Trip cost counts flights that carry a price but no booking.
    | "price"
    | "currency"
    | "bookingId"
  >[];
  cruises?: Array<{
    id: string;
    cruiseLine: string | null;
    startDate: string | null;
    endDate: string | null;
    status: string;
    shipId: number | null;
    // Trip cost counts cruises that carry a price but no booking, exactly as it
    // counts flights; `distanceKm` is the sum of the cruise's computed legs,
    // 0 when the sea router never ran for it.
    price?: number | null;
    currency?: string | null;
    bookingId?: string | null;
    distanceKm?: number;
  }>;
  stops?: TripStop[];
  journalEntries?: TripJournalEntry[];
  photos?: TripPhoto[];
  /** A stay linked to this trip via `LodgingStay.tripId` — always includes its `lodging` (GET /trips/:id). */
  lodgingStays?: (LodgingStay & { lodging: Lodging })[];
  immichAlbums?: LinkedAlbum[];
}

export interface TripPhoto {
  id: string;
  url: string;
  caption: string | null;
  takenAt: string | null;
  sortIdx: number;
  mimetype: string;
  sizeBytes: number;
  createdAt: string;
}

export interface FlightInput {
  /**
   * Set when the flight arrives from an import — a booking mail, a boarding
   * pass, a file. The server derives the provenance key from it; what counts
   * as "the same flight" is a rule about the data, not one each client should
   * restate.
   */
  importBatchId?: string | null;
  /** For the nullable fields in this interface: `null` clears the stored
   *  value on update; `undefined` leaves it alone. */
  airline?: string | null;
  airlineIata?: string;
  airlineIcao?: string;
  operatingAirline?: string | null;
  operatingAirlineIata?: string;
  operatingAirlineIcao?: string;
  isCodeshare?: boolean;
  flightNumber?: string | null;
  callsign?: string;
  aircraft?: string | null;
  aircraftRegistration?: string;
  aircraftModeS?: string;
  departure: Airport;
  arrival: Airport;
  // Canonical-UTC submission contract: send local wall-clock + IANA timezone
  // and let the server build the real UTC instant via fromZonedTime().
  // Format: "YYYY-MM-DDTHH:mm" (no TZ suffix, no seconds required).
  departureLocal?: string;
  depTimezone?: string | null;
  arrivalLocal?: string;
  arrTimezone?: string | null;
  /** null clears a stored actual time on update (delay resets with it). */
  actualDepartureLocal?: string | null;
  actualDepartureTz?: string;
  actualArrivalLocal?: string | null;
  actualArrivalTz?: string;
  // Match Flight's broader enum so Partial<Flight> assigns into
  // Partial<FlightInput> without a cast. The backend schema only accepts
  // UTC / DATE_ONLY / UNKNOWN — sending LEGACY_FAKE_UTC will 400, which is
  // intentional (it's a backend-only marker that should never be re-sent).
  depTimeSemantics?: "UTC" | "DATE_ONLY" | "UNKNOWN" | "LEGACY_FAKE_UTC";
  arrTimeSemantics?: "UTC" | "DATE_ONLY" | "UNKNOWN" | "LEGACY_FAKE_UTC";
  status?: "scheduled" | "flown" | "cancelled" | "historical" | "duplicated";
  dataSource?:
    | "manual"
    | "email_import"
    | "boarding_pass_scan"
    | "historical_enrichment"
    | "live_update"
    | "api_lookup"
    | "bulk_import";
  notes?: string | null;
  // Extended fields
  seatNumber?: string | null;
  /** `null` clears the stored value on update; `undefined` leaves it alone. */
  seatClass?: "economy" | "premium_economy" | "business" | "first" | null;
  boardingGroup?: string | null;
  gate?: string | null;
  terminal?: string | null;
  bookingReference?: string | null;
  ticketNumber?: string | null;
  price?: number | null;
  /** ISO 4217 alpha-3 code (EUR, USD, GBP, CHF, INR, JPY, …). */
  currency?: string;
  taxes?: number | null;
  fees?: number | null;
  /** `null` clears the stored value on update; `undefined` leaves it alone. */
  category?: "business" | "private" | "vacation" | null;
  tags?: string[];
  companions?: string[];
  receiptUrl?: string | null;
  baggageAllowance?: string | null;
  frequentFlyerNumber?: string | null;
  bookingClassLetter?: string | null;
  coPassengers?: string[];
  // Sonder-Flug (special flights) — see Flight interface
  specialType?:
    | "sightseeing"
    | "eclipse"
    | "rocket_launch"
    | "zerog"
    | "aurora"
    | "training"
    | "ferry"
    | "test"
    | null;
  eventLat?: number | null;
  eventLon?: number | null;
  eventLabel?: string | null;
  patternLat?: number | null;
  patternLon?: number | null;
  specialData?: Record<string, unknown> | null;
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
    | Array<"scheduled" | "flown" | "cancelled" | "historical" | "duplicated">;
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
      /** ISO 3166-1 alpha-2 country code (from /geo enrichment) — drives
       *  the flag in the map overlays. */
      country?: string | null;
      /** City the airport serves (from /geo enrichment). */
      city?: string | null;
      lat?: number;
      lon?: number;
    };
    arrivalAirport: {
      icao?: string;
      iata?: string;
      name?: string;
      country?: string | null;
      city?: string | null;
      lat?: number;
      lon?: number;
    };
    departureTime: string | null;
    arrivalTime: string | null;
    status: string;
    /** Trip this flight belongs to, if any. Exposed by the /geo endpoint
     *  so cross-domain journey mode can group flights + cruises by trip. */
    tripId?: string | null;
    category?: "business" | "private" | "vacation";
    tags?: string[];
    price?: number;
    /** ISO 4217 alpha-3 code (EUR, USD, GBP, CHF, INR, JPY, …). */
    currency?: string;
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
  // Domain the achievement belongs to. `shared` means "always show regardless of
  // which domains the user enabled". `string` fallback keeps us forward-compatible
  // with future domains the backend might introduce before the frontend learns them.
  domain: "flight" | "cruise" | "shared" | string;
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
  /** IATA code resolved by the catalogue; absent when nothing matches. The API
   *  has carried it since 2.5.0 — this side simply never declared it, so the
   *  card could not render what the endpoint was already sending. */
  iata?: string;
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
  /** Display vocabulary, ranked by flight count. */
  countries: CountryStat[];
  total: number;
  /** Counting vocabulary: lifetime departure countries as ISO alpha-2, so the
   *  cross-domain KPI can union them with the port catalogue without counting
   *  "Germany" and "DE" twice. Optional — an older backend omits it. */
  countriesIso?: string[];
  /** Departure countries keyed by year (the year on the clock at the
   *  departure airport), same ISO vocabulary. Optional so an older backend
   *  still parses. */
  byYear?: Record<string, string[]>;
}

export * from "./cruise";
export * from "./catalogue";

export interface AircraftRankingItem {
  registration: string;
  count: number;
  airline: string | null;
  aircraft: string | null;
  totalDistanceKm: number;
  firstFlightDate: string | null;
  lastFlightDate: string | null;
}

export interface AircraftRankingResponse {
  aircraft: AircraftRankingItem[];
  total: number;
}

export interface AircraftProfileFlight {
  id: string;
  flightNumber: string | null;
  airline: string | null;
  depIata: string | null;
  arrIata: string | null;
  depName: string | null;
  arrName: string | null;
  departureTime: string | null;
  arrivalTime: string | null;
  distanceKm: number;
  status: string;
}

export interface AircraftProfileResponse {
  registration: string;
  modeS: string | null;
  airline: string | null;
  aircraft: string | null;
  flightCount: number;
  totalDistanceKm: number;
  firstFlightDate: string | null;
  lastFlightDate: string | null;
  uniqueAirports: number;
  flights: AircraftProfileFlight[];
}
