import { DEMO_FORBIDDEN_CODE, apiErrorCode, apiErrorMachineCode } from "../../lib/apiError";

/**
 * The sentence for a failed override write (forgejo#308): the server's stable
 * code mapped to DE/EN copy, never its English prose. Anything unrecognised
 * gets the caller's own fallback, which still says what failed.
 */
export function overrideErrorKey(err: unknown, fallback: string): string {
  if (apiErrorCode(err) === DEMO_FORBIDDEN_CODE) return "passport:overrides.demoForbidden";
  switch (apiErrorMachineCode(err)) {
    case "COUNTRY_UNKNOWN":
      return "passport:overrides.unknownCountry";
    case "COUNTRY_OVERRIDE_NOT_FOUND":
      return "passport:overrides.notFound";
    default:
      return fallback;
  }
}
