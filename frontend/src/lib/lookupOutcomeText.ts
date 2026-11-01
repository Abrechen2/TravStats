import { providerFailureLines } from "./flightLookupFailure";
import type { LookupOutcome } from "./flightLookupBatch";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * One row's lookup outcome as a sentence in the reader's language. A provider
 * that could not answer is named (`errors:providerFailure.*`), so "no such
 * flight" never reads like "the key was refused".
 */
export function lookupOutcomeText(outcome: LookupOutcome<unknown>, t: Translate): string {
  if (outcome.status === "found") {
    return t("flights:lookup.found", { count: outcome.flights.length });
  }
  if (outcome.status === "empty") return t("flights:lookup.empty");
  const reason = t(`flights:lookup.reason.${outcome.reason}`);
  return outcome.providerFailures.length > 0
    ? [reason, ...providerFailureLines(outcome.providerFailures, t)].join(" ")
    : reason;
}
