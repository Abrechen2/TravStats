import { prisma } from "../db";
import { AVAILABLE_DOMAINS, type DomainKey } from "../shared/domains";
import { getInstanceSettings } from "./instanceSettingsService";

/**
 * Which domains a user sees: the ones they switched on that the instance also
 * shows. The server applies this wherever a figure would otherwise put a
 * hidden domain on screen — a trip suggestion holding a ride, a country badge
 * earned only by train — because the UI's gate (`useDomainVisible`,
 * `useToursVisible`) cannot hide a number the server has already folded in.
 */

/**
 * Domains that sit behind the instance's beta switch, and the key that gates
 * each (`frontend/src/config/betaFeatures.ts`). Empty since roadtrips and tours
 * left beta (feat/map-lists-ungate, 2026-11-24): the web dropped the
 * `roadtrips` key, so the server must stop hiding them too, or search, badges,
 * trip suggestions and sync would leave out what the web now shows. A domain
 * that goes back into beta gets its key here again.
 */
export const BETA_GATED_DOMAINS: Partial<Record<DomainKey, string>> = {};

/**
 * The visible domains, in registry order. A user without a settings row has
 * only flights switched on — the schema's default.
 */
export function visibleDomainKeys(
  enabledDomains: readonly string[] | null | undefined,
  betaFeaturesEnabled: boolean
): DomainKey[] {
  const enabled = new Set(enabledDomains ?? ["flight"]);
  return AVAILABLE_DOMAINS.filter(
    (key) => enabled.has(key) && (BETA_GATED_DOMAINS[key] === undefined || betaFeaturesEnabled)
  );
}

/** `visibleDomainKeys` for a stored user. */
export async function loadVisibleDomains(userId: string): Promise<DomainKey[]> {
  const [settings, instance] = await Promise.all([
    prisma.userSettings.findUnique({ where: { userId }, select: { enabledDomains: true } }),
    getInstanceSettings(),
  ]);
  return visibleDomainKeys(settings?.enabledDomains, instance.betaFeaturesEnabled);
}

/**
 * An account that makes a tour has `tour` switched on: the server's gates (sync,
 * calendar, badges, search) read the user's domain list, so a tour made by an
 * account without the key — the Companion creates tours without asking the web's
 * switch — would exist and be invisible everywhere. Called BEFORE the create, so
 * a failure here refuses the request instead of leaving a hidden tour. Creates
 * the settings row when there is none, since a missing row reads as flights only.
 */
export async function ensureTourDomainEnabled(userId: string): Promise<void> {
  const row = await prisma.userSettings.findUnique({
    where: { userId },
    select: { enabledDomains: true },
  });
  if (row?.enabledDomains.includes("tour")) return;
  // One statement, so two tours created at once (the workout queue repeats
  // requests) cannot both try to insert the row or both append the key.
  await prisma.$executeRaw`
    INSERT INTO "user_settings" ("id", "user_id", "enabled_domains", "data", "updated_at")
    VALUES (gen_random_uuid()::text, ${userId}, ARRAY['flight', 'tour'], '{}'::jsonb, CURRENT_TIMESTAMP)
    ON CONFLICT ("user_id") DO UPDATE
    SET "enabled_domains" = CASE
      WHEN 'tour' = ANY("user_settings"."enabled_domains") THEN "user_settings"."enabled_domains"
      ELSE array_append("user_settings"."enabled_domains", 'tour')
    END`;
}

/**
 * Domains added after a client shipped. A client that writes `enabledDomains`
 * without saying which keys it knows (`knownDomains` absent) wrote a list that
 * cannot mention them, so their stored state is kept rather than read as
 * "switched off" — an older Companion saving an unrelated switch must not turn
 * tours off (tours-own-domain, decision 3). A client that names the key in
 * `knownDomains` owns it: absent from `enabledDomains` then means off.
 */
const DOMAINS_ADDED_LATER: readonly DomainKey[] = ["tour"];

export function keepUnknownDomains(
  sent: readonly string[],
  stored: readonly string[] | null | undefined,
  known: readonly string[] | undefined
): string[] {
  const kept = DOMAINS_ADDED_LATER.filter(
    (key) => !sent.includes(key) && !known?.includes(key) && (stored ?? []).includes(key)
  );
  return [...sent, ...kept];
}

/** The body keys a request may carry and still count as "a domain switch, nothing else". */
const DOMAIN_ONLY_KEYS = new Set(["enabledDomains", "knownDomains", "removedDomains"]);

/**
 * The stored domains a settings write would switch off WITHOUT saying so, or
 * an empty list when the write may go ahead (UAT rc.45, B1).
 *
 * A web settings page used to PUT the whole store before the first load had
 * landed, and the store default for `enabledDomains` is `["flight"]` — every
 * other domain of the account was switched off by a page view. The web now
 * sends a patch, and this is the server's own line behind that: a write that
 * shrinks the list must name each domain it removes in `removedDomains`.
 *
 * One shape counts as explicit by itself: a request that carries nothing but
 * the domain list. That is the installed Companion's domain switch (it sends
 * `{ enabledDomains }` alone), and a body with no other field cannot be a full
 * settings object written by accident.
 */
export function unconfirmedDomainRemovals(
  next: readonly string[],
  stored: readonly string[] | null | undefined,
  body: Record<string, unknown>,
  named: readonly string[] | undefined
): string[] {
  const removed = (stored ?? []).filter((key) => !next.includes(key));
  if (removed.length === 0) return [];
  const domainOnly = Object.keys(body).every(
    (key) => DOMAIN_ONLY_KEYS.has(key) || body[key] === undefined
  );
  if (domainOnly) return [];
  return removed.filter((key) => !named?.includes(key));
}

/** The domains a user sees, as a set — the one gate a trip's money and nights pass. */
export type VisibleDomains = ReadonlySet<DomainKey>;

/**
 * The source set of every trip-cost and night figure: the trips page, a trip's
 * page and `/stats/travel-account` with its evidence all load it HERE, so one
 * trip never shows two totals (forgejo#274/#275/#266, controller ruling
 * 2026-10-09) and a domain behind the beta switch never reaches either.
 */
export async function loadVisibleDomainSet(userId: string): Promise<VisibleDomains> {
  return new Set(await loadVisibleDomains(userId));
}

/**
 * `rows` when the user sees `domain`, else none — the ONE filter those figures
 * apply. Flights pass whatever the setting says: every trip surface lists a
 * trip's flights ungated (`TripCard`, `TripOverview`), so leaving their money
 * or nights out would price a trip without entries it shows.
 */
export function rowsIfVisible<T>(visible: VisibleDomains, domain: DomainKey, rows: T[]): T[] {
  return domain === "flight" || visible.has(domain) ? rows : [];
}
