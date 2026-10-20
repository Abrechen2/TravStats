/**
 * The user's own verdicts on passport countries (forgejo#308). Enveloped (ADR 0001).
 */

import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import {
  countryOverrideBodySchema,
  countryOverrideRecordSchema,
} from "../../../schemas/countryOverride";

const tags = ["Passport"];
const err = (description: string) => ({ description, content: errorContent });
const ok = (description: string, data: z.ZodTypeAny) => ({
  description,
  content: { "application/json": { schema: z.object({ success: z.literal(true), data }) } },
});

const record = registry.register("CountryOverride", countryOverrideRecordSchema);
const params = z.object({
  countryCode: z.string().describe("ISO 3166-1 alpha-2; case does not matter"),
});
const unknownCountry = err("`COUNTRY_UNKNOWN`: the code names no country this server knows");
const demo = err("`DEMO_ACCOUNT_FORBIDDEN`: the shared demo account cannot change this");

registry.registerPath({
  method: "get",
  path: "/passport/overrides",
  summary: "The caller's verdicts on passport countries, and the codes a verdict may name",
  description:
    "An override is applied to the passport after the automatic count, so every figure built " +
    "on it — `/stats/passport`, the hero, badges, wrapped, comparison — gives the same answer. " +
    "`knownCountries` are exactly the codes `PUT` accepts.",
  tags,
  responses: {
    200: ok(
      "Sorted by country code",
      z.object({ overrides: z.array(record), knownCountries: z.array(z.string()) })
    ),
  },
});

registry.registerPath({
  method: "put",
  path: "/passport/overrides/{countryCode}",
  summary: "Set the caller's verdict on one country (create or replace)",
  description:
    "`visited`: counts as a visit, creating the row if no record shows the country. " +
    "`ground`: on the ground but not a visit. `excluded`: out of every set and total, " +
    "listed in the passport's `excludedCountries` so it can be undone. The note is required.",
  tags,
  request: {
    params,
    body: { content: { "application/json": { schema: countryOverrideBodySchema } } },
  },
  responses: {
    200: ok("The stored override", record),
    400: err("`COUNTRY_UNKNOWN`, or `VALIDATION_FAILED` for the body"),
    403: demo,
  },
});

registry.registerPath({
  method: "delete",
  path: "/passport/overrides/{countryCode}",
  summary: "Remove the caller's verdict on one country — the automatic count applies again",
  tags,
  request: { params },
  responses: {
    200: ok("Removed", z.object({ countryCode: z.string() })),
    400: unknownCountry,
    403: demo,
    404: err("`COUNTRY_OVERRIDE_NOT_FOUND`: the caller has no override for that country"),
  },
});
