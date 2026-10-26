import type { FindingErrorCode, InvalidActionReason } from "../../schemas/dataQualityFindings";

const STATUS_OF_ERROR: Record<FindingErrorCode, number> = {
  notFound: 404,
  invalidAction: 400,
  undoExpired: 409,
  staleFinding: 409,
};

/** A refused answer, with the contract's stable code in `error`. */
export class FindingActionError extends Error {
  readonly status: number;
  constructor(
    readonly code: FindingErrorCode,
    readonly reason?: InvalidActionReason
  ) {
    super(code);
    this.name = "FindingActionError";
    this.status = STATUS_OF_ERROR[code];
  }
}
