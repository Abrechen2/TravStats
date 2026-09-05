/**
 * The lodging stamp on a passport row (forgejo#93): how many nights the
 * account slept in a country, and the place that stands for them.
 *
 * A passport row already says a house PROVED a country (`kinds` holds
 * `lodging`); what the Companion's stamp needs beside that is the figure a
 * traveller actually remembers — "Vienna, 12 nights". This module derives the
 * two parts from the same stays the country rule reads, so the stamp and the
 * row cannot disagree about which houses were real.
 *
 * ## Nights
 *
 * The SUM over stays that HAPPENED — check-out in the past, not cancelled —
 * of the nights each stay can prove. "Happened" is `classifyStay`'s verdict
 * (`shared/lodgingCounting.ts`), and "can prove" is `resolveStayTiming`'s
 * (`shared/lodgingTiming.ts`): a DAY-precision stay with both ends counts the
 * span, any other stay counts its explicit `nights` field, and a stay with
 * neither counts NOTHING. That last case is why `nightsKnown` exists — a
 * month-precision stay stored as the 1st has a check-out that is a placeholder,
 * and the span between two placeholders is fiction.
 *
 * When NO stay in the country proves a span, the answer is `null`, not 0 —
 * the abstention rule this codebase keeps everywhere (`shared/flightDuration.ts`:
 * "null, not 0"). A country proved by a house nobody could date therefore
 * reports `{ place, nights: null }`, which reads as "slept here, no one knows
 * how long"; a zero would read as a claim of zero nights, and a stay that was
 * slept always proves at least one night or is unknown.
 *
 * ## Place
 *
 * The city of the house with the most proved nights in the country. A house
 * whose city is unknown cannot name the stamp, so the next house that CAN
 * takes its place — a stamp that says "12 nights" and no town is less useful
 * than one that names the town of 8 of them. `null` when no house in the
 * country carries a city at all. No canonical short code exists for a city, so
 * the client abbreviates; the server sends the name.
 *
 * ## When the whole stamp is null
 *
 * When no house in the country counts as evidence — `lodgingEvidence` is the
 * judge, and it refuses a house whose only stay is a future booking and a
 * house whose stays were all cancelled. A house with NO stay counts (owner's
 * decision of 2026-09-02) and yields `{ place, nights: null }`.
 */

import { lodgingEvidence, type CountableStay } from "../../shared/countryEvidence";
import { classifyStay } from "../../shared/lodgingCounting";
import { resolveStayTiming } from "../../shared/lodgingTiming";
import { lodgingCountry } from "./evidenceCountry";

/**
 * A stay as the stamp reads it. `datePrecision` and `nights` are optional so
 * every existing caller of `buildPassport` — and every existing test fixture —
 * keeps compiling; absent, the stay is read at DAY precision with no explicit
 * night count, which is what the columns default to.
 */
export interface StampStay extends CountableStay {
  datePrecision?: string;
  nights?: number | null;
}

export interface StampLodging {
  isoCountryCode: string | null;
  /** As the geocoder or the user wrote it. Null when nobody did. */
  city?: string | null;
  stays: readonly StampStay[];
}

export interface LodgingStamp {
  /** The city of the house with the most proved nights; null when none has one. */
  place: string | null;
  /** Nights proved by stays that happened; null when no stay proves a span — see the header. */
  nights: number | null;
}

/**
 * Nights one house proves: its completed stays, each as far as its dates can
 * say. Null when no stay could say anything.
 */
function provedNights(stays: readonly StampStay[], now: Date): number | null {
  return stays.reduce<number | null>((sum, stay) => {
    if (classifyStay(stay, now) !== "visited") return sum;
    const timing = resolveStayTiming({
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      datePrecision: stay.datePrecision ?? "DAY",
      nights: stay.nights ?? null,
    });
    return timing.nightsKnown ? (sum ?? 0) + timing.nights : sum;
  }, null);
}

/** The stamp for ONE country's houses, or null when none of them is evidence. */
export function lodgingStamp(lodgings: readonly StampLodging[], now: Date): LodgingStamp | null {
  const proved = lodgings
    .filter((lodging) => lodgingEvidence(lodging.stays, now) !== null)
    .map((lodging) => ({ city: lodging.city ?? null, nights: provedNights(lodging.stays, now) }))
    // Most nights first; equal nights fall back to the city name so the
    // answer does not depend on the order rows arrived in.
    .sort(
      (a, b) => (b.nights ?? -1) - (a.nights ?? -1) || (a.city ?? "").localeCompare(b.city ?? "")
    );
  if (proved.length === 0) return null;

  const named = proved.find((house) => house.city !== null && house.city.trim() !== "");
  const known = proved.filter((house) => house.nights !== null);
  return {
    place: named ? named.city : null,
    nights: known.length === 0 ? null : known.reduce((sum, house) => sum + (house.nights ?? 0), 0),
  };
}

/** One stamp per country code, for every country a house proves. */
export function lodgingStampsPerCountry(
  lodgings: readonly StampLodging[],
  now: Date
): Map<string, LodgingStamp> {
  const byCountry = new Map<string, StampLodging[]>();
  for (const lodging of lodgings) {
    const code = lodgingCountry(lodging);
    if (!code) continue;
    byCountry.set(code, [...(byCountry.get(code) ?? []), lodging]);
  }
  const out = new Map<string, LodgingStamp>();
  for (const [code, houses] of byCountry) {
    const stamp = lodgingStamp(houses, now);
    if (stamp) out.set(code, stamp);
  }
  return out;
}
