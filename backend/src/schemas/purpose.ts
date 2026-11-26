import { z } from "./zod";
import { PURPOSES, PURPOSE_DOMAINS } from "../shared/purpose";
import { BUILTIN_PURPOSES, PURPOSE_ICONS, isPurposeValue } from "../shared/purposeCatalogue";

/**
 * A purpose as a client writes it: the legacy kind (`private` | `business`, accepted forever) or a
 * detailed key (`builtin:<key>` | `custom:<uuid>`, shared/purposeCatalogue.ts). The Prisma hook
 * splits a key into kind + detail (services/purpose/purposeKeyWrite.ts).
 */
export const purposeValue = z
  .string()
  .max(60)
  .refine(isPurposeValue, { message: "Unknown purpose" });

/**
 * Private or business, or a detailed purpose (docs/superpowers/specs/2026-11-22-private-business-purpose.md).
 * Optional on every write: a client that does not send it leaves the stored value as it is, and
 * `null` clears it back to unknown.
 */
export const purposeField = purposeValue.nullable().optional();

/** The kinds of entry (a tour or roadtrip is a `tripRoute`) that can carry a purpose, in the names of their Prisma delegates. */
export const PURPOSE_ENTRY_TYPES = [
  "placeVisit",
  "flight",
  "lodgingStay",
  "railJourney",
  "busJourney",
  "ferryJourney",
  "rentalBooking",
  "cruise",
  "tripRoute",
] as const;
export type PurposeEntryType = (typeof PURPOSE_ENTRY_TYPES)[number];

export const setPurposeSchema = z.object({ purpose: purposeValue.nullable() }).strict();

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** A user's own purpose: a name, an optional English name, a colour, an icon and its kind. */
export const customPurposeCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    nameEn: z.string().trim().max(60).nullable().optional(),
    kind: z.enum(PURPOSES),
    color: hexColor,
    icon: z.enum(PURPOSE_ICONS),
  })
  .strict();

export const customPurposeUpdateSchema = customPurposeCreateSchema
  .partial()
  .extend({ archived: z.boolean().optional() })
  .strict();

/** The built-in keys, for the OpenAPI enum and tests. */
export const BUILTIN_PURPOSE_KEYS = BUILTIN_PURPOSES.map((p) => `builtin:${p.key}`);

/** `{ poi: ["business"], flight: [] }` — what the user hides per domain. */
export const purposeVisibilitySchema = z
  .object(
    Object.fromEntries(PURPOSE_DOMAINS.map((d) => [d, z.array(z.enum(PURPOSES)).max(2).optional()]))
  )
  .strict();
