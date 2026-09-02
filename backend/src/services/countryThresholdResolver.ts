/**
 * Which evidence tier the country headline counts from — resolved once, here.
 *
 * Design: `docs/superpowers/specs/2026-09-02-country-counting-design.md` §3.2.
 *
 * ## Why the value is settable at all, and why it stops at three
 *
 * "Does a connection count?" is a personal definition, not a property of the
 * server. Imposing one traveller's philosophy on everyone sharing a family
 * instance is the wrong default — but a fresh account must not have to decide
 * anything either, so the admin picks the starting point and a user may
 * disagree with it.
 *
 * The choices are the three tiers `shared/countryEvidence.ts` already derives,
 * and there is deliberately NO hours-based option. §2 refuses duration
 * thresholds on principle and has the measurement behind it: on the owner's
 * account six hours and twelve hours return the SAME set of countries, because
 * the connection countries run 1.4 h–4.7 h and the next one is France at 25 h.
 * A dial there would promise precision the data does not hold and invite
 * turning it until the total feels right. What this setting changes is which of
 * three structurally-derived rungs the headline starts at, nothing else.
 *
 * ## What it does NOT change
 *
 * The country LIST. `foldCountryEvidence` returns every country at every
 * threshold; `PassportCountry.counted` and `summary.countries` are the only
 * things that move, and `summary.countriesTotal` stays put. A country wrongly
 * classed as a connection must never vanish — being able to SEE it is how the
 * Bucharest hotel was found, and a threshold that hid rows would put that back.
 *
 * ## Resolution order
 *
 * User → instance default, the same shape `apiKeyResolver.ts` uses for keys,
 * with one difference worth naming: a user's `null` here means "follow the
 * instance", not "off". An account that never opened the setting keeps tracking
 * the admin instead of freezing whatever the default was on the day it was
 * created.
 */

import { prisma } from "../db";
import {
  DEFAULT_COUNTRY_TIER,
  parseCountryTier,
  type CountryTier,
} from "../shared/countryEvidence";
import logger from "../utils/logger";

/**
 * Both halves of the answer, so a caller that has to EXPLAIN the number does
 * not have to ask twice.
 *
 * The settings UI needs all three: what applies now, whether the user chose it,
 * and what they fall back to if they clear their choice. Spec §5 — "a number
 * that changes without explanation reads as data loss" — is why the instance
 * default is published rather than merely applied.
 */
export interface ResolvedCountryThreshold {
  /** The tier actually in force for this user. */
  effective: CountryTier;
  /** The user's own choice, or null when they follow the instance. */
  user: CountryTier | null;
  /** The instance default, whether or not the user overrides it. */
  instance: CountryTier;
}

/**
 * The instance default. Falls back to `DEFAULT_COUNTRY_TIER` when the stored
 * string is not a tier — see `parseCountryTier` for why that is possible at all
 * and why it must not be an error: an unreadable setting is a reason to count
 * the normal way, never a reason to fail a stats request.
 */
export async function getInstanceCountryThreshold(): Promise<CountryTier> {
  const row = await prisma.adminSettings.findFirst({ select: { countryThreshold: true } });
  const parsed = parseCountryTier(row?.countryThreshold);
  if (row && parsed === null) {
    logger.warn({
      operation: "country_threshold_unreadable",
      scope: "instance",
      stored: row.countryThreshold,
      fallback: DEFAULT_COUNTRY_TIER,
    });
  }
  return parsed ?? DEFAULT_COUNTRY_TIER;
}

/**
 * Resolve for one user: their override if they set one, otherwise the
 * instance default.
 *
 * Called without a `userId` — background jobs, the demo seed — it answers the
 * instance default, which is the right answer for "this instance's rule" when
 * there is no person to ask.
 */
export async function resolveCountryThreshold(
  userId?: string
): Promise<ResolvedCountryThreshold> {
  const [instance, userRow] = await Promise.all([
    getInstanceCountryThreshold(),
    userId
      ? prisma.userSettings.findUnique({
          where: { userId },
          select: { countryThreshold: true },
        })
      : Promise.resolve(null),
  ]);

  // `undefined` (no settings row yet) and `null` (a row that never chose) are
  // the same fact: this user follows the instance.
  const stored = userRow?.countryThreshold ?? null;
  const user = parseCountryTier(stored);
  if (stored !== null && user === null) {
    logger.warn({
      operation: "country_threshold_unreadable",
      scope: "user",
      userId,
      stored,
      fallback: instance,
    });
  }

  return { effective: user ?? instance, user, instance };
}

/** The tier alone, for the many callers that only need to count. */
export async function countryThresholdFor(userId?: string): Promise<CountryTier> {
  return (await resolveCountryThreshold(userId)).effective;
}
