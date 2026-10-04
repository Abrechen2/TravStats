import { z } from "./zod";

/**
 * `?variant=` on every photo `/file` route (forgejo#192) — shared by the
 * routes and their OpenAPI paths, so the contract and the parser cannot
 * disagree.
 *
 * `display` (the default) is what a browser can draw: for a HEIC/HEIF
 * original its JPEG copy. `original` is the bytes as uploaded. For any other
 * type both are the stored file.
 */
export const photoVariantSchema = z
  .enum(["display", "original"])
  .default("display")
  .describe(
    "`display` (default): an image a browser can draw — for a HEIC/HEIF original, its JPEG " +
      "copy made on upload. `original`: the bytes exactly as uploaded, with the stored type."
  );

export type PhotoVariant = z.infer<typeof photoVariantSchema>;

/** The query object the three `/file` routes document. */
export const photoFileQuerySchema = z.object({ variant: photoVariantSchema.optional() });
