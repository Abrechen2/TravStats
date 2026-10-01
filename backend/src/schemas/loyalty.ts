import { z } from "./zod";

import { LOYALTY_DOMAINS, type LoyaltyDomain } from "../shared/domains";

/**
 * Loyalty memberships across domains (owner, 2026-09-25) — the write shapes
 * of `routes/loyaltyMemberships.ts`.
 *
 * A card is the same thing in every domain; what it COVERS is not. Each domain
 * has exactly one coverage field and the others are refused rather than
 * silently stored: an airline code on a hotel card would sit in the table
 * covering nothing, and the page would have nowhere to show or remove it.
 */

/** Two letters or digits — the shape of an IATA airline designator. */
const iataAirline = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{2}$/, "Expected a two-character IATA airline code");

// Limits match the lodging schema's where the field is the same field, so a
// card saved through either router fits the other.
const cardFields = {
  programName: z.string().trim().min(1).max(120),
  membershipNumber: z.string().trim().max(60).nullable().optional(),
  /** The status held today — the only status a card keeps (no dated history). */
  tier: z.string().trim().max(40).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  airlineCodes: z.array(iataAirline).max(50).optional(),
  cruiseLines: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  /** Rail cards: operators as the rides name them ("DB Fernverkehr"). */
  railOperators: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  chainIds: z.array(z.number().int().positive()).max(100).optional(),
  lodgingIds: z.array(z.string().uuid()).max(500).optional(),
};

type CardFields = { [K in keyof typeof cardFields]?: unknown };

/** The coverage field each domain owns; every other one must stay absent or empty. */
const COVERAGE_FIELDS: Record<LoyaltyDomain, ReadonlyArray<keyof CardFields>> = {
  flight: ["airlineCodes"],
  cruise: ["cruiseLines"],
  lodging: ["chainIds", "lodgingIds"],
  rail: ["railOperators"],
  // A rental card (two senders print provider loyalty numbers) is stored and
  // shown, but covers no rentals by itself yet: the spec names no coverage
  // field for it, so it claims none rather than guessing one.
  rental: [],
};
const ALL_COVERAGE: ReadonlyArray<keyof CardFields> = [
  "airlineCodes",
  "cruiseLines",
  "railOperators",
  "chainIds",
  "lodgingIds",
];

/**
 * The coverage fields in `input` that do not belong to `domain`. An empty
 * array is accepted anywhere — it states "covers nothing", which is true of
 * every foreign field.
 */
export function foreignCoverage(domain: LoyaltyDomain, input: CardFields): string[] {
  const own = COVERAGE_FIELDS[domain];
  return ALL_COVERAGE.filter((field) => {
    if (own.includes(field)) return false;
    const value = input[field];
    return Array.isArray(value) && value.length > 0;
  });
}

export const createLoyaltyMembershipSchema = z
  .object({ domain: z.enum(LOYALTY_DOMAINS), ...cardFields })
  .superRefine((input, ctx) => {
    for (const field of foreignCoverage(input.domain, input)) {
      ctx.addIssue({
        code: "custom",
        path: [field],
        message: `A ${input.domain} membership cannot carry ${field}`,
      });
    }
  });

/**
 * `domain` is not accepted on update: a card is fixed to the domain it was
 * made in (see `LoyaltyMembership` in schema.prisma). The route checks the
 * coverage fields against the stored domain.
 */
export const updateLoyaltyMembershipSchema = z
  .object(cardFields)
  .partial()
  .strict()
  .refine((d) => Object.keys(d).length > 0, {
    message: "At least one field must be provided for update",
  });

export type CreateLoyaltyMembershipInput = z.infer<typeof createLoyaltyMembershipSchema>;
export type UpdateLoyaltyMembershipInput = z.infer<typeof updateLoyaltyMembershipSchema>;
