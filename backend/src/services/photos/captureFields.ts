import { z } from "../../schemas/zod";
import { AppError } from "../../middleware/errorHandler";
import type { PhotoExif } from "./photoExif";

/**
 * The capture metadata a photo upload may carry BESIDE the file (companion#59).
 *
 * A phone knows when and where a picture was taken even when the bytes it
 * sends no longer say so — a share-sheet export strips EXIF, a screenshot of
 * a photo never had it. So the multipart request may name `takenAt`, `lat`
 * and `lon` as text fields. They fill a gap and never overrule the file: EXIF
 * is read first, and a field is used only where the file yielded nothing for
 * it. The file was there; the field is what the client believes.
 *
 * Two refusals, both 400 before any row is written:
 *
 * - an offset-less `takenAt` — the host's zone would decide what it means,
 *   which is the mistake ADR 0002 exists to end;
 * - the fields beside SEVERAL files — one time cannot be the capture time of
 *   twenty pictures, and applying it to all of them would stamp a whole roll
 *   with one instant.
 */

/** An ISO datetime WITH an offset or `Z` — the shape `timeInput.ts` accepts as an instant. */
const OFFSET_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})$/i;

const takenAtField = z
  .string()
  .trim()
  .regex(OFFSET_ISO, "takenAt must be an ISO 8601 datetime with an offset or Z")
  .refine((value) => Number.isFinite(Date.parse(value)), "takenAt is not a valid instant")
  .openapi({
    description:
      "When the picture was taken, ISO 8601 WITH an offset or Z (an offset-less value is " +
      "refused). Used only where the file's EXIF carries no capture time.",
  });

/** Multipart fields arrive as strings; a number is coerced from the text. */
const coordinate = (limit: number, name: string) =>
  z
    .string()
    .trim()
    .transform((value, ctx) => {
      const parsed = Number(value);
      if (value === "" || !Number.isFinite(parsed) || Math.abs(parsed) > limit) {
        ctx.addIssue({ code: "custom", message: `${name} must be a number within ±${limit}` });
        return z.NEVER;
      }
      return parsed;
    });

/** The optional text fields of a photo upload. */
export const captureFieldsSchema = z.object({
  takenAt: takenAtField.optional(),
  lat: coordinate(90, "lat").optional().openapi({
    type: "number",
    description: "Latitude, −90..90; used only where the file's EXIF carries no position",
  }),
  lon: coordinate(180, "lon").optional().openapi({
    type: "number",
    description: "Longitude, −180..180; used only where the file's EXIF carries no position",
  }),
});

export interface CaptureFields {
  takenAt: Date | null;
  lat: number | null;
  lon: number | null;
}

/** The fields are only read when the request carries them; absent is "nothing to say". */
const NOTHING: CaptureFields = { takenAt: null, lat: null, lon: null };

/**
 * The capture fields of a multipart body, validated against the number of
 * files beside them. A malformed field or a field beside several files is a
 * 400 — raised by the route BEFORE any row, so the caller's cleanup removes
 * the bytes multer already stored.
 */
export function parseCaptureFields(body: unknown, fileCount: number): CaptureFields {
  const parsed = captureFieldsSchema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new AppError(parsed.error.issues.map((issue) => issue.message).join("; "), 400);
  }
  const { takenAt, lat, lon } = parsed.data;
  const carried = takenAt !== undefined || lat !== undefined || lon !== undefined;
  if (!carried) return NOTHING;
  if (fileCount !== 1) {
    throw new AppError(
      "takenAt, lat and lon describe ONE photo; send them with a single file per request",
      400
    );
  }
  return { takenAt: takenAt ? new Date(takenAt) : null, lat: lat ?? null, lon: lon ?? null };
}

/**
 * EXIF wins, field by field. A position is one value, not two: a file with
 * coordinates keeps both, a file without takes both from the fields, and a
 * field pair with one half missing fills nothing — half a position is no
 * position.
 */
export function withCaptureFields(exif: PhotoExif, fields: CaptureFields): PhotoExif {
  const position =
    exif.lat !== null && exif.lon !== null
      ? { lat: exif.lat, lon: exif.lon }
      : fields.lat !== null && fields.lon !== null
        ? { lat: fields.lat, lon: fields.lon }
        : { lat: null, lon: null };
  return { takenAt: exif.takenAt ?? fields.takenAt, ...position };
}
