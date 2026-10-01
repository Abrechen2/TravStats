import { z } from "./zod";

/**
 * Trip photo request shapes — shared by `routes/trips/tripPhotos.ts` and its
 * OpenAPI paths, so the contract and the parser cannot disagree.
 */

/** PATCH /trips/:id/photos/:photoId */
export const updateTripPhotoSchema = z.object({
  caption: z.string().max(500).nullable().optional(),
  takenAt: z.string().datetime().nullable().optional(),
  sortIdx: z.number().int().min(0).max(10000).optional(),
  /** File the photo at a stop of this trip, or take it off one (null) — forgejo#139. */
  stopId: z
    .string()
    .uuid()
    .nullable()
    .optional()
    .describe(
      "File the photo at a stop of this trip — a timeline stop or a station of a roadtrip " +
        "filed on it — or take it off one (null). Absent leaves it where it is."
    ),
});

/**
 * POST /trips/:id/photos — the form fields beside the files. `stopId` applies
 * to every file of the request; a malformed one is a 400, never "no
 * station" — a client that sent one meant it.
 */
export const tripPhotoUploadFieldsSchema = z.object({
  stopId: z
    .string()
    .uuid()
    .optional()
    .describe("File every photo of this request at this stop of the trip (forgejo#139)"),
});

/** GET /trips/:id/photos — one stop's photos only. */
export const listTripPhotosQuerySchema = z.object({
  stopId: z
    .string()
    .uuid()
    .optional()
    .describe("Only the photos filed at this stop of the trip; a stop not on the trip is a 400"),
});
