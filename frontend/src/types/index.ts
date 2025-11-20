export interface User {
  id: string;
  username: string;
}

export interface Airport {
  icao?: string;
  iata?: string;
  name?: string;
  lat: number;
  lon: number;
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
}

export interface FlightInput {
  airline: string;
  flightNumber: string;
  callsign?: string;
  aircraft?: string;
  departure: Airport;
  arrival: Airport;
  departureTime: string;
  arrivalTime: string;
  status?: 'scheduled' | 'flown' | 'cancelled';
  notes?: string;
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
