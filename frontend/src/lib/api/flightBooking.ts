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
};
