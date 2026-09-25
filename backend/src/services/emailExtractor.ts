import MsgReader from "@kenjiuno/msgreader";
import { parse as parseHtml } from "node-html-parser";
import logger from "../utils/logger";
import { senderAddressIn } from "./parsers/userTemplates/sampleHeaders";
import { headerText, parseMimeMessage } from "./email/mimeMessage";

/**
 * Email Extractor Service
 *
 * Extracts subject and body text from email files (.msg, .eml, .txt)
 * Uses @kenjiuno/msgreader for .msg files (binary Outlook format)
 */

export interface ExtractedEmail {
  subject: string;
  text: string;
  html?: string;
  /**
   * The sender's address, where the format carries it.
   *
   * `text` is the BODY — this reader drops the header block, and the parser
   * chain never wanted it back. The template workshop does: a sender domain
   * is one of the two things a derived template can anchor on, and with the
   * headers gone every browser upload abstained for want of one (beta audit
   * 2026-09-19, NOT FIXED 5). Absent for plain text and for any message whose
   * header is unreadable.
   */
  from?: string;
  /**
   * When the message itself was sent, if the format carries it.
   *
   * This is the anchor for a booking that names a day and a month but no year.
   * Without it the parser reads "16.07." against TODAY, so a 2007 confirmation
   * imports as a 2026 flight and quietly builds a trip in the wrong decade —
   * measured on a real Germanwings mail (Forgejo #18). The mail knows its own
   * date; nothing else in the pipeline does.
   *
   * Absent for plain text, and for any message whose header is unreadable.
   */
  sentAt?: Date;
}

/** A Date, or nothing — never an Invalid Date, which poisons every comparison. */
function toDate(value: unknown): Date | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/**
 * Extract email content from .msg file (Microsoft Outlook binary format)
 */
function extractFromMsg(buffer: Buffer): ExtractedEmail {
  try {
    // Convert Buffer to ArrayBuffer for MsgReader
    // MsgReader accepts Buffer in runtime but TypeScript types expect ArrayBuffer
    const arrayBuffer = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    );
    const msgReader = new MsgReader(arrayBuffer as ArrayBuffer);
    const fileData = msgReader.getFileData();

    if (!fileData) {
      throw new Error("Failed to read .msg file structure");
    }

    const subject = fileData.subject || "";
    const body = fileData.body || "";
    const bodyHtml = fileData.bodyHtml || undefined;
    // When the SENDER sent it, preferring submit over delivery: delivery is the
    // receiving server's clock, and a mailbox re-imported years later can carry
    // a delivery stamp from the migration rather than from the booking.
    const sentAt = toDate(fileData.clientSubmitTime) ?? toDate(fileData.messageDeliveryTime);

    logger.debug(
      {
        subject,
        bodyLength: body.length,
        hasHtml: !!bodyHtml,
        sentAt: sentAt?.toISOString(),
      },
      "[Email Extractor] Extracted .msg file"
    );

    return {
      subject,
      text: body,
      html: bodyHtml,
      sentAt,
      // `senderSmtpAddress` first: `senderEmail` carries an Exchange
      // distinguished name (`/O=…/CN=…`) for internal senders, which names no
      // domain at all.
      ...(fileData.senderSmtpAddress || fileData.senderEmail
        ? { from: (fileData.senderSmtpAddress || fileData.senderEmail) as string }
        : {}),
    };
  } catch (error) {
    logger.error({ error }, "[Email Extractor] Failed to extract .msg file");
    throw new Error(
      `Failed to parse .msg file: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

/**
 * Extract email content from .eml file (RFC 5322 / MIME).
 *
 * The MIME tree is read by `parseMimeMessage`; see that file for what a
 * blank-line split got wrong (audit SRV-MAIL-MIME-001 — a multipart/mixed
 * confirmation handed its boundaries, part headers and the base64 of its PDF
 * to the parser as the message text).
 */
function extractFromEml(content: Buffer): ExtractedEmail {
  try {
    const message = parseMimeMessage(content);

    const subject = headerText(message, "subject") ?? "";
    // Only the bare address, never the display name: a template anchors on
    // the DOMAIN, and "Hotel Seeblick Garni <res@…>" would otherwise have to
    // be unwrapped again by every reader downstream.
    const from = senderAddressIn(`From: ${headerText(message, "from") ?? ""}`) ?? undefined;
    // `Date:`, never `Delivery-Date:` — the header map is keyed by the exact
    // field name, so the two can no longer be confused by a prefix match.
    const sentAt = toDate(message.headers.get("date"));

    // A mail with no MIME structure that simply CONTAINS markup: the old
    // reader's behaviour, kept because it is right and nothing in the tree
    // declares a content type for such a body. A declared text/html part has
    // already been picked up above and does not reach this.
    let text = message.text;
    let html = message.html;
    if (!html) {
      const inlineHtml = text.match(/<html[\s\S]*?<\/html>/i)?.[0];
      if (inlineHtml) html = inlineHtml;
    }
    if (html && (!message.text || message.text === html)) {
      try {
        text = parseHtml(html).textContent || text;
      } catch (_htmlError) {
        // Unparseable markup is still better read as itself than dropped.
      }
    }

    logger.debug(
      {
        subject,
        bodyLength: text.length,
        hasHtml: !!html,
        attachments: message.attachments.map(
          (a) => `${a.mediaType}${a.filename ? ` (${a.filename})` : ""}`
        ),
      },
      "[Email Extractor] Extracted .eml file"
    );

    return {
      subject,
      text,
      html,
      sentAt,
      ...(from ? { from } : {}),
    };
  } catch (error) {
    logger.error({ error }, "[Email Extractor] Failed to extract .eml file");
    throw new Error(
      `Failed to parse .eml file: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

/**
 * Extract email content from plain text file
 */
function extractFromText(content: string): ExtractedEmail {
  logger.debug(
    {
      bodyLength: content.length,
    },
    "[Email Extractor] Extracted .txt file"
  );

  return {
    subject: "",
    text: content.trim(),
  };
}

/**
 * Extract email content from file
 *
 * @param file - File buffer or string content
 * @param filename - Original filename (used to determine file type)
 * @returns Extracted email content (subject, text, html)
 */
export function extractEmailFromFile(file: Buffer | string, filename: string): ExtractedEmail {
  const extension = filename.toLowerCase().slice(filename.lastIndexOf("."));

  logger.info(
    {
      filename,
      extension,
      isBuffer: Buffer.isBuffer(file),
      size: Buffer.isBuffer(file) ? file.length : file.length,
    },
    "[Email Extractor] Extracting email from file"
  );

  switch (extension) {
    case ".msg":
      if (!Buffer.isBuffer(file)) {
        throw new Error(".msg files must be provided as Buffer (binary)");
      }
      return extractFromMsg(file);

    case ".eml": {
      // The BYTES, not a UTF-8 string: a part declares its own charset and a
      // latin-1 body decoded as UTF-8 loses exactly the umlauts the German
      // templates key on.
      return extractFromEml(Buffer.isBuffer(file) ? file : Buffer.from(file, "utf8"));
    }

    case ".txt": {
      const txtContent = Buffer.isBuffer(file) ? file.toString("utf-8") : file;
      return extractFromText(txtContent);
    }

    default:
      throw new Error(`Unsupported email file type: ${extension}. Supported: .msg, .eml, .txt`);
  }
}
