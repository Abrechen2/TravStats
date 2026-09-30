/**
 * Evidence measures — the passport's headline figures (forgejo#132 item 5):
 * countries counted at the user's threshold, airports, entries ("Einreisen")
 * and continents, all from `loadPassport`'s `summary`. Which record proves a
 * country is the country page's own derivation, asked for every country; see
 * `services/evidence/metricEvidencePassport.ts`.
 *
 * All-time only: the passport has no year.
 *
 * MIRRORED at `frontend/src/shared/evidenceMeasuresPassport.ts`.
 */
import type { MeasureSpec } from "./evidenceMeasures";

const PASSPORT_CALCULATOR =
  "GET /stats/passport (services/stats/passport.ts buildPassport summary), rows by " +
  "services/stats/countryDetail.ts buildCountryDetail";

const passportMeasure = (aggregation: "sum" | "distinct", unit: string): MeasureSpec => ({
  aggregation,
  unit,
  scopes: ["allTime"],
  surface: "PassportPage (headline)",
  calculator: PASSPORT_CALCULATOR,
  servedIn: 1,
});

export const PASSPORT_MEASURES: Record<string, MeasureSpec> = {
  /** `summary.countries` — the headline, at the user's resolved threshold. */
  passportCountryCount: passportMeasure("distinct", "countries"),
  /** `summary.airports` — airports of flown legs whose country is known. */
  passportAirportCount: passportMeasure("distinct", "airports"),
  /** `summary.entries` — each flown flight once per country it touched. */
  passportEntryCount: passportMeasure("sum", "entries"),
  /** `summary.continentsVisited` — every country row's continent, whatever its tier. */
  passportContinentCount: passportMeasure("distinct", "continents"),
};
