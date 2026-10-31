import { z } from "./zod";
import { PLACE_CATEGORIES } from "../shared/placeCategories";

/** What a capture can be: waiting for a name, turned into a place, or thrown away. */
export const CAPTURE_STATUSES = ["open", "resolved", "dismissed"] as const;

/** `POST /places/captures` — a position the phone recorded before it had a name. */
export const createCaptureSchema = z.object({
  clientId: z.string().uuid(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  accuracyM: z.number().min(0).max(1_000_000).nullable(),
  capturedAt: z.string().datetime({ offset: true }),
  note: z
    .string()
    .max(2000)
    .transform((v) => v.replace(/<[^>]*>/g, ""))
    .nullable()
    .optional(),
});

/** `GET /places/captures?status=` */
export const captureQuerySchema = z.object({
  status: z.enum(CAPTURE_STATUSES).default("open"),
});

/**
 * `POST /places/captures/:id/resolve` — either a name (a new place at the
 * captured position), an existing place of the caller's, or — with `visitId`
 * too — a place and visit the phone already wrote.
 */
export const resolveCaptureSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    category: z.enum(PLACE_CATEGORIES).optional(),
    placeId: z.string().uuid().optional(),
    /** With `placeId`: the visit the phone already wrote — bind, create nothing. */
    visitId: z.string().uuid().optional(),
  })
  .refine((v) => v.name !== undefined || v.placeId !== undefined, {
    message: "name or placeId is required",
  })
  .refine((v) => v.visitId === undefined || v.placeId !== undefined, {
    message: "visitId needs placeId",
  });

export type CreateCaptureInput = z.infer<typeof createCaptureSchema>;
export type ResolveCaptureInput = z.infer<typeof resolveCaptureSchema>;
