import { z } from "./zod";

/**
 * A booking's optional price split (forgejo#219, widened to packages in
 * forgejo#430). The body of `PUT /flights/:id/booking/split`, and the shape
 * stored in `bookings.price_split`.
 */

export const BOOKING_SPLIT_METHODS = ["equal", "distance"] as const;
export type BookingSplitMethod = (typeof BOOKING_SPLIT_METHODS)[number];

/** Every method a stored split can carry: the two computed ones and the user's own amounts. */
export const STORED_SPLIT_METHODS = ["equal", "distance", "manual"] as const;
export type StoredSplitMethod = (typeof STORED_SPLIT_METHODS)[number];

/** The entry kinds a booking can sell (forgejo#430). */
export const BOOKING_ENTRY_KINDS = [
  "flight",
  "stay",
  "cruise",
  "rail",
  "bus",
  "ferry",
  "rental",
] as const;
export type BookingEntryKind = (typeof BOOKING_ENTRY_KINDS)[number];

export const bookingSplitBodySchema = z.object({
  method: z.enum(BOOKING_SPLIT_METHODS),
});

/**
 * One share. A version-1 split (forgejo#219) stored `{ flightId, amount }`;
 * it reads as a flight share. Flight shares keep `flightId` on write so an
 * installed Companion that only knows that field keeps reading them.
 */
const storedShareSchema = z
  .object({
    kind: z.enum(BOOKING_ENTRY_KINDS).optional(),
    id: z.string().optional(),
    flightId: z.string().optional(),
    amount: z.number(),
  })
  .transform((s, ctx) => {
    const kind = s.kind ?? (s.flightId ? "flight" : undefined);
    const id = s.id ?? s.flightId;
    if (!kind || !id) {
      ctx.addIssue({ code: "custom", message: "share names no entry" });
      return z.NEVER;
    }
    return { kind, id, amount: s.amount, ...(kind === "flight" ? { flightId: id } : {}) };
  });

/** What is stored: the basis it was computed from, and one share per entry. */
export const storedBookingSplitSchema = z.object({
  method: z.enum(STORED_SPLIT_METHODS),
  price: z.number(),
  currency: z.string().nullable(),
  shares: z.array(storedShareSchema),
  /**
   * Set by the database trigger when an item joined, left or was deleted
   * after the split was made (forgejo#430). The amounts stay for the user to
   * check; until a new split is saved the statistics read it as no split.
   */
  stale: z.boolean().optional(),
});
export type StoredBookingSplit = z.infer<typeof storedBookingSplitSchema>;
export type StoredBookingShare = StoredBookingSplit["shares"][number];

/** `PUT /trips/bookings/:id/split` — equal across every paying item, or the user's own amounts. */
export const packageSplitBodySchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("equal") }),
  z.object({
    method: z.literal("manual"),
    shares: z
      .array(
        z.object({
          kind: z.enum(BOOKING_ENTRY_KINDS),
          id: z.string().min(1).max(64),
          amount: z.number().finite().min(0),
        })
      )
      .min(1)
      .max(200),
  }),
]);
export type PackageSplitBody = z.infer<typeof packageSplitBodySchema>;
