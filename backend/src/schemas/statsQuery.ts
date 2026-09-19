import { z } from "./zod";
import { STATS_PAGE_SECTIONS } from "./statsPage";

/**
 * The query and path parameters the `/stats` routes accept.
 *
 * Moved out of `routes/stats.ts`, which is on the file-size debt list and may
 * not grow: the ETag middleware (forgejo#50) needed the lines.
 */

// Shared schema for date-range query parameters
export const DateRangeQuerySchema = z.object({
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
});

// Extended schema for summary endpoint with year comparison support
export const SummaryQuerySchema = z.object({
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  year: z.coerce.number().int().min(1900).max(2100).optional(),
  compareYear: z.coerce.number().int().min(1900).max(2100).optional(),
});

/**
 * The country a detail page is asked for. Accepts an ISO alpha-2 code or an
 * English country name — `isoCountryCode` resolves both, and rejecting a name
 * here would make the endpoint stricter than the catalogue that feeds it. The
 * bound is the longest country name the table carries, with room to spare.
 */
export const CountryCodeParamSchema = z.object({
  code: z.string().trim().min(2).max(64),
});

// Wrapped — a year in review. Omitting `year` asks for the latest year that
// has anything in it; see services/stats/wrapped.ts rule 1.
export const WrappedQuerySchema = z.object({
  year: z.coerce.number().int().min(1900).max(2100).optional(),
});

// Timeseries endpoint — bucketed series + current/previous window totals
export const TimeseriesQuerySchema = z.object({
  domain: z.enum(["flight", "cruise"]).default("flight"),
  granularity: z.enum(["month", "year"]).default("month"),
  window: z.enum(["rolling12m", "year", "all"]).default("rolling12m"),
  year: z.coerce.number().int().min(1900).max(2100).optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
});

// Schema for routes query parameters
export const RoutesQuerySchema = z.object({
  limit: z.coerce.number().int().positive().optional(),
});

/**
 * `GET /stats/page` — which sections to compose (forgejo#49).
 *
 * A comma-separated list, and a REQUIRED one: there is no server-side default
 * set, because what the statistics page draws depends on the reader's own
 * section visibility, and a default would compute sections they have switched
 * off. An unknown name is a 400 rather than a silently absent section — a
 * typo'd `include` must not read as "that section has no data".
 */
export const StatsPageQuerySchema = z.object({
  include: z
    .string()
    .transform((raw) => raw.split(",").map((s) => s.trim()))
    .pipe(z.array(z.enum(STATS_PAGE_SECTIONS)).min(1)),
});
