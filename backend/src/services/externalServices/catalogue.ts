/**
 * The external-services catalogue — ONE source of truth (forgejo#392).
 *
 * Every outbound service TravStats talks to is listed here: what level it is
 * configured at, which stored column carries each of its fields, which switch
 * is its `enabled`, and which environment variable can stand in. The admin and
 * account routes, the resolver policy and the completeness test
 * (`__tests__/catalogue.test.ts`) all read this list. Copy (names, purpose,
 * the info rows) lives in the frontend locale files under
 * `externalServices:services.<id>.*` — the API never carries prose.
 */
import type {
  CategoryId,
  EnabledBinding,
  FieldDef,
  FieldKind,
  FieldStore,
  ServiceDef,
} from "./types";

const admin = (
  key: string,
  kind: FieldKind,
  column: string,
  expert = false,
  options?: readonly string[]
): FieldDef => ({ key, kind, expert, store: "admin", column, ...(options ? { options } : {}) });

const user = (key: string, kind: FieldKind, column: string, expert = false): FieldDef => ({
  key,
  kind,
  expert,
  store: "user",
  column,
});

const other = (
  store: FieldStore,
  key: string,
  kind: FieldKind,
  column: string,
  expert = false
): FieldDef => ({ key, kind, expert, store, column });

const POLICY: EnabledBinding = { kind: "policy" };

function svc(
  def: Partial<ServiceDef> & Pick<ServiceDef, "id" | "category" | "level" | "credential">
): ServiceDef {
  return {
    recommended: null,
    keyless: false,
    alwaysOn: false,
    getKeyUrl: null,
    env: [],
    enabled: POLICY,
    fields: [],
    accountFields: [],
    requiredFields: [],
    ...def,
  };
}

const TESTERS = new Set([
  "airlabs",
  "aviationstack",
  "aerodatabox",
  "openrouteservice",
  "graphhopper",
]);

/** A flight/routing provider with one key that an account may also bring. */
function keyService(
  id: string,
  category: CategoryId,
  provider: string,
  adminColumn: string,
  userColumn: string,
  envName: string,
  getKeyUrl: string,
  extra: Partial<ServiceDef> = {}
): ServiceDef {
  const { fields: extraFields = [], ...rest } = extra;
  return svc({
    id,
    category,
    level: "instanceAndAccount",
    credential: "key",
    resolverProvider: provider,
    getKeyUrl,
    env: [envName],
    fields: [admin("apiKey", "secret", adminColumn), ...extraFields],
    accountFields: [user("apiKey", "secret", userColumn)],
    requiredFields: ["apiKey"],
    ...(TESTERS.has(id) ? { tester: id as ServiceDef["tester"] } : {}),
    ...rest,
  });
}

export const SERVICES: readonly ServiceDef[] = [
  // ---- flight ------------------------------------------------------------
  keyService(
    "airlabs",
    "flight",
    "airlabs",
    "globalAirlabsApiKey",
    "airlabsApiKey",
    "AIRLABS_API_KEY",
    "https://airlabs.co/",
    { recommended: "free", quotaProvider: "airlabs" }
  ),
  keyService(
    "aviationstack",
    "flight",
    "aviationstack",
    "globalAviationstackApiKey",
    "aviationstackApiKey",
    "AVIATIONSTACK_API_KEY",
    "https://aviationstack.com/",
    {
      quotaProvider: "aviationstack",
      fields: [admin("dailyBudget", "number", "aviationstackDailyBudget", true)],
    }
  ),
  keyService(
    "aerodatabox",
    "flight",
    "aerodatabox",
    "globalAerodataboxApiKey",
    "aerodataboxApiKey",
    "AERODATABOX_API_KEY",
    "https://rapidapi.com/aedbx-aedbx/api/aerodatabox",
    { recommended: "free", quotaProvider: "aerodatabox" }
  ),
  // Instance-only: its budget guard covers only the instance key (spec invariant 7).
  svc({
    id: "aeroapi",
    category: "flight",
    level: "instance",
    credential: "key",
    recommended: "freeCredit",
    resolverProvider: "aeroapi",
    getKeyUrl: "https://www.flightaware.com/aeroapi/portal/",
    env: ["AEROAPI_API_KEY"],
    fields: [
      admin("apiKey", "secret", "globalAeroapiApiKey"),
      admin("tier", "select", "aeroapiTier", false, ["personal", "personal_feeder", "custom"]),
      admin("monthlyLimitUsd", "number", "aeroapiCustomBudgetUsd", true),
      admin("tracksEnabled", "switch", "aeroapiTracksEnabled", true),
    ],
    requiredFields: ["apiKey"],
    tester: "aeroapi",
  }),
  svc({
    id: "opensky",
    category: "flight",
    level: "instanceAndAccount",
    credential: "oauthClient",
    recommended: "free",
    getKeyUrl: "https://opensky-network.org/",
    env: ["OPENSKY_CLIENT_ID", "OPENSKY_CLIENT_SECRET", "OPENSKY_USERNAME", "OPENSKY_PASSWORD"],
    fields: [
      admin("clientId", "secret", "globalOpenskyClientId"),
      admin("clientSecret", "secret", "globalOpenskyClientSecret"),
      admin("username", "secret", "globalOpenskyUsername", true),
      admin("password", "secret", "globalOpenskyPassword", true),
    ],
    accountFields: [
      user("clientId", "secret", "openskyClientId"),
      user("clientSecret", "secret", "openskyClientSecret"),
      user("username", "secret", "openskyUsername", true),
      user("password", "secret", "openskyPassword", true),
    ],
    requiredFields: ["clientId", "clientSecret"],
    tester: "opensky",
    quotaProvider: "opensky",
  }),
  svc({
    id: "adsblol",
    category: "flight",
    level: "instance",
    credential: "none",
    keyless: true,
    recommended: "free",
    resolverProvider: "adsblol",
    env: ["ADSBLOL_API_KEY"],
    enabled: { kind: "adminColumns", columns: ["adsbLolEnabled"] },
    fields: [admin("apiKey", "secret", "globalAdsblolApiKey", true)],
    tester: "adsblol",
    quotaProvider: "adsblol",
  }),
  svc({
    id: "adsbx",
    category: "flight",
    level: "instance",
    credential: "key",
    resolverProvider: "adsbx",
    getKeyUrl: "https://rapidapi.com/adsbx/api/adsbexchange-com1",
    env: ["ADSBX_RAPIDAPI_KEY"],
    fields: [admin("apiKey", "secret", "globalAdsbxApiKey")],
    requiredFields: ["apiKey"],
    tester: "adsbx",
    quotaProvider: "adsbx",
  }),

  // ---- maps & routes -------------------------------------------------------
  keyService(
    "openrouteservice",
    "mapsRoutes",
    "openrouteservice",
    "globalOpenrouteserviceApiKey",
    "openrouteserviceApiKey",
    "OPENROUTESERVICE_API_KEY",
    "https://openrouteservice.org/dev/#/signup",
    { recommended: "free" }
  ),
  keyService(
    "graphhopper",
    "mapsRoutes",
    "graphhopper",
    "globalGraphhopperApiKey",
    "graphhopperApiKey",
    "GRAPHHOPPER_API_KEY",
    "https://www.graphhopper.com/dashboard/"
  ),
  svc({
    id: "railTimetables",
    category: "mapsRoutes",
    level: "instance",
    credential: "none",
    keyless: true,
    recommended: "free",
    env: ["RAIL_LOOKUP_CONTACT"],
    enabled: { kind: "adminColumns", columns: ["railTransitousEnabled", "railDbRestEnabled"] },
    fields: [
      admin("transitous", "switch", "railTransitousEnabled"),
      admin("dbRest", "switch", "railDbRestEnabled"),
    ],
  }),
  svc({
    id: "googlePlaces",
    category: "mapsRoutes",
    level: "instance",
    credential: "key",
    resolverProvider: "googlePlaces",
    getKeyUrl: "https://console.cloud.google.com/google/maps-apis",
    env: ["GOOGLE_PLACES_API_KEY"],
    fields: [admin("apiKey", "secret", "globalGooglePlacesApiKey")],
    requiredFields: ["apiKey"],
    tester: "googlePlaces",
  }),
  svc({
    id: "geocoder",
    category: "mapsRoutes",
    level: "instance",
    credential: "url",
    keyless: true,
    // Every place and address entry, the lodging coordinates and the map pick run
    // on it, through ~40 call sites that answer "no result" on failure. A silent
    // "off" would read as "nothing found" everywhere. An admin who must not use
    // the public servers points the two URLs at their own (expert fields).
    alwaysOn: true,
    recommended: "free",
    env: ["PHOTON_URL", "NOMINATIM_URL"],
    fields: [
      admin("photonUrl", "url", "photonUrl", true),
      admin("nominatimUrl", "url", "nominatimUrl", true),
    ],
  }),
  svc({
    id: "selfHostedRouting",
    category: "mapsRoutes",
    level: "instance",
    credential: "url",
    keyless: true,
    fields: [
      admin("osrmUrl", "url", "routingCustomUrl", true),
      admin("railRoutingUrl", "url", "railRoutingUrl", true),
    ],
  }),

  // ---- photos & location ----------------------------------------------------
  svc({
    id: "immich",
    category: "photosLocation",
    level: "instanceAndAccount",
    credential: "urlKey",
    connection: true,
    recommended: "free",
    env: ["IMMICH_BASE_URL", "IMMICH_API_KEY"],
    fields: [
      admin("baseUrl", "url", "globalImmichBaseUrl"),
      admin("apiKey", "secret", "globalImmichApiKey"),
    ],
    accountFields: [
      user("baseUrl", "url", "immichBaseUrl"),
      user("apiKey", "secret", "immichApiKey"),
    ],
    requiredFields: ["baseUrl", "apiKey"],
    tester: "immich",
  }),
  svc({
    id: "dawarich",
    category: "photosLocation",
    level: "instanceAndAccount",
    credential: "urlKey",
    connection: true,
    adminRow: false,
    env: ["DAWARICH_BASE_URL", "DAWARICH_API_KEY"],
    fields: [
      admin("baseUrl", "url", "globalDawarichBaseUrl"),
      admin("apiKey", "secret", "globalDawarichApiKey"),
    ],
    accountFields: [
      user("baseUrl", "url", "dawarichBaseUrl"),
      user("apiKey", "secret", "dawarichApiKey"),
    ],
    requiredFields: ["baseUrl", "apiKey"],
    tester: "dawarich",
  }),
  svc({
    id: "strava",
    category: "photosLocation",
    level: "instanceAndAccount",
    credential: "oauthClient",
    connection: true,
    getKeyUrl: "https://www.strava.com/settings/api",
    env: ["STRAVA_CLIENT_ID", "STRAVA_CLIENT_SECRET"],
    fields: [
      admin("clientId", "text", "stravaClientId"),
      admin("clientSecret", "secret", "stravaClientSecret"),
    ],
    requiredFields: ["clientId", "clientSecret"],
  }),

  // ---- AI --------------------------------------------------------------------
  svc({
    id: "ollama",
    category: "ai",
    level: "instance",
    credential: "url",
    recommended: "free",
    env: ["OLLAMA_URL"],
    ai: { kind: "ollama" },
    fields: [
      admin("url", "url", "ollamaUrl"),
      admin("model", "text", "ollamaModel"),
      admin("visionModel", "text", "ollamaVisionModel", true),
      admin("remoteOptIn", "switch", "llmOllamaOptIn", true),
    ],
    requiredFields: ["url"],
    tester: "ollama",
  }),
  svc({
    id: "openai",
    category: "ai",
    level: "instance",
    credential: "key",
    getKeyUrl: "https://platform.openai.com/api-keys",
    ai: { kind: "openai" },
    enabled: { kind: "adminColumns", columns: ["llmOpenaiOptIn"] },
    fields: [
      admin("apiKey", "secret", "llmOpenaiApiKey"),
      admin("model", "text", "llmOpenaiModel", true),
    ],
    requiredFields: ["apiKey"],
    tester: "llmCloud",
  }),
  svc({
    id: "anthropic",
    category: "ai",
    level: "instance",
    credential: "key",
    getKeyUrl: "https://console.anthropic.com/settings/keys",
    ai: { kind: "anthropic" },
    enabled: { kind: "adminColumns", columns: ["llmAnthropicOptIn"] },
    fields: [
      admin("apiKey", "secret", "llmAnthropicApiKey"),
      admin("model", "text", "llmAnthropicModel", true),
    ],
    requiredFields: ["apiKey"],
    tester: "llmCloud",
  }),
  svc({
    id: "gemini",
    category: "ai",
    level: "instance",
    credential: "key",
    getKeyUrl: "https://aistudio.google.com/app/apikey",
    ai: { kind: "google" },
    enabled: { kind: "adminColumns", columns: ["llmGoogleOptIn"] },
    fields: [
      admin("apiKey", "secret", "llmGoogleApiKey"),
      admin("model", "text", "llmGoogleModel", true),
    ],
    requiredFields: ["apiKey"],
    tester: "llmCloud",
  }),
  svc({
    id: "customLlm",
    category: "ai",
    level: "instance",
    credential: "urlKey",
    ai: { kind: "custom" },
    enabled: { kind: "adminColumns", columns: ["llmCustomOptIn"] },
    fields: [
      admin("baseUrl", "url", "openaiCompatBaseUrl"),
      admin("model", "text", "openaiCompatModel"),
      admin("apiKey", "secret", "openaiCompatApiKey"),
    ],
    requiredFields: ["baseUrl", "model"],
    tester: "llmCloud",
  }),

  // ---- open data & logos ---------------------------------------------------------
  svc({
    id: "openData",
    category: "openData",
    level: "instance",
    credential: "none",
    keyless: true,
    recommended: "free",
    enabled: { kind: "adminColumns", columns: ["openDataEnabled"] },
  }),
  svc({
    id: "logos",
    category: "openData",
    level: "instance",
    credential: "key",
    keyless: true,
    recommended: "free",
    resolverProvider: "logostream",
    env: ["LOGOSTREAM_API_KEY"],
    fields: [
      admin("apiKey", "secret", "globalLogostreamApiKey", true),
      admin("operatorLogos", "switch", "operatorLogosOpenDataEnabled", true),
    ],
    tester: "logostream",
  }),
  svc({
    id: "fx",
    category: "openData",
    level: "instance",
    credential: "none",
    keyless: true,
    // The ECB lookup (Frankfurter) is what every stay and cost total converts
    // through; only a currency code and a date leave the server. What an admin may
    // decide is the public CDN fallback for currencies the ECB does not publish,
    // and that stays its own switch (the Parser page's "fxCdnFallbackEnabled").
    alwaysOn: true,
    recommended: "free",
    fields: [admin("cdnFallback", "switch", "fxCdnFallbackEnabled", true)],
  }),

  // ---- sync & mail -------------------------------------------------------------------
  svc({
    id: "webdav",
    category: "syncMail",
    level: "instanceAndAccount",
    credential: "urlKey",
    connection: true,
    recommended: "free",
    env: ["WEBDAV_URL"],
    // Off stops the account syncs AND the instance backups (the latter through
    // `getWebDAVSettings().enabled`); the column below is only the instance backup switch.
    fields: [
      admin("backupSync", "switch", "webdavSyncEnabled"),
      admin("url", "url", "webdavUrl"),
      admin("username", "text", "webdavUsername"),
      admin("password", "secret", "webdavPasswordEncrypted"),
      admin("backupPath", "text", "webdavBackupPath", true),
    ],
    requiredFields: ["url", "username", "password"],
    tester: "webdav",
  }),
  svc({
    id: "smtp",
    category: "syncMail",
    level: "instance",
    credential: "smtp",
    recommended: "free",
    enabled: { kind: "smtp" },
    fields: [
      other("smtp", "host", "text", "host"),
      other("smtp", "port", "number", "port", true),
      other("smtp", "secure", "switch", "secure", true),
      other("smtp", "username", "text", "username"),
      other("smtp", "password", "secret", "password"),
      other("smtp", "fromEmail", "text", "fromEmail"),
      other("smtp", "fromName", "text", "fromName", true),
    ],
    requiredFields: ["host", "username", "password", "fromEmail"],
  }),
  svc({
    id: "push",
    category: "syncMail",
    level: "instance",
    credential: "none",
    keyless: true,
    enabled: { kind: "push" },
    fields: [admin("relayUrl", "url", "pushRelayUrl", true)],
  }),

  // ---- instance ----------------------------------------------------------------------------
  svc({
    id: "federation",
    category: "instance",
    level: "instance",
    credential: "none",
    keyless: true,
    enabled: { kind: "federation" },
    fields: [admin("origin", "url", "federationOrigin", true)],
  }),
  svc({
    id: "usageStats",
    category: "instance",
    level: "instance",
    credential: "none",
    keyless: true,
    enabled: { kind: "usageStats" },
  }),
  svc({
    id: "updatesTemplates",
    category: "instance",
    level: "instance",
    credential: "url",
    keyless: true,
    enabled: { kind: "adminColumns", columns: ["updateCheckEnabled"] },
    fields: [admin("templateRepoUrl", "url", "templateRepoBaseUrl", true)],
  }),
];

export const SERVICE_BY_ID: ReadonlyMap<string, ServiceDef> = new Map(
  SERVICES.map((s) => [s.id, s])
);

export function getService(id: string): ServiceDef | undefined {
  return SERVICE_BY_ID.get(id);
}

/** The service that owns an `apiKeyResolver` provider id (openai/claude have none). */
export function serviceForResolverProvider(provider: string): ServiceDef | undefined {
  return SERVICES.find((s) => s.resolverProvider === provider);
}

/** Cloud-AI services (a document leaves the server): every AI service but a local Ollama. */
export const AI_SERVICES: readonly ServiceDef[] = SERVICES.filter((s) => s.ai);

/** Account connections: the four things an admin may forbid accounts to connect. */
export const CONNECTION_IDS = ["dawarich", "immich", "strava", "webdav"] as const;
export type ConnectionId = (typeof CONNECTION_IDS)[number];
