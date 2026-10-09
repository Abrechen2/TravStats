import type { FlightBookingAnswer } from "../../types/flightBooking";
import { api } from "./client";

/**
 * A flight's booking and its segments (forgejo#218, #219). Its own module so
 * a page test can mock it without the whole flights API. Bare answers, like
 * every flights router (ADR 0001).
 */
export const flightBookingApi = {
  get: async (flightId: string): Promise<FlightBookingAnswer> => {
    const { data } = await api.get<FlightBookingAnswer>(
      `/flights/${encodeURIComponent(flightId)}/booking`
    );
    return data;
  },

  /** Store a display-only split of the booking total (forgejo#219); answers the booking as it now is. */
  split: async (flightId: string, method: "equal" | "distance"): Promise<FlightBookingAnswer> => {
    const { data } = await api.put<FlightBookingAnswer>(
      `/flights/${encodeURIComponent(flightId)}/booking/split`,
      { method }
    );
    return data;
  },

  removeSplit: async (flightId: string): Promise<FlightBookingAnswer> => {
    const { data } = await api.delete<FlightBookingAnswer>(
      `/flights/${encodeURIComponent(flightId)}/booking/split`
    );
    return data;
  },
};
