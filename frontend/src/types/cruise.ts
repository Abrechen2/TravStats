export interface Ship {
  id: number;
  name: string;
  imo: string | null;
  cruiseLine: string;
  yearBuilt: number | null;
  grossTonnage: number | null;
  capacity: number | null;
  status: string;
  isUserAdded: boolean;
}

export interface Port {
  id: number;
  name: string;
  city: string | null;
  country: string | null;
  unlocode: string | null;
  lat: number;
  lon: number;
  timezone: string | null;
  region: string | null;
  isUserAdded: boolean;
}

export interface CruiseStop {
  id: string;
  cruiseId: string;
  portId: number | null;
  port: Port | null;
  dayNumber: number;
  isAtSea: boolean;
  arrivalTime: string | null;
  departureTime: string | null;
  excursionNote: string | null;
}

export type CruiseStatus = "scheduled" | "flown" | "cancelled" | "historical";
export type CabinType = "inside" | "oceanview" | "balcony" | "suite";

export interface Cruise {
  id: string;
  userId: string;
  shipId: number | null;
  ship: Ship | null;
  shipNameOverride: string | null;
  cruiseLine: string | null;
  departurePortId: number | null;
  departurePort: Port | null;
  arrivalPortId: number | null;
  arrivalPort: Port | null;
  startDate: string | null;
  endDate: string | null;
  status: CruiseStatus;
  cabinNumber: string | null;
  cabinType: CabinType | null;
  deck: number | null;
  bookingReference: string | null;
  price: number | null;
  currency: string | null;
  notes: string | null;
  tags: string[];
  companions: string[];
  tripId: string | null;
  bookingId: string | null;
  stops: CruiseStop[];
  createdAt: string;
  updatedAt: string;
}

export interface CruiseStopInput {
  portId: number | null;
  dayNumber: number;
  isAtSea: boolean;
  arrivalTime?: string | null;
  departureTime?: string | null;
  excursionNote?: string;
}

export interface CruiseInput {
  shipId?: number | null;
  shipNameOverride?: string;
  cruiseLine?: string;
  departurePortId?: number | null;
  arrivalPortId?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  status?: CruiseStatus;
  cabinNumber?: string;
  cabinType?: CabinType;
  deck?: number;
  bookingReference?: string;
  price?: number;
  currency?: "EUR" | "USD" | "GBP" | "CHF";
  notes?: string;
  tags?: string[];
  companions?: string[];
  tripId?: string | null;
  bookingId?: string | null;
  stops?: CruiseStopInput[];
}
