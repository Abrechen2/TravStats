/**
 * A tour operator's documents that arrive as a mail's PDF attachment (plan
 * 2026-10-09, P3 follow-up; spec package 2).
 *
 * The operator's mail says "anbei Ihre Reiseunterlagen" and prints nothing a
 * package template recognises; the invoice is the attachment. The package
 * reader used to see only the body, so such a mail read as "no template" —
 * the same blindness `pdfAttachmentFlights.ts` ended for flight mails.
 *
 * Template or nothing, as for the body: an attachment is read by the active
 * package templates only, and the first attachment a template reads whole
 * wins. A PDF that cannot be opened is logged and skipped.
 */
import { extractTextFromPdf } from "../pdfParser";
import { pdfAttachmentsToRead, type MailAttachment } from "../parsers/pdfAttachmentFlights";
import type { TemplateEnvelope } from "../parsers/templates/v2/envelope";
import { parsePackageText, type PackageParseResult } from "../trip/package/parsePackage";
import { scoreDocument, type DomainDetection } from "./documentDomain";
import logger from "../../utils/logger";

export interface AttachmentText {
  attachment: MailAttachment;
  text: string;
}

/** The text of each readable PDF attachment, in mail order. */
export async function pdfAttachmentTexts(
  attachments: readonly MailAttachment[]
): Promise<AttachmentText[]> {
  const texts: AttachmentText[] = [];
  for (const attachment of pdfAttachmentsToRead(attachments)) {
    try {
      texts.push({ attachment, text: await extractTextFromPdf(attachment.content) });
    } catch (err) {
      logger.warn(
        { file: attachment.filename, err: err instanceof Error ? err.message : String(err) },
        "[Package Parser] PDF attachment could not be read"
      );
    }
  }
  return texts;
}

/** Whether any active template could read a package at all — else no PDF is opened. */
export function hasPackageTemplates(templates: readonly TemplateEnvelope[]): boolean {
  return templates.some((t) => t.domain === "package");
}

export interface AttachmentPackageReading {
  result: PackageParseResult;
  attachment: MailAttachment;
}

/**
 * The first attachment a package template reads whole. When none is read but
 * a template recognised one and read it incompletely, that `invalidReading`
 * is returned instead — it tells the template's author more than "no template".
 */
export function readPackageFromAttachments(
  texts: readonly AttachmentText[],
  templates: readonly TemplateEnvelope[]
): AttachmentPackageReading | null {
  let refused: AttachmentPackageReading | null = null;
  for (const { attachment, text } of texts) {
    const result = parsePackageText(text, templates);
    if (result.reading) return { result, attachment };
    if (result.fallbackCode === "invalidReading") refused ??= { result, attachment };
  }
  return refused;
}

/**
 * `auto` for a mail whose body did not read as a package: the detection of
 * the first attachment that scores as one on its own. It is that attachment's
 * own scoring, so `domain` and `candidates[0]` agree, and its evidence names
 * the template that recognised it.
 */
export function detectPackageAttachment(
  texts: readonly AttachmentText[],
  templates: readonly TemplateEnvelope[]
): DomainDetection | null {
  for (const { text } of texts) {
    const detection = scoreDocument(text, templates);
    if (detection.domain === "package") return detection;
  }
  return null;
}
