import logger from "../../utils/logger";
import { AppError, type ApiErrorCode } from "../../middleware/errorHandler";

export type AdmissionErrorCode = Extract<ApiErrorCode, `FEDERATION_ADMISSION_${string}`>;

/** Every admission refusal: a named code the UI maps to copy, and a log line for the operator. */
export function admissionError(
  code: AdmissionErrorCode,
  status: number,
  message: string,
  context: Record<string, unknown> = {}
): AppError {
  logger.info({ operation: "federation_admission_refused", code, ...context }, message);
  return new AppError(message, status, code);
}
