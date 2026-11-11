import { prisma } from "../db";

/**
 * The settings v3 master switch "the server may ask external services"
 * (`admin_settings.internet_enabled`, default on).
 *
 * Since S6 it is the ONLY switch of the exchange-rate fallback, the rail
 * timetable sources (Transitous, db-rest), the operator logos, the update check
 * and the scheduled template sync: their own columns were dropped. One more
 * reads through it, and keeps a column of its own because it is OFF by default
 * (each call sends a place and a date to a third party):
 *
 * | gate                          | with the master switch OFF                         |
 * |-------------------------------|----------------------------------------------------|
 * | `openDataEnabled` (+ column)  | reads as off: Open-Meteo, Wikipedia, Overpass 409  |
 * | exchange rates                | no ECB and no CDN call: a rate is "none"           |
 * | Transitous, db-rest           | the rail lookup skips both                         |
 * | operator logos                | no Wikidata/Commons lookup                         |
 * | update check                  | no GitHub release check, no scheduled template     |
 * |                               | sync (a manual sync still runs)                    |
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

/** The master switch alone, for the calls that have no column of their own. */
export function internetOn(settings: { internetEnabled?: boolean | null }): boolean {
  return settings.internetEnabled !== false;
}

/** Whether the master switch is on. No settings row yet = a fresh instance = on. */
export async function internetAllowed(): Promise<boolean> {
  const row = await prisma.adminSettings.findFirst({
    orderBy: { id: "asc" },
    select: { internetEnabled: true },
  });
  return row?.internetEnabled ?? true;
}
