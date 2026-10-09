import { z } from "./zod";

/**
 * A booking's optional price split across its flight segments (forgejo#219).
 * The body of `PUT /flights/:id/booking/split`, and the shape stored in
 * `bookings.price_split`.
 */

export const BOOKING_SPLIT_METHODS = ["equal", "distance"] as const;
export type BookingSplitMethod = (typeof BOOKING_SPLIT_METHODS)[number];

export const bookingSplitBodySchema = z.object({
  method: z.enum(BOOKING_SPLIT_METHODS),
});

/** What is stored: the basis it was computed from, and one share per flight. */
export const storedBookingSplitSchema = z.object({
  method: z.enum(BOOKING_SPLIT_METHODS),
  price: z.number(),
  currency: z.string().nullable(),
  shares: z.array(z.object({ flightId: z.string(), amount: z.number() })),
});
export type StoredBookingSplit = z.infer<typeof storedBookingSplitSchema>;
