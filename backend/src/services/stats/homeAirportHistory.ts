/**
 * The user's home-airport history, as the stats calculators want it.
 *
 * `/stats/unique` and `/stats/airports` each carried this six-line read of
 * `user_settings.data`, and the composed `GET /stats/page` would have been a
 * third copy — so it is one function, read once per request (forgejo#49).
 *
 * Layovers exclude returns to home-AT-THAT-DATE, which is why the history and
 * not just the current home airport travels into the calculators.
 */

import { prisma } from "../../db";
import { normalizeHistory, type HomeAirportEntry } from "../../utils/homeAirport";
import type { SettingsDataJson } from "../../routes/settings/types";

export async function loadHomeAirportHistory(userId: string): Promise<HomeAirportEntry[]> {
  const settings = await prisma.userSettings.findUnique({
    where: { userId },
    select: { data: true },
  });
  const historyData =
    settings?.data && typeof settings.data === "object"
      ? (settings.data as SettingsDataJson).homeAirportHistory
      : undefined;
  return normalizeHistory(historyData);
}
