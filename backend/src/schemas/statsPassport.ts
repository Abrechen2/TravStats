/**
 * The passport row's wire shape (`GET /stats/passport`), split out of
 * `services/openapi/paths/stats.ts` at the 800-line limit.
 */
import { z } from "./zod";
import { DOMAIN_KEYS } from "../shared/domains";

export const continentSchema = z.enum([
  "Africa",
  "Antarctica",
  "Asia",
  "Europe",
  "North America",
  "Oceania",
  "South America",
]);
export const evidenceKindSchema = z.enum([
  "flight",
  "lodging",
  "port",
  "place",
  "rail",
  "bus",
  "ferry",
  "roadtrip",
  "track",
]);
export const countryTierSchema = z.enum(["slept", "visited", "transited", "connection"]);

const visitUnclearReasonSchema = z.enum(["openChain", "noDestination", "undated"]);

export const passportCountrySchema = z.object({
  groundPresence: z.boolean().describe('"Am Boden gewesen" — true on every row'),
  visited: z.boolean().describe('"Land besucht" (forgejo#299); equals `counted`'),
  visitUncertain: z.boolean().describe("Not visited, and the records cannot decide it: unclear"),
  visitUncertainReasons: z
    .array(visitUnclearReasonSchema)
    .describe("Why the visit is unclear, sorted; empty unless `visitUncertain`"),
  visitSources: z
    .array(
      z.object({
        domain: z.enum(DOMAIN_KEYS),
        years: z.array(z.number().int()).describe("Years with a dated record proving the visit"),
        undated: z.boolean().describe("A proving record carries no date (lifetime only)"),
      })
    )
    .describe(
      "Which domains prove the visit and when — the index the Stats overview's " +
        "'Länder besucht' tile and its evidence fold by chip and year; empty unless `visited`"
    ),
  code: z
    .string()
    .describe("ISO 3166-1 alpha-2. A code, never a flag: flags are political and age"),
  continent: continentSchema.nullable(),
  entries: z
    .number()
    .describe("Flights that began or ended here; 0 for a country proved another way"),
  firstYear: z.number().nullable(),
  firstVisitedYear: z.number().nullable().optional(),
  lastYear: z.number().nullable(),
  airports: z.array(z.string()).describe("IATA codes used here, first visit first"),
  isHome: z.boolean(),
  isNew: z.boolean().describe("First confirmed visit in the current calendar year"),
  evidence: evidenceKindSchema.describe("The strongest KIND of record behind this country"),
  tier: countryTierSchema.describe("How strong that evidence is"),
  kinds: z.array(evidenceKindSchema).describe("Every kind that contributed, alphabetical"),
  hasUndatedEvidence: z.boolean(),
  daysPresent: z.number().describe("Distinct calendar days any record ATTESTS the traveller here"),
  groundTime: z.discriminatedUnion("state", [
    z.object({ state: z.literal("measured"), minutes: z.number() }),
    z.object({ state: z.literal("unknown") }),
    z.object({ state: z.literal("notApplicable") }),
  ]),
  counted: z
    .boolean()
    .describe("Whether the row reaches `summary.countries`; a false greys, never removes"),
  portCalls: z.number().describe("Port calls of sailed cruises in this country"),
  places: z.number().describe("Recorded visits to places in this country"),
  lodging: z
    .object({
      place: z
        .string()
        .nullable()
        .describe(
          "The city of the house with the most proved nights; null when none names one. The client abbreviates — there is no canonical short code for a city"
        ),
      nights: z
        .number()
        .nullable()
        .describe(
          "Nights proved by stays that happened. Null when no stay proves a span — 'slept here, nobody knows how long' — never 0, which would claim zero nights"
        ),
    })
    .nullable()
    .describe("The lodging stamp. Null when no house proves this country"),
});
