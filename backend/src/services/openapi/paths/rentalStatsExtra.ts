import { z } from "zod";

/**
 * The `extra` block of GET /rentals/stats (forgejo#262), apart from
 * `rental.ts` so that file stays a list of paths. Every ratio names the
 * rentals it stands on; nothing is converted between currencies.
 */
export const rentalExtraStatsSchema = z
  .object({
    brokered: z.object({ viaBroker: z.number().int(), direct: z.number().int() }),
    kmPerDay: z
      .object({
        value: z.number().nullable().describe("Null when no rental in scope has known km"),
        rentals: z.number().int(),
        km: z.number(),
        days: z.number().int(),
      })
      .describe("Km and days of the SAME rentals — those with known km"),
    costPerKm: z
      .array(
        z.object({
          currency: z.string(),
          perKm: z.number(),
          rentals: z.number().int(),
          km: z.number(),
        })
      )
      .describe("Per currency, over rentals carrying both a known cost and known km"),
    bookedVsFinal: z
      .object({
        byCurrency: z.array(
          z.object({
            currency: z.string(),
            rentals: z.number().int(),
            booked: z.number(),
            final: z.number(),
            difference: z.number().describe("final − booked; positive = billed more"),
          })
        ),
        otherCurrency: z
          .number()
          .int()
          .describe("Billed in another currency than booked — never converted, compared nowhere"),
      })
      .describe("Only rentals whose final amount came from the invoice or a labelled correction"),
    vehicles: z.object({
      distinctDriven: z.number().int(),
      withDriven: z.number().int(),
      classes: z.array(z.object({ label: z.string(), rentals: z.number().int() })),
      promisedVsDriven: z
        .object({
          compared: z.number().int(),
          sameModel: z.number().int(),
          otherModel: z.number().int(),
        })
        .describe("Neutral: no class order exists, so nothing is called an upgrade"),
    }),
    records: z.object({
      longest: z
        .object({ id: z.string().uuid(), days: z.number().int(), provider: z.string() })
        .nullable(),
      farthest: z
        .object({ id: z.string().uuid(), km: z.number(), source: z.string().nullable() })
        .nullable(),
      newProviders: z
        .array(z.string())
        .describe("Providers whose FIRST completed rental falls in the period"),
    }),
    odometerDocumented: z.number().int().describe("Completed rentals with both odometer readings"),
  })
  .describe("forgejo#262");
