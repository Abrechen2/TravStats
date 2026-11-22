/**
 * What each step of reading a boarding pass did — recorded, never inferred.
 *
 * The scanner used to answer one of two things: a flight, or "Boarding pass
 * parsing failed". The owner's father scanned a pass, got a vague error and no
 * idea whether the barcode, the OCR or the model had let him down (owner,
 * 2026-11-22). Every stage now leaves one entry with a stable code; the web and
 * the Companion map the code to their own DE/EN sentence, and the server's
 * English never reaches the screen.
 *
 * Order is fixed: barcode → OCR → parser (template/regex over the OCR text) →
 * flight lookup → language model. A later stage runs only for what the earlier
 * ones left open, and says so when it did not need to run.
 */

export type BoardingPassStageName = "barcode" | "ocr" | "parser" | "lookup" | "llm";
export type BoardingPassStageStatus = "ok" | "partial" | "failed" | "skipped";

export const BOARDING_PASS_STAGE_CODES = [
  // barcode
  "BARCODE_FOUND",
  "BARCODE_SUPPLIED",
  "BARCODE_NOT_FOUND",
  "BARCODE_NOT_BOARDING_PASS",
  "BARCODE_DECODE_ERROR",
  // ocr
  "OCR_OK",
  "OCR_FAILED",
  "OCR_NOT_RUN",
  // parser
  "PARSER_OK",
  "PARSER_PARTIAL",
  "PARSER_NOTHING",
  "PARSER_NO_TEXT",
  // lookup
  "LOOKUP_OK",
  "LOOKUP_NOT_FOUND",
  "LOOKUP_FAILED",
  "LOOKUP_NOT_NEEDED",
  "LOOKUP_NOT_REQUESTED",
  // llm
  "LLM_OK",
  "LLM_NOTHING",
  "LLM_NOT_NEEDED",
  "LLM_NOT_CONFIGURED",
  "LLM_UNREACHABLE",
  "LLM_FAILED",
] as const;
export type BoardingPassStageCode = (typeof BOARDING_PASS_STAGE_CODES)[number];

export interface BoardingPassStage {
  readonly stage: BoardingPassStageName;
  readonly status: BoardingPassStageStatus;
  readonly code: BoardingPassStageCode;
  /** How many legs/barcodes the stage produced, where that is meaningful. */
  readonly count?: number;
  /** Fields still missing after this stage (parser), or filled by it (lookup, llm). */
  readonly fields?: readonly string[];
}

/** Fields without which a scanned leg cannot be saved as it stands. */
export const ESSENTIAL_LEG_FIELDS = [
  "flightNumber",
  "departureCode",
  "arrivalCode",
  "departureDate",
  "departureClock",
] as const;

/**
 * Thrown when nothing at all could be read (no barcode, and OCR itself failed):
 * carries the original failure for the route's error mapping AND the stages
 * that ran, so the user still sees which step broke.
 */
export class BoardingPassReadError extends Error {
  constructor(
    readonly original: unknown,
    readonly stages: readonly BoardingPassStage[]
  ) {
    super(original instanceof Error ? original.message : String(original));
    this.name = "BoardingPassReadError";
  }
}
