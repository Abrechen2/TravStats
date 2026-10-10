/**
 * Resolving a Google Takeout list inside the place import (#358).
 *
 * Kept beside `places.ts` rather than in it: that file is close to the
 * 800-line limit, and this is one endpoint with its own result shape.
 */

import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import { jobStartedSchema } from "./jobs";
import {
  DAY_REASONS,
  POSITION_REASONS,
  TAKEOUT_KINDS,
  TAKEOUT_TREATMENTS,
  TRIP_REASONS,
  placeImportResolveSchema,
} from "../../../schemas/placeImportResolve";

const positionReason = z.enum(POSITION_REASONS);

export const placeImportResolutionSchema = registry.register(
  "PlaceImportResolution",
  z.object({
    listCountry: z.string().nullable().openapi({
      description: "ISO code of the country the list is named after, or null.",
    }),
    trip: z
      .object({
        id: z.string(),
        name: z.string(),
        first: z.string().nullable(),
        last: z.string().nullable(),
      })
      .nullable(),
    tripReason: z.enum(TRIP_REASONS).nullable(),
    googleConfigured: z.boolean(),
    rows: z.array(
      z.object({
        sourceRowIndex: z.number().int(),
        position: z
          .object({
            lat: z.number(),
            lon: z.number(),
            source: z.enum(["google_cid", "name_search"]),
            address: z.string().nullable(),
            city: z.string().nullable(),
            country: z.string().nullable(),
          })
          .nullable(),
        cidReason: positionReason.nullable(),
        positionReason: positionReason.nullable(),
        kind: z.enum(TAKEOUT_KINDS),
        suggestedTreatment: z.enum(TAKEOUT_TREATMENTS),
        visitDay: z.object({ date: z.string(), photoCount: z.number().int() }).nullable(),
        visitDayReason: z.enum(DAY_REASONS).nullable(),
        matchedStay: z
          .object({ id: z.string(), name: z.string(), checkIn: z.string().nullable() })
          .nullable(),
      })
    ),
  })
);

registry.registerPath({
  method: "post",
  path: "/place-import/resolve",
  summary: "Resolve a Google Takeout list for the place import preview",
  description:
    "Starts a background job (poll GET /jobs/{id}) whose result is a `PlaceImportResolution`: " +
    "per row a position — from the CID in the Maps link via Google Place Details with the " +
    "instance's Google Places key, else by name inside the country the list is named after — " +
    "or the reason there is none (`no_key`, `auth`, `quota`, `timeout`, `network`, " +
    "`not_found`, …); the user's single trip into that country; the visit day from the " +
    "user's trip photographs inside the trip's span within 300 m; and a suggested treatment " +
    "(place, trip stop, the user's own stay, or skip for a whole city). Writes nothing — " +
    "the preview offers each suggestion and the commit writes what the user chose.",
  tags: ["Places"],
  request: {
    body: { content: { "application/json": { schema: placeImportResolveSchema } } },
  },
  responses: {
    202: {
      description: "Job started; its result has the shape `placeImportResolutionSchema`",
      content: { "application/json": { schema: jobStartedSchema } },
    },
    400: { description: "Validation failed", content: errorContent },
    401: { description: "Not authenticated", content: errorContent },
    429: { description: "Rate-limited", content: errorContent },
  },
});
