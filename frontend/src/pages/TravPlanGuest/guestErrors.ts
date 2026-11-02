import { apiErrorMachineCode } from "../../lib/apiError";

/** The i18n key of a refusal's copy; every code has its own sentence, nothing falls to a raw code. */
export function guestErrorKey(cause: unknown): string {
  const code = apiErrorMachineCode(cause);
  if (code) return "errors." + code;
  const status = (cause as { response?: { status?: number } })?.response?.status;
  return status === undefined ? "errors.network" : "errors.unknown";
}
