import logger from "../../utils/logger";
import { AppError, type ApiErrorCode } from "../../middleware/errorHandler";

export type FriendsErrorCode = Extract<ApiErrorCode, `FRIENDS_${string}`>;

/** Every refusal of the friends API: a stable code the web maps to DE/EN copy, and a log line. */
export function friendsError(
  code: FriendsErrorCode,
  status: number,
  message: string,
  context: Record<string, unknown> = {}
): AppError {
  logger.info({ operation: "friends_refused", code, ...context }, message);
  return new AppError(message, status, code);
}
