import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import {
  fixedPlaceBodySchema,
  fixedPlaceWindowSchema,
  homePlaceBodySchema,
  lodgingPlaceBodySchema,
} from "../../../schemas/travtrackPlaces";

/**
 * TravTrack's fixed places (spec 2026-11-05-travtrack-fixed-places, S2). Beside
 * `travtrack.ts`, whose zones they sit next to; the folded stops they cause are
 * in `travtrackLegs.ts`.
 */

const disabled = {
  description: "TRAVTRACK_DISABLED, a read-only token, or the demo",
  content: errorContent,
};

const place = z.object({
  id: z.string().describe('`"home"` for the home entry, a uuid otherwise'),
  name: z.string().describe("Home: the home's name"),
  kind: z.enum(["home", "work", "custom"]),
  lat: z.number().nullable().describe("Home: null while no home is known"),
  lon: z.number().nullable(),
  radiusM: z.number().int().describe("25 to 2000, default 150"),
  window: fixedPlaceWindowSchema
    .nullable()
    .describe(
      "Days (1 = Monday .. 7 = Sunday, the day the window starts on) and times in the place's own " +
        "zone; `until` earlier than `from` spans midnight. Null: always"
    ),
});

const lodgingSetting = z.object({ enabled: z.boolean(), radiusM: z.number().int() });

const tags = ["TravTrack"];
const invalid = {
  description:
    "VALIDATION_FAILED (`error: validation`), or TRAVTRACK_HOME_IS_DERIVED (`error: homeIsDerived`)",
  content: errorContent,
};

registry.registerPath({
  method: "get",
  path: "/travtrack/places",
  summary: "List the fixed places",
  description:
    "The home entry first (its point is the home the server already knows; only its radius and " +
    "window are stored here), then the account's work and custom places. Inside a place's " +
    "circle, a run of fixes shows as one stop in `/travtrack/day`. Reachable with TravTrack off " +
    "while the account holds data.",
  tags,
  responses: {
    200: {
      description: "Home first, then oldest first",
      content: {
        "application/json": {
          schema: z.object({
            places: z.array(place),
            lodgingAsPlace: lodgingSetting,
            lodgingSkipped: z
              .number()
              .int()
              .describe("Current and upcoming bookings whose house has no coordinates"),
          }),
        },
      },
    },
    403: disabled,
  },
});

registry.registerPath({
  method: "post",
  path: "/travtrack/places",
  summary: "Create a fixed place",
  description: "`kind: home` is refused: home is derived.",
  tags,
  request: { body: { content: { "application/json": { schema: fixedPlaceBodySchema } } } },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: place } } },
    400: invalid,
    403: disabled,
  },
});

registry.registerPath({
  method: "put",
  path: "/travtrack/places/lodging",
  summary: "Fold a booked lodging into one stop, or stop doing so",
  description: "Default `{enabled: false, radiusM: 150}`.",
  tags,
  request: { body: { content: { "application/json": { schema: lodgingPlaceBodySchema } } } },
  responses: {
    200: { description: "Stored", content: { "application/json": { schema: lodgingSetting } } },
    400: invalid,
    403: disabled,
  },
});

registry.registerPath({
  method: "put",
  path: "/travtrack/places/{id}",
  summary: "Replace a fixed place",
  description:
    "Full body as for create. For `id = home` only `{radiusM, window}` are accepted: moving home " +
    "goes through the home setting.",
  tags,
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: { "application/json": { schema: fixedPlaceBodySchema.or(homePlaceBodySchema) } },
    },
  },
  responses: {
    200: { description: "Replaced", content: { "application/json": { schema: place } } },
    400: invalid,
    403: disabled,
    404: { description: "TRAVTRACK_PLACE_NOT_FOUND", content: errorContent },
  },
});

registry.registerPath({
  method: "delete",
  path: "/travtrack/places/{id}",
  summary: "Remove a fixed place",
  description: "`home` cannot be removed: 400 TRAVTRACK_HOME_IS_DERIVED.",
  tags,
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: "Removed" },
    400: invalid,
    403: disabled,
    404: { description: "TRAVTRACK_PLACE_NOT_FOUND", content: errorContent },
  },
});
