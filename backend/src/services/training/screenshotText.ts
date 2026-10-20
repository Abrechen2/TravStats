import path from "path";
import { AppError } from "../../middleware/errorHandler";
import { validateBoardingPassImageBase64 } from "../../utils/fileValidation";
import { getTesseractParser } from "../parsers/vision/tesseractParser";
import { MIN_USABLE_TEXT_LENGTH } from "../parsing/usableText";
import logger from "../../utils/logger";

/**
 * The text of a screenshot uploaded to the template workshop (forgejo#309).
 *
 * A booking an app shows only on screen — a rail connection, a rental
 * summary — never arrives as a mail, so until now the workshop could not learn
 * from it: an image was stored as base64 with no text, and there was nothing
 * to mark. This runs the OCR step `/parse-image` runs (the same validator, the
 * same Tesseract worker, the same "too little text" floor), and the result is
 * the sample's `fullText`, marked exactly like a mail's.
 *
 * Every way of reading nothing is its own stable code, never an empty sample:
 * a sample with no text could only ever derive a template that reads nothing.
 */

/** The screenshot formats the workshop takes — what a phone or desktop saves. */
export const SCREENSHOT_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"] as const;

export function isScreenshotFile(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return (SCREENSHOT_EXTENSIONS as readonly string[]).includes(ext);
}

export async function readScreenshotText(buffer: Buffer): Promise<string> {
  // Magic-number sniffing and the decoded-byte cap the image routes apply.
  const validation = validateBoardingPassImageBase64(buffer.toString("base64"));
  if (!validation.valid) {
    throw new AppError(
      `The screenshot is not an image this workshop reads (${validation.reason ?? "invalid"})`,
      400,
      "TRAINING_IMAGE_UNREADABLE"
    );
  }
  let text: string;
  try {
    ({ text } = await getTesseractParser().recognizeText(
      validation.base64 ?? buffer.toString("base64")
    ));
  } catch (err) {
    // The OCR could not decode the file: the user's file, not a server fault.
    logger.warn({ err }, "[Training] OCR could not read the screenshot");
    throw new AppError(
      "The screenshot could not be read as an image",
      422,
      "TRAINING_IMAGE_UNREADABLE"
    );
  }
  // PostgreSQL jsonb rejects NUL bytes; OCR output is otherwise kept as read.
  const cleaned = text.replace(/\0/g, "");
  if (cleaned.trim().length < MIN_USABLE_TEXT_LENGTH) {
    throw new AppError(
      "Almost no text could be read from the screenshot",
      422,
      "TRAINING_IMAGE_NO_TEXT"
    );
  }
  return cleaned;
}
