import { prisma } from "../db";
import { visibleDomainKeys } from "./domainVisibility";
import { getInstanceSettings } from "./instanceSettingsService";

/**
 * Whether a user's day tours may be shown at all — the server's half of the
 * web's `useToursVisible`: `tour` is a domain since 2026-11-09 (it was "not a
 * domain" under the coordinator ruling of 2026-10-09): the user switched the
 * domain on (tours left beta on 2026-11-24, so `BETA_GATED_DOMAINS` no longer
 * gates them). Every server figure that
 * would put a tour on screen — the cruise excursions, the year in review's
 * tour chapter, the tour badges, sync, `GET /tours` — asks this.
 */
export async function toursVisible(userId: string): Promise<boolean> {
  const [settings, instance] = await Promise.all([
    prisma.userSettings.findUnique({ where: { userId }, select: { enabledDomains: true } }),
    getInstanceSettings(),
  ]);
  return visibleDomainKeys(settings?.enabledDomains, instance.betaFeaturesEnabled).includes("tour");
}
