import { Unzip, UnzipInflate } from "fflate";

import { FILE_LIMITS } from "../../config/constants";

/**
 * KMZ — a ZIP holding a KML, conventionally `doc.kml` at its root — opened to
 * the KML text (forgejo#312). Google Earth reads the first `.kml` entry; so
 * does this, preferring `doc.kml` when there are several.
 *
 * Untrusted bytes, so the cap counts what is actually inflated, not what the
 * ZIP header claims (the `trip/exchange/readArchive.ts` approach): the archive
 * goes through fflate's streaming inflater in slices and an entry is cut off
 * the moment the KML entries together pass the upload limit. Entries that are
 * not KML (icons, overlays) are never inflated.
 */

export type KmzRefusal = "kmzDamaged" | "kmzNoKml" | "kmzTooLarge";
export type KmzResult = { ok: true; kml: string } | { ok: false; reason: KmzRefusal };

const SLICE = 16 * 1024;

export function looksLikeZip(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

function isKmlEntry(name: string): boolean {
  return /\.kml$/i.test(name) && !name.startsWith("__MACOSX/");
}

export function readKmz(buffer: Buffer, maxBytes = FILE_LIMITS.GPX_TRACK_MAX_SIZE): KmzResult {
  const entries = new Map<string, Buffer>();
  let failure: KmzRefusal | null = null;
  let total = 0;
  let started = 0;

  const unzip = new Unzip((file) => {
    if (failure || !isKmlEntry(file.name)) return;
    if (file.originalSize !== undefined && file.originalSize > maxBytes) {
      failure = "kmzTooLarge";
      return;
    }
    started += 1;
    const chunks: Uint8Array[] = [];
    file.ondata = (err, chunk, final) => {
      if (failure) return;
      if (err) {
        failure = "kmzDamaged";
        file.terminate();
        return;
      }
      total += chunk.length;
      if (total > maxBytes) {
        failure = "kmzTooLarge";
        file.terminate();
        return;
      }
      chunks.push(chunk);
      if (final) entries.set(file.name, Buffer.concat(chunks));
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  try {
    for (let at = 0; at < buffer.length && !failure; at += SLICE) {
      unzip.push(buffer.subarray(at, at + SLICE), at + SLICE >= buffer.length);
    }
  } catch {
    failure ??= "kmzDamaged";
  }
  if (failure) return { ok: false, reason: failure };
  // An entry that began but never ended: the archive was cut short.
  if (entries.size < started) return { ok: false, reason: "kmzDamaged" };

  const names = [...entries.keys()];
  const chosen = names.find((n) => n.toLowerCase() === "doc.kml") ?? names[0];
  if (chosen === undefined) return { ok: false, reason: "kmzNoKml" };
  return { ok: true, kml: entries.get(chosen)!.toString("utf-8") };
}
