import { prisma } from "../../db";
import { appVersion } from "../../utils/version";
import {
  bucketCruises,
  bucketFlights,
  bucketUsers,
  detectArch,
  roundKm,
  type CruisesBucket,
  type FlightsBucket,
  type UsersBucket,
} from "./buckets";
import { getOrCreateInstallId } from "./consent";

export interface UsagePayload {
  install_id: string;
  version: string;
  arch: string;
  enabled_domains: string[];
  users_bucket: UsersBucket;
  flights_bucket: FlightsBucket;
  cruises_bucket: CruisesBucket;
  distance_km: { flight: number; cruise: number };
  achievements: { unlocked_total: number; keys: string[] };
  features: {
    llm_parser: boolean;
    backups: boolean;
    webdav_sync: boolean;
    historical_enrichment: boolean;
    live_tracking: boolean;
  };
  flight_api_providers: string[];
  locale: string;
  reported_at: string;
}

/** Read `data.display.language` out of the free-form UserSettings JSON blob. */
function readLanguage(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const display = (data as Record<string, unknown>).display;
  if (typeof display !== "object" || display === null) return null;
  const language = (display as Record<string, unknown>).language;
  return typeof language === "string" ? language : null;
}

/** Most frequent language across users; ties (including the no-data case) resolve to "en". */
function majorityLocale(languages: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const lang of languages) counts.set(lang, (counts.get(lang) ?? 0) + 1);

  let maxCount = 0;
  for (const count of counts.values()) {
    if (count > maxCount) maxCount = count;
  }

  // "en" wins outright, or is the tie-break winner, whenever it shares the max count.
  if ((counts.get("en") ?? 0) === maxCount) return "en";

  for (const [lang, count] of counts) {
    if (count === maxCount) return lang;
  }
  return "en";
}

/**
 * Build the anonymous usage payload.
 *
 * Pure aggregation over the database — no network I/O, which is what makes the
 * no-PII assertion in the tests meaningful. Never include IP, hostname, paths,
 * airport/port/ship/airline names, travel dates, usernames, or API keys.
 */
export async function buildUsagePayload(): Promise<UsagePayload> {
  const [
    installId,
    admin,
    userCount,
    flightCount,
    cruiseCount,
    flightDistance,
    cruiseDistance,
    achievementTotal,
    achievementRows,
    trackedFlight,
    allUserSettings,
  ] = await Promise.all([
    getOrCreateInstallId(),
    prisma.adminSettings.findFirst(),
    prisma.user.count(),
    prisma.flight.count(),
    prisma.cruise.count(),
    prisma.flight.aggregate({ _sum: { routeDistance: true } }),
    prisma.cruiseLeg.aggregate({ _sum: { distanceKm: true } }),
    prisma.userAchievement.count(),
    prisma.userAchievement.findMany({ select: { achievement: { select: { code: true } } } }),
    prisma.flight.findFirst({ where: { hasLiveTracking: true }, select: { id: true } }),
    prisma.userSettings.findMany({
      select: { enabledDomains: true, historicalEnrichmentEnabled: true, data: true },
    }),
  ]);

  const providerColumns: ReadonlyArray<readonly [string, unknown]> = [
    ["airlabs", admin?.globalAirlabsApiKey],
    ["aviationstack", admin?.globalAviationstackApiKey],
    ["aerodatabox", admin?.globalAerodataboxApiKey],
    ["opensky", admin?.globalOpenskyClientId],
  ];

  const languages = allUserSettings
    .map((s) => readLanguage(s.data))
    .filter((lang): lang is string => lang !== null);

  return {
    install_id: installId,
    version: appVersion,
    arch: detectArch(),
    enabled_domains: [...new Set(allUserSettings.flatMap((s) => s.enabledDomains))],
    users_bucket: bucketUsers(userCount),
    flights_bucket: bucketFlights(flightCount),
    cruises_bucket: bucketCruises(cruiseCount),
    distance_km: {
      flight: roundKm(flightDistance._sum.routeDistance ?? 0),
      cruise: roundKm(cruiseDistance._sum.distanceKm ?? 0),
    },
    achievements: {
      unlocked_total: achievementTotal,
      keys: [...new Set(achievementRows.map((row) => row.achievement.code))],
    },
    features: {
      llm_parser: Boolean(admin?.ollamaUrl ?? admin?.globalOpenaiApiKey ?? admin?.globalClaudeApiKey),
      backups: Boolean(admin?.backupEnabled),
      webdav_sync: Boolean(admin?.webdavSyncEnabled),
      historical_enrichment: allUserSettings.some((s) => s.historicalEnrichmentEnabled === true),
      live_tracking: trackedFlight !== null,
    },
    flight_api_providers: providerColumns.filter(([, value]) => Boolean(value)).map(([name]) => name),
    locale: majorityLocale(languages),
    reported_at: new Date().toISOString(),
  };
}
