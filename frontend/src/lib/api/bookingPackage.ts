import type { BookingPackageAnswer, BookingPackageSplitBody } from "../../types/bookingPackage";
import { api } from "./client";

/**
 * A booking with every entry it sold and the split of its one price
 * (forgejo#430). Bare answers, like the other booking routes (ADR 0001).
 */
export const bookingPackageApi = {
  get: async (bookingId: string): Promise<BookingPackageAnswer> => {
    const { data } = await api.get<BookingPackageAnswer>(
      `/trips/bookings/${encodeURIComponent(bookingId)}`
    );
    return data;
  },

  split: async (
    bookingId: string,
    body: BookingPackageSplitBody
  ): Promise<BookingPackageAnswer> => {
    const { data } = await api.put<BookingPackageAnswer>(
      `/trips/bookings/${encodeURIComponent(bookingId)}/split`,
      body
    );
    return data;
  },

  removeSplit: async (bookingId: string): Promise<BookingPackageAnswer> => {
    const { data } = await api.delete<BookingPackageAnswer>(
      `/trips/bookings/${encodeURIComponent(bookingId)}/split`
    );
    return data;
  },
};
