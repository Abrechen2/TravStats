import { z } from "./zod";
import { PURPOSES, PURPOSE_DOMAINS } from "../shared/purpose";

/**
 * Private or business (docs/superpowers/specs/2026-11-22-private-business-purpose.md).
 * Optional on every write: a client that does not send it leaves the stored value as it is, and
 * `null` clears it back to unknown.
 */
export const purposeField = z.enum(PURPOSES).nullable().optional();

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

export const setPurposeSchema = z.object({ purpose: z.enum(PURPOSES).nullable() }).strict();

/** `{ poi: ["business"], flight: [] }` — what the user hides per domain. */
export const purposeVisibilitySchema = z
  .object(
    Object.fromEntries(PURPOSE_DOMAINS.map((d) => [d, z.array(z.enum(PURPOSES)).max(2).optional()]))
  )
  .strict();
