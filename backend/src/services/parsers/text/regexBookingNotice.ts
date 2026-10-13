import type { ParsedBooking } from "../../bookingParser";

/** Affirmative notices, not cancellation policies or a negated cancellation. */
const CANCELLATION =
  /\b(?:is|was|has been|wurde|ist|wird)\s+(?:leider\s+)?(?:cancelled|canceled|storniert|annulliert)\b|\b(?:flight cancellation|cancellation (?:notice|confirmation)|flugstornierung|stornierungsbestätigung)\b/i;

/** Keep the fallback's uncertainty visible in review (forgejo#298). */
export function annotateRegexBooking(source: string, flight: ParsedBooking): ParsedBooking {
  const inferred = new Set(flight.inferredFields ?? []);
  // With no clock anywhere in the source, midnight is only a date placeholder.
  if (!/\b\d{1,2}:\d{2}\b/.test(source)) {
    for (const field of ["departureTime", "arrivalTime"] as const) {
      if (/T00:00(?::00)?$/.test(flight[field] ?? "")) inferred.add(field);
    }
  }
  return {
    ...flight,
    ...(source
      .split(/[.!?\n]+/)
      .some(
        (line) =>
          CANCELLATION.test(line) && !/\b(?:if|unless|falls|wenn|policy|bedingungen)\b/i.test(line)
      )
      ? { airlineNotice: "flight_cancellation" }
      : {}),
    ...(inferred.size > 0 ? { inferredFields: [...inferred] } : {}),
  };
}
