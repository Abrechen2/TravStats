import { prisma } from "../db";
import { AVAILABLE_DOMAINS, type DomainKey } from "../shared/domains";
import { getInstanceSettings } from "./instanceSettingsService";

/**
 * Which domains a user sees: the ones they switched on that the instance also
 * shows. The server applies this wherever a figure would otherwise put a
 * hidden domain on screen — a trip suggestion holding a ride, a country badge
 * earned only by train — because the UI's gate (`useRailVisible`,
 * `useToursVisible`) cannot hide a number the server has already folded in.
 */

/**
 * Domains that sit behind the instance's beta switch, and the key that gates
 * each (`frontend/src/config/betaFeatures.ts`). Tours share the roadtrip key,
 * as they do in the UI.
 */
export const BETA_GATED_DOMAINS: Partial<Record<DomainKey, string>> = {
  rail: "railDomain",
  roadtrip: "roadtrips",
  rental: "rentalDomain",
};

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
