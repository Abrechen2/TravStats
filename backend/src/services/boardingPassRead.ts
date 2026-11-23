/**
 * Reading a boarding pass — shared by `/parse-boardingpass` (web scanner and
 * the Companion's photo capture) and `/boardingpass/propose`.
 *
 * Stages, in this order, each recorded in `stages` (see boardingPass/stages):
 *  1. barcode — every PDF417/Aztec/QR in the image (`barcodeScan/`), each BCBP
 *     string one leg; two passes on one photo are two legs;
 *  2. OCR — per pass when several barcodes mark where each pass is, else the
 *     whole image; it runs even after a barcode hit, because gate, terminal
 *     and every clock are printed only;
 *  3. parser — barcode fields win, the regex reading fills the rest, and the
 *     printed departure/arrival clocks turn the barcode's bare date into times;
 *  4. lookup — scheduled times from the flight-data providers, only for legs
 *     still lacking them and only when the caller asks (`enrich`);
 *  5. llm — the language model over the OCR text, last, only for what is
 *     still open.
 *
 * Before 2026-11-22 a stage that found nothing was invisible: the full-frame
 * decode missed both PDF417s on a photo of two United passes, OCR merged the
 * two passes into one invented flight, and the user saw one vague error.
 */
import { ParsedBooking } from "./bookingParser";
import { getParserConfig, parseBoardingPass } from "./parsers/factory";
import type { ParserConfig } from "./parsers/types";
import { getMissingFields } from "./parsers/shared/utils";
import { scanBarcodesFromImageBase64, type BarcodeScan } from "../utils/barcodeImage";
import { decodeBcbp, looksLikeBcbp, type DecodedBcbp } from "../utils/bcbp";
import { ImageRefusedError, type Box } from "../utils/barcodeScan/pixels";
import logger from "../utils/logger";
import { mergeLeg, openFields, settleArrivalDate } from "./boardingPass/legs";
import { getAirportTimezone } from "../utils/timezone";
import { readPrintedTimes } from "./boardingPass/printedTimes";
import { getTesseractParser } from "./parsers/vision/tesseractParser";
import { cropPassBands } from "./boardingPass/bands";
import { llmStage, lookupStage } from "./boardingPass/fill";
import {
  BoardingPassReadError,
  MAX_LEGS_PER_IMAGE,
  type BoardingPassStage,
} from "./boardingPass/stages";

export { BoardingPassReadError, type BoardingPassStage } from "./boardingPass/stages";

export interface BoardingPassReading {
  /** The first decoded BCBP, or null when no readable boarding-pass barcode. */
  readonly decoded: DecodedBcbp | null;
  /** Every decoded BCBP, one per pass on the image. */
  readonly decodedAll: readonly DecodedBcbp[];
  /** What OCR alone made of the (first) card; undefined when OCR did not run or failed. */
  readonly ocr: ParsedBooking | undefined;
  /** The first leg — what single-flight callers read. */
  readonly merged: ParsedBooking;
  /** One entry per boarding pass found on the image. */
  readonly legs: readonly ParsedBooking[];
  readonly stages: readonly BoardingPassStage[];
  readonly sources: { readonly barcode: boolean; readonly ocr: boolean };
  /** The OCR provider, or "barcode" when OCR contributed nothing at all. */
  readonly provider: string;
  readonly fallbackUsed: boolean;
  /** True when the flight lookup filled a field. */
  readonly enriched: boolean;
}

export interface BoardingPassInput {
  readonly imageBase64?: string;
  /** A barcode the caller already has — the live scanner decodes on-device. */
  readonly barcode?: string;
  readonly userId: string;
  /**
   * The route limiter's key for this request (`userOrIpKey(req)`): the flight lookups spend the
   * same bucket the lookup route does — per API token, per masked address for the shared demo.
   * Never built by hand; a hand-built `user:` key split or shared the wrong bucket.
   */
  readonly lookupKey: string;
  /**
   * False when the caller has already judged the image unusable for OCR (it
   * failed magic-number validation, say) but still wants the barcode read out
   * of it. Defaults to true.
   */
  readonly allowOcr?: boolean;
  /** Ask the flight-data providers for times the pass did not yield. Default false. */
  readonly enrich?: boolean;
  /** Ask the language model for what is still open. Default true. */
  readonly allowLlm?: boolean;
}

/** True when the reading found nothing at all — the caller's 422 condition. */
export function isEmpty(reading: BoardingPassReading): boolean {
  return reading.legs.length === 0;
}

/**
 * One pass per passenger and flight: the same pass read twice (full frame and
 * a region) collapses, two travellers on one flight stay two legs.
 */
const legKey = (d: DecodedBcbp): string =>
  [d.flightNumber, d.date, d.fromCode, d.passengerName, d.seatNumber].join("|");

type DecodedLeg = { bcbp: DecodedBcbp; box?: Box };

async function barcodeStage(
  input: BoardingPassInput
): Promise<{ decoded: DecodedLeg[]; stage: BoardingPassStage }> {
  if (input.barcode !== undefined) {
    const bcbp = looksLikeBcbp(input.barcode) ? decodeBcbp(input.barcode) : null;
    return bcbp
      ? {
          decoded: [{ bcbp }],
          stage: { stage: "barcode", status: "ok", code: "BARCODE_SUPPLIED", count: 1 },
        }
      : {
          decoded: [],
          stage: { stage: "barcode", status: "failed", code: "BARCODE_NOT_BOARDING_PASS" },
        };
  }
  if (!input.imageBase64) {
    return {
      decoded: [],
      stage: { stage: "barcode", status: "skipped", code: "BARCODE_NOT_FOUND" },
    };
  }
  const scan: BarcodeScan = await scanBarcodesFromImageBase64(input.imageBase64);
  const seen = new Set<string>();
  const decoded: DecodedLeg[] = [];
  for (const code of scan.codes) {
    const bcbp = looksLikeBcbp(code.text) ? decodeBcbp(code.text) : null;
    if (!bcbp || seen.has(legKey(bcbp))) continue;
    seen.add(legKey(bcbp));
    decoded.push({ bcbp, ...(code.box ? { box: code.box } : {}) });
  }
  logger.info(
    {
      codes: scan.codes.length,
      legs: decoded.length,
      attempts: scan.attempts,
      regions: scan.regionsTried,
    },
    "[BoardingPassRead] barcode stage"
  );
  if (decoded.length > MAX_LEGS_PER_IMAGE) {
    return {
      decoded: decoded.slice(0, MAX_LEGS_PER_IMAGE),
      stage: {
        stage: "barcode",
        status: "partial",
        code: "BARCODE_TOO_MANY_LEGS",
        count: MAX_LEGS_PER_IMAGE,
      },
    };
  }
  if (decoded.length > 0) {
    return {
      decoded,
      stage: { stage: "barcode", status: "ok", code: "BARCODE_FOUND", count: decoded.length },
    };
  }
  if (scan.refused) {
    return {
      decoded,
      stage: { stage: "barcode", status: "failed", code: "BARCODE_IMAGE_REFUSED" },
    };
  }
  if (scan.error) {
    return { decoded, stage: { stage: "barcode", status: "failed", code: "BARCODE_DECODE_ERROR" } };
  }
  return {
    decoded,
    stage: {
      stage: "barcode",
      status: "failed",
      code: scan.codes.length > 0 ? "BARCODE_NOT_BOARDING_PASS" : "BARCODE_NOT_FOUND",
    },
  };
}

interface OcrPass {
  readonly booking?: ParsedBooking;
  readonly text?: string;
  /** OCR threw on this image — distinct from "read it, found nothing". */
  readonly failed?: true;
}

interface OcrOutcome {
  readonly passes: OcrPass[];
  readonly provider: string;
  readonly fallbackUsed: boolean;
  readonly error?: unknown;
}

async function ocrStage(
  imageBase64: string,
  boxes: ReadonlyArray<Box | undefined>,
  config: ParserConfig
): Promise<OcrOutcome> {
  // Several barcodes with known positions: one OCR per pass, so each leg is
  // read from its own card. Otherwise the whole image, once.
  const boxed = boxes.filter((b): b is Box => b !== undefined);
  const perPass = boxes.length >= 2 && boxed.length === boxes.length;
  const images = (perPass ? cropPassBands(imageBase64, boxed) : null) ?? [imageBase64];
  const passes: OcrPass[] = [];
  let provider = "barcode";
  let fallbackUsed = false;
  let error: unknown;
  for (const image of images) {
    try {
      const result = await parseBoardingPass(image, config);
      provider = result.provider;
      fallbackUsed = fallbackUsed || result.fallbackUsed;
      passes.push({
        booking: result.flights[0],
        text: await withSecondReading(image, result.ocrText),
      });
    } catch (err) {
      error = err;
      passes.push({ failed: true });
    }
  }
  return { passes, provider, fallbackUsed, ...(error !== undefined ? { error } : {}) };
}

/**
 * A second OCR pass with the document reader (global threshold) when the
 * first left a printed clock unread. Thin dot-matrix print reads differently
 * under the two thresholds — on the United photo the first pass found no
 * "Flight Departs" at all and the second read "12:46" — so the texts are
 * joined and the clock reader takes the first match. Best effort: a failing
 * second pass costs nothing the first already had.
 */
async function withSecondReading(
  image: string,
  text: string | undefined
): Promise<string | undefined> {
  if (text === undefined) return undefined;
  const printed = readPrintedTimes(text);
  if (printed.departure && printed.arrival) return text;
  try {
    const second = await getTesseractParser().recognizeText(image);
    return second.text.trim() === "" ? text : `${text}\n${second.text}`;
  } catch (err) {
    logger.debug({ err }, "[BoardingPassRead] second OCR reading failed");
    return text;
  }
}

function ocrStageEntry(ocr: OcrOutcome): BoardingPassStage {
  const read = ocr.passes.filter((p) => !p.failed).length;
  if (read === 0) {
    return {
      stage: "ocr",
      status: "failed",
      code: ocr.error instanceof ImageRefusedError ? "OCR_IMAGE_REFUSED" : "OCR_FAILED",
    };
  }
  return {
    stage: "ocr",
    status: read === ocr.passes.length ? "ok" : "partial",
    code: "OCR_OK",
    count: read,
  };
}

function buildLegs(decoded: readonly DecodedBcbp[], passes: readonly OcrPass[]): ParsedBooking[] {
  if (decoded.length > 0) {
    // Per-pass OCR belongs to its leg. A whole-image OCR of SEVERAL passes
    // belongs to none of them in particular, so its fields stay out.
    const paired = passes.length === decoded.length;
    return decoded.map((bcbp, i) => {
      const pass = paired ? passes[i] : decoded.length === 1 ? passes[0] : undefined;
      return mergeLeg(bcbp, pass?.booking, pass?.text);
    });
  }
  const pass = passes[0];
  const b = pass?.booking;
  return b && (b.flightNumber || b.departureCode || b.arrivalCode)
    ? [mergeLeg(null, b, pass.text)]
    : [];
}

function parserStageEntry(
  legs: readonly ParsedBooking[],
  passes: readonly OcrPass[]
): BoardingPassStage {
  if (passes.every((p) => p.failed)) {
    return { stage: "parser", status: "skipped", code: "PARSER_NO_TEXT" };
  }
  if (legs.length === 0) return { stage: "parser", status: "failed", code: "PARSER_NOTHING" };
  const open = [...new Set(legs.flatMap(openFields))];
  return open.length > 0
    ? {
        stage: "parser",
        status: "partial",
        code: "PARSER_PARTIAL",
        fields: open,
        count: legs.length,
      }
    : { stage: "parser", status: "ok", code: "PARSER_OK", count: legs.length };
}

export async function readBoardingPass(input: BoardingPassInput): Promise<BoardingPassReading> {
  const { imageBase64, userId, allowOcr = true, enrich = false, allowLlm = true } = input;
  const stages: BoardingPassStage[] = [];

  // 1. barcode
  const barcode = await barcodeStage(input);
  stages.push(barcode.stage);
  const decodedAll = barcode.decoded.map((d) => d.bcbp);

  // 2. OCR
  const config = (await getParserConfig(undefined, undefined, userId)) as ParserConfig;
  let ocr: OcrOutcome | undefined;
  if (imageBase64 !== undefined && allowOcr) {
    ocr = await ocrStage(
      imageBase64,
      barcode.decoded.map((d) => d.box),
      config
    );
    const entry = ocrStageEntry(ocr);
    stages.push(entry);
    if (entry.status === "failed") {
      logger.warn({ err: ocr.error }, "[BoardingPassRead] OCR failed");
      // Without a barcode nothing is left to read; the route's error mapping
      // tells the user why (the contract before stages existed).
      if (decodedAll.length === 0) {
        throw new BoardingPassReadError(ocr.error ?? new Error("OCR produced nothing"), stages);
      }
    }
  } else {
    stages.push({ stage: "ocr", status: "skipped", code: "OCR_NOT_RUN" });
  }

  // 3. parser: barcode + OCR reading + printed clocks
  const passes = ocr?.passes ?? [];
  let legs = await Promise.all(
    buildLegs(decodedAll, passes).map((leg) => settleArrivalDate(leg, getAirportTimezone))
  );
  stages.push(parserStageEntry(legs, passes));

  // 4. flight lookup
  let enriched = false;
  if (enrich) {
    const looked = await lookupStage(legs, userId, input.lookupKey);
    legs = looked.legs;
    enriched = looked.stage.code === "LOOKUP_OK";
    stages.push(looked.stage);
  } else {
    stages.push({ stage: "lookup", status: "skipped", code: "LOOKUP_NOT_REQUESTED" });
  }

  // 5. language model, last
  if (allowLlm) {
    const text = passes
      .map((p) => p.text)
      .filter((t): t is string => Boolean(t))
      .join("\n\n");
    const asked = await llmStage(legs, text, config, userId);
    legs = asked.legs;
    stages.push(asked.stage);
  } else {
    stages.push({ stage: "llm", status: "skipped", code: "LLM_NOT_NEEDED" });
  }

  legs = legs.map((leg) => ({ ...leg, missing: getMissingFields(leg) }));
  const firstOcr = passes.find((p) => p.booking)?.booking;
  logger.info(
    { legs: legs.length, stages: stages.map((s) => `${s.stage}:${s.code}`) },
    "[BoardingPassRead] reading complete"
  );

  return {
    decoded: decodedAll[0] ?? null,
    decodedAll,
    ocr: firstOcr,
    merged: legs[0] ?? { missing: getMissingFields({ missing: [] }) },
    legs,
    stages,
    sources: { barcode: decodedAll.length > 0, ocr: firstOcr !== undefined },
    provider: firstOcr ? (ocr?.provider ?? "barcode") : "barcode",
    fallbackUsed: ocr?.fallbackUsed ?? false,
    enriched,
  };
}
