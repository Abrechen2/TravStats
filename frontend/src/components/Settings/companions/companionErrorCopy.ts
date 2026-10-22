import { saveErrorKey } from "../../../lib/saveErrorMessage";
import { apiErrorMachineCode } from "../../../lib/apiError";

const NS = "companions:manage.errors";

/**
 * The sentence a refused companion action shows: the server's codes
 * (`backend/src/middleware/companionErrorCodes.ts`) first, then the shared
 * save rules (network, rate limit, demo account), then the action's own
 * fallback. Never the server's English prose.
 */
export function companionErrorKey(err: unknown, fallbackKey: string): string {
  return saveErrorKey(err, fallbackKey, {
    COMPANION_NAME_TAKEN: `${NS}.nameTaken`,
    COMPANION_MERGE_SELF: `${NS}.mergeSelf`,
    COMPANION_MERGE_LINK_CONFLICT: `${NS}.linkConflict`,
    COMPANION_IN_USE: `${NS}.inUse`,
    COMPANION_NOT_FOUND: `${NS}.notFound`,
  });
}

/** The other companion a refused rename collided with — the page offers to merge into it. */
export function takenBy(err: unknown): { id: string; name: string } | null {
  if (apiErrorMachineCode(err) !== "COMPANION_NAME_TAKEN") return null;
  const data = (err as { response?: { data?: { companionId?: unknown; companionName?: unknown } } })
    .response?.data;
  return typeof data?.companionId === "string" && typeof data.companionName === "string"
    ? { id: data.companionId, name: data.companionName }
    : null;
}
