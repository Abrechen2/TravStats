/**
 * Streams a `.travstats` archive: manifest, trip.json, and the chosen files.
 *
 * The output is checked against the reader's own schema before the first
 * byte goes out — a file this server writes is a file this server reads, and
 * a value the schema refuses is a 500 here rather than an export that fails
 * later on someone else's import. A photo or document whose bytes are gone
 * from disk is left out of trip.json too, so the file never names an entry it
 * does not carry.
 */
import fs from "fs";
import archiver from "archiver";
import type { Writable } from "stream";
import { AppError } from "../../../middleware/errorHandler";
import logger from "../../../utils/logger";
import { buildVersion } from "../../../utils/version";
import type { CollectedTrip } from "./collect";
import {
  TRIP_FILE_FORMAT,
  TRIP_FILE_VERSION,
  manifestSchema,
  tripFileSchema,
  type ExportOptions,
  type TripFile,
  type TripFileManifest,
} from "./format";

/** Drops entries whose bytes are missing, and returns what is left to pack. */
export function presentFiles(collected: CollectedTrip): CollectedTrip {
  const present = collected.files.filter((f) => fs.existsSync(f.source));
  const names = new Set(present.map((f) => f.name));
  const file: TripFile = {
    ...collected.file,
    documents: collected.file.documents.filter((d) => names.has(d.file)),
    photos: collected.file.photos.filter((p) => names.has(p.file)),
  };
  return { ...collected, file, files: present };
}

export function buildManifest(options: ExportOptions, now: Date): TripFileManifest {
  return {
    format: TRIP_FILE_FORMAT,
    formatVersion: TRIP_FILE_VERSION,
    appVersion: buildVersion,
    exportedAt: now.toISOString(),
    options,
  };
}

/** Validates, then pipes the archive into `out`. Resolves when the archive is finalised. */
export async function writeTripArchive(
  collected: CollectedTrip,
  manifest: TripFileManifest,
  out: Writable
): Promise<void> {
  const checked = tripFileSchema.safeParse(collected.file);
  const head = manifestSchema.safeParse(manifest);
  if (!checked.success || !head.success) {
    const issues = (checked.error ?? head.error)?.issues.slice(0, 5) ?? [];
    logger.error({
      operation: "trip_export_invalid_output",
      issues: issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    });
    throw new AppError("The trip could not be written as a .travstats file", 500);
  }
  const zip = archiver("zip", { zlib: { level: 6 } });
  const done = new Promise<void>((resolve, reject) => {
    zip.on("error", reject);
    out.on("error", reject);
    out.on("finish", () => resolve());
    out.on("close", () => resolve());
  });
  zip.pipe(out);
  zip.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" });
  zip.append(JSON.stringify(checked.data), { name: "trip.json" });
  for (const f of collected.files) zip.file(f.source, { name: f.name });
  await zip.finalize();
  await done;
}
