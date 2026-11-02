/**
 * The server connection file (Admin → Server-Verbindungen): this server's address, public
 * key and fingerprint in one ZIP, so two admins exchange a file instead of copying a PEM
 * block by hand. The file carries no secret and proves nothing by itself — the admins still
 * compare address and fingerprint over a second channel; the README inside says so.
 *
 * Reading one is untrusted bytes in, the three values out, or a coded refusal. The guards:
 *   - upload past MAX_BYTES, or the entry past it as ACTUALLY inflated   TOO_LARGE
 *   - neither ZIP nor JSON, a damaged ZIP, more than MAX_ENTRIES entries,
 *     no root `travstats-connection.json`, or that entry twice          UNREADABLE
 *   - another format or version, or a wrong shape                       FORMAT
 *   - an address the pin route would refuse                             ORIGIN
 *   - anything but an Ed25519 public key (a private key included)       KEY
 *   - a stated fingerprint the key does not hash to                     FINGERPRINT
 * "This server itself" needs the identity and is the route's check.
 *
 * Only the one entry is ever inflated, through the streaming inflater in small slices, and
 * cut off the moment it passes the cap: a ZIP header's declared size can lie, so a bomb
 * costs at most one slice's worth of expansion (the same reasoning as the trip file's
 * `readArchive.ts`).
 */
import { Unzip, UnzipInflate, strToU8, zipSync, type UnzipFile } from "fflate";
import { z } from "zod";
import { httpsOriginSchema } from "../../schemas/federationAdmin";
import type { ConnectionFileApiErrorCode } from "../../middleware/connectionFileErrorCodes";
import { comparisonError } from "../comparison/errors";
import { parsePeerPublicKey } from "./peerKey";
import { hash } from "./refusal";

export const CONNECTION_FILE_FORMAT = "travstats-federation-connection";
export const CONNECTION_FILE_VERSION = 1;
export const CONNECTION_ENTRY = "travstats-connection.json";
export const CONNECTION_README = "LIESMICH.txt";
/** Cap for the upload and for the inflated entry alike; a real file is well under 2 KB. */
export const CONNECTION_FILE_MAX_BYTES = 64 * 1024;
/** The file holds two entries; a few more (a `__MACOSX/` folder after re-zipping) are tolerated. */
const MAX_ENTRIES = 16;
const SLICE = 4 * 1024;

export interface ConnectionValues {
  origin: string;
  publicKey: string;
  fingerprint: string;
}

const refuse = (code: ConnectionFileApiErrorCode, message: string, status = 422) =>
  comparisonError(code, status, message);

const headSchema = z.object({ format: z.string(), version: z.number() });
const fileSchema = z.object({
  format: z.literal(CONNECTION_FILE_FORMAT),
  version: z.literal(CONNECTION_FILE_VERSION),
  origin: z.string().max(250),
  publicKey: z.string().min(40).max(500),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.string().max(40).optional(),
});

const README = (v: ConnectionValues): string =>
  [
    "TravStats – Verbindungsdatei",
    "============================",
    "",
    "Diese Datei enthält die Adresse, den öffentlichen Schlüssel und den Fingerabdruck",
    "dieses TravStats-Servers. Sie enthält kein Geheimnis.",
    "",
    "So verbindest du den anderen Server damit:",
    "  1. Öffne dort Admin → Server-Verbindungen → „Verbindungsdatei einlesen“.",
    "  2. Wähle diese ZIP-Datei (oder die JSON-Datei daraus).",
    "  3. Vergleiche Server-Adresse und vollständigen Fingerabdruck mit dem Admin",
    "     dieses Servers über einen unabhängigen Kanal, z. B. am Telefon.",
    "  4. Erst wenn beides übereinstimmt: „Server hinterlegen“.",
    "",
    `Adresse:       ${v.origin}`,
    `Fingerabdruck: ${v.fingerprint}`,
    "",
    "",
    "TravStats – connection file",
    "===========================",
    "",
    "This file holds the address, public key and fingerprint of this TravStats server.",
    "It contains no secret.",
    "",
    "To connect the other server with it:",
    "  1. There, open Admin → Server connections → “Import connection file”.",
    "  2. Choose this ZIP file (or the JSON file inside it).",
    "  3. Compare the server address and the full fingerprint with this server's admin",
    "     over an independent channel, e.g. by phone.",
    "  4. Only when both match: “Pin server”.",
    "",
    `Address:     ${v.origin}`,
    `Fingerprint: ${v.fingerprint}`,
    "",
  ].join("\r\n");

/** The ZIP for this server's identity. `publicKey` is the SPKI PEM `fingerprint` hashes. */
export function buildConnectionFile(values: ConnectionValues, createdAt: Date): Buffer {
  const json = {
    format: CONNECTION_FILE_FORMAT,
    version: CONNECTION_FILE_VERSION,
    origin: values.origin,
    publicKey: values.publicKey,
    fingerprint: values.fingerprint,
    createdAt: createdAt.toISOString(),
  };
  return Buffer.from(
    zipSync({
      [CONNECTION_ENTRY]: strToU8(`${JSON.stringify(json, null, 2)}\n`),
      [CONNECTION_README]: strToU8(README(values)),
    })
  );
}

/** `https://travstats.example.org` → `travstats.example.org`, safe for a header. */
export function connectionFileName(origin: string): string {
  const host = new URL(origin).hostname.replace(/[^a-z0-9.-]/gi, "-");
  return `travstats-verbindung-${host || "server"}.zip`;
}

const isZip = (buffer: Buffer) => buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;

/** The one entry, inflated under the cap; every other entry is skipped unread. */
function unpackEntry(buffer: Buffer): Buffer {
  const unreadable = (message: string) => refuse("COMPARISON_CONNECTION_FILE_UNREADABLE", message);
  let failure: Error | null = null;
  let entries = 0;
  let seen = false;
  let result: Buffer | null = null;
  const fail = (error: Error, file?: UnzipFile) => {
    failure ??= error;
    file?.terminate();
  };
  const unzip = new Unzip((file) => {
    if (failure) return;
    entries += 1;
    if (entries > MAX_ENTRIES) return fail(unreadable("The archive holds too many entries"));
    if (file.name !== CONNECTION_ENTRY) return;
    if (seen) return fail(unreadable(`${CONNECTION_ENTRY} appears twice`));
    seen = true;
    const chunks: Uint8Array[] = [];
    let size = 0;
    file.ondata = (err, chunk, final) => {
      if (failure) return;
      if (err) return fail(unreadable("The archive is damaged"), file);
      size += chunk.length;
      if (size > CONNECTION_FILE_MAX_BYTES)
        return fail(
          refuse("COMPARISON_CONNECTION_FILE_TOO_LARGE", "The entry is too large", 413),
          file
        );
      chunks.push(chunk);
      if (final) result = Buffer.concat(chunks);
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  try {
    for (let at = 0; at < buffer.length && !failure; at += SLICE) {
      unzip.push(buffer.subarray(at, at + SLICE), at + SLICE >= buffer.length);
    }
  } catch {
    failure ??= unreadable("The archive is damaged");
  }
  if (failure) throw failure;
  if (!result) throw unreadable(`The archive holds no ${CONNECTION_ENTRY}`);
  return result;
}

/** Validates an uploaded connection file (ZIP or its JSON) down to the three values. */
export function readConnectionFile(buffer: Buffer): ConnectionValues {
  if (buffer.length > CONNECTION_FILE_MAX_BYTES)
    throw refuse("COMPARISON_CONNECTION_FILE_TOO_LARGE", "The file is too large", 413);
  const bytes = isZip(buffer) ? unpackEntry(buffer) : buffer;
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw refuse("COMPARISON_CONNECTION_FILE_UNREADABLE", "Neither a ZIP nor JSON");
  }
  const head = headSchema.safeParse(raw);
  const file = fileSchema.safeParse(raw);
  if (!head.success || !file.success)
    throw refuse(
      "COMPARISON_CONNECTION_FILE_FORMAT",
      head.success
        ? `Format ${head.data.format} version ${head.data.version} is not a supported connection file`
        : "Not a connection file"
    );
  return validateValues(file.data.origin, file.data.publicKey, file.data.fingerprint);
}

/** The checks every carrier (file, QR) shares: https origin, Ed25519 key, matching fingerprint. */
function validateValues(origin: string, rawKey: string, fingerprint: string): ConnectionValues {
  if (!httpsOriginSchema.safeParse(origin).success)
    throw refuse(
      "COMPARISON_CONNECTION_FILE_ORIGIN",
      "The address is not an https origin (LAN servers: see FEDERATION_PRIVATE_PEERS)"
    );
  const publicKey = parsePeerPublicKey(rawKey);
  if (!publicKey) throw refuse("COMPARISON_CONNECTION_FILE_KEY", "Not an Ed25519 public key");
  if (hash(publicKey) !== fingerprint)
    throw refuse("COMPARISON_CONNECTION_FILE_FINGERPRINT", "Fingerprint does not match the key");
  return { origin, publicKey, fingerprint };
}

/** The QR the Admin → Instanz page shows (spec 2026-11-02 §6): the file's three values, no secret. */
export interface ServerQrPayload {
  v: 1;
  k: "server";
  u: string;
  key: string;
  fp: string;
}

/** Compact JSON string for the QR; `readServerQrPayload` is its inverse. */
export function buildServerQrPayload(values: ConnectionValues): string {
  const payload: ServerQrPayload = {
    v: 1,
    k: "server",
    u: values.origin,
    key: values.publicKey,
    fp: values.fingerprint,
  };
  return JSON.stringify(payload);
}

const QR_MAX_BYTES = 2 * 1024;
const qrSchema = z.strictObject({
  v: z.literal(1),
  k: z.literal("server"),
  u: z.string().max(250),
  key: z.string().min(40).max(500),
  fp: z.string().regex(/^[a-f0-9]{64}$/),
});

/** Validates a scanned QR (JSON string or already-parsed object) with the connection file's checks. */
export function readServerQrPayload(input: unknown): ConnectionValues {
  let raw = input;
  if (typeof input === "string") {
    if (input.length > QR_MAX_BYTES)
      throw refuse("COMPARISON_CONNECTION_FILE_TOO_LARGE", "The QR payload is too large", 413);
    try {
      raw = JSON.parse(input);
    } catch {
      throw refuse("COMPARISON_CONNECTION_FILE_UNREADABLE", "The QR payload is not JSON");
    }
  }
  const parsed = qrSchema.safeParse(raw);
  if (!parsed.success)
    throw refuse("COMPARISON_CONNECTION_FILE_FORMAT", "Not a TravStats server QR");
  return validateValues(parsed.data.u, parsed.data.key, parsed.data.fp);
}
