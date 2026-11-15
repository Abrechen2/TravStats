/**
 * The Polarsteps data download is a ZIP: one folder per trip, each with a
 * `trip.json` (the steps) and `locations.json` (the GPS track), plus the
 * photos — which can be most of its size. Unzipping happens HERE, in the
 * browser, so only the small `trip.json` files travel to the server, under the
 * same text ceiling as every other import file.
 *
 * Only entries named `trip.json` are inflated (`filter`), and one that claims
 * to be larger than the ceiling is skipped before it is inflated, so a
 * hostile archive cannot be inflated into memory by naming itself that.
 */

import { strFromU8, unzipSync } from "fflate";

export type PolarstepsZipFailure = "notZip" | "noTrip" | "tooLarge" | "invalid";

export class PolarstepsZipError extends Error {
  constructor(public readonly kind: PolarstepsZipFailure) {
    super(kind);
    this.name = "PolarstepsZipError";
  }
}

const TRIP_FILE = /(^|\/)trip\.json$/i;
const ZIP_MAGIC = [0x50, 0x4b];

/** Whether the bytes start like a ZIP (`PK`), whatever the file is called. */
export function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === ZIP_MAGIC[0] && bytes[1] === ZIP_MAGIC[1];
}

/** The text to send: the archive's trips as one JSON array. */
export function polarstepsTextFromZip(bytes: Uint8Array, maxChars: number): string {
  if (!looksLikeZip(bytes)) throw new PolarstepsZipError("notZip");
  let skippedLarge = false;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, {
      filter: (file) => {
        if (!TRIP_FILE.test(file.name)) return false;
        if (file.originalSize > maxChars) {
          skippedLarge = true;
          return false;
        }
        return true;
      },
    });
  } catch {
    throw new PolarstepsZipError("notZip");
  }
  const names = Object.keys(entries).sort();
  // A trip left out because it is too large would otherwise vanish from a file that still imports.
  if (skippedLarge) throw new PolarstepsZipError("tooLarge");
  if (names.length === 0) throw new PolarstepsZipError("noTrip");
  const trips: unknown[] = [];
  for (const name of names) {
    try {
      trips.push(JSON.parse(strFromU8(entries[name])));
    } catch {
      throw new PolarstepsZipError("invalid");
    }
  }
  const text = JSON.stringify(trips);
  if (text.length > maxChars) throw new PolarstepsZipError("tooLarge");
  return text;
}
