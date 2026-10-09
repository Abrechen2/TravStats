/**
 * Reading a `.travstats` upload — untrusted bytes in, a validated trip file
 * out, or a refusal with a stable code.
 *
 * The guards, in the order they bite:
 *   - not a ZIP, or no manifest/trip.json        TRIP_FILE_INVALID (422)
 *   - an entry name that climbs out (`..`, `/x`,
 *     `C:`, a backslash)                          TRIP_FILE_UNSAFE_PATH (422) —
 *     the whole file, not just the entry: a writer that produced one is not
 *     a writer whose other entries deserve trust
 *   - more entries than allowed, an entry or the
 *     whole past its byte cap                     TRIP_FILE_TOO_LARGE (413)
 *   - a manifest of another format or version     TRIP_FILE_VERSION_UNSUPPORTED (422)
 *   - manifest or trip.json failing their schema  TRIP_FILE_INVALID (422)
 *
 * The caps count bytes as they are actually inflated, not as the ZIP header
 * declares them: a header can lie, and fflate's one-shot unzip grows its
 * buffer past the declared size. So the archive is fed to the streaming
 * inflater in small slices and each entry is cut off the moment it passes
 * its cap — a bomb costs at most one slice's worth of expansion.
 *
 * Entry names are never used as paths: they are matched against a closed
 * pattern and only ever serve as keys into this map.
 */
import { Unzip, UnzipInflate, type UnzipFile } from "fflate";
import { AppError } from "../../../middleware/errorHandler";
import {
  ENTRY_FILE_NAME,
  TRIP_FILE_FORMAT,
  TRIP_FILE_LIMITS,
  TRIP_FILE_VERSION,
  manifestHeadSchema,
  manifestSchema,
  tripFileSchema,
  type TripFile,
  type TripFileManifest,
} from "./format";

export interface TripArchive {
  manifest: TripFileManifest;
  file: TripFile;
  /** `documents/d1.pdf` → bytes, only for names trip.json references. */
  blobs: Map<string, Buffer>;
}

export type TripArchiveLimits = typeof TRIP_FILE_LIMITS;

/** Small enough that one slice of a maximal-ratio deflate stream stays a few MB. */
const SLICE = 16 * 1024;

const invalid = (message: string, issues?: string): AppError =>
  new AppError(
    message,
    422,
    "TRIP_FILE_INVALID",
    undefined,
    issues ? { issues } : undefined
  );
const tooLarge = (): AppError =>
  new AppError("The file is larger than a trip file may be", 413, "TRIP_FILE_TOO_LARGE");

function isUnsafeName(name: string): boolean {
  return (
    name.includes("\\") ||
    name.startsWith("/") ||
    /^[A-Za-z]:/.test(name) ||
    name.split("/").some((part) => part === "..") ||
    name.includes("\0")
  );
}

function capFor(name: string, limits: TripArchiveLimits): number | null {
  if (name === "manifest.json") return limits.maxManifestBytes;
  if (name === "trip.json") return limits.maxTripJsonBytes;
  const [dir, base, ...rest] = name.split("/");
  if (rest.length > 0 || !base || !ENTRY_FILE_NAME.test(base)) return null;
  if (dir === "documents") return limits.maxDocumentBytes;
  if (dir === "photos") return limits.maxPhotoBytes;
  return null;
}

/** Inflates the wanted entries under the caps; throws the coded refusal on any breach. */
export function unpackEntries(
  buffer: Buffer,
  limits: TripArchiveLimits = TRIP_FILE_LIMITS
): Map<string, Buffer> {
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw invalid("The file is not a .travstats archive");
  }
  const out = new Map<string, Buffer>();
  let failure: AppError | null = null;
  let entries = 0;
  let total = 0;
  const fail = (error: AppError, file?: UnzipFile) => {
    failure ??= error;
    file?.terminate();
  };

  const unzip = new Unzip((file) => {
    if (failure) return;
    entries += 1;
    if (entries > limits.maxEntries) return fail(tooLarge());
    if (isUnsafeName(file.name)) {
      return fail(
        new AppError("The file names a path outside itself", 422, "TRIP_FILE_UNSAFE_PATH")
      );
    }
    const cap = capFor(file.name, limits);
    if (cap === null) return; // not ours (a folder entry, __MACOSX/…) — never inflated
    if (out.has(file.name)) return fail(invalid(`Entry ${file.name} appears twice`));
    if (file.originalSize !== undefined && file.originalSize > cap) return fail(tooLarge());
    const chunks: Uint8Array[] = [];
    let size = 0;
    file.ondata = (err, chunk, final) => {
      if (failure) return;
      if (err) return fail(invalid("The archive is damaged"), file);
      size += chunk.length;
      total += chunk.length;
      if (size > cap || total > limits.maxTotalBytes) return fail(tooLarge(), file);
      chunks.push(chunk);
      if (final) out.set(file.name, Buffer.concat(chunks));
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  try {
    for (let at = 0; at < buffer.length && !failure; at += SLICE) {
      unzip.push(buffer.subarray(at, at + SLICE), at + SLICE >= buffer.length);
    }
  } catch {
    failure ??= invalid("The archive is damaged");
  }
  if (failure) throw failure;
  return out;
}

function parseJson(bytes: Buffer | undefined, name: string): unknown {
  if (!bytes) throw invalid(`The file holds no ${name}`);
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw invalid(`${name} is not JSON`);
  }
}

const issuesOf = (error: { issues: { path: PropertyKey[]; message: string }[] }): string =>
  error.issues
    .slice(0, 10)
    .map((i) => `${i.path.map(String).join(".") || "(root)"}: ${i.message}`)
    .join("; ");

export function readTripArchive(
  buffer: Buffer,
  limits: TripArchiveLimits = TRIP_FILE_LIMITS
): TripArchive {
  const entries = unpackEntries(buffer, limits);
  const rawManifest = parseJson(entries.get("manifest.json"), "manifest.json");
  const head = manifestHeadSchema.safeParse(rawManifest);
  if (!head.success) {
    throw invalid(`The manifest does not name the ${TRIP_FILE_FORMAT} format`);
  }
  if (head.data.formatVersion !== TRIP_FILE_VERSION) {
    throw new AppError(
      `Format version ${head.data.formatVersion} is not supported`,
      422,
      "TRIP_FILE_VERSION_UNSUPPORTED",
      undefined,
      { formatVersion: head.data.formatVersion, supported: TRIP_FILE_VERSION }
    );
  }
  const manifest = manifestSchema.safeParse(rawManifest);
  if (!manifest.success) throw invalid("The manifest is invalid", issuesOf(manifest.error));
  const file = tripFileSchema.safeParse(parseJson(entries.get("trip.json"), "trip.json"));
  if (!file.success) throw invalid("trip.json is invalid", issuesOf(file.error));

  const blobs = new Map<string, Buffer>();
  for (const ref of [...file.data.documents, ...file.data.photos]) {
    const bytes = entries.get(ref.file);
    if (!bytes) throw invalid(`trip.json names ${ref.file}, which the file does not hold`);
    blobs.set(ref.file, bytes);
  }
  return { manifest: manifest.data, file: file.data, blobs };
}
