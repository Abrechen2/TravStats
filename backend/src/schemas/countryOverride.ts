/**
 * The user's verdict on a passport country (forgejo#308) — the request body of
 * `PUT /passport/overrides/{countryCode}` and the shapes the passport and the
 * country drill-down publish it in. What the verdicts mean is
 * `services/stats/countryOverrides.ts`.
 */
import { z } from "./zod";
import { COUNTRY_OVERRIDE_VERDICTS } from "../services/stats/countryOverrides";
import { isKnownCountryCode } from "../utils/continents";

export const countryOverrideVerdictSchema = z.enum(COUNTRY_OVERRIDE_VERDICTS).openapi({
  description:
    "`visited`: counts as a visit. `ground`: on the ground, not a visit. " +
    "`excluded`: out of every set and total, listed in `excludedCountries` to be undone.",
});

/** A calendar day the user remembers, `YYYY-MM-DD`, checked to be a real date. */
const daySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((day) => {
    const parsed = new Date(`${day}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day;
  }, "Not a calendar day");

export const countryOverrideBodySchema = z
  .object({
    verdict: countryOverrideVerdictSchema,
    note: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .openapi({ description: "Why — required, 1–500 characters" }),
    day: daySchema
      .nullable()
      .optional()
      .openapi({ description: "A day the user remembers; never invented" }),
  })
  .strict();

/**
 * The path parameter. Upper-cased first, then checked against the countries
 * this server knows — a code it cannot place on a continent is refused, not
 * stored as a row named after itself.
 */
export const countryOverrideCodeSchema = z
  .string()
  .trim()
  .transform((code) => code.toUpperCase())
  .refine(isKnownCountryCode, "Unknown country");

export const countryOverrideViewSchema = z.object({
  verdict: countryOverrideVerdictSchema,
  note: z.string(),
  day: z.string().nullable(),
});

export const countryOverrideRecordSchema = countryOverrideViewSchema.extend({
  countryCode: z.string().openapi({ description: "ISO 3166-1 alpha-2, upper case" }),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const excludedCountrySchema = z.object({
  code: z.string(),
  note: z.string(),
  day: z.string().nullable(),
});
