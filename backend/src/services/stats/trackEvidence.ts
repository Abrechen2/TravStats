/**
 * Stored location observations, deliberately separate from country evidence.
 *
 * forgejo#299: country-days contain neither altitude, motion nor reliable
 * provenance. Point counts, airport proximity and adjacent dates cannot prove
 * that the traveller was on the ground. Keep these observations visible, but
 * never feed them into the evidence fold, presence days or visit years.
 * A future ground classifier must use richer source data and explicit proof;
 * deleting stored country-days would only hide the problem until the next sync.
 */
import { toCountryCode } from "../../shared/countryEvidence";
import { parseCountryDaySource, type CountryDaySource } from "../countryDays/countryDaySource";

/** A stored CountryDay. Airport counts and completeness are not ground proof. */
export interface CountryDayRow {
  date: string;
  countryCode: string;
  pointCount: number;
  airportPointCount: number;
  partialWindow: boolean;
  /**
   * The pipeline that wrote the row, as stored; absent means Dawarich's, as
   * every row was before TravTrack. A value outside `COUNTRY_DAY_SOURCES` is
   * dropped, never guessed into one.
   */
  source?: string;
}

export interface UnconfirmedTrackCountry {
  code: string;
  /** The pipeline that observed it. One entry per country AND source: the two are never merged. */
  source: CountryDaySource;
  reason: "ground-unconfirmed";
  observedDays: number;
  pointCount: number;
  firstDate: string;
  lastDate: string;
}

/** Summarise observations without making a visit or transit claim. */
export function unconfirmedTrackCountries(
  rows: readonly CountryDayRow[],
  now: Date
): UnconfirmedTrackCountry[] {
  const today = now.toISOString().slice(0, 10);
  const byCountry = new Map<
    string,
    { code: string; source: CountryDaySource; days: Set<string>; points: number }
  >();
  for (const row of rows) {
    const code = toCountryCode(row.countryCode);
    const source = row.source === undefined ? "dawarich" : parseCountryDaySource(row.source);
    const instant = Date.parse(`${row.date}T00:00:00Z`);
    if (
      !code ||
      !source ||
      !/^\d{4}-\d{2}-\d{2}$/.test(row.date) ||
      !Number.isFinite(instant) ||
      new Date(instant).toISOString().slice(0, 10) !== row.date ||
      row.date > today ||
      !Number.isSafeInteger(row.pointCount) ||
      row.pointCount <= 0
    )
      continue;
    const key = `${code} ${source}`;
    const track = byCountry.get(key) ?? { code, source, days: new Set<string>(), points: 0 };
    track.days.add(row.date);
    track.points += row.pointCount;
    byCountry.set(key, track);
  }
  return [...byCountry.values()]
    .map((track): UnconfirmedTrackCountry => {
      const days = [...track.days].sort();
      return {
        code: track.code,
        source: track.source,
        reason: "ground-unconfirmed",
        observedDays: days.length,
        pointCount: track.points,
        firstDate: days[0],
        lastDate: days[days.length - 1],
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code) || a.source.localeCompare(b.source));
}
