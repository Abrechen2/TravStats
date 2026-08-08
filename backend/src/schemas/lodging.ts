import { z } from "zod";
import { receiptUrlValidator } from "./receiptUrl";

export const LODGING_TYPES = ["hotel", "campsite", "guesthouse", "apartment", "hostel"] as const;
export const BOARD_TYPES = [
  "none",
  "breakfast",
  "half",
  "full",
  "all_inclusive",
] as const;
// `in_progress` joined the vocabulary when lodging status became derived from
// the dates (Alex, 2026-07-12) — a stay whose check-in has passed but whose
// check-out has not is "laufend", the same three-way split cruises already use.
// The wire still ACCEPTS all four so an importer or an older client is never
// rejected, but only "cancelled" survives derivation; see deriveLodgingStatus.
export const STAY_STATUSES = ["scheduled", "in_progress", "completed", "cancelled"] as const;
export const CURRENCIES = ["EUR", "USD", "GBP", "CHF"] as const;

// Accept partial datetimes and coerce them to full ISO 8601, mirroring schemas/cruise.ts.
const isoDateTimeRequired = z.preprocess((v) => {
  if (typeof v !== "string" || v === "") return v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toISOString();
}, z.string().datetime());

// `.nullable()` on every field a user can explicitly CLEAR in the editors
// (finding 4) — an emitted `null` must round-trip as "delete this value",
// distinct from an omitted key ("leave it alone"). Fields that already had
// a dedicated "not set" sentinel before this fix (chainId, lat/lon, stars)
// were already nullable; this only adds the ones that previously had no way
// to be cleared once set.
const rating = z.number().min(1).max(5).nullable().optional();

const baseLodgingSchema = z.object({
  type: z.enum(LODGING_TYPES).default("hotel"),
  name: z.string().trim().min(1).max(200),
  chainId: z.number().int().positive().nullable().optional(),
  address: z.string().max(300).nullable().optional(),
  city: z.string().max(120).nullable().optional(),
  country: z.string().max(120).nullable().optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lon: z.number().min(-180).max(180).nullable().optional(),
  stars: z.number().int().min(1).max(5).nullable().optional(),
  amenities: z.array(z.string().max(60)).max(50).optional(),
  notes: z
    .string()
    .transform((v) => v.replace(/<[^>]*>/g, ""))
    .nullable()
    .optional(),
});

export const createLodgingSchema = baseLodgingSchema;
export const updateLodgingSchema = baseLodgingSchema
  .partial()
  .refine((d) => Object.keys(d).length > 0, {
    message: "At least one field must be provided for update",
  });

const baseStaySchema = z.object({
  checkIn: isoDateTimeRequired,
  checkOut: isoDateTimeRequired,
  status: z.enum(STAY_STATUSES).default("completed"),
  tripId: z.string().uuid().nullable().optional(),
  bookingId: z.string().uuid().nullable().optional(),
  roomNumber: z.string().max(20).nullable().optional(),
  roomCategory: z.string().max(120).nullable().optional(),
  board: z.enum(BOARD_TYPES).optional(),
  pricePerNight: z.number().min(0).nullable().optional(),
  // Optional here even though the DB column is NOT NULL DEFAULT 'EUR' — omitting it
  // lets the client fall back to the column default rather than forcing every caller
  // to send a currency.
  currency: z.enum(CURRENCIES).optional(),
  // Nullable so a user can explicitly clear a price (e.g. an award stay that
  // turns out to have cost nothing) — an explicit `null` here also drives the
  // FX snapshot clear in routes/lodging.ts (finding 1 + finding 4 interact).
  totalPrice: z.number().min(0).nullable().optional(),
  isAwardStay: z.boolean().optional(),
  ratingRoom: rating,
  ratingBreakfast: rating,
  ratingService: rating,
  ratingOverall: rating,
  roomAmenities: z.array(z.string().max(60)).max(50).optional(),
  bookingReference: z.string().max(40).nullable().optional(),
  membershipId: z.string().uuid().nullable().optional(),
  receiptUrl: receiptUrlValidator.nullable(),
  companions: z.array(z.string().max(100)).max(50).optional(),
  notes: z
    .string()
    .transform((v) => v.replace(/<[^>]*>/g, ""))
    .nullable()
    .optional(),
});

export const createStaySchema = baseStaySchema.refine(
  (d) => new Date(d.checkOut).getTime() >= new Date(d.checkIn).getTime(),
  { message: "checkOut must not precede checkIn", path: ["checkOut"] },
);
export const updateStaySchema = baseStaySchema
  .partial()
  .refine((d) => Object.keys(d).length > 0, {
    message: "At least one field must be provided for update",
  })
  .refine(
    (d) => {
      if (!d.checkIn || !d.checkOut) return true;
      return new Date(d.checkOut).getTime() >= new Date(d.checkIn).getTime();
    },
    { message: "checkOut must not precede checkIn", path: ["checkOut"] },
  );

export const lodgingQuerySchema = z.object({
  type: z.enum(LODGING_TYPES).optional(),
  chainId: z.coerce.number().int().positive().optional(),
  tripId: z.string().uuid().optional(),
  year: z.coerce.number().int().min(1900).max(2200).optional(),
  country: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  sort: z.enum(["nights", "rating", "spend", "name", "checkIn"]).optional(),
});

// A membership is still PROGRAM-shaped — one card, one programme name, several
// chains (Sheraton/Westin/Ritz-Carlton -> Marriott Bonvoy). What changed is how
// the chains are attached: `chainIds` is an explicit list of ids, never a single
// `chainId` and no longer a string match on the programme name. Loyalty
// programmes get rebranded, so the name is the user's own free text and the ids
// carry the link (see `LodgingMembershipChain` in schema.prisma).
//
// An ABSENT `chainIds` means "leave the links as they are" — only an array
// present in the body replaces them, so a PATCH that just fixes a tier can
// never silently unlink every chain.
const baseMembershipSchema = z.object({
  programName: z.string().trim().min(1).max(120),
  membershipNumber: z.string().max(60).optional(),
  tier: z.string().max(40).optional(),
  chainIds: z.array(z.number().int().positive()).max(100).optional(),
});
export const createMembershipSchema = baseMembershipSchema;
export const updateMembershipSchema = baseMembershipSchema
  .partial()
  .refine((d) => Object.keys(d).length > 0, {
    message: "At least one field must be provided for update",
  });

export type LodgingInput = z.infer<typeof baseLodgingSchema>;
export type StayInput = z.infer<typeof baseStaySchema>;
export type LodgingQueryInput = z.infer<typeof lodgingQuerySchema>;
export type MembershipInput = z.infer<typeof baseMembershipSchema>;
