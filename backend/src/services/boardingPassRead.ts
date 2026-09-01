/**
 * Reading a boarding pass — the half that `/parse-boardingpass` and
 * `/boardingpass/propose` do identically.
 *
 * Both routes decode the pass's barcode, run OCR over the printed card, and
 * merge the two with the barcode winning what it carries. That was written into
 * both files, on different days, in slightly different words — so the next
 * correction to the merge rules would have had to be made twice, and the second
 * one would have been forgotten.
 *
 * What stays in the routes is what actually distinguishes them: flight-lookup
 * enrichment on one side, airport resolution and duplicate matching on the
 * other. Neither is redundant; only this part was duplicated.
 */
import { ParsedBooking } from './bookingParser';
import { getParserConfig, parseBoardingPass } from './parsers/factory';
import { getMissingFields } from './parsers/shared/utils';
import { decodeBarcodeFromImageBase64 } from '../utils/barcodeImage';
import { decodeBcbp, looksLikeBcbp, type DecodedBcbp } from '../utils/bcbp';
import logger from '../utils/logger';

export interface BoardingPassReading {
  /** The decoded BCBP, or null when there was no readable boarding-pass barcode. */
  readonly decoded: DecodedBcbp | null;
  /** What OCR alone made of the card; undefined when OCR did not run or found nothing. */
  readonly ocr: ParsedBooking | undefined;
  /** Both halves combined, barcode winning every field it carries. */
  readonly merged: ParsedBooking;
  readonly sources: { readonly barcode: boolean; readonly ocr: boolean };
  /** The OCR provider, or "barcode" when OCR contributed nothing at all. */
  readonly provider: string;
  readonly fallbackUsed: boolean;
}

export interface BoardingPassInput {
  readonly imageBase64?: string;
  /** A barcode the caller already has — the live scanner decodes on-device. */
  readonly barcode?: string;
  readonly userId: string;
  /**
   * False when the caller has already judged the image unusable for OCR (it
   * failed magic-number validation, say) but still wants the barcode read out
   * of it. Defaults to true.
   */
  readonly allowOcr?: boolean;
}

/** True when the reading found nothing at all — the caller's 422 condition. */
export function isEmpty(reading: BoardingPassReading): boolean {
  return reading.decoded === null && reading.ocr === undefined;
}

export async function readBoardingPass(
  input: BoardingPassInput
): Promise<BoardingPassReading> {
  const { imageBase64, barcode, userId, allowOcr = true } = input;

  // --- 1. The barcode -----------------------------------------------------
  // A supplied one wins: the scanner already decoded it from a live camera
  // frame, which beats re-reading it out of a JPEG of the same card. Reading it
  // out of the image is otherwise unconditional — a picture too poor for OCR
  // can still hold a perfectly good, error-corrected barcode.
  const barcodeStr =
    barcode ?? (imageBase64 ? await decodeBarcodeFromImageBase64(imageBase64) : undefined);
  const decoded = looksLikeBcbp(barcodeStr) ? decodeBcbp(barcodeStr) : null;
  if (decoded && barcode === undefined) {
    logger.info(
      { flightNumber: decoded.flightNumber, route: `${decoded.fromCode} → ${decoded.toCode}` },
      '[BoardingPassRead] barcode read from image'
    );
  }

  // --- 2. OCR, for the printed fields no barcode carries -------------------
  // Gate, terminal, boarding group and aircraft are never in a BCBP string, so
  // this runs even when the barcode decoded. It is allowed to fail there:
  // losing the gate must not cost a flight the barcode already spelled out.
  let ocr: ParsedBooking | undefined;
  let provider = 'barcode';
  let fallbackUsed = false;
  if (imageBase64 !== undefined && allowOcr) {
    try {
      const config = await getParserConfig(undefined, undefined, userId);
      const result = await parseBoardingPass(imageBase64, config);
      ocr = result.flights[0];
      provider = result.provider;
      fallbackUsed = result.fallbackUsed;
    } catch (error) {
      if (decoded === null) {
        throw error;
      }
      logger.warn({ err: error }, '[BoardingPassRead] OCR failed, continuing with barcode only');
    }
  }

  // --- 3. Merge, barcode winning what it carries ---------------------------
  // The date is stamped T00:00 rather than left bare: a BCBP string holds a day
  // of the year and no clock at all, and midnight is the placeholder this
  // codebase already reads as date-only.
  //
  // `airline` is the one field the barcode does NOT win. It carries the two
  // letter carrier code, OCR reads the printed name, and "Lufthansa" is worth
  // more to every caller than "LH" — which `normalizeParsedBooking` can derive
  // from the flight number anyway.
  const merged: ParsedBooking = {
    ...(ocr ?? { missing: [] }),
    ...(decoded
      ? {
          flightNumber: decoded.flightNumber ?? ocr?.flightNumber,
          departureCode: decoded.fromCode ?? ocr?.departureCode,
          arrivalCode: decoded.toCode ?? ocr?.arrivalCode,
          departureTime: decoded.date ? `${decoded.date}T00:00` : ocr?.departureTime,
          seat: decoded.seatNumber ?? ocr?.seat,
          pnr: decoded.pnr ?? ocr?.pnr,
          bookingReference: decoded.pnr ?? ocr?.bookingReference,
          bookingClassLetter: decoded.bookingClassLetter ?? ocr?.bookingClassLetter,
          airline: ocr?.airline ?? decoded.carrier,
        }
      : {}),
  };
  // Recomputed, not inherited: `missing` came from the OCR pass alone and would
  // still name fields the barcode has since supplied.
  merged.missing = getMissingFields(merged);

  logger.info(
    {
      provider,
      fallbackUsed,
      barcode: Boolean(decoded),
      flightNumber: merged.flightNumber,
      route: `${merged.departureCode} → ${merged.arrivalCode}`,
    },
    '[BoardingPassRead] reading complete'
  );

  return {
    decoded,
    ocr,
    merged,
    sources: { barcode: Boolean(decoded), ocr: ocr !== undefined },
    provider,
    fallbackUsed,
  };
}
