import { z } from "zod";

import { registry } from "../registry";

const modeStats = z.object({
  mode: z.enum(["rail", "bus", "ferry", "cruise", "rental"]),
  records: z.number().describe("Records in the mode's counting population"),
  measured: z.number().describe("Of those, how many have an estimate (a known distance)"),
  kg: z.number().nullable().describe("Null when no record could be measured, never 0"),
  distanceKm: z.number(),
  lowerBound: z.boolean().describe("True for the cruise proxy, which understates by construction"),
  kinds: z.array(z.object({ factor: z.string(), rides: z.number(), kg: z.number() })),
  savedVsFlightKg: z
    .number()
    .nullable()
    .describe("Estimate: kg saved against an economy flight over the same great-circle distance"),
  comparedRides: z.number(),
});

const co2Stats = registry.register(
  "Co2Stats",
  z
    .object({
      flights: z.object({
        records: z.number(),
        measured: z.number(),
        kg: z.number().nullable(),
      }),
      modes: z.array(modeStats),
      totalKg: z
        .number()
        .nullable()
        .describe("Flights plus every mode with a figure; the parts are listed beside it"),
      savedVsFlightKg: z.number().nullable(),
      comparedRides: z.number(),
      source: z.object({
        publisher: z.string(),
        title: z.string(),
        year: z.number(),
        url: z.string(),
      }),
    })
    .openapi("Co2Stats")
);

registry.registerPath({
  method: "get",
  path: "/stats/co2",
  summary: "Carbon per mode of travel, lifetime",
  description:
    "Estimated CO2 for rail (including tram and metro, listed by factor), bus, ferry, " +
    "cruise and rental cars, beside the flight figure. Factors are the UK DESNZ " +
    "conversion factors named in `source` (direct emissions per passenger-km, per " +
    "vehicle-km for a rental car); the cruise figure applies the ferry average over " +
    "the voyage's leg distance and is a lower bound. A ride without a known distance " +
    "is left out (`measured` < `records`), never counted as 0. `totalKg` adds the " +
    "parts; each is returned beside it. `savedVsFlightKg` is an estimate against an " +
    "economy flight over the same great-circle distance, for rail and bus rides.",
  tags: ["Stats"],
  responses: {
    200: {
      description: "Carbon per mode",
      content: { "application/json": { schema: co2Stats } },
    },
  },
});
