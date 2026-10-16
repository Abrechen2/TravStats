import logger from "../../utils/logger";
import { AppError, type ApiErrorCode } from "../../middleware/errorHandler";

export type ComparisonErrorCode = Extract<ApiErrorCode, `COMPARISON_${string}`>;

/**
 * Every leaderboard refusal goes through here: a named code the frontend branches on, and a log
 * line, so "why can't Anna see Ben" is answered from the log instead of from a guess. The old
 * comparison router answered every refusal with one bare 403 and logged none of them.
 */
export function comparisonError(
  code: ComparisonErrorCode,
  status: number,
  message: string,
  context: Record<string, unknown> = {}
): AppError {
  logger.info({ operation: "comparison_refused", code, ...context }, message);
  return new AppError(message, status, code);
}
