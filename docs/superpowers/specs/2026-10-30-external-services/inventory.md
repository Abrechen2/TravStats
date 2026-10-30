# TravStats external services inventory (checkout int-2.8.1 @ 64bd146bf)

Level: "A+U" = admin global key AND account key (account key wins, then admin, then env; resolver `backend/src/services/apiKeyResolver.ts:43`). "A" admin only. "U" account only.
UI paths: `frontend/src/components/Settings/ServicesSection.tsx` = user page Einstellungen > Dienste; `frontend/src/components/Admin/GlobalApiKeysManager.tsx` = Administration > Externe Dienste.

| # | Service | Purpose in TravStats | Level | Credential | Switch / default | UI today | Cost / quota (code or i18n) | AI consent |
|---|---|---|---|---|---|---|---|---|
| 1 | AirLabs | flight status / lookup chain | A+U, env AIRLABS_API_KEY | API key | key present = on; `allowUserFlightApiKeys` (default true) | user ServicesSection flight group; admin GlobalApiKeysManager | i18n: 1000 req/month free (`settings.apiKeys.airlabs.description`) | n/a |
| 2 | Aviationstack | flight lookup | A+U, env AVIATIONSTACK_API_KEY | API key | key = on | same | none in copy | n/a |
| 3 | AeroDataBox (RapidAPI) | flight lookup, history up to 1 year | A+U, env AERODATABOX_API_KEY | API key | key = on | same | 600 units/month free (i18n); unit headers parsed (`services/apiQuota.ts`) | n/a |
| 4 | FlightAware AeroAPI | flight status, optional track import | A+U, env AEROAPI_API_KEY | API key | key = on; `aeroapiTracksEnabled` default false (admin) | user + admin, budget card in flight footer (`AeroapiBudgetCard`) | tier budget: personal 5 USD, personal_feeder 10 USD, custom (`services/aeroapiBudget.ts:24`); 10 req/min (`:46`) | n/a |
| 5 | OpenSky Network | ADS-B flight lookup | A+U (OAuth client id/secret or user/pass), env OPENSKY_CLIENT_SECRET/PASSWORD | client id + secret | key = on | user flight group (`ApiKeyCard` with opensky fields); admin | rate-limit only, no monthly quota (`apiQuota.ts:89`) | n/a |
| 6 | adsb.lol | keyless ADS-B lookup | admin switch; key column also exists (A+U schema), env ADSBLOL_API_KEY | none (optional key) | `adsbLolEnabled` default false | admin only (`GlobalApiKeysManager.tsx` ~l.228, SettingRows) | rate-limit only | n/a |
| 7 | ADS-B Exchange | ADS-B lookup via RapidAPI | A (user column exists, no user UI), env ADSBX_RAPIDAPI_KEY | RapidAPI key | key = on | admin only (`GlobalApiKeysManager.tsx` ~l.106) | RapidAPI link only | n/a |
| 8 | AISStream | ferry live AIS positions (`services/ferry/aisStream.ts:4`) | env only (AISSTREAM_API_KEY) | key | env presence | no UI | none | n/a |
| 9 | OpenRouteService | routing for tours/roadtrips | A+U, env OPENROUTESERVICE_API_KEY | API key | routing provider choice (admin) | user ServicesSection routing group (`PersonalRoutingKeysSection`); admin `RoutingProviderSection.tsx` | 2000 req/day free (i18n `settings.routing.openrouteservice.description`) | n/a |
| 10 | GraphHopper | routing alternative | A+U, env GRAPHHOPPER_API_KEY | API key | routing provider choice | same as 9 | 500 req/day free (i18n) | n/a |
| 11 | Custom OSRM | self-hosted routing (`routingCustomUrl`) | A, URL only | URL, no key | URL set = on | admin RoutingProviderSection / GlobalApiKeysManager routing group | self-hosted | n/a |
| 12 | OpenRailRouting | rail track geometry (`services/rail/openRailRouting.ts`) | A, URL (`railRoutingUrl`) | URL | URL set | admin `RailRoutingUrlSetting.tsx`; rail group | self-hosted, no key | n/a |
| 13 | Transitous | European timetable lookup for rail logbook; line geometry | A (switch), contact env RAIL_LOOKUP_CONTACT | none | `railTransitousEnabled` default true | admin `RailProvidersCard` (admin rail group); user services rail group (state read-only) | i18n: "sends train no., station, day" | n/a |
| 14 | db-rest (v6.db.transport.rest) | German timetable lookup (unofficial) | A (switch) | none | `railDbRestEnabled` default true | same as 13 | i18n: ~100 req/min shared by all users | n/a |
| 15 | Photon (komoot) | geocoding / place search | A, URL (`photonUrl`, env PHOTON_URL) | none | always resolved (public default) | admin GeocoderSettingsCard (externalServices > maps); also moved from user page (`MOVED_TO_ADMIN`) | none in code | n/a |
| 16 | Nominatim (OSM) | geocoding; Immich nightly scan naming (<=40/20 per run) | A, URL (`nominatimUrl`, env NOMINATIM_URL) | none | always resolved | admin GeocoderSettingsCard | public usage policy; caps in `immich.nightlyScan.privacyHelp` | n/a |
| 17 | Google Places (New API) + Takeout CID lookup | last-tier place search; Google Maps takeout import | A only, env GOOGLE_PLACES_API_KEY | API key | key = on | admin GlobalApiKeysManager cross group | billing per request (copy "optional", `admin.globalApiKeys.googlePlaces.description`) | n/a |
| 18 | OpenStreetMap Overpass + OSM open data | open-data enrichment (lodging, Dawarich market catalogue `MARKET_OVERPASS_URL`) | A switch `openDataEnabled` default false | none | off by default | admin OpenDataCard (externalServices cross group) | rate-limited copy `openData.upstream.rateLimited` | n/a |
| 19 | Open-Meteo (weather, archive, elevation) | weather and elevation in open data / TravPlan | A, switch `openDataEnabled` default false | none | off by default | admin OpenDataCard; TravPlan weather (`services/travplan/weather.ts`) | rate-limited copy `openData.weather.outcome.rateLimited` | n/a |
| 20 | Wikipedia / Wikimedia Commons / Wikidata | stop info, stop images, operator logos | A, `openDataEnabled` (default false) and `operatorLogosOpenDataEnabled` (default true) | none | two switches | admin OpenDataCard, OperatorLogosCard (admin GlobalApiKeysManager cross group) | none | n/a |
| 21 | OpenFreeMap tiles | basemap styles | env MAP_STYLE_{STANDARD,LIGHT,DARK,VOYAGER}_URL only | none | always on | no UI (env, `services/mapConfig.ts`) | none | n/a |
| 22 | Mapbox | not used (only the deck.gl/mapbox overlay library) | — | — | — | — | — | — |
| 23 | Frankfurter (ECB rates) | FX rates | none (always) | none | always | no UI | none | n/a |
| 24 | jsDelivr currency-api CDN (fawazahmed0) | FX fallback for non-ECB currencies | admin switch `fxCdnFallbackEnabled` default true | none | switch on | admin `ParserSettings.tsx` (FX switch sits on the Parser page) | none | n/a |
| 25 | logostream | premium airline logos | A, env LOGOSTREAM_API_KEY (min 10 chars) | API key | key = on | admin GlobalApiKeysManager cross group | none | n/a |
| 26 | kiwi.com logo CDN | keyless default airline logo tier | none | none | always | no UI (`services/airlineLogo/airlineLogoService.ts:39`) | none | n/a |
| 27 | Daisycon logo CDN | tail airline logo fallback | none | none | always | no UI | none | n/a |
| 28 | Immich | photo albums (link or import), nightly photo-journey scan | A+U (URL + key), env IMMICH_BASE_URL/IMMICH_API_KEY; A+U resolved user > admin | URL + API key | nightly scan opt-in (`photoJourneyNightlyScan`) | user services cross group (`ImmichConnectionCard`, `PhotoJourneyNightlyScanCard`); admin cross group (`ImmichGlobalSettings`) | none | n/a |
| 29 | Dawarich | location history import, stay scan | U (`DawarichConnectionCard` in location page); admin route `routes/admin/dawarich.ts` exists with NO admin UI; env DAWARICH_* | URL + API key | — | user location page; user services shows pointer only | none | n/a |
| 30 | Strava | activity import as tours | admin client id/secret (`routes/admin/strava.ts`, env STRAVA_CLIENT_ID/SECRET) + U OAuth tokens | OAuth client + per-user token | connect/disconnect | user services (`StravaConnectionCard`, admin fields inside same card when isAdmin) | Strava API limits, none in code | n/a |
| 31 | WebDAV (sync of exports) | backup / export sync to a share | A (URL, `webdavSyncEnabled`, env WEBDAV_*) + U (URL, user, password per user) | URL + user + password | admin enable, user `enabled` | admin Backups > WebDAV (`WebDAVSettings`); user Einstellungen > Daten > Backup (`WebdavSyncRow` inside `BackupSection`) | none | n/a |
| 32 | SMTP | outgoing mail (invites, resets, notifications) | A (DB table `SmtpConfig`, default enabled=false) | host + user + password | `enabled` | admin SMTP page (`SmtpManager`) | none | n/a |
| 33 | Push relay (push.travstats.de) | push notifications to paired devices | A (`pushEnabled` default false, `pushRelayUrl` default push.travstats.de) | instance secret | `pushEnabled` | admin Instanz > Push (expert, `PushSettings`); user Devices page | none | n/a |
| 34 | Federation peers (other TravStats servers) | remote trip sharing, comparison | A (`federationEnabled`, `tripFederationEnabled` both default false) | Ed25519 keys, connection file | two switches | admin Instanz > Föderation (expert, `FederationSettings`); user Teilen > remote sharing (beta `federatedTripSharing`) | none | n/a |
| 35 | Usage-stats telemetry (stats.travstats.de) | anonymous usage stats | A switch + U/instance consent dialog (`usageStatsConsent`, default "unset") | install id | consent state | admin Instanz > Nutzungsstatistik (`UsageStatsSettings`); consent `UsageStatsConsentDialog` (App.tsx) | none | not AI |
| 36 | GitHub Releases API | update check (`services/updateChecker.ts`, called from `routes/version.ts`) | none, no switch found | none | always | no UI | GitHub rate limit | n/a |
| 37 | GitHub raw (travstats-templates) | parser templates | A (`templateRepoBaseUrl`, env TEMPLATE_REPO_BASE_URL) | URL | URL | admin Parser > Vorlagen (expert, `TemplateRepoSettings`) | none | n/a |
| 38 | GitHub community airline templates | training recorder (`services/trainingRecorder.ts:37`) | unclear, no switch found | none | unknown | none | none | n/a |
| 39 | DuckDuckGo icons + rental provider sites | rental provider logos (`rentalProviders/providerLogoService.ts:88-89`) | none | none | always | no UI | none | n/a |
| 40 | Ollama (local default http://localhost:11434) | LLM parser / TravPlan AI, local-first | A, `ollamaUrl` + env OLLAMA_URL; remote needs `llmOllamaOptIn` | URL | `llmEnabled` default true (master) | admin Parser > KI (`ParserSettings.tsx`, `LlmProviderSettings.tsx`) | none | remote only: checkbox `admin:parserSettings.ollama.remoteOptIn.label` |
| 41 | OpenAI | LLM parser | A only (`llmOpenaiApiKey`), fixed base api.openai.com/v1 | API key | per-slot `llmOpenaiOptIn` default false | admin Parser > KI (`LlmProviderSettings.tsx`) | per request, copy up to 12,000 chars | inline checkbox, see below |
| 42 | Anthropic | LLM parser | A only (`llmAnthropicApiKey`), api.anthropic.com/v1 | API key | `llmAnthropicOptIn` default false | same | same | inline checkbox |
| 43 | Google Gemini (OpenAI-compat endpoint) | LLM parser | A only (`llmGoogleApiKey`) | API key | `llmGoogleOptIn` default false | same | same | inline checkbox |
| 44 | Custom OpenAI-compatible endpoint | LLM parser | A only (`openaiCompatBaseUrl` + `openaiCompatApiKey`) | URL + key | `llmCustomOptIn` default false | same | same | inline checkbox |

Notes:
- OpenAI/Claude account keys (UserSettings.openaiApiKey, claudeApiKey) and env OPENAI_API_KEY / CLAUDE_API_KEY are read only by apiKeyResolver and apiKeyTester (`services/apiKeyTester.ts:110,178`). No UI, and the LLM chain (`services/llm/llmProvider.ts`) reads only the admin slots. Effectively dead.
- Account key columns exist with no account UI for adsbx and adsblol (ApiKeysSection lists airlabs, aviationstack, aerodatabox, aeroapi, opensky only).
- Google Maps / bahn.de / booking etc. appear only as outbound links, not counted.

## AI consent: where it lives (no dialog exists)
- Inline always-visible checkbox per cloud slot, not a modal: `frontend/src/components/Admin/LlmProviderSettings.tsx` (~l.350-375, testid `llm-consent-checkbox-<kind>`, warning shown when saved without consent at l.234).
- i18n: `admin:parserSettings.provider.slots.{openai,anthropic,google,custom}.consent.{title,warning,label,inactive}` in `frontend/src/i18n/resources/{de,en}/admin.json`.
- Backend gate: `backend/src/services/llm/llmGate.ts` (`cloud_not_consented`), `llmProvider.ts:200-235`.
- User-facing refusal copy: `import:errors.llmCloudNotConsented` (`frontend/src/components/import/EmailImportTab.tsx:40,217`).
- TravPlan per-trip: switch `cloudEnable` plus `travplan` i18n `aiConsent` (`frontend/src/pages/TravPlan/PlanAI.tsx:85`), backend `services/travplan/ai.ts:22,41` (`PLAN_AI_CONSENT`).
- git history: commits 13b1bf6d3 and 0375a37ae replaced a single flag with per-slot flags, no dialog in either.
- Still shown today: yes, the checkbox is always visible in admin Parser > KI.

## Settings tab structure
User (`frontend/src/pages/Settings/settingsModel.ts:72`, menu :171):
- general: account (profile, security, devices, notifications, apitokens) · display (display, units, domains, countryCounting) · trips (trips, suggestions, sharing, shareLinks, calendarFeed) · companions · location (locationProvider, travTrack, dawarich, tripRecording, stayScan) · loyalty
- domains: flight (homeAirport, autoupdate, features, defaults, enrichment) · cruise (cruisePreferences)
- data: backup (incl. WebDAV row), import · services: externalServices (ServicesSection, ServiceAccordion)

Admin (`frontend/src/pages/Admin/adminSections.ts:121`, menu :152):
- manage: instance (instance, travTrack, travPlan, shareLinks, importMode, usageStats, about, federation, push) · users · invitations
- operations: externalServices (GlobalApiKeysManager) · parsers (parsers incl. LLM and FX switch, templateRepo) · smtp · backups (backups, webdav) · timeModel · logging · system
- master data: flight/cruise/lodging catalogues

## Inconsistencies (top 5)
1. External services are spread over 5 admin pages: externalServices, instance (open data, federation, push, usage stats), parsers (LLM, FX switch, template repo), backups (WebDAV), smtp.
2. Strava, Immich, WebDAV each split across admin and user pages with different card styles (ServiceAccordion vs SectionCard vs ApiKeyCard vs SettingRows; WebdavSyncRow inside BackupSection).
3. Dawarich has a backend admin route (`routes/admin/dawarich.ts`) without any admin UI; the user page only points to it from services.
4. Orphan credentials: UserSettings openai/claude keys, env OPENAI_API_KEY/CLAUDE_API_KEY, and adsbx/adsblol account columns have no UI or are only used by a tester.
5. The FX fallback switch sits on the Parser page; the AI consent is an inline checkbox and no consent dialog exists today (none in the git history of the LLM consent commits either).
