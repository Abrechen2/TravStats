import { z } from "./zod";

/**
 * The shape of `GET /stats/wrapped` — the year in review.
 *
 * Described once, inferred by `services/stats/wrapped.ts` (forgejo#52).
 *
 * Two of the fields below exist so a client does not have to decide something
 * on the user's behalf, and the descriptions say which: `availableYears` keeps
 * a year picker from offering an empty story, and `comparisonYear` names the
 * one year that beat this one ONLY when exactly one did — rather than inventing
 * a ranking out of a tie.
 */

/** A chapter of a domain the user does not see is null — never a chapter of zeros. */
const wrappedChaptersSchema = z
  .object({
    lodging: z
      .object({
        stays: z.number().int().describe("Stays that are over, filed under the check-in's year"),
        nights: z.number().int().describe("Their known nights"),
        nightsUnknown: z.number().int().describe("Stays whose record does not say how many nights"),
      })
      .nullable(),
    places: z
      .object({
        visits: z.number().int().describe("Visits that happened, on the place's calendar"),
        places: z.number().int().describe("Distinct places among them"),
      })
      .nullable(),
    roadtrips: z
      .object({ roadtrips: z.number().int().describe("Roadtrips that started in the year") })
      .nullable(),
    tours: z
      .object({ tours: z.number().int().describe("Day tours dated in the year and past") })
      .nullable(),
    rentals: z
      .object({
        rentals: z.number().int().describe("Completed rentals, by the pickup's year"),
        days: z
          .number()
          .int()
          .describe("Their rental days — a rental figure, never added to travel days"),
      })
      .nullable(),
    bus: z
      .object({
        rides: z.number().int(),
        km: z.number().describe("Every distance source together; a ride without one adds none"),
        nights: z.number().int().describe("Nights on a night bus, by its clocks"),
      })
      .nullable(),
  })
  .openapi({
    description:
      "forgejo#265 — one chapter per further domain the user sees, each its own figure " +
      "and never summed across domains. Null for a hidden domain.",
  });

export const wrappedRankSchema = z.enum(["top", "second", "other"]);

export const wrappedSchema = z.object({
  year: z.number().int(),
  availableYears: z.array(z.number().int()).openapi({
    description:
      "Every year with countable activity, ascending. Here so a client can offer a " +
      "year picker without a second round trip — and so it never offers a year the " +
      "story would be empty for.",
  }),
  rank: wrappedRankSchema,
  comparisonYear: z.number().int().nullable().openapi({
    description: "The one year that beat this one, when exactly one did.",
  }),
  flights: z.number().int(),
  distanceKm: z.number(),
  earthFactor: z.number().openapi({
    description: "`distanceKm` in trips around the Earth, one decimal.",
  }),
  newCountries: z
    .number()
    .int()
    .openapi({
      description:
        "Countries first evidenced in this year AND reaching the user's counting " +
        "threshold. The threshold is taken from the passport rather than re-decided " +
        "here, so the story cannot count from a different tier than the headline it " +
        "sits next to.",
    }),
  cruises: z.number().int(),
  railRides: z.number().int().openapi({
    description: "Completed train rides that left in this year, on their station's calendar.",
  }),
  railKm: z.number().openapi({
    description: "Their kilometres, every distance source together; a ride without one adds none.",
  }),
  railStraightLineKm: z.number().openapi({
    description:
      "The part of `railKm` measured as the straight line between the stations, which " +
      "understates the track — shown as such, never folded in silently.",
  }),
  topAirline: z
    .object({
      name: z.string(),
      code: z.string().nullable(),
      flights: z.number().int(),
    })
    .nullable()
    .openapi({
      description:
        "The year's most-flown carrier. Null when no flight named one. `code` is the " +
        "two-letter prefix of the flight number when it is written the usual way, and " +
        "null rather than a guess otherwise — the name is the identity here, the code " +
        "only decorates a tile.",
    }),
  topRoute: z
    .object({
      from: z.string(),
      to: z.string(),
      flights: z.number().int(),
    })
    .nullable()
    .openapi({
      description: "The year's most-flown pair, codes sorted. Null when none is derivable.",
    }),
  chapters: wrappedChaptersSchema,
});

export type WrappedRank = z.infer<typeof wrappedRankSchema>;
export type Wrapped = z.infer<typeof wrappedSchema>;
