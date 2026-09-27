import { COUNTRY_TIERS } from "../../shared/countryEvidence";
import { LOG_LEVELS } from "../../shared/logContract";
import { ROUTING_PROVIDER_IDS } from "../tour/routing/types";

/**
 * The admin settings a public bug report may carry — a POSITIVE list.
 *
 * Every entry names its kind, and the projection enforces it: a boolean is a
 * boolean, a number a finite number, an enum one of its listed values (else
 * the literal "other"). URLs, keys, names and every other string are never
 * copied; where their presence matters for debugging, a `present` rule turns
 * them into a boolean ("is Ollama configured?") without the value.
 *
 * A column added to `admin_settings` is therefore absent from the export until
 * someone adds it here on purpose — the opposite of the old negative list,
 * which leaked whatever it had not thought of.
 */

type Rule =
  | { kind: "boolean" }
  | { kind: "number" }
  | { kind: "enum"; values: readonly string[] }
  | { kind: "present"; from: string };

const bool: Rule = { kind: "boolean" };
const num: Rule = { kind: "number" };
const oneOf = (values: readonly string[]): Rule => ({ kind: "enum", values });
const present = (from: string): Rule => ({ kind: "present", from });

export const ADMIN_SETTINGS_ALLOWLIST: Readonly<Record<string, Rule>> = {
  allowUserApiKeys: bool,
  allowUserFlightApiKeys: bool,
  allowRegistration: bool,
  betaFeaturesEnabled: bool,
  openDataEnabled: bool,
  llmEnabled: bool,
  fxCdnFallbackEnabled: bool,
  railTransitousEnabled: bool,
  railDbRestEnabled: bool,
  backupEnabled: bool,
  webdavSyncEnabled: bool,
  logHttpRequests: bool,
  logDatabaseQueries: bool,
  logParserOperations: bool,
  maxUsers: num,
  aviationstackDailyBudget: num,
  backupRetentionDays: num,
  maxLogFileSize: num,
  maxLogFiles: num,
  logRetentionDays: num,
  logLevel: oneOf(LOG_LEVELS),
  parserOrder: oneOf(["template_first", "llm_first"]),
  backupInterval: oneOf(["daily", "weekly", "monthly"]),
  countryThreshold: oneOf(COUNTRY_TIERS),
  usageStatsConsent: oneOf(["unset", "granted", "denied"]),
  routingProvider: oneOf(ROUTING_PROVIDER_IDS),
  airportTimezoneDataset: oneOf(["all", "now"]),
  ollamaConfigured: present("ollamaUrl"),
  immichConfigured: present("globalImmichBaseUrl"),
  dawarichConfigured: present("globalDawarichBaseUrl"),
  stravaConfigured: present("stravaClientId"),
  webdavConfigured: present("webdavUrl"),
  airlabsKeyConfigured: present("globalAirlabsApiKey"),
  aviationstackKeyConfigured: present("globalAviationstackApiKey"),
  aerodataboxKeyConfigured: present("globalAerodataboxApiKey"),
  openskyConfigured: present("globalOpenskyClientId"),
  googlePlacesKeyConfigured: present("globalGooglePlacesApiKey"),
  railRoutingConfigured: present("railRoutingUrl"),
};

export type SettingValue = boolean | number | string | null;

function project(rule: Rule, row: Record<string, unknown>, key: string): SettingValue {
  if (rule.kind === "present") {
    const value = row[rule.from];
    return typeof value === "string" ? value.trim().length > 0 : value != null;
  }
  const value = row[key];
  if (value === null || value === undefined) return null;
  switch (rule.kind) {
    case "boolean":
      return typeof value === "boolean" ? value : null;
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? value : null;
    case "enum":
      return typeof value === "string" && rule.values.includes(value) ? value : "other";
  }
}

/** Project a settings row onto the allowlist. Keys not listed never appear. */
export function projectAdminSettings(
  row: Record<string, unknown> | null
): Record<string, SettingValue> {
  const source = row ?? {};
  return Object.fromEntries(
    Object.entries(ADMIN_SETTINGS_ALLOWLIST).map(([key, rule]) => [key, project(rule, source, key)])
  );
}
