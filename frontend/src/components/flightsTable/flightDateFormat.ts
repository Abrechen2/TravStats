/**
 * The flights list's date, in one place.
 *
 * Weekday, day, month, two-digit year, in the airport's own zone. It lived
 * inside `TimeCell`; the narrow row summary needs the same string, and a
 * second copy is how a list ends up showing two date formats on one screen —
 * which is exactly the finding (D-07) this round was handed.
 */
export const flightDateFmt = (iso: string, tz: string, lang: string): string =>
  new Intl.DateTimeFormat(lang === "de" ? "de-DE" : "en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    timeZone: tz,
  })
    .format(new Date(iso))
    // de-DE renders "Mo., 09.11.26" — the mockup wants the bare "Mo 09.11.26".
    .replace(".,", "");
