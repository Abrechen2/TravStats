/**
 * One trip as a `.travstats` file (spec 2026-10-09 S3): export, and the
 * import's preview and commit. The file's own schema is
 * `services/trip/exchange/format.ts`.
 */
import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import { PROPOSAL_REASONS } from "../../trip/package/types";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const action = z.enum(["create", "attach", "skip"]);
const counts = z.object({ create: z.number().int(), skip: z.number().int() });

const proposal = registry.register(
  "TripFileProposal",
  z.object({
    trip: z.object({
      action: z.enum(["create", "attach"]),
      id: z.string().uuid().nullable(),
      name: z.string(),
      startDate: day.nullable(),
      endDate: day.nullable(),
      matchedBy: z.enum(["bookingReference", "dateOverlap"]).nullable(),
    }),
    options: z.object({ documents: z.boolean(), photos: z.boolean(), private: z.boolean() }),
    exportedAt: z.string(),
    appVersion: z.string(),
    bookings: z.array(
      z.object({
        key: z.string(),
        action: z.enum(["create", "attach"]),
        id: z.string().uuid().nullable(),
        reference: z.string().nullable(),
        price: z.number().nullable(),
        currency: z.string().nullable(),
      })
    ),
    places: z.array(
      z.object({
        key: z.string(),
        action: z.enum(["create", "reuse"]),
        id: z.string().uuid().nullable(),
        name: z.string(),
      })
    ),
    entries: z.array(
      z.object({
        key: z.string(),
        kind: z.enum(["flight", "stay", "cruise", "rail", "rental", "visit", "stop"]),
        action,
        id: z.string().uuid().nullable(),
        reason: z.enum(PROPOSAL_REASONS).optional(),
        label: z.string(),
        day: day.nullable(),
      })
    ),
    journal: counts,
    documents: counts,
    photos: counts,
  })
);

const upload = {
  body: {
    content: {
      "multipart/form-data": {
        schema: z.object({
          file: z.string().openapi({ format: "binary" }).describe("The .travstats file"),
          tripName: z.string().max(200).optional().describe("Name for a trip the import creates"),
        }),
      },
    },
    required: true,
  },
};

const failures = {
  400: { description: "No file uploaded", content: errorContent },
  413: {
    description:
      "`TRIP_FILE_TOO_LARGE` — the upload, one entry, the entry count or the unpacked total " +
      "is past its cap (counted as inflated, not as declared)",
    content: errorContent,
  },
  422: {
    description:
      "`TRIP_FILE_INVALID` (not a ZIP, no manifest/trip.json, or a schema failure — `issues` " +
      "names the paths), `TRIP_FILE_VERSION_UNSUPPORTED` (`formatVersion`, `supported`), or " +
      "`TRIP_FILE_UNSAFE_PATH` (an entry names a path outside the archive)",
    content: errorContent,
  },
  429: { description: "Too many trip file requests", content: errorContent },
};

registry.registerPath({
  method: "get",
  path: "/trips/{id}/export",
  summary: "Export one trip as a .travstats file",
  description:
    "A ZIP holding `manifest.json` (format `travstats-trip`, `formatVersion` 1, app version, " +
    "export time, options) and `trip.json` (the trip, bookings with their total, flights, stays " +
    "with their lodging, cruises with stops, rail rides, rentals, stops, place visits with their " +
    "places). Times are written as stored: instant, zone and calendar day. Private fields (seat, " +
    "cabin, own price, ratings, notes, journal, companion names), `documents/` and `photos/` are " +
    "included only when asked. Another user's trip is a 404.",
  tags: ["Trips"],
  request: {
    params: z.object({ id: z.string().uuid() }),
    query: z.object({
      documents: z.enum(["0", "1"]).optional(),
      photos: z.enum(["0", "1"]).optional(),
      private: z.enum(["0", "1"]).optional(),
    }),
  },
  responses: {
    200: {
      description: "The .travstats file, as an attachment",
      content: { "application/zip": { schema: z.string().openapi({ format: "binary" }) } },
    },
    404: { description: "Trip not found", content: errorContent },
    429: failures[429],
  },
});

registry.registerPath({
  method: "post",
  path: "/trips/import/preview",
  summary: "Propose what a .travstats file would write",
  description:
    "Reads the file under hard limits and matches it against the logbook like a package " +
    "tour: the trip by booking reference, else the one trip overlapping its days; flights by " +
    "provenance or number and local day; stays by lodging name and check-in; cruises by " +
    "provenance or booking reference; rail by provenance, operator and number or stations, and " +
    "local day; rentals by provider and pick-up day; places by provenance or within 100 m; " +
    "visits by place and day; stops by place or title and day on the matched trip. Writes nothing.",
  tags: ["Trips"],
  request: upload,
  responses: {
    200: {
      description: "The proposal",
      content: {
        "application/json": {
          schema: z.object({ success: z.literal(true), data: z.object({ proposal }) }),
        },
      },
    },
    ...failures,
  },
});

registry.registerPath({
  method: "post",
  path: "/trips/import/commit",
  summary: "Write a .travstats file as a trip",
  description:
    "Rebuilds the proposal from the file and writes it in one transaction; documents are filed " +
    "afterwards, skipping bytes the user already holds. An attached row keeps its booking; a row " +
    "on another trip stays where it is; importing the same file again writes nothing new.",
  tags: ["Trips"],
  request: upload,
  responses: {
    201: {
      description: "Written",
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            data: z.object({
              tripId: z.string().uuid(),
              created: z.number().int(),
              attached: z.number().int(),
              skipped: z.number().int(),
              documents: z.object({
                filed: z.number().int(),
                skipped: z.number().int(),
                refused: z.number().int(),
              }),
              photos: z.number().int(),
              proposal,
            }),
          }),
        },
      },
    },
    ...failures,
  },
});
