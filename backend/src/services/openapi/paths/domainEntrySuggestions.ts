/**
 * GET /ferry|rentals|cruises|places/entry-suggestions (forgejo#405) — the
 * forms' chips from the user's own rows, the bus endpoint's siblings.
 * Enveloped like the rest of those families.
 */

import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";

const ferryTerminal = registry.register(
  "FerryTerminalSuggestion",
  z
    .object({
      name: z.string(),
      address: z.string().nullable().describe("As printed on the crossing it was taken from"),
      lat: z.number(),
      lon: z.number(),
      country: z.string().nullable().describe("ISO 3166-1 alpha-2; null when never stored"),
    })
    .openapi("FerryTerminalSuggestion")
);

const ferrySuggestions = registry.register(
  "FerryEntrySuggestions",
  z
    .object({
      operators: z.array(z.string()).describe("The user's operators, most frequent first"),
      vessels: z.array(z.string()).describe("Vessels used with the typed operator"),
      fareClasses: z.array(z.string()).describe("Fare classes used with the typed operator"),
      cabinTypes: z.array(z.string()).describe("Cabin types used with the typed operator"),
      terminals: z.array(ferryTerminal).describe("Ports starting with the typed name, either end"),
    })
    .openapi("FerryEntrySuggestions")
);

const rentalSuggestions = registry.register(
  "RentalEntrySuggestions",
  z
    .object({
      providers: z.array(z.string()),
      brokers: z.array(z.string()),
      vehicleClasses: z.array(z.string()).describe("Classes rented from the typed provider"),
      vehicleExamples: z.array(z.string()).describe("'… or similar' lines of the typed provider"),
    })
    .openapi("RentalEntrySuggestions")
);

const cruiseSuggestions = registry.register(
  "CruiseEntrySuggestions",
  z
    .object({
      cruiseLines: z.array(z.string()),
      routeNames: z.array(z.string()).describe("Route names given to the typed line's cruises"),
    })
    .openapi("CruiseEntrySuggestions")
);

const placeSuggestions = registry.register(
  "PlaceEntrySuggestions",
  z
    .object({
      cities: z.array(
        z.object({
          city: z.string(),
          country: z.string().nullable(),
          isoCountryCode: z.string().nullable(),
        })
      ),
      countries: z.array(z.object({ country: z.string(), isoCountryCode: z.string().nullable() })),
    })
    .openapi("PlaceEntrySuggestions")
);

function register(
  path: string,
  tag: string,
  summary: string,
  query: z.ZodObject<z.ZodRawShape>,
  data: z.ZodTypeAny
): void {
  registry.registerPath({
    method: "get",
    path,
    summary,
    description:
      "Values the form offers as one-click chips, read from the user's own earlier rows. " +
      "Bounded and user-scoped; a chip fills a field only when clicked. An empty logbook " +
      "answers empty lists.",
    tags: [tag],
    request: { query },
    responses: {
      200: {
        description: "Suggestions",
        content: { "application/json": { schema: z.object({ success: z.literal(true), data }) } },
      },
      400: { description: "Invalid query", content: errorContent },
      401: { description: "Missing or invalid token", content: errorContent },
      429: { description: "Rate limited", content: errorContent },
    },
  });
}

register(
  "/ferry/entry-suggestions",
  "Ferry",
  "Ferry form suggestions from the user's own crossings",
  z.object({
    depName: z.string().max(200).optional().describe("Departure port, typed so far"),
    arrName: z.string().max(200).optional().describe("Arrival port, typed so far"),
    operator: z.string().max(100).optional().describe("Operator, case-insensitive"),
  }),
  ferrySuggestions
);
register(
  "/rentals/entry-suggestions",
  "Rental",
  "Rental form suggestions from the user's own rentals",
  z.object({ provider: z.string().max(120).optional().describe("Provider, case-insensitive") }),
  rentalSuggestions
);
register(
  "/cruises/entry-suggestions",
  "Cruises",
  "Cruise form suggestions from the user's own cruises",
  z.object({
    cruiseLine: z.string().max(120).optional().describe("Cruise line, case-insensitive"),
  }),
  cruiseSuggestions
);
register(
  "/places/entry-suggestions",
  "Places",
  "Place form suggestions from the user's own places",
  z.object({
    city: z.string().max(120).optional().describe("City, typed so far"),
    country: z.string().max(120).optional().describe("Country, typed so far"),
  }),
  placeSuggestions
);
