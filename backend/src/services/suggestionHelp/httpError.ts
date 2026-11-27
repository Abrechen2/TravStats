import { AppError } from "../../middleware/errorHandler";
import { AiHelpError, type AiHelpFailure } from "./askStay";

/** The status each failure answers with: a missing setup is 409, a provider fault 502, a timeout 504. */
const STATUS: Record<AiHelpFailure, number> = {
  serviceOff: 409,
  internetOff: 409,
  noProvider: 409,
  notAmbiguous: 409,
  providerConsent: 409,
  providerOff: 409,
  timeout: 504,
  unreachable: 502,
  providerError: 502,
  badAnswer: 502,
};

/** An `AiHelpError` as an AppError with a stable code and its reason; anything else unchanged. */
export function aiHelpErrorOf(error: unknown): unknown {
  if (!(error instanceof AiHelpError)) return error;
  return new AppError(
    `AI help failed: ${error.reason}`,
    STATUS[error.reason],
    "AI_HELP_FAILED",
    undefined,
    {
      reason: error.reason,
    }
  );
}
