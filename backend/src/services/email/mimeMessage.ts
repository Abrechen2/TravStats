/**
 * Read an RFC 5322 message as the TREE it is, instead of as a string with a
 * blank line in it.
 *
 * The reader this replaces split on the first empty line and called
 * everything after it the body. For a plain single-part mail that is right.
 * For a standard `multipart/mixed` — a message and a PDF, which is what a
 * booking confirmation actually looks like — it is the whole MIME envelope:
 * boundary markers, per-part headers and the base64 of the attachment, all
 * handed to the flight parser as if a human had typed it, and shown to the
 * user as the message text.
 *
 * Measured 2026-09-20 on 2.7.0-beta.13 (audit SRV-MAIL-MIME-001): a
 * standards-conformant multipart/mixed .eml with a text/plain part and a PDF
 * attachment came back from `/parse-email-file` with `text` containing the
 * boundaries, the part headers and the base64; Python's stdlib parser read
 * the same file correctly.
 *
 * What this handles, and why each one is here rather than "later":
 *
 * - **Folded headers.** A `Subject:` continued on an indented next line lost
 *   its continuation entirely before, silently shortening the subject the
 *   domain detector scores.
 * - **Nested multiparts.** `mixed` wrapping `alternative` is the ordinary
 *   shape of any mail with both a text and an HTML body plus an attachment.
 * - **Transfer encodings.** A quoted-printable body is not text: it reads
 *   `Fr=C3=BChst=C3=BCck` and every German label in it fails to match.
 * - **Charsets.** A latin-1 part decoded as UTF-8 loses exactly the umlauts
 *   the German templates key on.
 * - **Attachments are excluded from the text.** A part with a filename or
 *   `Content-Disposition: attachment` is listed, never concatenated into the
 *   message body.
 *
 * Deliberately NOT here: reading the attachment. An attached PDF stays an
 * attachment this reader can NAME but does not parse — saying so is the
 * point, since the old behaviour pretended its base64 was the message.
 */

/** Guards against a pathological message; neither is reachable by real mail. */
const MAX_DEPTH = 10;
const MAX_PARTS = 200;

export interface MimeAttachment {
  filename?: string;
  mediaType: string;
  /** Decoded size in bytes. */
  size: number;
}

export interface MimeMessage {
  /** Header values by lower-cased name, unfolded, first occurrence wins. */
  headers: Map<string, string>;
  /** The readable message, from the text/plain part where there is one. */
  text: string;
  /** The HTML part, where there is one. */
  html?: string;
  /** Parts that are not the message: what the mail carried, not what it says. */
  attachments: MimeAttachment[];
}

interface ContentType {
  mediaType: string;
  parameters: Map<string, string>;
}

/**
 * The header block as text: UTF-8 when the bytes are valid UTF-8, latin1
 * otherwise.
 *
 * RFC 6532 lets a header carry UTF-8 unencoded, and real mail does. Read as
 * latin1 unconditionally, "Buchungsbestätigung" came back as
 * "BuchungsbestÃ¤tigung" and the sample-header columns stored that
 * (parserWorkshop.sampleHeaders.test.ts). Pure ASCII reads the same either
 * way, and bytes that are not UTF-8 are what an older mailer wrote in latin1.
 */
function headerBlockText(bytes: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return bytes.toString("latin1");
  }
}

/** Everything before the first empty line, and everything after it. */
function splitHeadersAndBody(raw: Buffer): { headerText: string; body: Buffer } {
  for (let i = 0; i + 1 < raw.length; i++) {
    if (raw[i] === 0x0a && raw[i + 1] === 0x0a) {
      return { headerText: headerBlockText(raw.subarray(0, i)), body: raw.subarray(i + 2) };
    }
    if (
      i + 3 < raw.length &&
      raw[i] === 0x0d &&
      raw[i + 1] === 0x0a &&
      raw[i + 2] === 0x0d &&
      raw[i + 3] === 0x0a
    ) {
      return { headerText: headerBlockText(raw.subarray(0, i)), body: raw.subarray(i + 4) };
    }
  }
  // No blank line at all — there is no header block to speak of, so the whole
  // thing is the body. A message consisting only of headers is not one.
  return { headerText: "", body: raw };
}

/**
 * Header names and structure are ASCII. Non-ASCII inside a value arrives
 * either raw (see `headerBlockText`) or through RFC 2047 encoded-words, which
 * `decodeEncodedWords` handles. Unfolding first is what makes a continued
 * `Subject:` survive.
 */
function parseHeaders(headerText: string): Map<string, string> {
  const headers = new Map<string, string>();
  if (!headerText) return headers;

  const unfolded: string[] = [];
  for (const line of headerText.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += " " + line.trim();
    } else {
      unfolded.push(line);
    }
  }

  for (const line of unfolded) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    if (headers.has(name)) continue;
    headers.set(name, line.slice(colon + 1).trim());
  }
  return headers;
}

function parseContentType(value: string | undefined): ContentType {
  const parameters = new Map<string, string>();
  if (!value) return { mediaType: "text/plain", parameters };

  const [head, ...rest] = value.split(";");
  for (const chunk of rest) {
    const eq = chunk.indexOf("=");
    if (eq <= 0) continue;
    const key = chunk.slice(0, eq).trim().toLowerCase();
    let raw = chunk.slice(eq + 1).trim();
    if (raw.startsWith('"')) {
      const end = raw.indexOf('"', 1);
      raw = end > 0 ? raw.slice(1, end) : raw.slice(1);
    }
    parameters.set(key, raw);
  }
  return { mediaType: head.trim().toLowerCase() || "text/plain", parameters };
}

function decodeQuotedPrintable(body: Buffer): Buffer {
  const text = body.toString("latin1").replace(/=(?:\r?\n)/g, "");
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (
      text[i] === "=" &&
      i + 2 < text.length &&
      /^[0-9A-Fa-f]{2}$/.test(text.slice(i + 1, i + 3))
    ) {
      out.push(parseInt(text.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      out.push(text.charCodeAt(i) & 0xff);
    }
  }
  return Buffer.from(out);
}

function decodeTransferEncoding(body: Buffer, encoding: string | undefined): Buffer {
  switch ((encoding ?? "").trim().toLowerCase()) {
    case "base64":
      return Buffer.from(body.toString("latin1").replace(/[^A-Za-z0-9+/=]/g, ""), "base64");
    case "quoted-printable":
      return decodeQuotedPrintable(body);
    default:
      return body;
  }
}

/**
 * Bytes to text in the part's own charset.
 *
 * An unknown label is not a reason to lose the message: UTF-8 is tried, and
 * latin1 — which cannot fail — is the last resort.
 */
function decodeText(bytes: Buffer, charset: string | undefined): string {
  const label = (charset ?? "utf-8").trim().toLowerCase();
  for (const candidate of [label, "utf-8"]) {
    try {
      return new TextDecoder(candidate, { fatal: false }).decode(bytes);
    } catch {
      // Unknown label — try the next one.
    }
  }
  return bytes.toString("latin1");
}

/**
 * `=?utf-8?Q?Buchungsbest=C3=A4tigung?=` and its base64 sibling, as they
 * appear in `Subject:` and `From:`.
 */
export function decodeEncodedWords(value: string): string {
  return value.replace(
    /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,
    (whole, charset: string, encoding: string, payload: string) => {
      try {
        const bytes =
          encoding.toUpperCase() === "B"
            ? Buffer.from(payload, "base64")
            : decodeQuotedPrintable(Buffer.from(payload.replace(/_/g, " "), "latin1"));
        return decodeText(bytes, charset);
      } catch {
        return whole;
      }
    }
  );
}

/** Split a multipart body on its boundary; the epilogue after `--b--` is dropped. */
function splitOnBoundary(body: Buffer, boundary: string): Buffer[] {
  const text = body.toString("latin1");
  const marker = `--${boundary}`;
  const parts: Buffer[] = [];

  let cursor = text.indexOf(marker);
  if (cursor < 0) return parts;

  while (cursor >= 0 && parts.length < MAX_PARTS) {
    const afterMarker = cursor + marker.length;
    if (text.startsWith("--", afterMarker)) break; // closing delimiter
    const bodyStart = text.indexOf("\n", afterMarker);
    if (bodyStart < 0) break;
    const next = text.indexOf(marker, bodyStart);
    const end = next < 0 ? text.length : next;
    // The CRLF immediately before the next boundary belongs to the delimiter.
    parts.push(body.subarray(bodyStart + 1, Math.max(bodyStart + 1, trimDelimiterEol(text, end))));
    cursor = next;
  }
  return parts;
}

function trimDelimiterEol(text: string, end: number): number {
  let cut = end;
  if (cut > 0 && text[cut - 1] === "\n") cut--;
  if (cut > 0 && text[cut - 1] === "\r") cut--;
  return cut;
}

interface Collected {
  text?: string;
  html?: string;
  attachments: MimeAttachment[];
}

function isAttachment(headers: Map<string, string>, contentType: ContentType): boolean {
  const disposition = (headers.get("content-disposition") ?? "").toLowerCase();
  if (disposition.startsWith("attachment")) return true;
  if (contentType.parameters.has("name")) return true;
  return /filename\s*=/.test(disposition);
}

function filenameOf(headers: Map<string, string>, contentType: ContentType): string | undefined {
  const disposition = headers.get("content-disposition") ?? "";
  const match = /filename\s*=\s*"?([^";]+)"?/i.exec(disposition);
  if (match) return decodeEncodedWords(match[1].trim());
  const name = contentType.parameters.get("name");
  return name ? decodeEncodedWords(name) : undefined;
}

function walk(headers: Map<string, string>, body: Buffer, depth: number, into: Collected): void {
  if (depth > MAX_DEPTH) return;

  const contentType = parseContentType(headers.get("content-type"));

  if (contentType.mediaType.startsWith("multipart/")) {
    const boundary = contentType.parameters.get("boundary");
    if (!boundary) return;
    for (const raw of splitOnBoundary(body, boundary)) {
      const split = splitHeadersAndBody(raw);
      walk(parseHeaders(split.headerText), split.body, depth + 1, into);
    }
    return;
  }

  const decoded = decodeTransferEncoding(body, headers.get("content-transfer-encoding"));

  if (isAttachment(headers, contentType)) {
    if (into.attachments.length < MAX_PARTS) {
      const filename = filenameOf(headers, contentType);
      into.attachments.push({
        ...(filename ? { filename } : {}),
        mediaType: contentType.mediaType,
        size: decoded.length,
      });
    }
    return;
  }

  // First of each kind wins: in a multipart/alternative the plain part comes
  // before the HTML one, and in a mixed body the first text part is the
  // message rather than a signature block appended further down.
  if (contentType.mediaType === "text/plain" && into.text === undefined) {
    into.text = decodeText(decoded, contentType.parameters.get("charset"));
  } else if (contentType.mediaType === "text/html" && into.html === undefined) {
    into.html = decodeText(decoded, contentType.parameters.get("charset"));
  } else if (
    !contentType.mediaType.startsWith("text/") &&
    into.attachments.length < MAX_PARTS &&
    decoded.length > 0
  ) {
    // A binary part with no disposition is still not the message.
    into.attachments.push({ mediaType: contentType.mediaType, size: decoded.length });
  }
}

export function parseMimeMessage(raw: Buffer): MimeMessage {
  const { headerText, body } = splitHeadersAndBody(raw);
  const headers = parseHeaders(headerText);
  const collected: Collected = { attachments: [] };
  walk(headers, body, 0, collected);

  return {
    headers,
    text: (collected.text ?? "").trim(),
    ...(collected.html ? { html: collected.html } : {}),
    attachments: collected.attachments,
  };
}

/** A header value with its encoded-words decoded, or undefined when absent. */
export function headerText(message: MimeMessage, name: string): string | undefined {
  const raw = message.headers.get(name.toLowerCase());
  return raw === undefined ? undefined : decodeEncodedWords(raw);
}
