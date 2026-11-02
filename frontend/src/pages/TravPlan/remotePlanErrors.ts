import { apiErrorMachineCode } from "../../lib/apiError";

/** The i18n key of a refusal's copy; every code has its own sentence, nothing falls to a raw code. */
export function remotePlanErrorKey(cause: unknown): string {
  const code = apiErrorMachineCode(cause) ?? (cause as { code?: string })?.code;
  if (typeof code === "string" && code) return "errors." + code;
  const status = (cause as { response?: { status?: number } })?.response?.status;
  return status === undefined ? "errors.network" : "errors.unknown";
}
