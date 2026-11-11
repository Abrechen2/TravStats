import { prisma } from "../db";

/**
 * The settings v3 master switch "the server may ask external services"
 * (`admin_settings.internet_enabled`, default on).
 *
 * It GATES six older admin columns and replaces none of them, so switching it
 * back on restores exactly what the admin had set:
 *
 * | column                         | with the master switch OFF                         |
 * |--------------------------------|----------------------------------------------------|
 * | `openDataEnabled`              | reads as off: Open-Meteo, Wikipedia, Overpass 409  |
 * | `operatorLogosOpenDataEnabled` | reads as off: no Wikidata/Commons lookup           |
 * | `fxCdnFallbackEnabled`         | reads as off AND no ECB call: a rate is "none"     |
 * | `railTransitousEnabled`        | reads as off: the rail lookup skips Transitous     |
 * | `railDbRestEnabled`            | reads as off: the rail lookup skips db-rest        |
 * | `updateCheckEnabled`           | reads as off: no GitHub release check, no          |
 * |                                | scheduled template sync (a manual sync still runs) |
 *
 * A settings object that carries no `internetEnabled` (an older row shape, a
 * test double) counts as ON: absent = the column default.
 */
export function throughInternet(
  settings: { internetEnabled?: boolean | null },
  flag: boolean
): boolean {
  return flag && settings.internetEnabled !== false;
}

/** Whether the master switch is on. No settings row yet = a fresh instance = on. */
export async function internetAllowed(): Promise<boolean> {
  const row = await prisma.adminSettings.findFirst({
    orderBy: { id: "asc" },
    select: { internetEnabled: true },
  });
  return row?.internetEnabled ?? true;
}
