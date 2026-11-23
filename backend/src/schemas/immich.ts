/**
 * Zod schemas for every Immich system boundary: settings writes, connection
 * tests, album linking, and the proxy's path/query parameters.
 */
import { z } from "./zod";

export const immichModeSchema = z.enum(["link", "import"]);

/** Partial update — an omitted field is untouched, an explicit null clears it. */
export const immichConnectionSchema = z
  .object({
    baseUrl: z.string().min(1).max(500).nullable().optional(),
    apiKey: z.string().min(1).max(500).nullable().optional(),
    defaultMode: immichModeSchema.optional(),
  })
  .strict();

/**
 * A connection field that is optional AND treats an empty string as absent.
 * The settings card always SENDS `baseUrl`/`apiKey`; when the user has no own
 * connection it sends `""`. Coercing `"" → undefined` lets that mean "test
 * whatever is currently resolved for me" (user tier → admin global → ENV)
 * instead of tripping `.min(1)` with a 400 before the route's fallback runs.
 */
const optionalConnectionField = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).max(500).optional()
);

/** Test an ad-hoc pair before saving, or fall back to the stored connection. */
export const immichTestSchema = z
  .object({
    baseUrl: optionalConnectionField,
    apiKey: optionalConnectionField,
  })
  .strict();

/** The photo source an album lives in; omitted means Immich (every client before PhotoPrism). */
export const photoSourceKindSchema = z.enum(["immich", "photoprism"]);

export const linkAlbumsSchema = z
  .object({
    albums: z
      .array(
        z
          .object({
            immichAlbumId: z.string().min(1).max(100),
            mode: immichModeSchema,
            provider: photoSourceKindSchema.default("immich"),
          })
          .strict()
      )
      .min(1)
      .max(50),
  })
  .strict();

export const unlinkQuerySchema = z
  .object({
    deleteCopies: z
      .enum(["true", "false"])
      .optional()
      .transform((v) => v === "true"),
  })
  .strict();

export const assetSizeSchema = z.enum(["thumbnail", "preview", "original"]).default("thumbnail");

/** A day bucket of the gallery: a local day, the photos without a date, or everything. */
export const galleryDayParamSchema = z.union([
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  z.enum(["undated", "all"]),
]);

/** Page of one day's photos. Bounded: a day of a long trip can hold hundreds. */
export const galleryDayQuerySchema = z
  .object({
    offset: z.coerce.number().int().min(0).default(0),
    limit: z.coerce.number().int().min(1).max(200).default(60),
  })
  .strict();

export const assetIdParamSchema = z.string().uuid();

/**
 * An asset of a LINKED album: an Immich UUID or the hex file hash PhotoPrism
 * calls its asset by. The routes that serve Immich-only grants keep the UUID.
 */
export const linkedAssetIdParamSchema = z.union([
  assetIdParamSchema,
  z.string().regex(/^[0-9a-f]{16,64}$/i),
]);

/** `?provider=` of the album picker; absent means Immich. */
export const albumListQuerySchema = z.object({ provider: photoSourceKindSchema.default("immich") });

/** `TripPhoto.id` is `@default(uuid())`. */
export const photoIdParamSchema = z.string().uuid();

export const setCoverSchema = z
  .object({
    linkId: z.string().uuid(),
    assetId: linkedAssetIdParamSchema,
  })
  .strict();

export type ImmichConnectionInput = z.infer<typeof immichConnectionSchema>;
export type ImmichTestInput = z.infer<typeof immichTestSchema>;
export type LinkAlbumsInput = z.infer<typeof linkAlbumsSchema>;
