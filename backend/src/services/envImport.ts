/**
 * One-time import of the service environment variables (forgejo#392, owner
 * decision 2026-10-31). Until then the service credentials and addresses could
 * come from the environment; from now on only `admin_settings` counts. A
 * deployment that still carries them in its compose file keeps working: the
 * first start copies each variable whose instance field is empty, secrets
 * encrypted with the same helper the admin page uses, records that it ran, and
 * the environment is never read for these again — a variable set later is
 * ignored on purpose.
 *
 * Logs name variables only; no value is ever logged.
 */
import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { createPrivateKey } from "node:crypto";
import { prisma } from "../db";
import logger from "../utils/logger";
import { encryptApiKey } from "../utils/encryption";
import { ensureAdminSettingsRow } from "./adminSettingsRow";
import { parseOwnGeoUrl } from "./geo/ownServerConfig";
import { refreshInstanceTuning } from "./instanceTuning";

interface Mapping {
  env: string;
  column: string;
  secret?: boolean;
  /** Boolean column: imported only when the variable reads "true"; "empty" is `false`. */
  flag?: true;
  /** Non-nullable text column with a default: "empty" is the default itself. */
  emptyValue?: string;
  /** Rejects a value the admin page would refuse too. */
  validate?: (value: string) => boolean;
}

const https = (v: string): boolean => {
  try {
    return parseOwnGeoUrl(v) !== null;
  } catch {
    return false;
  }
};

export const ENV_IMPORT_MAP: readonly Mapping[] = [
  { env: "OPENAI_API_KEY", column: "globalOpenaiApiKey", secret: true },
  { env: "CLAUDE_API_KEY", column: "globalClaudeApiKey", secret: true },
  { env: "AIRLABS_API_KEY", column: "globalAirlabsApiKey", secret: true },
  { env: "AVIATIONSTACK_API_KEY", column: "globalAviationstackApiKey", secret: true },
  { env: "AERODATABOX_API_KEY", column: "globalAerodataboxApiKey", secret: true },
  { env: "AEROAPI_API_KEY", column: "globalAeroapiApiKey", secret: true },
  { env: "ADSBX_RAPIDAPI_KEY", column: "globalAdsbxApiKey", secret: true },
  { env: "ADSBLOL_API_KEY", column: "globalAdsblolApiKey", secret: true },
  { env: "LOGOSTREAM_API_KEY", column: "globalLogostreamApiKey", secret: true },
  { env: "GOOGLE_PLACES_API_KEY", column: "globalGooglePlacesApiKey", secret: true },
  { env: "OPENROUTESERVICE_API_KEY", column: "globalOpenrouteserviceApiKey", secret: true },
  { env: "GRAPHHOPPER_API_KEY", column: "globalGraphhopperApiKey", secret: true },
  { env: "OPENSKY_CLIENT_ID", column: "globalOpenskyClientId", secret: true },
  { env: "OPENSKY_CLIENT_SECRET", column: "globalOpenskyClientSecret", secret: true },
  { env: "OPENSKY_USERNAME", column: "globalOpenskyUsername", secret: true },
  { env: "OPENSKY_PASSWORD", column: "globalOpenskyPassword", secret: true },
  { env: "AISSTREAM_API_KEY", column: "globalAisstreamApiKey", secret: true },
  { env: "PHOTON_URL", column: "photonUrl" },
  { env: "NOMINATIM_URL", column: "nominatimUrl" },
  { env: "TRAVSTATS_GEO_URL", column: "ownGeoUrl", validate: https },
  { env: "MARKET_OVERPASS_URL", column: "marketOverpassUrl" },
  { env: "RAIL_LOOKUP_CONTACT", column: "railLookupContact" },
  { env: "OLLAMA_URL", column: "ollamaUrl" },
  { env: "OLLAMA_MODEL", column: "ollamaModel" },
  { env: "IMMICH_BASE_URL", column: "globalImmichBaseUrl" },
  { env: "IMMICH_API_KEY", column: "globalImmichApiKey", secret: true },
  { env: "DAWARICH_BASE_URL", column: "globalDawarichBaseUrl" },
  { env: "DAWARICH_API_KEY", column: "globalDawarichApiKey", secret: true },
  { env: "STRAVA_CLIENT_ID", column: "stravaClientId" },
  { env: "STRAVA_CLIENT_SECRET", column: "stravaClientSecret", secret: true },
  { env: "WEBDAV_URL", column: "webdavUrl" },
  { env: "WEBDAV_USERNAME", column: "webdavUsername" },
  { env: "WEBDAV_PASSWORD", column: "webdavPasswordEncrypted", secret: true },
  { env: "WEBDAV_BACKUP_PATH", column: "webdavBackupPath", emptyValue: "/TravStats/backups/" },
  { env: "WEBDAV_SYNC_ENABLED", column: "webdavSyncEnabled", flag: true },
  { env: "TEMPLATE_REPO_BASE_URL", column: "templateRepoBaseUrl" },
  { env: "TRAVSTATS_STATS_ENDPOINT", column: "usageStatsEndpoint" },
];

/** Variables read for the service settings that are gone and have no instance field to move to. */
export const ENV_DROPPED = ["CLAUDE_MODEL", "CLAUDE_VISION_MODEL", "USE_LLM_PARSER"] as const;

export interface EnvImportResult {
  imported: string[];
  skipped: string[];
  alreadyDone: boolean;
}

type Row = Record<string, unknown>;

function isEmpty(row: Row, m: Mapping): boolean {
  const current = row[m.column];
  if (m.flag) return current !== true;
  if (m.column === "usageStatsEndpoint") return current === null || current === undefined;
  if (m.emptyValue !== undefined) return current === null || current === m.emptyValue;
  return current === null || current === undefined || current === "";
}

function federationFromEnv(row: Row, env: NodeJS.ProcessEnv, data: Row, names: string[]): void {
  if (env.FEDERATION_ENABLED !== "1") return;
  const group = ["FEDERATION_ENABLED", "FEDERATION_PUBLIC_ORIGIN", "FEDERATION_KEY_FILE"];
  const origin = env.FEDERATION_PUBLIC_ORIGIN;
  const file = env.FEDERATION_KEY_FILE;
  if (row.federationEnabled === true || row.federationOrigin || row.federationPrivateKey) {
    names.push(...group.map((n) => `skip:${n}`));
    return;
  }
  try {
    if (!origin || !file || !isAbsolute(file)) throw new Error("incomplete");
    const pem = readFileSync(file, "utf8");
    if (createPrivateKey(pem).asymmetricKeyType !== "ed25519") throw new Error("key type");
    data.federationEnabled = true;
    data.federationOrigin = origin;
    data.federationPrivateKey = encryptApiKey(pem);
    names.push(...group);
  } catch {
    names.push(...group.map((n) => `skip:${n}`));
  }
}

/**
 * Copy the old environment variables into `admin_settings`, once. Idempotent:
 * a recorded import is a no-op, so a variable set after the first start (or a
 * second boot) changes nothing.
 */
export async function importServiceEnv(
  env: NodeJS.ProcessEnv = process.env
): Promise<EnvImportResult> {
  const id = await ensureAdminSettingsRow();
  const row = (await prisma.adminSettings.findUniqueOrThrow({ where: { id } })) as unknown as Row;
  if (row.envImportedAt) {
    await refreshInstanceTuning();
    return { imported: [], skipped: [], alreadyDone: true };
  }

  const data: Row = {};
  const imported: string[] = [];
  const skipped: string[] = [];

  for (const m of ENV_IMPORT_MAP) {
    const raw = env[m.env];
    if (raw === undefined) continue;
    const value = raw.trim();
    // An empty stats endpoint is the old "never send" switch: keep it as the empty string.
    if (value === "" && m.column !== "usageStatsEndpoint") continue;
    if (!isEmpty(row, m) || (m.validate && !m.validate(value))) {
      skipped.push(m.env);
      continue;
    }
    if (m.flag) {
      if (value !== "true") continue;
      data[m.column] = true;
    } else {
      data[m.column] = m.secret ? encryptApiKey(value) : value;
    }
    imported.push(m.env);
  }

  const fed: string[] = [];
  federationFromEnv(row, env, data, fed);
  for (const n of fed) (n.startsWith("skip:") ? skipped : imported).push(n.replace("skip:", ""));

  data.envImportedAt = new Date();
  await prisma.adminSettings.update({ where: { id }, data });

  // The two feature switches live in their own tables; a row that exists wins.
  for (const [name, table] of [
    ["TRAVPLAN_ENABLED", "travelPlanConfig"],
    ["TRAVTRACK_ENABLED", "travTrackConfig"],
  ] as const) {
    if (env[name] !== "true") continue;
    const model = prisma[table] as unknown as {
      findUnique: (a: unknown) => Promise<unknown>;
      create: (a: unknown) => Promise<unknown>;
    };
    if (await model.findUnique({ where: { id: "default" } })) skipped.push(name);
    else {
      await model.create({ data: { id: "default", enabled: true } });
      imported.push(name);
    }
  }

  const dropped = ENV_DROPPED.filter((n) => env[n] !== undefined);
  logger.info(
    { operation: "service_env_import", imported, skipped, ignored: dropped },
    "Service environment variables imported into the instance settings; they are no longer read"
  );
  await refreshInstanceTuning();
  return { imported, skipped, alreadyDone: false };
}
