# External services: one place, admin and account (forgejo#392)

Owner, 2026-10-30: the settings tabs must get better, starting with **Externe
Dienste** — the one place for everything TravStats does not do itself (APIs,
Immich, Dawarich, Strava, WebDAV, SMTP, AI). It exists for admins and for
accounts, each showing what that level may change, in one style. Every entry has
an info button (why TravStats needs it, cost, where to get the key, quota, what
leaves the server). Cloud AI keeps an explicit data-sharing confirmation.
Standard and Expert views. "Empfohlen" tags mark what gives the best experience
for free. Approved as drawn ("so kannst du es bauen").

- Mockups (approved): `2026-10-30-external-services/mockup-admin.html`,
  `mockup-account.html` (Design-canvas `.dc.html` sources; read the markup and
  the data in the script block — the data is the catalogue draft).
- Inventory of what exists today (44 rows, file paths, current UI, defaults):
  `2026-10-30-external-services/inventory.md`.
- Review: Codex twice (concept and mockup); its rules are the invariants below.

## Invariants

1. **The effective source is shown.** Every service says which credential
   actually serves a request: account → instance → none. Server environment variables are not a source (owner, 2026-10-31); see "ENV removal".
   Admin view shows the instance side; the account view shows the account's.
2. **Off means off.** An admin "off" blocks the service for every account,
   including accounts with their own key, the ENV fallback and background jobs.
   Clearing a key never silently activates another source *unless* that source
   is the documented next step (account key removed → instance key applies).
3. **Status has dimensions**, never one word: `enabled`, `configured`
   (credential present where one is needed), `lastTest {at, ok, reason}`,
   `quota` (where known), and for cloud AI `consent`. "Aktiv" = enabled ∧
   configured; enabled without a needed credential shows "Schlüssel fehlt".
4. **Cloud AI consent is two-step.** The admin allows a provider for the
   instance (existing per-slot opt-in + a confirmation dialog). An account's
   documents go to that provider only after **that account** consented (new,
   per provider, revocable). Remote Ollama and the custom endpoint count as
   cloud. Withdrawal copy names the provider ("geht nichts mehr an X"), never
   "alles lokal" while another provider is consented.
5. **Standard shows every service**; it hides only endpoints/URLs and source
   order. Search and filters see all services in both views.
6. **Secrets are write-only**: masked on read (`•••• last4`), password inputs.
7. **AeroAPI is instance-only** (its budget guard covers only the instance key);
   the account view lists it under "Von der Instanz bereitgestellt".

## Catalogue — one source of truth

`backend/src/services/externalServices/catalogue.ts` (+ frontend mirror for
copy only is NOT wanted: the frontend reads the catalogue from the API) lists
each service: `id`, `category`, `level` (`instance` | `instanceAndAccount` |
`account`), `credential` kind (`key` | `oauthClient` | `urlKey` | `url` |
`none` | `smtp`), `recommended` (`free` | `freeCredit` | null), `expertOnly`
fields, `keyless` flag, and i18n keys for name, purpose and the five info rows
(`why`, `cost`, `quota`, `dataOut`, `getKeyUrl` + label). Copy lives in
`frontend/src/i18n/resources/{de,en}/externalServices.json` (DE first, EN mirror,
localeKeyParity holds). A test fails when a service column in `schema.prisma`
(`*ApiKey`, `*Url`, `*Enabled` external switches listed in `inventory.md`) has
no catalogue entry, mirroring `shareTypes.test.ts`.

Categories (order): `flight`, `mapsRoutes`, `photosLocation`, `ai`,
`openData`, `syncMail`, `instance`. Service ids: `airlabs`, `aviationstack`,
`aerodatabox`, `aeroapi`, `opensky`, `adsblol`, `adsbx`, `openrouteservice`,
`graphhopper`, `railTimetables` (transitous + db-rest), `googlePlaces`,
`geocoder` (photon + nominatim, expert fields), `selfHostedRouting` (osrm +
openRailRouting), `immich`, `dawarich`, `strava`, `ollama`, `openai`,
`anthropic`, `gemini`, `customLlm`, `openData`, `logos`, `fx`, `webdav`,
`smtp`, `push`, `federation`, `usageStats`, `updatesTemplates`. Not listed:
Mapbox (unused), map tile URLs (ENV only, expert note), AISStream (ENV only —
add when it gets a UI).

## Contract (additive; no endpoint removed)

### ENV removal (owner decision 2026-10-31)

Contract change: `instanceSource` and `effectiveSource` lose the value `"env"` (a variable that
stood in for a key now reads `"none"` until the one-time import has copied it into the instance).
`GET /admin/strava` loses `envConfigured`. The Companion reads none of these routes (grep of
`TravStatsCompanion`, 2026-10-31: no reference to `external-services`, `instanceSource` or
`effectiveSource`).

Service credentials and addresses are read only from `admin_settings`/`user_settings`. On the first
start of this version `importServiceEnv()` (services/envImport.ts) copies every old variable that
is still set into its instance field when that field is empty (secrets encrypted with the admin
page's helper), writes `admin_settings.env_imported_at`, and never reads the environment for these
again. Variable names are logged, never values. New columns: `own_geo_url`, `market_overpass_url`,
`rail_lookup_contact`, `usage_stats_endpoint`, `global_aisstream_api_key`, `env_imported_at`.
New catalogue row `aisstream` (key). `CLAUDE_MODEL`, `CLAUDE_VISION_MODEL` and `USE_LLM_PARSER`
have no instance field and are ignored.

### `GET /api/v1/admin/external-services` (admin)

```ts
{
  categories: Array<{ id: string; services: AdminService[] }>;
  accountConnections: Array<{ id: "dawarich" | "immich" | "strava" | "webdav"; allowed: boolean; connectedAccounts: number }>;
}
type AdminService = {
  id: string; level: "instance" | "instanceAndAccount" | "account";
  recommended: "free" | "freeCredit" | null;
  enabled: boolean;                 // admin switch; for key-only services: true unless switched off
  configured: boolean;              // instance credential present (or keyless)
  instanceSource: "instance" | "none";
  allowAccountKeys: boolean | null; // null when level !== instanceAndAccount
  lastTest: { at: string; ok: boolean; reason: string | null } | null;
  quota: { kind: "budget" | "monthly" | "daily" | "rateLimit" | "none"; used?: number; limit?: number; unit?: string; resetsAt?: string } | null;
  fields: Array<{ key: string; kind: "secret" | "text" | "url" | "number" | "select" | "switch"; value: string | number | boolean | null; masked?: boolean; expert: boolean }>;
  consent?: { allowedByAdmin: boolean; accountsConsented: number };  // cloud AI only
}
```

### `PUT /api/v1/admin/external-services/:id`

Body: `{ enabled?: boolean; allowAccountKeys?: boolean; fields?: Record<string, unknown> }`.
Field writes go through the existing per-service save paths (api-keys,
routing, geocoder, open data, llm, smtp, webdav, push, …) — this route is a
façade, not a second store. Secrets: empty string = remove, masked value =
unchanged. Enabling a cloud AI provider requires `confirmDataSharing: true` in
the body (400 `CONSENT_REQUIRED` otherwise).

### `PUT /api/v1/admin/external-services/connections/:id` — `{ allowed: boolean }`

### `POST /api/v1/admin/external-services/:id/test`

Runs the existing tester; persists `lastTest`. A disabled service answers
`409 SERVICE_DISABLED` without calling out. Never sends mail/data beyond what
the tester already does; the response says whether quota was used
(`{ ok, reason, usedQuota: boolean }`).

### `GET /api/v1/settings/external-services` (account)

```ts
{
  connections: AccountService[];   // dawarich, immich, strava, webdav — only those the admin allows
  ownKeys: AccountService[];       // instanceAndAccount services with allowAccountKeys && enabled
  aiConsents: Array<{ id: string; provider: string; destination: string; consentedAt: string | null }>; // only admin-allowed providers
  instanceProvided: Array<{ id: string; enabled: boolean; recommended: "free" | "freeCredit" | null }>;
}
type AccountService = {
  id: string; recommended: "free" | "freeCredit" | null;
  effectiveSource: "account" | "instance" | "none" | "off";
  accountDisabled: boolean;        // "Für mein Konto ausschalten"
  configured: boolean; lastTest: {...} | null;
  fields: Array<{ key: string; kind: ...; value: ...; masked?: boolean; expert: boolean }>;
}
```

### `PUT /api/v1/settings/external-services/:id`

`{ fields?: ...; accountDisabled?: boolean }`. Removing the own key
(`fields.<key> = ""`) falls back to the instance; `accountDisabled: true` stops
every call for this account (resolver returns `off`).

### `PUT /api/v1/settings/external-services/ai-consent/:provider` — `{ consent: boolean }`

Stores `consentedAt` per provider on the account. `llmGate` refuses a cloud
provider for an account without consent with the existing
`cloud_not_consented` reason (now per account), which the import UI already maps.

### Errors

`{ error, code }` as everywhere: `SERVICE_DISABLED`, `CONSENT_REQUIRED`,
`ACCOUNT_KEYS_NOT_ALLOWED`, `CONNECTION_NOT_ALLOWED`, `VALIDATION_FAILED`.

## Schema (one migration, additive)

- `admin_settings.external_service_policy` JSONB default `'{}'`:
  `{ disabled: string[]; accountKeysForbidden: string[]; connectionsForbidden: string[] }`
  (absent = allowed/enabled, so existing instances keep today's behaviour).
- `admin_settings.update_check_enabled` boolean default true.
- `user_settings.external_service_prefs` JSONB default `'{}'`:
  `{ disabled: string[]; aiConsent: Record<provider, ISO date> }`.
- `external_service_tests` (scope `instance` | user id, service id, at, ok, reason) — or a JSONB on each settings row; worker decides, test included.

Resolver (`apiKeyResolver.ts`) consults the policy first: admin-disabled → `off`
for everyone; account-disabled → `off` for that account; account keys forbidden
→ skip the account key. One test per rule (off blocks account key and ENV; a
forbidden account key is ignored; removing an account key falls to instance).

## Phases

| Phase | Side | What | State |
|---|---|---|---|
| ES1 | server | catalogue, policy columns, resolver rules, the five routes, per-account AI consent in llmGate, persisted tests, OpenAPI | open |
| ES2 | web | Admin › Externe Dienste per mockup-admin (rows, info panel, recommended banner+filter, Standard/Expert, consent dialog, "Was Konten selbst verbinden dürfen"); existing cards move in, the scattered entries elsewhere (Parser FX switch, Instanz open data/push/federation/usage stats, Backups WebDAV, SMTP page) link here | open |
| ES3 | web | Einstellungen › Dienste per mockup-account | open |
| ES4 | Companion | none required; the app reads nothing new. Later: show AI consent in the app's import | — |

ES2/ES3 build against the contract with the API mocked until ES1 lands.

## Open

- Cost/quota copy marked `[…]` in the mockup (e.g. Aviationstack free tier) must be checked against the provider before release; unknown stays "laut Anbieter", never a guessed number.
- The usage-stats consent dialog and TravPlan's per-trip AI switch keep their own flows; this page links to them.
