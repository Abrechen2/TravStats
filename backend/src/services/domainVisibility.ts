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
  bus: "busDomain",
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
