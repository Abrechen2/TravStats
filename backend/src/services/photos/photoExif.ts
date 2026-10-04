import { load as loadExif, type ExpandedTags } from "exifreader";

import logger from "../../utils/logger";
import { machineInstant } from "../../shared/time/instant";
import { zoneOfCoordinates } from "../../shared/time/resolveInput";

/**
 * When and where an uploaded photo was taken, read from its own metadata
 * (forgejo#192).
 *
 * ExifReader rather than exifr: exifr 7.1.3 (unchanged since 2021) answered
 * "Malformed EXIF data" on a HEIC written by libheif 1.23 whose Exif item is
 * spec-conformant (4-byte header offset, `Exif\0\0`, big-endian TIFF), while
 * ExifReader read capture time, offset and position from the same file. It
 * reads JPEG, PNG, WebP and HEIC containers through one call.
 *
 * Abstention throughout: a value the file does not carry, or carries in a
 * form that does not parse, is null — never the upload time, never 0,0.
 */

export interface PhotoExif {
  takenAt: Date | null;
  lat: number | null;
  lon: number | null;
}

const NOTHING: PhotoExif = { takenAt: null, lat: null, lon: null };

/** `YYYY:MM:DD HH:MM:SS` — EXIF's own spelling of a wall clock. */
const EXIF_DATETIME = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/;
/** `+02:00` / `-05:30` — OffsetTimeOriginal. */
const EXIF_OFFSET = /^[+-]\d{2}:\d{2}$/;

function firstString(tag: { description?: unknown; value?: unknown } | undefined): string | null {
  if (!tag) return null;
  if (typeof tag.description === "string") return tag.description.trim();
  if (Array.isArray(tag.value) && typeof tag.value[0] === "string") return tag.value[0].trim();
  return null;
}

function coordinate(value: unknown, limit: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (Math.abs(value) > limit) return null;
  return value;
}

/**
 * The capture instant. EXIF's DateTimeOriginal is a wall clock with no zone:
 * - with OffsetTimeOriginal (every phone since ~2019) it is exact;
 * - without it, the zone of the photo's own GPS position places it, the way
 *   any other machine reading is placed (ADR 0002, machine origin — a
 *   spring-forward gap is placed, never refused);
 * - with neither it is null: the host's zone would be a guess.
 */
function captureInstant(
  local: string | null,
  offset: string | null,
  lat: number | null,
  lon: number | null
): Date | null {
  const match = local ? EXIF_DATETIME.exec(local) : null;
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const wallClock = `${y}-${mo}-${d}T${h}:${mi}:${s}`;
  if (offset && EXIF_OFFSET.test(offset)) {
    const instant = new Date(`${wallClock}${offset}`);
    return Number.isFinite(instant.getTime()) ? instant : null;
  }
  if (lat === null || lon === null) return null;
  try {
    return machineInstant(wallClock, zoneOfCoordinates(lat, lon));
  } catch {
    // The zone lookup could not run; a photo without a time beats a failed upload.
    return null;
  }
}

/** Reads capture time and position from an image's bytes. Never throws. */
export function readPhotoExif(bytes: Buffer): PhotoExif {
  let tags: ExpandedTags;
  try {
    tags = loadExif(bytes, { expanded: true });
  } catch (error) {
    // No metadata at all is the ordinary case for a screenshot or a sticker.
    logger.debug({
      operation: "photo_exif_unreadable",
      message: "No EXIF could be read from an uploaded photo",
      error: { message: error instanceof Error ? error.message : String(error) },
    });
    return NOTHING;
  }

  let lat = coordinate(tags.gps?.Latitude, 90);
  let lon = coordinate(tags.gps?.Longitude, 180);
  // 0,0 is what a camera without a fix writes, not a photo from the Gulf of Guinea.
  if (lat === null || lon === null || (lat === 0 && lon === 0)) {
    lat = null;
    lon = null;
  }

  const takenAt = captureInstant(
    firstString(tags.exif?.DateTimeOriginal),
    firstString(tags.exif?.OffsetTimeOriginal),
    lat,
    lon
  );
  return { takenAt, lat, lon };
}
