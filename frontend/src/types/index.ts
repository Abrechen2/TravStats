export interface User {
  id: string;
  username: string;
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
  // Extended fields
  seatNumber?: string;
  seatClass?: 'economy' | 'premium_economy' | 'business' | 'first';
  boardingGroup?: string;
  gate?: string;
  terminal?: string;
  bookingReference?: string;
  ticketNumber?: string;
  ticketPrice?: number;
  currency?: string;
  category?: 'business' | 'private' | 'vacation';
  tags?: string[];
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
  ticketPrice?: number;
  currency?: string;
  category?: 'business' | 'private' | 'vacation';
  tags?: string[];
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
  airline?: string;
  flightNumber?: string;
  fromDate?: string;
  toDate?: string;
  status?: 'scheduled' | 'flown' | 'cancelled';
}

export interface Stats {
  totalFlights: number;
  totalDistance: number;
  totalFlightTime: number;
  avgDistance: number;
  byStatus: Record<string, number>;
  byAirline: Record<string, number>;
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
