import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";

/** Trip photo links (docs/superpowers/specs/2026-11-26-trip-photo-links.md). Minimum server 2.8.0-rc.47. */

const provider = z.enum(["immich", "photoprism"]);
const failure = z.enum(["unreachable", "auth", "notFound", "protocol", "invalidUrl"]);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const trip = z.object({ id: z.string().uuid() });
const json = <T extends z.ZodTypeAny>(schema: T) => ({ "application/json": { schema } });

const source = z
  .object({
    id: z.string().uuid(),
    kind: z.enum(["album", "period"]),
    provider,
    connectionId: provider.describe("One connection per provider today: named by its provider"),
    name: z.string().nullable().describe("Album only"),
    from: day.nullable().describe("Period: first day (the trip's unless pinned)"),
    until: day.nullable(),
    pinned: z.boolean(),
    auto: z.boolean().describe("Period linked by the account's auto setting"),
    count: z.number().int().nullable().describe("Album only, when the source told it"),
    mode: z.enum(["link", "import"]).nullable(),
  })
  .openapi("TripPhotoSource");

const proposal = z.object({
  key: z.string().describe("`<provider>:<albumId>` — the dismissal key"),
  connectionId: provider,
  albumId: z.string(),
  name: z.string(),
  count: z.number().int().nullable(),
  overlapDays: z.number().int().nullable(),
  reason: z.enum(["folder", "name", "date"]),
});

const linkedPhoto = z.object({
  key: z.string(),
  provider,
  sourceId: z.string().uuid(),
  sourceKind: z.enum(["album", "period"]),
  url: z.string(),
  previewUrl: z.string(),
  takenAt: z.string().nullable(),
  day: day.nullable(),
});

registry.registerPath({
  method: "get",
  path: "/trips/{id}/photo-sources",
  summary: "The trip's photo sources: album links and period links",
  tags: ["Trips"],
  request: { params: trip },
  responses: {
    200: { description: "Sources", content: json(z.object({ sources: z.array(source) })) },
    404: { description: "Trip not found", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/trips/{id}/photo-sources",
  summary: "Link a period (the trip's days, or pinned days) or one album in link mode",
  description:
    "A period reads PhotoPrism when connected and Immich only as the fallback; asking for " +
    "Immich while PhotoPrism is connected answers 409 `notPreferred`. References only.",
  tags: ["Trips"],
  request: {
    params: trip,
    body: {
      content: json(
        z.union([
          z.object({
            kind: z.literal("period"),
            connectionId: provider.optional(),
            from: day.optional(),
            until: day.optional(),
          }),
          z.object({ kind: z.literal("album"), connectionId: provider, albumId: z.string() }),
        ])
      ),
    },
  },
  responses: {
    201: { description: "Linked", content: json(z.object({ source: source.nullable() })) },
    400: { description: "`noDates`, `unknownAlbum` or invalid body", content: errorContent },
    404: { description: "Trip not found", content: errorContent },
    409: { description: "`notConfigured` or `notPreferred`", content: errorContent },
    502: { description: "The source failed (error carries the kind)", content: errorContent },
  },
});

registry.registerPath({
  method: "delete",
  path: "/trips/{id}/photo-sources/{sourceId}",
  summary: "Remove a period or a link-mode album; a removed period is never re-offered",
  tags: ["Trips"],
  request: { params: trip.extend({ sourceId: z.string().uuid() }) },
  responses: {
    204: { description: "Removed" },
    404: { description: "Not a source of this trip", content: errorContent },
    409: { description: "`importedAlbum`: use the album route", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/trips/{id}/photo-sources/proposals",
  summary: "Album proposals and the business-trip period offer (trip page only, never the inbox)",
  description:
    "With the account's auto setting on, a trip without album, period or proposal gets its " +
    "period linked on this read (`autoLinked`).",
  tags: ["Trips"],
  request: { params: trip },
  responses: {
    200: {
      description: "Proposals",
      content: json(
        z.object({
          connectionId: provider.nullable(),
          proposals: z.array(proposal),
          periodOffer: z.object({ connectionId: provider, from: day, until: day }).nullable(),
          autoLinked: z.boolean(),
          failure: failure.nullable(),
        })
      ),
    },
    404: { description: "Trip not found", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/trips/{id}/photo-sources/proposals/{key}/dismiss",
  summary:
    'Remember "nicht dieses" for a proposal (`<provider>:<albumId>`) or the offer (`period`)',
  tags: ["Trips"],
  request: { params: trip.extend({ key: z.string() }) },
  responses: {
    204: { description: "Remembered" },
    400: { description: "Invalid key", content: errorContent },
    404: { description: "Trip not found", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/trips/{id}/linked-photos",
  summary: "The merged, de-duplicated photos of every linked source, one page of one day",
  description:
    "Albums and periods together; an Immich twin of a PhotoPrism photo (capture ±2 s, same " +
    "dimensions) is dropped. A failing source is named in `failures`, never left out silently.",
  tags: ["Trips"],
  request: {
    params: trip,
    query: z.object({
      day: z.string().optional().describe("`YYYY-MM-DD`, `undated` or `all` (default)"),
      cursor: z.string().optional(),
      limit: z.string().optional().describe("1–200, default 60"),
    }),
  },
  responses: {
    200: {
      description: "Photos",
      content: json(
        z.object({
          zone: z.string(),
          totalAll: z.number().int(),
          total: z.number().int(),
          days: z.array(z.object({ day: day.nullable(), count: z.number().int() })),
          photos: z.array(linkedPhoto),
          nextCursor: z.string().nullable(),
          truncated: z.boolean(),
          failures: z.array(
            z.object({
              sourceId: z.string().uuid(),
              sourceKind: z.enum(["album", "period"]),
              provider,
              kind: z.union([failure, z.literal("notConfigured")]),
            })
          ),
        })
      ),
    },
    400: { description: "Invalid day or page", content: errorContent },
    404: { description: "Trip not found", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/trips/{id}/photo-sources/{sourceId}/assets/{assetId}/file",
  summary: "Stream one photo of a period link",
  description:
    "The asset must be in that period's own search result. Private immutable caching; an " +
    "upstream failure paints a no-store placeholder.",
  tags: ["Trips"],
  request: { params: trip.extend({ sourceId: z.string().uuid(), assetId: z.string() }) },
  responses: {
    200: { description: "Image bytes", content: { "image/*": { schema: z.string() } } },
    404: { description: "Not a photo of this period", content: errorContent },
    409: { description: "notConfigured", content: errorContent },
  },
});

const autoSwitch = json(z.object({ enabled: z.boolean() }));

registry.registerPath({
  method: "get",
  path: "/settings/photo-period-auto",
  summary: "Whether trips without an album get their period linked automatically (default off)",
  tags: ["Settings"],
  responses: { 200: { description: "Switch", content: autoSwitch } },
});

registry.registerPath({
  method: "put",
  path: "/settings/photo-period-auto",
  summary: "Turn the automatic period link on or off",
  tags: ["Settings"],
  request: { body: { content: autoSwitch } },
  responses: { 200: { description: "Saved", content: autoSwitch } },
});
