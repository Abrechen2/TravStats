import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import { travTrackCityLookupSchema, travTrackMonthsQuerySchema } from "../../../schemas/travtrack";

/** TravTrack's monthly values and their city-lookup switch (TravTrack plan L3). */

const city = z.object({
  name: z.string(),
  countryCode: z.string().nullable().describe("ISO 3166-1 alpha-2, resolved offline"),
});

const months = z.object({
  months: z
    .array(
      z.object({
        month: z.string().describe("`YYYY-MM`, a UTC month"),
        kmGround: z
          .number()
          .describe(
            "Kilometres on the ground along the privacy-safe line: no step in the air, faster " +
              "than 500 km/h, or hidden by a privacy zone"
          ),
        countries: z.array(z.string()).describe("ISO alpha-2 codes of the month's country days"),
        cities: z
          .array(city)
          .nullable()
          .describe("Cities stayed in for 30 minutes or more; null: not determined"),
        daysWithData: z.number().int(),
        daysPaused: z.number().int().describe("Days the phone reported it could not record"),
      })
    )
    .describe("Months holding data only: a month without data is absent, never zero"),
  pending: z
    .array(z.string())
    .describe("`YYYY-MM` of months still being recomputed: their values may change"),
});

const lookup = z.object({ enabled: z.boolean() });

const forbidden = {
  description: "TRAVTRACK_DISABLED: TravTrack is switched off on this server",
  content: errorContent,
};

registry.registerPath({
  method: "get",
  path: "/travtrack/months",
  summary: "Monthly values",
  description:
    "Per UTC month of the year: ground kilometres, countries and — only when the account " +
    "switched the city lookup on — cities. Own account only; only while TravTrack is on.",
  tags: ["TravTrack"],
  request: { query: travTrackMonthsQuerySchema },
  responses: {
    200: { description: "The months", content: { "application/json": { schema: months } } },
    400: { description: "VALIDATION_FAILED: not a year", content: errorContent },
    403: forbidden,
  },
});

registry.registerPath({
  method: "get",
  path: "/travtrack/city-lookup",
  summary: "Whether the monthly values name cities",
  tags: ["TravTrack"],
  responses: {
    200: { description: "The switch", content: { "application/json": { schema: lookup } } },
    403: forbidden,
  },
});

registry.registerPath({
  method: "put",
  path: "/travtrack/city-lookup",
  summary: "Switch the city lookup",
  description:
    "On, rounded positions (0.01°) of stays are sent to the server's reverse geocoder, which " +
    "may be a public Nominatim. Off, the cities already named are removed at once.",
  tags: ["TravTrack"],
  request: {
    body: { content: { "application/json": { schema: travTrackCityLookupSchema } } },
  },
  responses: {
    200: { description: "The switch", content: { "application/json": { schema: lookup } } },
    400: { description: "VALIDATION_FAILED: not a switch", content: errorContent },
    403: forbidden,
  },
});
