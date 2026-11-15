/**
 * An import writes only into the areas (domains) the account has switched on.
 *
 * A TripIt file may carry stays and rail rides and a Polarsteps one places; an
 * account that never enabled that area must not find rows in it. The records
 * of an area that is off become `domain_off` rejects — listed with their
 * reason in the preview, never written, never dropped without a word.
 */

import { prisma } from "../../db";
import type { DomainKey } from "../../shared/domains";
import type { AppParse, AppReject, AppSheetKey } from "./types";

/** `admin_settings`/`user_settings` default for an account that never chose. */
const DEFAULT_DOMAINS: readonly string[] = ["flight"];

/** The area each importer sheet belongs to. */
const SHEET_DOMAIN: Partial<Record<AppSheetKey, DomainKey>> = {
  flights: "flight",
  lodging: "lodging",
  lodgingStays: "lodging",
  places: "poi",
  placeVisits: "poi",
  // A trip comes along with the places of its steps and is not an area of its own.
  trips: "poi",
  rail: "rail",
};

export async function enabledDomainsOf(userId: string): Promise<readonly string[]> {
  const settings = await prisma.userSettings.findUnique({
    where: { userId },
    select: { enabledDomains: true },
  });
  return settings?.enabledDomains ?? DEFAULT_DOMAINS;
}

const OFF = "domain_off";

/** Move the records of every disabled area into `rejects`. Returns a new parse. */
export function gateDomains(parsed: AppParse, enabled: readonly string[]): AppParse {
  const on = (sheet: AppSheetKey): boolean => {
    const domain = SHEET_DOMAIN[sheet];
    return !domain || enabled.includes(domain);
  };
  const rejects: AppReject[] = [...parsed.rejects];
  const off = (sheet: AppSheetKey, rows: Array<{ row: number; label: string }>): void => {
    for (const r of rows) rejects.push({ sheet, row: r.row, label: r.label, reason: OFF });
  };

  const sheetRows = <T extends { row: number; label: string }>(sheet: AppSheetKey, rows: T[]) => {
    if (on(sheet)) return rows;
    off(sheet, rows);
    return [];
  };
  const busOn = enabled.includes("bus");
  const rides = parsed.rides.filter((ride) => {
    const sheet = ride.mode === "bus" ? "bus" : "rail";
    if (sheet === "bus" ? busOn : on("rail")) return true;
    off(sheet, [ride]);
    return false;
  });

  return {
    ...parsed,
    flights: sheetRows("flights", parsed.flights),
    lodging: sheetRows("lodging", parsed.lodging),
    lodgingStays: sheetRows("lodgingStays", parsed.lodgingStays),
    places: sheetRows("places", parsed.places),
    placeVisits: sheetRows("placeVisits", parsed.placeVisits),
    trips: sheetRows("trips", parsed.trips),
    rides,
    rejects,
  };
}
