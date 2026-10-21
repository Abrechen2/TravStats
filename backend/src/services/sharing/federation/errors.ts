import logger from "../../../utils/logger";
import { AppError, type ApiErrorCode } from "../../../middleware/errorHandler";

export type RemoteShareErrorCode = Extract<ApiErrorCode, `SHARE_REMOTE_${string}`>;

/**
 * Every refusal of the remote-sharing endpoints: a code the frontend maps to DE/EN copy (no
 * server English reaches the UI), facts the sentence needs in `extra` (the origin of a server the
 * admin has not admitted), and a log line — the log carries kinds and ids, never codes or facts.
 */
export function remoteShareError(
  code: RemoteShareErrorCode,
  status: number,
  message: string,
  context: { userId?: string; origin?: string; kind?: string } = {},
  extra?: Readonly<Record<string, string>>
): AppError {
  logger.info({ operation: "share_remote_refused", code, ...context }, message);
  return new AppError(message, status, code, undefined, extra);
}
