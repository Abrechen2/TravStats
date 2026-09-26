/**
 * The two rules that decide when flights become a trip on their own, and the
 * month label an automatically named trip carries. One home, because the
 * detection service and the batch import each used to own a copy.
 *
 * The two thresholds differ on purpose, and the difference is the evidence:
 *
 *   - DETECTED: `detectTrips` INFERS a journey from flight patterns (a shared
 *     PNR over at most 30 days, a home loop, a continuous chain). A plain
 *     out-and-back is not journey-shaped enough to propose a container for
 *     ("Rule of Three"), so it needs three flights.
 *   - BOOKED: the batch import groups flights the user imported TOGETHER
 *     under one booking reference — an email or PDF confirmation. That
 *     booking is a fact, not an inference, and the trip it creates is also
 *     where the booking's total price lands (spec 2026-07-17). An outbound +
 *     return confirmation is the most common booking there is; at three it
 *     would lose both its trip and its booking-level price.
 */
export const MIN_DETECTED_TRIP_FLIGHTS = 3;
export const MIN_BOOKED_TRIP_FLIGHTS = 2;

export type TripNameLanguage = "de" | "en";

/**
 * The reader's language from the free-form `UserSettings.data` blob
 * (`display.language`). Absent or unknown means German, the app's primary
 * language — the same default the trip summary uses.
 */
export function tripNameLanguageOf(settingsData: unknown): TripNameLanguage {
  if (typeof settingsData !== "object" || settingsData === null) return "de";
  const display = (settingsData as Record<string, unknown>).display;
  if (typeof display !== "object" || display === null) return "de";
  const language = (display as Record<string, unknown>).language;
  return language === "en" ? "en" : "de";
}

/**
 * "Okt. 2026" / "Oct 2026" for the month a trip starts. Read in UTC so the
 * label does not depend on the server's own zone.
 */
export function tripNameMonth(departure: Date, language: TripNameLanguage): string {
  return departure.toLocaleDateString(language, {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
