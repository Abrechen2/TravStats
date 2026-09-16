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
  newCountries: z.number().int().openapi({
    description:
      "Countries first evidenced in this year AND reaching the user's counting " +
      "threshold. The threshold is taken from the passport rather than re-decided " +
      "here, so the story cannot count from a different tier than the headline it " +
      "sits next to.",
  }),
  cruises: z.number().int(),
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
});

export type WrappedRank = z.infer<typeof wrappedRankSchema>;
export type Wrapped = z.infer<typeof wrappedSchema>;
