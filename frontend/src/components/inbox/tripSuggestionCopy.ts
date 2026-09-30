import { saveErrorKey } from "../../lib/saveErrorMessage";
import type { TripSuggestion } from "../../types/tripSuggestion";

type Translate = (key: string, options?: Record<string, unknown>) => string;

const NS = "dataQuality:inbox.tripSuggestions";

/**
 * The name a new trip is offered under, in the reader's language:
 * "Lissabon · September 2025". The server sends the destination and the dates,
 * never a finished name, because only the client knows which language it is
 * written in. Without a destination the month stands alone behind a generic
 * word — never an invented place.
 */
export function suggestedTripName(
  suggestion: Pick<TripSuggestion, "destination" | "startDay">,
  language: string,
  t: Translate
): string {
  const month = new Intl.DateTimeFormat(language === "de" ? "de-DE" : "en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${suggestion.startDay}T00:00:00Z`));
  return `${suggestion.destination ?? t(`${NS}.nameFallback`)} · ${month}`;
}

/**
 * The sentence a failed answer shows. The server's codes first — a changed
 * proposal ("reload") is not a broken one — then the shared save rules
 * (network, rate limit, demo account), then the action's own fallback.
 */
export function tripSuggestionErrorKey(err: unknown, fallbackKey: string): string {
  return saveErrorKey(err, fallbackKey, {
    TRIP_SUGGESTION_STALE: `${NS}.errors.stale`,
    TRIP_SUGGESTION_SELECTION_INVALID: `${NS}.errors.selection`,
  });
}

/** Whether the list must be reloaded after this failure. */
export function isStale(err: unknown): boolean {
  const code = (err as { response?: { data?: { code?: string } } } | null)?.response?.data?.code;
  return code === "TRIP_SUGGESTION_STALE";
}
