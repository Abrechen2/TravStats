/**
 * Open data (2.7, 2026-09-24): Open-Meteo weather and elevations, Wikipedia
 * summaries through Wikidata, and a house's facts from OpenStreetMap.
 *
 * Every endpoint answers 409 `{ error: "openDataDisabled" }` while the
 * instance's `openDataEnabled` switch is off (the default).
 */

import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";

const disabled = {
  description: "The instance's open data switch is off",
  content: {
    "application/json": {
      schema: z.object({ error: z.literal("openDataDisabled"), message: z.string() }),
    },
  },
};
const notFound = { description: "Not found", content: errorContent };
const uuid = z.string().uuid();

const observedWeather = registry.register(
  "ObservedWeather",
  z
    .object({
      code: z.number().int().describe("WMO weather interpretation code"),
      tMaxC: z.number(),
      tMinC: z.number(),
      precipMm: z.number(),
      place: z.string().describe("The trip stop the day was measured at"),
      lat: z.number(),
      lon: z.number(),
      source: z.literal("open-meteo"),
      fetchedAt: z.string(),
    })
    .openapi("ObservedWeather")
);

const journalEntry = z.object({
  id: uuid,
  tripId: uuid,
  date: z.string(),
  title: z.string().nullable(),
  body: z.string(),
  mood: z.string().nullable(),
  weather: z.string().nullable().describe("The author's own words"),
  observedWeather: observedWeather.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const plannedProfile = registry.register(
  "PlannedElevationProfile",
  z
    .object({
      distanceKm: z.number(),
      ascentM: z.number().nullable(),
      descentM: z.number().nullable(),
      profile: z.array(z.tuple([z.number(), z.number()])).describe("[km, m] pairs"),
    })
    .openapi("PlannedElevationProfile")
);

const wikipediaSummary = registry.register(
  "WikipediaSummary",
  z
    .object({
      title: z.string(),
      extract: z.string(),
      thumbnailUrl: z.string().nullable(),
      pageUrl: z.string(),
      lang: z.enum(["de", "en"]),
    })
    .openapi("WikipediaSummary")
);

const lang = z.object({ lang: z.enum(["de", "en"]).optional() });

registry.registerPath({
  method: "post",
  path: "/trips/{id}/journal/weather",
  summary: "Fill the measured weather of every diary entry that has none",
  description:
    "Each entry is placed at the trip stop whose span covers its day (the one reached last on " +
    "a travel day); an entry with no such stop, today's, or a future one stays without.",
  tags: ["Trips", "Open data"],
  request: { params: z.object({ id: uuid }) },
  responses: {
    200: {
      description: "Filled",
      content: {
        "application/json": {
          schema: z.object({ filled: z.number().int(), entries: z.array(journalEntry) }),
        },
      },
    },
    404: notFound,
    409: disabled,
  },
});

registry.registerPath({
  method: "post",
  path: "/trips/{id}/journal/{entryId}/weather",
  summary: "Fetch one diary entry's measured weather again",
  tags: ["Trips", "Open data"],
  request: { params: z.object({ id: uuid, entryId: uuid }) },
  responses: {
    200: {
      description: "The entry as stored",
      content: { "application/json": { schema: z.object({ entry: journalEntry }) } },
    },
    404: notFound,
    409: disabled,
  },
});

registry.registerPath({
  method: "get",
  path: "/tours/{routeId}/planned-profile",
  summary: "Elevation profile of a tour's planned line",
  description:
    "Ground heights from Open-Meteo along the routed legs (or the straight chords of legs that " +
    "are not routed), read by the same climb rule a recording gets. `profile` is null when the " +
    "line is too short or the elevation service did not answer.",
  tags: ["Tours", "Open data"],
  request: { params: z.object({ routeId: uuid }) },
  responses: {
    200: {
      description: "Profile",
      content: {
        "application/json": { schema: z.object({ profile: plannedProfile.nullable() }) },
      },
    },
    404: notFound,
    409: disabled,
  },
});

registry.registerPath({
  method: "get",
  path: "/places/{id}/wikipedia",
  summary: "Wikipedia summary of a place",
  description:
    "Through the place's Wikidata item, from its curated checklist item or the `wikidata` tag " +
    "of the OpenStreetMap element it was picked from — never by name. `summary` is null when " +
    "there is no item or no article; English stands in for a missing German one.",
  tags: ["Places", "Open data"],
  request: { params: z.object({ id: uuid }), query: lang },
  responses: {
    200: {
      description: "Summary",
      content: {
        "application/json": { schema: z.object({ summary: wikipediaSummary.nullable() }) },
      },
    },
    404: notFound,
    409: disabled,
  },
});

registry.registerPath({
  method: "get",
  path: "/lodging/{id}/wikipedia",
  summary: "Wikipedia summary of a lodging",
  description:
    "Only for a house whose Wikidata item is known (set by the OpenStreetMap enrichment).",
  tags: ["Lodging", "Open data"],
  request: { params: z.object({ id: uuid }), query: lang },
  responses: {
    200: {
      description: "Summary",
      content: {
        "application/json": { schema: z.object({ summary: wikipediaSummary.nullable() }) },
      },
    },
    404: notFound,
    409: disabled,
  },
});

registry.registerPath({
  method: "post",
  path: "/lodging/{id}/enrich",
  summary: "Fill a lodging's empty fields from OpenStreetMap (beta)",
  description:
    "Finds the house within 150 m of its pin whose name agrees, and writes stars, website, " +
    "Wikidata item and a KNOWN chain — each only while still empty. Never overwrites.",
  tags: ["Lodging", "Open data"],
  request: { params: z.object({ id: uuid }) },
  responses: {
    200: {
      description: "What was found and filled",
      content: {
        "application/json": {
          schema: z.object({
            found: z.boolean(),
            reason: z.enum(["noCoordinates", "notFound"]).nullable(),
            osmRef: z.string().nullable(),
            osmName: z.string().nullable(),
            filled: z.array(z.enum(["stars", "website", "wikidataId", "chain"])),
          }),
        },
      },
    },
    404: notFound,
    409: disabled,
  },
});
