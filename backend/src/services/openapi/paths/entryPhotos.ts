/**
 * Library photos linked to a flight, stay, rail/bus/ferry journey, rental,
 * cruise stop or roadtrip station (`/entry-photos/{kind}/{entryId}/…`). The
 * rule across it: a library id is linked or served only after the server found
 * it itself in a search against the caller's own connection.
 */

import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";

const tag = ["Entry photos"];
const notFound = { description: "Not found", content: errorContent };
const badInput = { description: "Invalid input", content: errorContent };
const uuid = z.string().uuid();
const kind = z
  .enum(["flight", "stay", "rail", "bus", "ferry", "rental", "cruiseStop", "roadtripStop"])
  .describe("The entry type");
const entry = z.object({ kind, entryId: uuid });
const provider = z.enum(["immich", "photoprism"]);
const sourceState = z
  .string()
  .describe(
    "`ok`, `notConfigured`, `truncated` (more photos than one search reads) or a failure kind"
  );

const link = z.object({
  id: uuid,
  url: z.string().describe("Where the thumbnail is served"),
  provider,
  assetId: z.string(),
  provenance: z.enum(["manual", "auto"]).describe("`auto`: shown as 'automatisch verknüpft'"),
  takenAt: z.string().nullable(),
  mimetype: z.string(),
});
const envelope = <T extends z.ZodTypeAny>(data: T) => z.object({ success: z.literal(true), data });
const json = <T extends z.ZodTypeAny>(schema: T) => ({ "application/json": { schema } });

registry.registerPath({
  method: "get",
  path: "/entry-photos/{kind}/{entryId}/photos",
  summary: "Photos linked to an entry",
  tags: tag,
  request: { params: entry },
  responses: {
    200: { description: "The links", content: json(envelope(z.object({ photos: z.array(link) }))) },
    404: notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/entry-photos/{kind}/{entryId}/photo-suggestions",
  summary: "Photos that match an entry and are not linked yet",
  description:
    "The matcher's answer for the entry's window and place, per source. `untimed` is true " +
    "when the entry has no usable time or position, so there is nothing to suggest.",
  tags: tag,
  request: { params: entry },
  responses: {
    200: {
      description: "Suggestions and the state of each source",
      content: json(
        envelope(
          z.object({
            suggestions: z.array(
              z.object({
                url: z.string().describe("Where the thumbnail is served"),
                provider,
                assetId: z.string(),
                takenAt: z.string().nullable(),
                mimetype: z.string(),
              })
            ),
            sources: z.record(z.string(), sourceState),
            untimed: z.boolean(),
          })
        )
      ),
    },
    404: notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/entry-photos/{kind}/{entryId}/photos",
  summary: "Link suggested photos by hand",
  description:
    "Only ids among the entry's current suggestions are linked; the others are counted as `skipped`.",
  tags: tag,
  request: {
    params: entry,
    body: {
      content: json(
        z.object({ provider: provider.optional(), assetIds: z.array(z.string()).min(1).max(100) })
      ),
    },
  },
  responses: {
    200: {
      description: "How many were linked",
      content: json(envelope(z.object({ linked: z.number().int(), skipped: z.number().int() }))),
    },
    400: badInput,
    404: notFound,
  },
});

registry.registerPath({
  method: "delete",
  path: "/entry-photos/{kind}/{entryId}/photos/auto",
  summary: "Remove every automatically linked photo of an entry",
  description: "Each removed link is kept as a refusal, so the next pass does not bring it back.",
  tags: tag,
  request: { params: entry },
  responses: {
    200: {
      description: "Removed",
      content: json(envelope(z.object({ removed: z.number().int() }))),
    },
    404: notFound,
  },
});

registry.registerPath({
  method: "delete",
  path: "/entry-photos/{kind}/{entryId}/photos/{photoId}",
  summary: "Remove one linked photo",
  description: "The link becomes a refusal: no automatic pass links that photo again.",
  tags: tag,
  request: { params: entry.extend({ photoId: uuid }) },
  responses: {
    200: {
      description: "Removed",
      content: json(envelope(z.object({ removed: z.number().int() }))),
    },
    400: badInput,
    404: notFound,
  },
});

registry.registerPath({
  method: "delete",
  path: "/entry-photos/{kind}/{entryId}/photo-refusals",
  summary: "Offer the refused photos of an entry again",
  tags: tag,
  request: { params: entry },
  responses: {
    200: {
      description: "Cleared",
      content: json(envelope(z.object({ cleared: z.number().int() }))),
    },
    404: notFound,
  },
});

const bytes = {
  200: { description: "Image bytes", content: { "image/*": { schema: z.string() } } },
  304: { description: "Unchanged" },
  404: notFound,
  409: { description: "The source is not configured", content: errorContent },
  502: { description: "The source did not deliver the asset" },
};

registry.registerPath({
  method: "get",
  path: "/entry-photos/{kind}/{entryId}/photos/{photoId}/file",
  summary: "Bytes of a linked photo, streamed from its own source",
  tags: tag,
  request: {
    params: entry.extend({ photoId: uuid }),
    query: z.object({ size: z.enum(["thumbnail", "preview", "original"]).optional() }),
  },
  responses: bytes,
});

registry.registerPath({
  method: "get",
  path: "/entry-photos/{kind}/{entryId}/photo-suggestions/{provider}/{assetId}/file",
  summary: "Thumbnail of a suggested photo",
  description: "404 unless the asset is among the entry's suggestions found in the last minute.",
  tags: tag,
  request: {
    params: entry.extend({ provider, assetId: z.string() }),
    query: z.object({ size: z.enum(["thumbnail", "preview", "original"]).optional() }),
  },
  responses: bytes,
});
