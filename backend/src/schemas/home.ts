import { z } from "./zod";
import { MAX_HOME_AIRPORTS } from "../utils/homeAirport";

/**
 * The wire shapes of "Zuhause" — residence plus home airports, by date
 * (owner decision 2026-09-27; model in `utils/homeAirport.ts`).
 *
 * Refusals carry STABLE codes in `error` (`HOME_PERIODS_INVALID`,
 * `HOME_AIRPORT_UNKNOWN`) and the web maps them to DE/EN copy; the Zod issues
 * travel beside them for a developer, never for the screen.
 */

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

export const homeResidenceSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    placeRef: z.string().max(200).nullable().optional(),
  })
  .openapi("HomeResidence");

export const homeAirportChoiceSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(3)
      .max(4)
      .transform((v) => v.toUpperCase()),
    primary: z.boolean(),
  })
  .openapi("HomeAirportChoice");

export const homePeriodSchema = z
  .object({
    fromDate: isoDay.describe("Inclusive start."),
    toDate: isoDay.nullable().describe("Exclusive end; null for the home that runs now."),
    residence: homeResidenceSchema
      .nullable()
      .describe(
        "Where the user lived. Null only on a period migrated from the old one-airport " +
          "shape whose airport the catalogue does not know."
      ),
    residenceConfirmed: z
      .boolean()
      .describe(
        "False on a period migrated from the old shape: its residence is the airport, and " +
          "every statistic measures from there until the user confirms."
      ),
    airports: z
      .array(homeAirportChoiceSchema)
      .min(1)
      .max(MAX_HOME_AIRPORTS)
      .describe("One to three home airports, exactly one primary."),
  })
  .superRefine((period, ctx) => {
    if (period.airports.filter((a) => a.primary).length !== 1) {
      ctx.addIssue({ code: "custom", path: ["airports"], message: "exactly one primary" });
    }
    const codes = period.airports.map((a) => a.code);
    if (new Set(codes).size !== codes.length) {
      ctx.addIssue({ code: "custom", path: ["airports"], message: "duplicate airport" });
    }
    if (period.toDate !== null && period.toDate <= period.fromDate) {
      ctx.addIssue({ code: "custom", path: ["toDate"], message: "ends before it starts" });
    }
    if (period.residenceConfirmed && period.residence === null) {
      ctx.addIssue({
        code: "custom",
        path: ["residence"],
        message: "confirmed without a residence",
      });
    }
  })
  .openapi("HomePeriod");

export type HomePeriodInput = z.infer<typeof homePeriodSchema>;

/**
 * The whole list, replaced at once: periods may not overlap, and only the last
 * may be open. Gaps are allowed — the old shape allowed them, and a gap is an
 * honest "no home recorded" rather than a guess.
 */
export const homePeriodsBodySchema = z
  .object({ periods: z.array(homePeriodSchema).max(100) })
  .superRefine(({ periods }, ctx) => {
    const sorted = [...periods].sort((a, b) => (a.fromDate < b.fromDate ? -1 : 1));
    sorted.forEach((period, i) => {
      const next = sorted[i + 1];
      if (!next) return;
      if (period.toDate === null || period.toDate > next.fromDate) {
        ctx.addIssue({ code: "custom", path: ["periods", i], message: "overlaps the next period" });
      }
    });
  })
  .openapi("HomePeriodsBody");

/** What every home-airports endpoint answers: both shapes, side by side. */
export const homeAirportsResponseSchema = z
  .object({
    history: z
      .array(
        z.object({
          iata: z.string(),
          fromDate: isoDay,
          toDate: isoDay.nullable(),
        })
      )
      .describe(
        "The old one-airport shape, derived from `periods` (each period's primary). Kept " +
          "for clients that predate the rework — the Companion reads it."
      ),
    periods: z.array(homePeriodSchema),
  })
  .openapi("HomeAirports");

export const nearbyHomeAirportsQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
});

export const nearbyHomeAirportsResponseSchema = z
  .object({
    airports: z.array(
      z.object({
        code: z.string(),
        name: z.string(),
        city: z.string().nullable(),
        distanceKm: z.number(),
      })
    ),
  })
  .openapi("NearbyHomeAirports");
