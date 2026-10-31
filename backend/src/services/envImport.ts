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

const CIPHERTEXT_PREFIX = "tsenc:v1:";
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
  /**
   * Variables that only make sense together (an address and its key). The group is imported
   * only when EVERY column of it is still empty: a stored address must never be paired with
   * an imported key, which would send that key to a different server.
   */
  group?: string;
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
  { env: "OPENSKY_CLIENT_ID", column: "globalOpenskyClientId", group: "opensky", secret: true },
  {
    env: "OPENSKY_CLIENT_SECRET",
    column: "globalOpenskyClientSecret",
    group: "opensky",
    secret: true,
  },
  { env: "OPENSKY_USERNAME", column: "globalOpenskyUsername", group: "opensky", secret: true },
  { env: "OPENSKY_PASSWORD", column: "globalOpenskyPassword", group: "opensky", secret: true },
  { env: "AISSTREAM_API_KEY", column: "globalAisstreamApiKey", secret: true },
  { env: "PHOTON_URL", column: "photonUrl" },
  { env: "NOMINATIM_URL", column: "nominatimUrl" },
  { env: "TRAVSTATS_GEO_URL", column: "ownGeoUrl", validate: https },
  { env: "MARKET_OVERPASS_URL", column: "marketOverpassUrl" },
  { env: "RAIL_LOOKUP_CONTACT", column: "railLookupContact" },
  { env: "OLLAMA_URL", column: "ollamaUrl", group: "ollama" },
  { env: "OLLAMA_MODEL", column: "ollamaModel", group: "ollama" },
  { env: "IMMICH_BASE_URL", column: "globalImmichBaseUrl", group: "immich" },
  { env: "IMMICH_API_KEY", column: "globalImmichApiKey", group: "immich", secret: true },
  { env: "DAWARICH_BASE_URL", column: "globalDawarichBaseUrl", group: "dawarich" },
  { env: "DAWARICH_API_KEY", column: "globalDawarichApiKey", group: "dawarich", secret: true },
  { env: "STRAVA_CLIENT_ID", column: "stravaClientId", group: "strava" },
  { env: "STRAVA_CLIENT_SECRET", column: "stravaClientSecret", group: "strava", secret: true },
  { env: "WEBDAV_URL", column: "webdavUrl", group: "webdav" },
  { env: "WEBDAV_USERNAME", column: "webdavUsername", group: "webdav" },
  { env: "WEBDAV_PASSWORD", column: "webdavPasswordEncrypted", group: "webdav", secret: true },
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

const ADVISORY_LOCK_KEY = 7_392_011;

/**
 * Copy the old environment variables into `admin_settings`, once. Idempotent:
 * a recorded import is a no-op, so a variable set after the first start (or a
 * second boot) changes nothing. Everything — the check, the copies, the two
 * feature switches and the marker — happens in ONE transaction under an
 * advisory lock, so two starts cannot both import and a crash leaves no marker
 * behind a half-done import.
 */
export async function importServiceEnv(
  env: NodeJS.ProcessEnv = process.env
): Promise<EnvImportResult> {
  const id = await ensureAdminSettingsRow();
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_KEY})`;
    const row = (await tx.adminSettings.findUniqueOrThrow({ where: { id } })) as unknown as Row;
    if (row.envImportedAt) return { imported: [], skipped: [], alreadyDone: true };

    const data: Row = {};
    const imported: string[] = [];
    const skipped: string[] = [];
    const blockedGroups = new Set(
      ENV_IMPORT_MAP.filter((m) => m.group && !isEmpty(row, m)).map((m) => m.group as string)
    );

    for (const m of ENV_IMPORT_MAP) {
      const raw = env[m.env];
      if (raw === undefined) continue;
      // A secret is copied exactly as given: trimming would change a password.
      const value = m.secret ? raw : raw.trim();
      if (value.trim() === "") continue;
      if (
        !isEmpty(row, m) ||
        (m.group && blockedGroups.has(m.group)) ||
        (m.validate && !m.validate(value)) ||
        (m.secret && value.startsWith(CIPHERTEXT_PREFIX))
      ) {
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

    // The two feature switches live in their own tables; a row that exists wins.
    for (const [name, table] of [
      ["TRAVPLAN_ENABLED", "travelPlanConfig"],
      ["TRAVTRACK_ENABLED", "travTrackConfig"],
    ] as const) {
      if (env[name] !== "true") continue;
      const model = tx[table] as unknown as {
        findUnique: (a: unknown) => Promise<unknown>;
        create: (a: unknown) => Promise<unknown>;
      };
      if (await model.findUnique({ where: { id: "default" } })) skipped.push(name);
      else {
        await model.create({ data: { id: "default", enabled: true } });
        imported.push(name);
      }
    }

    data.envImportedAt = new Date();
    await tx.adminSettings.update({ where: { id }, data });
    return { imported, skipped, alreadyDone: false };
  });

  if (!result.alreadyDone) {
    const dropped = ENV_DROPPED.filter((n) => env[n] !== undefined);
    logger.info(
      {
        operation: "service_env_import",
        imported: result.imported,
        skipped: result.skipped,
        ignored: dropped,
      },
      "Service environment variables imported into the instance settings; they are no longer read"
    );
  }
  await refreshInstanceTuning();
  return result;
}
