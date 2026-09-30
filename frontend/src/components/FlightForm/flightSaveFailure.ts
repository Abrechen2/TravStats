import type { DuplicateFlight } from "./flightFormModel";
import { saveErrorMessage } from "../../lib/saveErrorMessage";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** A refused save: a duplicate to offer, or the sentence to show. */
export type FlightSaveFailure =
  { kind: "duplicate"; existing: DuplicateFlight } | { kind: "message"; message: string };

/**
 * What the create form does with a failed save, in one place for its three
 * submit paths (save, save-and-return, force-save).
 *
 * A 409 with the existing flight is not an error but a question. Everything
 * else reads through the shared save rule: a stable code becomes a sentence in
 * the reader's language — the time model's refusals included (a typed hour the
 * clock change skips, an airport without a zone, a stale bundle). The form
 * used to print `response.data.error`, English prose written for a log.
 */
export function flightSaveFailure(err: unknown, t: Translate): FlightSaveFailure {
  const response = (
    err as { response?: { status?: number; data?: { existingFlight?: DuplicateFlight } } } | null
  )?.response;
  if (response?.status === 409 && response.data?.existingFlight) {
    return { kind: "duplicate", existing: response.data.existingFlight };
  }
  return { kind: "message", message: saveErrorMessage(err, t, "errors:saveFailed") };
}
