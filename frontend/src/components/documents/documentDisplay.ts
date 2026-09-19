import type { IconName } from "../ui/Icon";
import type { DocumentFormat, DocumentLimits } from "../../lib/api/documents";

/**
 * What a kept original LOOKS like in a list — the pure half of
 * `DocumentsSection`, so the component holds rendering and this holds the
 * decisions a test can make without a DOM.
 */

/** One icon per format. `kind` is a word, not a picture: a boarding pass and
 *  an invoice can both be PDFs, and two icons for one row would compete. */
export const DOCUMENT_FORMAT_ICON: Record<DocumentFormat, IconName> = {
  image: "image",
  pdf: "file-text",
  eml: "mail",
  emailText: "mail",
  pkpass: "smartphone",
};

/** Extension → format, for the formats whose MIME type a browser rarely sets. */
const EXTENSION_FORMAT: Record<string, DocumentFormat> = {
  eml: "eml",
  txt: "emailText",
  pkpass: "pkpass",
  pdf: "pdf",
};

/**
 * Which format the server will probably call this file.
 *
 * A GUESS, and used only to pick the size limit to check before spending an
 * upload: the server decides from the bytes and may disagree, which is why
 * nothing is sent with the request. An unrecognised file yields null — the
 * upload then goes out and the server answers, rather than this function
 * refusing something it does not understand.
 */
export function guessDocumentFormat(file: File): DocumentFormat | null {
  const mime = file.type.toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  if (mime === "message/rfc822") return "eml";
  if (mime === "application/vnd.apple.pkpass") return "pkpass";
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  if (mime === "text/plain") return EXTENSION_FORMAT[extension] ?? "emailText";
  return EXTENSION_FORMAT[extension] ?? null;
}

/**
 * The limit this file breaks, in bytes, or null when it fits.
 *
 * With no limits known — an older server answers 404 on `/documents/limits` —
 * nothing is refused here. A client-side check exists to save a doomed upload,
 * never to be the rule; the rule is the server's.
 */
export function exceededDocumentLimit(file: File, limits: DocumentLimits | null): number | null {
  if (!limits) return null;
  const format = guessDocumentFormat(file);
  const limit = format ? limits[format] : Math.max(...Object.values(limits));
  return file.size > limit ? limit : null;
}
