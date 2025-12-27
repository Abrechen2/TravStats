export interface User {
  id: string;
  username: string;
  isAdmin: boolean;
  canTrainLLM?: boolean;
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
}

export interface Flight {
  id: string;
  userId: string;
  airline: string;
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
  departureTime: string;
  arrivalTime: string;
  status: 'scheduled' | 'flown' | 'cancelled';
  notes?: string;
  createdAt: string;
  // Costs & categorization
  price?: number;
  currency?: 'EUR' | 'USD' | 'GBP' | 'CHF';
  taxes?: number;
  fees?: number;
  category?: 'business' | 'private' | 'vacation';
  tags?: string[];
  receiptUrl?: string;
  // Extended fields
  seatNumber?: string;
  seatClass?: 'economy' | 'premium_economy' | 'business' | 'first';
  boardingGroup?: string;
  gate?: string;
  terminal?: string;
  bookingReference?: string;
  ticketNumber?: string;
}

export interface FlightInput {
  airline?: string;
  flightNumber?: string;
  callsign?: string;
  aircraft?: string;
  departure: Airport;
  arrival: Airport;
  departureTime: string;
  arrivalTime: string;
  status?: 'scheduled' | 'flown' | 'cancelled';
  notes?: string;
  // Extended fields
  seatNumber?: string;
  seatClass?: 'economy' | 'premium_economy' | 'business' | 'first';
  boardingGroup?: string;
  gate?: string;
  terminal?: string;
  bookingReference?: string;
  ticketNumber?: string;
  price?: number;
  currency?: 'EUR' | 'USD' | 'GBP' | 'CHF';
  taxes?: number;
  fees?: number;
  category?: 'business' | 'private' | 'vacation';
  tags?: string[];
  receiptUrl?: string;
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
  missing?: string[];
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
    | 'scheduled'
    | 'flown'
    | 'cancelled'
    | Array<'scheduled' | 'flown' | 'cancelled'>;
  category?: 'business' | 'private' | 'vacation';
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
  type: 'Feature';
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
    };
    arrivalAirport: {
      icao?: string;
      iata?: string;
      name?: string;
    };
    departureTime: string;
    arrivalTime: string;
    status: string;
    category?: 'business' | 'private' | 'vacation';
    tags?: string[];
    price?: number;
    currency?: 'EUR' | 'USD' | 'GBP' | 'CHF';
    taxes?: number;
    fees?: number;
    distance: number;
  };
  geometry: {
    type: 'LineString';
    coordinates: [number, number][];
  };
}

export interface GeoJSONFeatureCollection {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
}

export interface Achievement {
  id: string;
  code: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  tier: 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond';
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

export interface OnboardingState {
  flightAdded: boolean;
  usedFilter: boolean;
  exported: boolean;
  mapExplored: boolean;
  statsViewed: boolean;
  achievementsViewed: boolean;
  dismissed: boolean;
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
  sameDayReturns: number;
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
  roundTripMaster: number;
}