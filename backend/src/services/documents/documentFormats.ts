/**
 * What a kept original IS, decided from its bytes — and how large it may be.
 *
 * `format` is the file (image | pdf | eml | emailText | pkpass); `kind` is what
 * the document means (invoice | booking | boardingPass | ticket | other). Two
 * different axes, decided separately (forgejo#116).
 *
 * The declared MIME type and file name are hints, never the answer: an image
 * is an image because its first bytes say so. Only the two text formats, which
 * have no signature, fall back to the declaration — and even then the bytes
 * must look like text.
 *
 * Size limits are the owner's (2026-09-16): image 10 MB, pdf 10 MB,
 * eml / emailText 2 MB, pkpass 5 MB.
 */

export const DOCUMENT_FORMATS = ["image", "pdf", "eml", "emailText", "pkpass"] as const;
export type DocumentFormat = (typeof DOCUMENT_FORMATS)[number];

export const DOCUMENT_KINDS = ["invoice", "booking", "boardingPass", "ticket", "other"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/** The entries a document can be filed with — at most one of them. */
export const ENTRY_TYPES = [
  "flight",
  "cruise",
  "lodgingStay",
  "trip",
  "placeVisit",
  "railJourney",
] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

const MB = 1024 * 1024;

export const DOCUMENT_SIZE_LIMITS: Record<DocumentFormat, number> = {
  image: 10 * MB,
  pdf: 10 * MB,
  eml: 2 * MB,
  emailText: 2 * MB,
  pkpass: 5 * MB,
};

/** The largest any single document may be — the multer ceiling. */
export const DOCUMENT_MAX_BYTES = Math.max(...Object.values(DOCUMENT_SIZE_LIMITS));

export interface DetectedFormat {
  format: DocumentFormat;
  mimetype: string;
  extension: string;
}

function startsWith(buffer: Buffer, bytes: number[], offset = 0): boolean {
  if (buffer.length < offset + bytes.length) return false;
  return bytes.every((b, i) => buffer[offset + i] === b);
}

const ascii = (text: string): number[] => [...text].map((c) => c.charCodeAt(0));

function detectImage(buffer: Buffer): DetectedFormat | null {
  if (startsWith(buffer, [0xff, 0xd8, 0xff]))
    return { format: "image", mimetype: "image/jpeg", extension: ".jpg" };
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { format: "image", mimetype: "image/png", extension: ".png" };
  }
  if (startsWith(buffer, ascii("RIFF")) && startsWith(buffer, ascii("WEBP"), 8)) {
    return { format: "image", mimetype: "image/webp", extension: ".webp" };
  }
  // HEIC/HEIF — the iPhone camera's original format. "The original, full size"
  // is the owner's decision, so refusing HEIC would refuse the very file asked for.
  if (startsWith(buffer, ascii("ftyp"), 4)) {
    const brand = buffer.subarray(8, 12).toString("ascii");
    if (["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand)) {
      return { format: "image", mimetype: "image/heic", extension: ".heic" };
    }
  }
  return null;
}

/** Text, as far as a first check can tell: no NUL byte in the first 64 KB. */
function looksLikeText(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 64 * 1024);
  return !sample.includes(0);
}

/**
 * The format of an uploaded file, or null when it is none of the accepted ones.
 *
 * @param declaredName the client's file name — used only to tell a Wallet pass
 *   from any other ZIP and a mail file from any other text.
 * @param declaredMime the client's MIME type — same limited role.
 */
export function detectDocumentFormat(
  buffer: Buffer,
  declaredName: string | undefined,
  declaredMime: string | undefined
): DetectedFormat | null {
  const name = (declaredName ?? "").toLowerCase();
  const mime = (declaredMime ?? "").toLowerCase();

  const image = detectImage(buffer);
  if (image) return image;

  if (startsWith(buffer, ascii("%PDF")))
    return { format: "pdf", mimetype: "application/pdf", extension: ".pdf" };

  // A Wallet pass is a ZIP. Any ZIP is not a Wallet pass, so the declaration decides.
  if (startsWith(buffer, [0x50, 0x4b, 0x03, 0x04])) {
    if (name.endsWith(".pkpass") || mime === "application/vnd.apple.pkpass") {
      return { format: "pkpass", mimetype: "application/vnd.apple.pkpass", extension: ".pkpass" };
    }
    return null;
  }

  if (looksLikeText(buffer)) {
    if (name.endsWith(".eml") || mime === "message/rfc822") {
      return { format: "eml", mimetype: "message/rfc822", extension: ".eml" };
    }
    if (mime.startsWith("text/plain") || name.endsWith(".txt")) {
      return { format: "emailText", mimetype: "text/plain", extension: ".txt" };
    }
  }
  return null;
}

/** Text the server received AS text — a pasted mail — which has no file name to detect from. */
export const EMAIL_TEXT_FORMAT: DetectedFormat = {
  format: "emailText",
  mimetype: "text/plain",
  extension: ".txt",
};

/** Null when the size is acceptable for the format, otherwise the limit that was exceeded. */
export function exceededLimit(format: DocumentFormat, sizeBytes: number): number | null {
  const limit = DOCUMENT_SIZE_LIMITS[format];
  return sizeBytes > limit ? limit : null;
}
