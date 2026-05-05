import { api } from "./client";
import type { Trip, Booking } from "../../types";

export interface CreateTripInput {
  name: string;
  description?: string;
  color?: string;
}

export interface UpdateTripInput {
  name?: string;
  description?: string | null;
  color?: string;
}

export interface AssignFlightsInput {
  flightIds: string[];
  action: "add" | "remove";
}

export interface CreateBookingInput {
  tripId?: string;
  pnr?: string;
  price?: number;
  /** ISO 4217 alpha-3 code (EUR, USD, GBP, CHF, INR, JPY, …). */
  currency?: string;
  flightIds?: string[];
}

export const tripsApi = {
  getAll: async (): Promise<Trip[]> => {
    const { data } = await api.get<{ trips: Trip[] }>("/trips");
    return data.trips;
  },

  getById: async (id: string): Promise<Trip> => {
    const { data } = await api.get<{ trip: Trip }>(`/trips/${id}`);
    return data.trip;
  },

  create: async (input: CreateTripInput): Promise<Trip> => {
    const { data } = await api.post<{ trip: Trip }>("/trips", input);
    return data.trip;
  },

  update: async (id: string, input: UpdateTripInput): Promise<Trip> => {
    const { data } = await api.patch<{ trip: Trip }>(`/trips/${id}`, input);
    return data.trip;
  },

  delete: async (id: string): Promise<void> => {
    await api.delete(`/trips/${id}`);
  },

  assignFlights: async (tripId: string, input: AssignFlightsInput): Promise<void> => {
    await api.post(`/trips/${tripId}/flights`, input);
  },

  createBooking: async (input: CreateBookingInput): Promise<Booking> => {
    const { data } = await api.post<{ booking: Booking }>("/trips/bookings", input);
    return data.booking;
  },

  detect: async (input: { dryRun?: boolean } = { dryRun: true }): Promise<DetectTripsResult> => {
    const { data } = await api.post<DetectTripsResult>("/trips/detect", input);
    return data;
  },
};

export interface ProposedTrip {
  source: "pnr" | "home_loop" | "continuity";
  flightIds: string[];
  pnr: string | null;
  origin: string;
  destination: string;
  span: { from: string; to: string };
  suggestedName: string;
}

export interface DetectTripsResult {
  proposed: ProposedTrip[];
  created: Array<{ tripId: string; flightIds: string[]; pnr: string | null }>;
  orphansRemoved: number;
}
