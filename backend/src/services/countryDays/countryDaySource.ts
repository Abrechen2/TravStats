/**
 * Where a country-day came from — the `source` column of `CountryDay`.
 *
 * Design: `docs/superpowers/specs/2026-09-02-country-counting-design.md` §8.4,
 * which specifies the row as `(userId, date, countryCode, source)`.
 *
 * ## What this does NOT say, and why that matters
 *
 * §8.3 asks for one honesty above all others: *"Not all of Dawarich is
 * measured. The owner's own history is photo-estimated beyond one year. An
 * estimated presence is evidence, but it is not GPS, and the row must say which
 * it was."*
 *
 * **The Dawarich API, as measured, cannot say which it was.** The one payload
 * this repo has ever measured against a real instance — Dawarich 1.9.2, the
 * fixture pinned in `services/dawarich/__tests__/dawarichClient.test.ts` — is
 * `{id, latitude, longitude, timestamp, altitude, accuracy, velocity,
 * track_id, lonlat, city, country}`. There is no import id, no provenance, no
 * "this came from a photo" marker anywhere in it. A `quality` column whose
 * every row read `measured` would be precisely the inference-dressed-as-a-
 * measurement that §8.3 exists to forbid, so this file does not invent one.
 *
 * What IS observable is stored instead, and stored as a number rather than a
 * verdict: `CountryDay.pointCount`. A day held up by four hundred fixes and a
 * day held up by one behave differently, and a reader can see that without
 * anyone deciding on their behalf what it means. Same discipline as the ground
 * time in §3.4b — shown as evidence, never used as a threshold.
 *
 * ## Why the column exists at all when there is one value today
 *
 * It is part of the unique key. A second pipeline observing the same day must
 * be able to disagree with this one rather than overwrite it — `TripRouteTrack`
 * already carries `source = "gpx" | "dawarich"`, so a GPX upload is a real,
 * already-stored second provenance waiting for a reducer, not a hypothetical.
 * Without the column in the key, adding it later means rewriting rows that are
 * by then in someone's passport.
 */

/** Every pipeline allowed to write a country-day. */
export const COUNTRY_DAY_SOURCES = ["dawarich"] as const;

export type CountryDaySource = (typeof COUNTRY_DAY_SOURCES)[number];

/**
 * A stored or submitted value read back as a source, or null when it is not
 * one.
 *
 * The column is plain TEXT — the closed set lives here and a duplicate database
 * enum would be a second place for it to drift, the same trade
 * `shared/countryEvidence.ts` makes for the tier vocabulary. That makes this
 * the boundary guard for a row written by a build that knew a source this one
 * does not.
 */
export function parseCountryDaySource(value: unknown): CountryDaySource | null {
  return typeof value === "string" && (COUNTRY_DAY_SOURCES as readonly string[]).includes(value)
    ? (value as CountryDaySource)
    : null;
}
