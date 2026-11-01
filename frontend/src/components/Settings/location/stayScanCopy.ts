import { JobFailedError, JobLostError } from "../../../lib/api/jobs";
import { apiErrorMachineCode } from "../../../lib/apiError";
import type { StayScanState } from "../../../lib/api/dawarichStays";

/** The kinds a failed read of the source can name (`state.error`). */
const SOURCE_ERRORS = ["auth", "unreachable", "protocol", "notFound", "invalidUrl"];

/** Why the last scan failed, when the source said so; else the plain sentence. */
export function failedResultKey(state: StayScanState | null): string {
  return state?.error && SOURCE_ERRORS.includes(state.error)
    ? `trips:tours.tracks.dawarich.errors.${state.error}`
    : "settings:location.stay.result.failed";
}

/** The i18n key of a stay-scan refusal: its own copy per cause, never the server's English. */
export function stayErrorKey(err: unknown, state?: StayScanState | null): string {
  if (err instanceof JobFailedError) {
    return state?.error && SOURCE_ERRORS.includes(state.error)
      ? `trips:tours.tracks.dawarich.errors.${state.error}`
      : "settings:location.stay.errors.jobFailed";
  }
  switch (apiErrorMachineCode(err)) {
    case "DAWARICH_PLACES_DISABLED":
      return "settings:location.stay.errors.placesOff";
    case "TRAVTRACK_DISABLED":
      return "settings:location.stay.errors.travTrackOff";
    case "DAWARICH_OWN_CONNECTION_REQUIRED":
      return "settings:location.stay.errors.ownConnection";
    case "DAWARICH_SCAN_UNAVAILABLE":
      return "settings:location.stay.errors.unavailable";
    default:
  }
  const response = (err as { response?: { status?: number } } | null)?.response;
  if (!response) return "settings:location.stay.errors.offline";
  if (response.status === 429) return "settings:location.stay.errors.rateLimited";
  return "settings:location.stay.errors.generic";
}

export { JobLostError };
