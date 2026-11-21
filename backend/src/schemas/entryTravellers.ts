import { z } from "./zod";
import { TRAVELLER_ENTRY_TYPES } from "../services/companions/travellerFacts";

const uuid = z.string().uuid();

/** Plan D7: the entry types that carry per-traveller facts. */
export const travellerEntryRefSchema = z.object({ type: z.enum(TRAVELLER_ENTRY_TYPES), id: uuid });

export const travellersQuerySchema = z.object({
  entryType: z.enum(TRAVELLER_ENTRY_TYPES),
  entryId: uuid,
});

const fact = z.string().max(80).nullable().optional();

/**
 * A patch of one companion's facts. Only the fields of the entry's type are
 * accepted (seat for transport, cabin for a cruise, driver flag for a rental);
 * the service refuses a field the type does not have. "" or null clears.
 */
export const travellerFactsBodySchema = z
  .object({
    entry: travellerEntryRefSchema,
    facts: z
      .object({
        seatNumber: fact,
        seatClass: fact,
        ticketNumber: fact,
        bookingReference: fact,
        loyaltyNumber: fact,
        cabin: fact,
        isDriver: z.boolean().nullable().optional(),
      })
      .strict(),
  })
  .strict();

export const travellerRowSchema = z.object({
  companionId: uuid,
  displayName: z.string(),
  position: z.number().int(),
  facts: z.record(z.string(), z.union([z.string(), z.boolean(), z.null()])),
  factsSource: z.enum(["user", "auto"]).nullable(),
  documents: z.array(z.object({ id: uuid, displayName: z.string(), kind: z.string().nullable() })),
});
