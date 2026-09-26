import { apiErrorMachineCode } from "../../lib/apiError";
import { LOG_ERROR_CODES } from "../../shared/logContract";

/**
 * The reader's-language sentence for a failed log-area call: the server's
 * stable code (`LOG_FILE_NOT_FOUND`, …) mapped to `admin:logging.errors.*`,
 * otherwise the caller's fallback. Never the server's `error` prose — that
 * printed "Log file not found: …" in English into the German admin page.
 */
export function logErrorCopy(error: unknown, fallback: string, t: (key: string) => string): string {
  const code = apiErrorMachineCode(error);
  return code && (LOG_ERROR_CODES as readonly string[]).includes(code)
    ? t(`admin:logging.errors.${code}`)
    : fallback;
}
