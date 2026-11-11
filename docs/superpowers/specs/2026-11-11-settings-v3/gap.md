# Settings gap: approved prototype vs web settings registry

Measured against `forgejo/main` at 2995084c9 (2026-11-11). Registry = `frontend/src/pages/Settings/registry/data/*.ts` (252 rows, ids identical to the 2026-11-08 inventory; generated from the designer's round-2 `settings-data.json`). Prototype = `pagesmod.js` (PAGES, 32 pages + service grid in `prototype.html`). The prototype is wider than Part B of the spec (it adds TravTrack/TravPlan areas, Treue, Telefone, Nutzer, Wartung rows).

Status legend: SAME = exists, only moves/relabels. CHANGED = exists but label, default, control kind, derivation or expert level differs. NEW-UI = backend exists, no UI/row today. NEW = needs backend work. DROPPED-HERE = exists today on this page, prototype removes it.
"Today" = `<registry page>/<section>/<row id>`. Mount table: `pages/Settings/area/areaModel.ts` (what is drawn); registry is what search reads. A row without a mounted component is noted.

## 0. Totals

| Status | Rows (non-service pages) | Service cards (21) | Total |
|---|---|---|---|
| SAME | 133 | 11 | 144 |
| CHANGED | 55 | 8 | 63 |
| NEW-UI | 19 | 0 | 19 |
| NEW | 6 | 2 | 8 |
| DROPPED-HERE | 11 | 20 (rows on the two service pages) | 31 |

CHANGED includes rows that only change level (standard -> expert) or only relabel. Rows are counted once per prototype row; one prototype row can cover several registry rows (e.g. `friends` = anfragen + verkn + fcodes; `smtpport` = smtpport + smtptls).

## 0b. Page level: prototype page -> today's page

Areas: prototype has four (Mein Konto, TravTrack, TravPlan, Server); today the menu has account / server / about, TravTrack and planning live inside account pages.

| Prototype page | Today |
|---|---|
| konto/profil | account (profile, security, apitokens, deletion); `home` section moves out |
| konto/anzeige | display (language, units); `views` links (karte, start, listen) dropped |
| konto/reisearten | domains (domains, planning, countryCounting) + flight/homeAirport + account/home |
| konto/reisen | trips (trips); suggestions section splits (rvor stays, avor/immichbeleg/kiort go to TravTrack) |
| konto/fluege, kreuzfahrten, treue | flight, cruise, loyalty |
| konto/erinnerungen | notifications |
| konto/freunde | sharing (companions, accounts, shareLinks, compare, encrypted) |
| konto/telefone | account/devices section (own page now) |
| konto/dienstek | services page, account side (mine/own-key cards) |
| konto/daten | data |
| konto/ueber | about |
| track/tt-aufz, tt-erk, tt-daten | travtrack (8 sections -> 3 pages) |
| track/tt-bereit | server/features.ttoffer |
| plan/pl-plan | domains/planning.travplan |
| plan/pl-bereit | server/features.tpoffer + tplimits |
| server/allgemein | server/general (+ addresses move out) |
| server/nutzer | users |
| server/funktionen | server/features + sharing/shareLinks (admin switch) + services/federation.fedon |
| server/email | services/smtp card |
| server/buchungen | server/parsers |
| server/dienste | services page, admin side |
| server/sicherungen | backups |
| server/srvconn | services/federation (fedpeers) |
| server/datenschutz | services/usageStats + services/push |
| server/adressen | server/addresses + server/passkeys |
| server/eigene | services/geocoder + selfHostedRouting + openData + updatesTemplates |
| server/wartung, stamm | maintenance, masterdata |

## 1. Per prototype page

### konto/profil "Profil & Anmeldung"

| proto row id | title | status | today (registry page/section/row) | backend field | note |
|---|---|---|---|---|---|
| avatar | Profilbild | SAME | account/profile/avatar | avatar file (users) |  |
| vorname | Vorname | SAME | account/profile/vorname | users.firstName |  |
| nachname | Nachname | SAME | account/profile/nachname | users.lastName |  |
| anzeige | Anzeigename | NEW-UI | - | none (derived firstName+lastName) | ProfileSection already builds fullName (l.88) for display; no field, no registry row |
| benutzer | Benutzername | SAME | account/profile/benutzer | users.username |  |
| email | E-Mail | SAME | account/profile/email | users.notificationEmail | Same column as the reminder address (reg erimail) |
| pass | Reisepass gültig bis | SAME | account/home/pass | user_settings.passportExpiry |  |
| geburtstag | Geburtstag | CHANGED | account/profile/geburtstag | users.birthdate/birthDay/birthPrecision | level standard -> expert |
| password | Passwort | SAME | account/security/passwort | users.passwordHash |  |
| twofa | Zwei-Faktor-Anmeldung | SAME | account/security/zweifa | users.twoFactorEnabledAt |  |
| codes | Ersatzcodes | SAME | account/security/codes | two_factor_recovery_codes | Prototype greys it out without 2FA (need) |
| passkeys | Passkeys | SAME | account/security/passkeys | webauthn_credentials |  |
| tokens | API-Schlüssel | SAME | account/apitokens/tokens | api_tokens | expert in both |
| findable | Für andere Server auffindbar | NEW | - | users.federationFindable (column exists) | Column only READ (sharing/federation/connections/serve.ts, remoteStats.ts); no write route, no UI. Needs a setter endpoint + row |
| delete | Konto löschen | SAME | account/deletion/deleteacct | DELETE account |  |

### konto/anzeige "Anzeige"

| proto row id | title | status | today (registry page/section/row) | backend field | note |
|---|---|---|---|---|---|
| lang | Sprache | SAME | display/language/sprache | user_settings.data.display.language |  |
| tz | Zeitzone | CHANGED | display/language/zeitzone | data.display.timezone + timezoneFollowsDevice | today a select; prototype shows derived 'vom Gerät'. timezoneFollowsDevice has no UI today |
| datefmt | Datumsformat | SAME | display/language/datum | data.display.dateFormat | choice -> select |
| timefmt | Uhrzeit | SAME | display/language/zeit | data.display.timeFormat |  |
| dist | Entfernungen | SAME | display/units/distanz | data.units.distanceUnit (kilometers/miles/nautical_miles) | sm = nautical_miles already allowed |
| weight | Gepäck | SAME | display/units/gewicht | data.units.weightUnit |  |
| cur | Anzeigewährung | NEW | - | data.units.currency (JSON key still in defaults, settings/types.ts:275) | Today ONE currency row = baseCurrency (UnitsSection.tsx l.17-23: units.currency was merged away). Prototype wants a separate display currency -> read-side + UI needed |
| basecur | Basiswährung für Summen | CHANGED | display/units/waehrung | user_settings.baseCurrency | today's single 'Hauptwährung' row is this column; standard -> expert, label changes |
| - | Kartendarstellung | DROPPED-HERE | display/views/karte | - | Kartendarstellung link (device map look); spec: not in spec |
| - | Startseite | DROPPED-HERE | display/views/start | - | Startseite link; spec: not in spec |
| - | Listen importieren | DROPPED-HERE | data/import/listen | - | Listen link; spec: not in spec |

### konto/reisearten "Reisearten"

| proto row id | title | status | today (registry page/section/row) | backend field | note |
|---|---|---|---|---|---|
| d_flights | Flüge | SAME | domains/domains/d_flight | user_settings.enabledDomains |  |
| d_cruises | Kreuzfahrten | SAME | domains/domains/d_cruise | enabledDomains |  |
| d_hotels | Unterkünfte | SAME | domains/domains/d_lodging | enabledDomains |  |
| d_trains | Bahn | SAME | domains/domains/d_rail | enabledDomains |  |
| d_bus | Bus | SAME | domains/domains/d_bus | enabledDomains |  |
| d_ferry | Fähre | SAME | domains/domains/d_ferry | enabledDomains |  |
| d_rental | Mietwagen | SAME | domains/domains/d_rental | enabledDomains |  |
| d_places | Orte | SAME | domains/domains/d_poi | enabledDomains (poi) |  |
| d_tours | Touren (beta) | SAME | domains/domains/d_tour | enabledDomains (tour) | registry row carries beta=roadtrips; DOMAINS.tour behind DOMAIN_BETA_GATES |
| d_roadtrips | Roadtrips (beta) | SAME | - | enabledDomains (roadtrip) | No d_roadtrip registry row although DOMAIN_KEYS has roadtrip and ModuleSection iterates available domains; r_roadtrip reminder row exists |
| farbenreset | Farben zurücksetzen | CHANGED | domains/domains/farbenreset | device/webPrefs colour stores | level standard -> expert |
| country | Ein Land zählt ab | NEW-UI | domains/countryCounting/laender | user_settings.countryThreshold (nullable; tiers slept/visited/transited/connection) | Backend PATCH /settings accepts it (routes/settings/general.ts:246). Today's `laender` row draws only a read-only counts card (CountryCountingCard.tsx), no chooser. null = 'Wie der Server' |
| home | Heimatort | SAME | account/home/wohnort | user_settings.homePlace (+homePeriods) |  |
| homeair | Heimatflughäfen | SAME | flight/homeAirport/airports | homeAirportHistory/homePeriods | moves from Flüge page to Reisearten |
| heimatland | Heimatland | CHANGED | account/home/heimatland | user_settings.homeCountry | today a select; prototype shows derived from home place (derivation logic needed) [level S->E] |

### konto/reisen "Reisen & Vorschläge"

| proto row id | title | status | today (registry page/section/row) | backend field | note |
|---|---|---|---|---|---|
| autotrip | Reisen automatisch anlegen | SAME | trips/trips/autoreise | user_settings.autoCreateTrips | label 'Reisen beim Import bilden' -> 'Reisen automatisch anlegen' |
| tripsug | Reisen vorschlagen | SAME | trips/suggestions/rvor | tripSuggestionsEnabled |  |
| color | Farbe neuer Reisen | CHANGED | trips/trips/reisefarbe | tripDefaultColor | standard -> expert; prototype adds 'Automatisch' option (null today) |
| offenevor | Offene Vorschläge | NEW-UI | travtrack/ttDetect/posteingang | counts of open suggestions (existing inbox API) | today a link row on TravTrack page; prototype puts a count on Reisen page |
| ics | Kalender-Abo (beta) | SAME | trips/calendarFeed/ics | calendar_feeds | beta in prototype too |

### konto/fluege "Flüge" (when d_flights)

| proto row id | title | status | today (registry page/section/row) | backend field | note |
|---|---|---|---|---|---|
| live | Live-Updates | CHANGED | flight/autoupdate/autoupd | user_settings.autoUpdateEnabled (+autoUpdateCheckInterval=15, autoUpdateOnlyDuringFlight=true, no UI) | Spec A.2 wants window and interval fixed: the two columns already have no UI. Prototype greys the row out without a flight-data service (useServiceReadiness.ts exists) |
| approve | Änderungen erst bestätigen | SAME | flight/autoupdate/freigabe | autoUpdateRequireApproval |  |
| offen | Offene Änderungen | SAME | flight/autoupdate/offen | pending_flight_updates | link -> info row |
| expiry | Offene Änderungen verfallen nach | SAME | flight/autoupdate/verfall | autoUpdateExpiryHours | range 1-168 shown |
| costs | Steuern und Gebühren erfassen | SAME | flight/features/kosten | data.features.enableCostTracking | prototype label 'Steuern und Gebühren erfassen' (today 'Steuern und Gebühren'); spec text called it 'Kosten erfassen' |
| flugweg | Flugweg vom Telefon | SAME | flight/features/flugweg | user_settings.flightLiveTrackingEnabled (gate in routes/flights/track.ts:251) | FeaturesSection liveTracking switch = phone-track upload gate, NOT the live-update poll. Earlier inventory listed the column as 'no UI'; it has one |
| kennz | Kennzeichen der Maschine | CHANGED | flight/features/kennz | data.features.trackAircraftRegistration | standard -> expert |
| enrich | Ältere Flüge ergänzen | SAME | flight/enrichment/anr | historicalEnrichmentEnabled | expert both |
| enrichconf | Mindestübereinstimmung | SAME | flight/enrichment/anrkonf | historicalEnrichmentMinConfidence |  |
| enrichmax | Vorschläge pro Nacht | SAME | flight/enrichment/anrmax | historicalEnrichmentMaxPerDay |  |
| enrichcand | Passende Flüge | SAME | flight/enrichment/anrkand | enrichment candidates list |  |
| fklasse | Klasse | CHANGED | flight/defaults/fklasse | data.defaults.flight* | standard -> expert |
| fairline | Airline | CHANGED | flight/defaults/fairline | data flight defaults | standard -> expert |
| fanlass | Anlass | CHANGED | flight/defaults/fanlass | data flight defaults | standard -> expert |
| - | Status | DROPPED-HERE | flight/defaults/fstatus | - | Status default for new flights (data.defaults.flightStatus); spec: not in spec |

### konto/kreuzfahrten "Kreuzfahrten" (expert page) (when d_cruises)

| proto row id | title | status | today (registry page/section/row) | backend field | note |
|---|---|---|---|---|---|
| klinie | Reederei | CHANGED | cruise/cruisePreferences/klinie | data cruise preferences | standard -> expert |
| kkabine | Kabine | CHANGED | cruise/cruisePreferences/kkabine | data cruise preferences | standard -> expert |
| seetage | Seetage als Reisetage | CHANGED | cruise/counting/seetage | user_settings.cruiseCountSeaDays | standard -> expert |

### konto/treue "Treueprogramme"

| proto row id | title | status | today (registry page/section/row) | backend field | note |
|---|---|---|---|---|---|
| tr_flights | Airlines | SAME | loyalty/loyalty/tr_flight | loyalty_memberships domain=flight |  |
| tr_hotels | Hotels | SAME | loyalty/loyalty/tr_hotel | loyalty domain=lodging |  |
| tr_trains | Bahn | SAME | loyalty/loyalty/tr_rail | loyalty domain=rail |  |
| tr_cruises | Reedereien | SAME | loyalty/loyalty/tr_cruise | loyalty domain=cruise |  |

### konto/erinnerungen "Erinnerungen"

| proto row id | title | status | today (registry page/section/row) | backend field | note |
|---|---|---|---|---|---|
| remaddr | Erinnerungen an | CHANGED | notifications/channel/erimail | users.notificationEmail | same column as Profil e-mail; today an editable input, prototype shows derived '= Profil-E-Mail' |
| rchan | Kanal | CHANGED | notifications/channel/pushstate | reminder_preferences.channel (per domain: app/mail/both) | Prototype: ONE channel for all domains; backend stores channel per domain row |
| pushstate | Mitteilungen an die App | SAME | notifications/channel/pushstate | device_pushes + admin pushEnabled |  |
| rem_flights | Flug | CHANGED | notifications/domains/r_flight | reminder_preferences(domain=flight).enabled/leadHours | today: leadHours int[] (presets 24,2 + custom up to 168) and per-domain channel; prototype one select Aus/2h/24h/2 Tage |
| rem_cruises | Kreuzfahrt | CHANGED | notifications/domains/r_cruise | reminder_preferences(cruise) | as rem_flights |
| rem_hotels | Unterkunft | CHANGED | notifications/domains/r_lodging | reminder_preferences(lodging) | as rem_flights |
| rem_trains | Bahn | CHANGED | notifications/domains/r_rail | reminder_preferences(rail) | as rem_flights |
| rem_bus | Bus | CHANGED | notifications/domains/r_bus | reminder_preferences(bus) | as rem_flights |
| rem_ferry | Fähre | CHANGED | notifications/domains/r_ferry | reminder_preferences(ferry) | as rem_flights |
| rem_rental | Mietwagen | CHANGED | notifications/domains/r_rental | reminder_preferences(rental) | as rem_flights |
| rem_roadtrips | Roadtrip | CHANGED | notifications/domains/r_roadtrip | reminder_preferences(roadtrip) | as rem_flights |
| - | Orte | DROPPED-HERE | notifications/domains/r_poi | - | Orte reminder (reminder_preferences domain poi); spec: not in spec |

### konto/freunde "Freunde & Teilen"

| proto row id | title | status | today (registry page/section/row) | backend field | note |
|---|---|---|---|---|---|
| friends | Freunde | CHANGED | sharing/accounts/anfragen, sharing/accounts/verkn, sharing/servers/fcodes | remote_share_accounts, share_consents, comparison links, federation invite codes | prototype folds Reisen teilen / Person mit Konto verknüpfen / Einladungscode into one friend list; behaviour of the three flows unchanged underneath |
| personen | Mitreisende | SAME | sharing/companions/personen | companions |  |
| unused | Unbenutzte Personen löschen | SAME | - | POST /companions/delete-unused | backend + UI exist inside CompanionsSection, no registry row |
| linksoff | (callout) Öffentliche Links sind auf diesem Server aus. Der  | NEW-UI | sharing/shareLinks/linkserlaubt | admin.shareLinksEnabled | callout when admin switch off (today the admin switch sits on this account page, scope instance) |
| linkliste | Deine Links | SAME | sharing/shareLinks/linkliste | public_share_links |  |
| rangliste | Rangliste (beta) | SAME | sharing/compare/rangliste | leaderboard consents (beta comparison) |  |
| verschl | Verschlüsselt übergeben (beta) | SAME | sharing/compare/verschl | encrypted share (beta encryptedShare) |  |

### konto/telefone "Telefone"

| proto row id | title | status | today (registry page/section/row) | backend field | note |
|---|---|---|---|---|---|
| phones | Gekoppelte Telefone | SAME | account/devices/telefone | pairing_codes / paired devices | moves from Konto page to own page |
| pair | Telefon koppeln | SAME | - | POST /pairing/start | QR dialog lives in DevicesSection.tsx; no separate registry row (part of telefone) |
| pushstate2 | Mitteilungen | SAME | notifications/channel/pushstate | device_pushes |  |

### konto/daten "Daten"

| proto row id | title | status | today (registry page/section/row) | backend field | note |
|---|---|---|---|---|---|
| srvbackup | Letzte Sicherung des Servers | SAME | data/backup/srvbackup | backup status |  |
| webdaveigen | Eigene Kopie auf WebDAV | SAME | data/backup/webdaveigen | user_webdav_sync.enabled |  |
| webdavtakt | Wie oft | CHANGED | data/backup/webdavtakt | user_webdav_sync.schedule | standard -> expert |
| webdavvers | Versionen behalten | SAME | data/backup/webdavvers | user_webdav_sync.keepVersions | expert both |
| webdavlast | Letzte eigene Kopie | NEW-UI | - | user_webdav_sync.lastSuccessAt/lastStatus/lastSizeBytes | columns exist; no registry row (WebdavSyncRow may show them) |
| meine | Alle meine Daten | SAME | data/export/meine | export |  |
| excelexp | Excel-Tabelle | SAME | data/export/excelexp | xlsx export |  |
| gpxzip | Aufzeichnungen | SAME | data/export/gpxzip | track archive |  |
| listen | Listen importieren | SAME | data/import/listen | import |  |
| excelimp | Excel-Tabelle einlesen | SAME | data/import/excelimp | xlsx import |  |
| gpxin | Aufzeichnungen einlesen | SAME | data/import/gpxin | track import |  |
| implog | Bisherige Importe | SAME | data/import/implog | import_batches |  |
| ubahn | U-Bahn und Tram beim Bahn-Import | SAME | data/railImport/ubahn | user_settings.railImportLocalTransit |  |
| busleg | Busabschnitte beim Bahn-Import | SAME | data/railImport/busleg | user_settings.railImportBus |  |
| - | Jetzt hochladen | DROPPED-HERE | data/backup/webdavjetzt | - | 'Jetzt hochladen' own WebDAV copy; spec: not in spec |

### konto/ueber "Über TravStats"

| proto row id | title | status | today (registry page/section/row) | backend field | note |
|---|---|---|---|---|---|
| ver | Version | SAME | about/about/ver | APP_VERSION |  |
| build | Build | SAME | about/about/build | build id | expert both |
| changelog | Changelog | NEW-UI | - | link | no row today (AboutSection has links) |
| docs | Dokumentation | NEW-UI | - | link | no row today (AboutSection has links) |

### track/tt-aufz "Aufzeichnung & Orte" (when offer_tt)

| proto row id | title | status | today (registry page/section/row) | backend field | note |
|---|---|---|---|---|---|
| quelle | Standort kommt von | CHANGED | travtrack/ttRecording/quelle | user_settings.locationProvider (none/travtrack/dawarich) | same values; label order/wording only |
| aufz | Reisen aufzeichnen | SAME | travtrack/ttRecording/aufz | user_settings.tripRecordingEnabled |  |
| dawlink | Deine Dawarich-Verbindung | SAME | travtrack/ttRecording/dawlink, travtrack/ttSources/dawconn | user dawarichBaseUrl/ApiKey | today hidden while TravTrack is the source (2995084c9) |
| geraete | Geräte | SAME | travtrack/ttRecording/geraete | paired devices |  |
| orte | Feste Orte | SAME | travtrack/ttPlaces/orte | travtrack_fixed_places |  |
| unterkunft | Unterkunft während der Buchung | CHANGED | travtrack/ttPlaces/unterkunft | travtrack_place_settings | standard -> expert |
| zonen | Schutzzonen | SAME | travtrack/ttZones/zonen | travtrack_privacy_zones |  |
| (page stats) | Gespeichert / Zuletzt eingegangen | SAME | travtrack/ttRecording/ttsum | - | info line(s) |

### track/tt-erk "Erkennung & Vorschläge" (when offer_tt)

| proto row id | title | status | today (registry page/section/row) | backend field | note |
|---|---|---|---|---|---|
| staysug | Aufenthalte vorschlagen | CHANGED | trips/suggestions/avor | user_settings.staySuggestionsEnabled | moves from Reisen to TravTrack Erkennung |
| stopps | Stopps benennen | SAME | travtrack/ttDetect/stopps | travtrack_place_settings |  |
| scan | Automatisch suchen | SAME | travtrack/ttDetect/scan | dawarich_stay_scan.enabled |  |
| scaninfo | Letzter Suchlauf | NEW-UI | - | dawarich_stay_scan.finishedAt/result/createdCount | status columns exist |
| scanjetzt | Jetzt suchen | SAME | travtrack/ttDetect/scanjetzt | POST stay scan |  |
| photoev | Fotos als Beleg nutzen | SAME | trips/suggestions/immichbeleg | staySuggestionsImmichEvidence | moves from Reisen to TravTrack |
| staedte | Städte benennen | CHANGED | travtrack/ttDetect/staedte | travtrackCityLookup | standard -> expert |
| aiplace | Ortsart per KI erkennen | CHANGED | trips/suggestions/kiort | staySuggestionsLlmPlaceClassification | moves from Reisen to TravTrack; expert in prototype, standard today [level S->E] |
| scanzeit | Zeitraum für „Jetzt suchen“ | SAME | travtrack/ttDetect/scanzeit | stay-scan window (request param) | expert both |
| gelaende | Märkte, Parks und Museen mitsuchen | NEW-UI | - | dawarich_stay_scan.marketEnabled/venueEnabled (enableVenues API) | API dawarichStays.enableVenues exists; no registry row |

### track/tt-daten "Daten & Quellen" (when offer_tt)

| proto row id | title | status | today (registry page/section/row) | backend field | note |
|---|---|---|---|---|---|
| dawcopy | Aus Dawarich übernehmen | SAME | travtrack/ttSources/dawcopy | travtrack_dawarich_import |  |
| dawimp | Letzte Übernahme | NEW-UI | - | travtrack_dawarich_import status | status shown by TravTrackDawarichCopy, no row |
| gpxtrack | Dateien importieren | SAME | travtrack/ttSources/gpxtrack | travtrack_imports |  |
| ttimp | Bisherige Importe | NEW-UI | - | travtrack_imports list | list in TravTrackImports.tsx, no row |
| apps | Weitere Apps | SAME | travtrack/ttSources/apps | travtrack_ingest_tokens | expert both |
| ttexport | Verlauf exportieren | SAME | travtrack/ttExport/ttexport | export |  |
| ttdel | Zeitraum löschen | SAME | travtrack/ttDelete/ttdel | travtrack_deleted_ranges |  |
| diag | Diagnose | SAME | travtrack/ttDiag/diag | travtrack_diagnostic_* | expert both |

### track/tt-bereit "Bereitstellung" (server provisioning page)

| proto row id | title | status | today (registry page/section/row) | backend field | note |
|---|---|---|---|---|---|
| offer_tt | TravTrack anbieten | SAME | server/features/ttoffer | admin.travTrackConfig.enabled | moves to own admin page 'Bereitstellung' under TravTrack |
| tt_all | Gespeichert auf dem Server | NEW-UI | - | count of travtrack_points | stat line |

### plan/pl-plan "Reisen planen" (when offer_plan)

| proto row id | title | status | today (registry page/section/row) | backend field | note |
|---|---|---|---|---|---|
| travplan | Reisen planen | SAME | domains/planning/travplan | user_settings.travPlanEnabled | moves from Reisearten |
| planai | KI-Vorschläge in Plänen | NEW | - | none | no per-account AI-in-plans switch in backend |
| planwx | Wetter in Plänen | NEW | - | none | no per-account weather-in-plans switch in backend |
| planshare | Pläne mit Freunden teilen | NEW-UI | - | link | link row |
| (page stats) | KI-Anfragen heute / Wetter-Anfragen heute | NEW-UI | - | travel_plan_usage (exists) | info line(s) |

### plan/pl-bereit "Bereitstellung" (server provisioning page)

| proto row id | title | status | today (registry page/section/row) | backend field | note |
|---|---|---|---|---|---|
| offer_plan | Reisen planen anbieten | SAME | server/features/tpoffer | travel_plan_config.enabled |  |
| pl_ai | KI-Anfragen je Konto und Tag | CHANGED | server/features/tplimits | travel_plan_config.aiDailyLimit | today one row 'Planen: Anfragen pro Tag' (ServerOffers.tsx edits both limits); prototype splits ai / weather |
| pl_wx | Wetter-Anfragen je Konto und Tag | CHANGED | server/features/tplimits | travel_plan_config.weatherDailyLimit | see pl_ai |

### server/allgemein "Allgemein"

| proto row id | title | status | today (registry page/section/row) | backend field | note |
|---|---|---|---|---|---|
| instname | Servername | SAME | server/general/instname | admin.instanceName |  |
| puburl | Öffentliche Adresse | CHANGED | server/addresses/puburl | admin.frontendUrl | registry label 'Öffentliche Adresse' maps to frontendUrl, but the 'Adresse für Telefone' row maps to publicUrl; spec A.5 leaves the crossing open |
| puburlw | (callout) Fehlt noch. Bis dahin zeigen Einladungen, Mails un | NEW-UI | - | - | warn callout when empty |
| reg | Registrierung | CHANGED | users/access/registr | admin.allowRegistration | toggle -> segmented (Nur mit Einladung / Offen) |
| maxusers | Höchstzahl Konten | SAME | users/access/maxnutzer | admin.maxUsers | env MAX_USERS removed per spec |
| loginimg | Bilder der Anmeldeseite | CHANGED | server/general/loginbilder | login images upload | standard -> expert |

### server/nutzer "Nutzer"

| proto row id | title | status | today (registry page/section/row) | backend field | note |
|---|---|---|---|---|---|
| nutzerliste | Konten | SAME | users/accounts/nutzerliste | users, PATCH toggle-active, POST reset-password, POST disable-2fa, DELETE | all four actions exist in routes/admin/users.ts |
| einlliste | Einladungen | SAME | users/invitations/einlliste | invitations |  |

### server/funktionen "Funktionen"

| proto row id | title | status | today (registry page/section/row) | backend field | note |
|---|---|---|---|---|---|
| internet | Server darf externe Dienste abfragen | NEW | - | none (replaces openDataEnabled, operatorLogosOpenDataEnabled, fxCdnFallbackEnabled, railTransitousEnabled, railDbRestEnabled, updateCheckEnabled) | ONE new switch; six columns and their rows fold into it |
| links | Öffentliche Links erlauben | SAME | sharing/shareLinks/linkserlaubt | admin.shareLinksEnabled | moves from account Teilen page to admin Funktionen |
| fed | Mit anderen Servern verbinden | SAME | services/federation/fedon | admin.federationEnabled | from Dienste -> federation card |
| l_tt | TravTrack | NEW-UI | - | link |  |
| l_pl | TravPlan | NEW-UI | - | link |  |
| beta | Beta-Funktionen zeigen | CHANGED | server/features/beta | admin.betaFeaturesEnabled | standard -> expert |
| countrydef | Standard: wann zählt ein Land | CHANGED | server/features/laenderstd | admin.countryThreshold (default 'transited') | standard -> expert; prototype says server default 'Auch beim Umsteigen' (= connection), column default today is transited |
| importmodus | Großer Import | CHANGED | server/features/importmodus | admin.importModeUntil/importModeUserId | standard -> expert; select options 'Normal' / 'Grenzen für 24 h aufheben' |

### server/email "E-Mail"

| proto row id | title | status | today (registry page/section/row) | backend field | note |
|---|---|---|---|---|---|
| smtphost | Mailserver | SAME | services/smtp/smtphost | smtp_config.host | now on own page, not a card |
| smtpuser | Benutzer | SAME | services/smtp/smtpuser | smtp_config.username |  |
| smtppw | Passwort | SAME | services/smtp/smtppw | smtp_config.password |  |
| smtpfrom | Absenderadresse | SAME | services/smtp/smtpfrom | smtp_config.fromEmail |  |
| smtptest | Testmail senden | SAME | services/smtp/smtptest | POST smtp test |  |
| mailstat | Letzte Testmail | NEW-UI | - | external_service_tests (lastTest) for smtp, or none | SmtpConfig has no last-test column; the service-test model has lastTest per service; verify smtp uses it |
| smtpport | Port und Verschlüsselung | CHANGED | services/smtp/smtpport, services/smtp/smtptls | smtp_config.port + secure | two rows (port, TLS) -> one derived row 'erkannt'; detection logic does not exist |
| smtpname | Absendername | CHANGED | services/smtp/smtpname | smtp_config.fromName (default 'TravStats') | default becomes '= Servername'; derivation not in backend |
| smtpdel | Mailserver entfernen | CHANGED | services/smtp/smtpdel | delete smtp_config | [level S->E] |
| - | Mails verschicken | DROPPED-HERE | services/smtp/smtpon | - | Mails verschicken switch (smtp_config.enabled); spec: A.1 principle 3 (on when host entered) |

### server/buchungen "Buchungen lesen"

| proto row id | title | status | today (registry page/section/row) | backend field | note |
|---|---|---|---|---|---|
| builtin | Bekannte Vorlagen | SAME | server/parsers/builtin | parser templates count |  |
| ai | KI zum Lesen von Buchungen | SAME | server/parsers/kiaktiv | admin.llmEnabled |  |
| order | Reihenfolge | CHANGED | server/parsers/leserfolge | admin.parserOrder | standard -> expert |
| cloudorder | Reihenfolge der KI-Anbieter | CHANGED | server/parsers/cloudorder | admin.llmProviderOrder | standard -> expert |
| userkeys | Konten dürfen eigene Schlüssel nutzen | NEW-UI | - | admin.allowUserApiKeys + allowUserFlightApiKeys (two columns, no UI) | one switch must write both; routes/admin/parserSettings.ts + apiKeys.ts already accept them |

### server/sicherungen "Sicherungen"

| proto row id | title | status | today (registry page/section/row) | backend field | note |
|---|---|---|---|---|---|
| baknow | Automatisch | NEW-UI | - | admin backup config | summary line |
| backupnow | Jetzt sichern | SAME | backups/backups/bakjetzt | POST backup |  |
| bakliste | Vorhandene Sicherungen | SAME | backups/backups/bakliste | backups list + restore |  |
| bakwdload | Sicherungen von WebDAV holen | SAME | backups/backups/bakwdload | WebDAV restore |  |
| interval | Intervall | CHANGED | backups/automatic/baktakt | admin.backupInterval | standard -> expert |
| retention | Aufbewahren | CHANGED | backups/automatic/bakhalten | admin.backupRetentionDays | standard -> expert; known bug: routes/backup.ts + backupConfig.ts read env BACKUP_RETENTION_DAYS not this column (spec A.3) |
| cloudprune | Alte Sicherungen auch auf WebDAV löschen | CHANGED | backups/automatic/bakwddel | admin.backupCloudRetention | standard -> expert |
| zone | Zeitzone für 02:00 | CHANGED | backups/automatic/bakzone | admin.backupZone | select -> derived, expert |
| (page stats) | Letzte erfolgreiche Sicherung / Nächste / Aufbewahrt | NEW-UI | - | backup list | info line(s) |
| - | Automatisch sichern | DROPPED-HERE | backups/automatic/autobak | - | Automatisch sichern switch (backupEnabled); spec: A.2 (backups fixed on) |

### server/srvconn "Server-Verbindungen" (when fed)

| proto row id | title | status | today (registry page/section/row) | backend field | note |
|---|---|---|---|---|---|
| requests | Anfragen | SAME | services/federation/fedpeers | federation_admission_requests | today one list 'Vertraute Server'; prototype splits requests / connected |
| servers | Verbundene Server | SAME | services/federation/fedpeers | federation peers |  |
| fedorigin | Adresse dieses Servers | SAME | services/federation/fedorigin | admin.federationOrigin | input -> derived |
| fedkey | Server-Schlüssel | CHANGED | services/federation/fedkey | admin.federationPrivateKey | standard -> expert |

### server/datenschutz "Datenschutz"

| proto row id | title | status | today (registry page/section/row) | backend field | note |
|---|---|---|---|---|---|
| stats | Anonyme Nutzungsstatistik senden | SAME | services/usageStats/nutzstat | admin.usageStatsConsent |  |
| push | Benachrichtigungen aufs Telefon | SAME | services/push/pushon, services/push/pushconsent | admin.pushEnabled + pushConsentAt | consent status row folds into the switch |
| pushrelay | Push-Dienst-Adresse | CHANGED | services/push/pushrelay | admin.pushRelayUrl | expert both |
| pushreset | Push zurücksetzen | CHANGED | services/push/pushreset | admin.pushInstanceId/Secret/pausedUntil | standard -> expert |

### server/adressen "Adressen & Passkeys" (expert page)

| proto row id | title | status | today (registry page/section/row) | backend field | note |
|---|---|---|---|---|---|
| phoneurl | Adresse für Telefone | CHANGED | server/addresses/pairurl | admin.publicUrl | input -> derived '= Öffentliche Adresse'; moves to expert page; see puburl note |
| lanurl | Adresse im eigenen Netz | SAME | server/addresses/lanurl | admin.lanUrl | expert both |
| rpid | Passkey-Domain | CHANGED | server/passkeys/rpid | admin.webauthnRpId | input -> derived (falls back to publicUrl host already) |
| origins | Erlaubte Passkey-Adressen | SAME | server/passkeys/origins | admin.webauthnOrigins |  |

### server/eigene "Eigene Server" (expert page)

| proto row id | title | status | today (registry page/section/row) | backend field | note |
|---|---|---|---|---|---|
| geo | Eigener Geo-Server | SAME | services/geocoder/geoeigen | admin.ownGeoUrl | from Dienste -> geocoder card |
| photon | Photon | SAME | services/geocoder/photon | admin.photonUrl |  |
| nominatim | Nominatim | SAME | services/geocoder/nominatim | admin.nominatimUrl |  |
| routing | Routing | CHANGED | services/selfHostedRouting/osrm | admin.routingProvider + routingCustomUrl | today a URL input; prototype select Kein/OSRM/Valhalla (custom URL implied) |
| rail | OpenRailRouting | SAME | services/selfHostedRouting/orr | admin.railRoutingUrl |  |
| overpass | Overpass | SAME | services/openData/overpass | admin.marketOverpassUrl |  |
| tplrepo | Vorlagen-Quelle | SAME | services/updatesTemplates/tplrepo | admin.templateRepoBaseUrl |  |
| fx | Wechselkurs-Quelle | CHANGED | - | admin.fxPrimarySource/fxFallbackSource/*CustomUrl | today only fxCdnFallbackEnabled has a row; the primary/fallback selector exists as columns, catalogue-only |

### server/wartung "Wartung" (expert page)

| proto row id | title | status | today (registry page/section/row) | backend field | note |
|---|---|---|---|---|---|
| loglevel | Protokoll-Stufe | SAME | maintenance/logging/loglevel | admin.logLevel | standard-label; expert both; env LOG_LEVEL pins |
| debug24 | Ausführliches Protokoll für 24 h | NEW | maintenance/logging/debug | admin.logLevel via toggleDebugLogging (no timer) | today an on/off toggle; prototype a 24 h timer that switches back -> needs expiry state + job |
| logdays | Protokolle aufbewahren | SAME | maintenance/logging/logtage | admin.logRetentionDays |  |
| logfiles | Protokolldateien | SAME | maintenance/logging/logfiles | log viewer |  |
| logclean | Alte Protokolle löschen | SAME | maintenance/logging/logclean | POST logs clean |  |
| sysver | Version | SAME | maintenance/system/sysver | APP_VERSION |  |
| tzreport | Zeitmodell | SAME | maintenance/timeModel/tzreport | admin.timeModelBackfillAt |  |
| tzresolve | Zeitzonen neu bestimmen | SAME | maintenance/timeModel/tzresolve | POST tz resolve |  |
| fulljson | Alle Daten aller Konten | SAME | maintenance/system/fulljson | all-data export |  |
| enrich_air | Flughafen nachladen | SAME | maintenance/system/enrich | airport enrich |  |
| reseed | Kataloge neu einlesen | SAME | maintenance/system/reseed | seed |  |
| demodel | Demo-Konto löschen | SAME | maintenance/system/demodel | demo user |  |
| - | Anfragen mitschreiben | DROPPED-HERE | maintenance/logging/loghttp | - | Anfragen mitschreiben (logHttpRequests); spec: A.2 |
| - | Datenbank mitschreiben | DROPPED-HERE | maintenance/logging/logdb | - | Datenbank mitschreiben (logDatabaseQueries); spec: A.2 |
| - | Lesen mitschreiben | DROPPED-HERE | maintenance/logging/logparser | - | Lesen mitschreiben (logParserOperations); spec: A.2 |

### server/stamm "Stammdaten" (expert page)

| proto row id | title | status | today (registry page/section/row) | backend field | note |
|---|---|---|---|---|---|
| md0 | Fluggesellschaften | SAME | masterdata/catalogues/md_airlines |  |  |
| md1 | Flugzeugtypen | SAME | masterdata/catalogues/md_aircraft |  |  |
| md2 | Flughäfen | SAME | masterdata/catalogues/md_airports |  |  |
| md3 | Schiffe | SAME | masterdata/catalogues/md_ships |  |  |
| md4 | Häfen | SAME | masterdata/catalogues/md_ports |  |  |
| md5 | Hotelketten | SAME | masterdata/catalogues/md_chains |  |  |
### konto/dienstek and server/dienste: service cards (21 in the prototype, 31 catalogue cards today)

Today: `components/Services/serviceCards.ts` (31 cards, templates ownKey/mine/on/instKey/allowKeys/allowConn/test/quota/always/aiAllow/aiConsent/model), backend `services/externalServices/*` + `schemas/externalServices.ts`. Existing per card: `enabled` (admin switch), `allowAccountKeys`, `lastTest {at,ok,reason}`, `quota`, account `accountDisabled`, `effectiveSource`, AI per-account consent (`aiConsents`), admin `confirmDataSharing` (400 CONSENT_REQUIRED). Stored in `admin_settings.externalServicePolicy` / `user_settings.externalServicePrefs` + `global*` / user key columns.

| proto card | status | today card / registry rows | backend | note |
|---|---|---|---|---|
| airlabs | SAME | airlabs (ownKey/mine/on/instKey/test/quota) | admin.globalAirlabsApiKey, user.airlabsApiKey | own key and quota text exist |
| aviationstack | CHANGED | aviationstack; avbudget | globalAviationstackApiKey, aviationstackDailyBudget | budget row standard -> expert |
| aerodatabox | SAME | aerodatabox | globalAerodataboxApiKey, user key | |
| aeroapi | CHANGED | aeroapi; aerotarif, aerolimit, aerousage | globalAeroapiApiKey, aeroapiTier, aeroapiCustomBudgetUsd | tarif/limit -> expert; no account key in prototype or card (user.aeroapiApiKey column exists); `aerotracks` dropped |
| opensky | CHANGED | opensky; oskid, osksec, oskidI, osksecI | globalOpenskyClientId/Secret, user openskyClientId/Secret | legacy username/password rows (oskuser, oskpw, oskuserI, oskpwI) dropped; spec: only if OpenSky stops accepting them (verify) |
| adsbx | SAME | adsbx | globalAdsbxApiKey | |
| adsblol | CHANGED | adsblol (catalogue: keyless) | globalAdsblolApiKey + adsbLolEnabled | prototype: on when key entered, pause instead of switch (A.2) |
| aisstream | SAME | aisstream | globalAisstreamApiKey | |
| openai | CHANGED | openai (aiConsent/aiAllow/instKey/model/test) | llmOpenaiApiKey + globalOpenaiApiKey (two admin keys), llmOpenaiModel, llmOpenaiOptIn, user.openaiApiKey | A.3: one key per vendor. Prototype own-key field for accounts: column exists, card has no ownKey/mine -> NEW-UI. Notice 'Verstanden' replaces `confirmDataSharing` + admin opt-in; account opt-out = `aiConsents` |
| anthropic | CHANGED | anthropic | llmAnthropicApiKey + globalClaudeApiKey, llmAnthropicModel/OptIn, user.claudeApiKey | as openai |
| gemini | NEW | gemini | llmGoogleApiKey/Model/OptIn | prototype own-key: no user column, no resolver branch -> backend needed (plus the two-key merge) |
| ollama | SAME | ollama; ollurl, ollmodel, ollvision, ollremote | ollamaUrl/Model/VisionModel, llmOllamaOptIn | expert page of fields; `ollpull` (model pull) and `olltest` not in prototype (test = card test button) |
| custom | SAME | customLlm; custurl | openaiCompatBaseUrl/Model/ApiKey, llmCustomOptIn | |
| immich | SAME | immich; immurl, immkey, imminsturl, imminstkey | user.immichBaseUrl/ApiKey, global pair | `immnacht`, `immmode`, `immvisit` not in prototype |
| dawarich | SAME | dawarich; dawurl, dawkey, dawinsturl, dawinstkey | user/global Dawarich pair | `dawsweep` not in prototype; hidden while TravTrack is source (24356f81b) |
| strava | SAME | strava; stravaconn, stravaid, stravasec | stravaClientId/Secret, user strava tokens | |
| placesapi | NEW | googlePlaces (on/instKey/test, no own key) | globalGooglePlacesApiKey | prototype `own:1`: no user column or resolver for an own Google Places key |
| ors | SAME | openrouteservice (ownKey/mine) | globalOpenrouteserviceApiKey, user key | |
| graphhopper | SAME | graphhopper | globalGraphhopperApiKey, user key | |
| logos | CHANGED | logos (instKey) | globalLogostreamApiKey | `oplogos` (operator logos switch) goes under `internet`; `logorefresh` not in prototype |
| webdav | CHANGED | webdav; wdurl, wduser, wdpw, wdfolder, wdsrvurl, wdsrvuser, wdsrvpw, wdpath | admin webdavUrl/Username/PasswordEncrypted/BackupPath; user_webdav_sync | `wdsrv` (webdavSyncEnabled) dropped: on when URL entered |

Card behaviours the prototype adds over today's card (not counted above):

| behaviour | status | today / backend |
|---|---|---|
| 'Pausieren' switch, key kept | CHANGED | `enabled` per card exists (policy JSON); today `enabled` must be switched ON; prototype: on as soon as a key is saved, pause = enabled false. Needs auto-enable on first key |
| Status chip Nicht eingerichtet / Aktiv / Pausiert / Fehler: reason | NEW-UI | `configured`, `enabled`, `lastTest.reason` in `adminServiceViewSchema` |
| 'Verbindung testen' | SAME | `serviceTestResponseSchema`, ExternalServiceTest |
| Account: 'Server-Schlüssel wird genutzt' / 'Für mein Konto nicht nutzen' / own key | SAME | `effectiveSource`, `accountDisabled`, `ownKeys` |
| One-time notice 'Buchungstexte werden an X gesendet' stored as acknowledged | CHANGED | admin: `confirmDataSharing` request flag (not stored as acknowledgement); account: `ai_consents` per provider+destination |
| Quota text | SAME | `quota` kinds budget/monthly/daily/rateLimit |
| Today's 10 cards NOT in the prototype grid | - | railTimetables, geocoder, selfHostedRouting, openData, fx (-> `internet` + Eigene Server), smtp (E-Mail page), push, usageStats (Datenschutz), federation (Funktionen + Server-Verbindungen), updatesTemplates (`internet` + Eigene Server tplrepo), mailIntake (catalogue only) |

Dropped rows on these two pages (DROPPED-HERE), spec ref in section 2: oskuser, oskpw, immnacht, immmode, immvisit (account side); oskuserI, oskpwI, transitous, dbrest, bahnkontakt, oplogos, logorefresh, fxcdn, updcheck, wdsrv, aerotracks, ollpull, dawsweep, fedtrips, olltest (admin side).

## 2. Today's rows that appear nowhere in the prototype

Registry rows with no prototype row (31). "Spec" = covered by Part A of the 2026-11-08 spec.

| registry id | page/section | label | backend field | spec |
|---|---|---|---|---|
| karte | display/views | Kartendarstellung (link) | device mapAppearance, data.map.mapStyle/routeColor | not in spec |
| start | display/views | Startseite (link) | device / webPrefs | not in spec |
| listen | display/views | Listen (link) | device / webPrefs | not in spec |
| fstatus | flight/defaults | Status (default for new flights) | data.defaults.flightStatus | not in spec |
| webdavjetzt | data/backup | Jetzt hochladen (own WebDAV copy) | user_webdav_sync | not in spec |
| immnacht | services/immich | Fotos jede Nacht durchsehen | user.photoJourneyNightlyScan | not in spec |
| immmode | services/immich | Fotos an Reisen (link/import) | user.immichDefaultMode | not in spec |
| immvisit | services/immich | Besuchsfotos verknüpfen (action) | - | not in spec |
| dawsweep | services/dawarich | Ländertage jetzt zählen (action) | dawarich_sweep_state | not in spec |
| aerotracks | services/aeroapi | Echte Flugwege nach der Landung | admin.aeroapiTracksEnabled | not in spec |
| bahnkontakt | services/railTimetables | Kontakt für Anfragen | admin.railLookupContact | not in spec |
| logorefresh | services/logos | Logos neu laden | action | not in spec |
| ollpull | services/ollama | Modell auf den Server laden | action | not in spec |
| olltest | server/parsers | Ollama prüfen | action | covered by card test button |
| fedtrips | services/federation | Reisen mit anderen Servern teilen | admin.tripFederationEnabled (beta gate federatedTripSharing) | not in spec |
| r_poi | notifications/domains | Orte (reminder) | reminder_preferences(domain=poi) | not in spec |
| oskuser, oskpw | services/opensky | own legacy OpenSky login | user.openskyUsername/Password | A.3 (verify first) |
| oskuserI, oskpwI | services/opensky | server legacy OpenSky login | admin.globalOpenskyUsername/Password | A.3 |
| transitous, dbrest | services/railTimetables | rail timetable sources | admin.railTransitousEnabled, railDbRestEnabled | A.2 -> `internet` |
| oplogos | services/logos | operator logos | admin.operatorLogosOpenDataEnabled (+openDataEnabled) | A.2 -> `internet` |
| fxcdn | services/fx | FX CDN fallback | admin.fxCdnFallbackEnabled | A.2 -> `internet` |
| updcheck | services/updatesTemplates | update check | admin.updateCheckEnabled | A.2 -> `internet` |
| wdsrv | services/webdav | Server-Sicherungen hochladen | admin.webdavSyncEnabled | A.3/A.1 (on when URL entered) |
| smtpon | services/smtp | Mails verschicken | smtp_config.enabled | A.1 (on when host entered) |
| autobak | backups/automatic | Automatisch sichern | admin.backupEnabled | A.2 (fixed on) |
| loghttp, logdb, logparser | maintenance/logging | log switches | admin.logHttpRequests, logDatabaseQueries, logParserOperations | A.2 (fixed) |

Rows present only as part of another prototype row (not forgotten, but the registry row disappears): `anfragen`, `verkn`, `fcodes` (-> friends), `smtptls` (-> smtpport), `pushconsent` (-> push), `posteingang` (-> offenevor), `dawconn` (-> dawlink), `tplimits` (-> pl_ai + pl_wx, one registry row becomes two).

Stored with NO UI today and no prototype row (backend field only): `admin.maxLogFileSize`, `maxLogFiles` (A.2 fixed), `user.autoUpdateCheckInterval`, `autoUpdateOnlyDuringFlight` (A.2 fixed), `preferredVisionParser`, `preferredTextParser`, `visionFallbackChain`, `textFallbackChain`, `boardingPassParserStrategy` (A.3 remove), `data.map.zoomLevel/markerStyle`, `data.notifications.*`, `users.notifyBefore24h/2h` (A.3 remove), `admin.airportTimezoneDataset`, `data.display.timezoneFollowsDevice` (prototype `tz` could use it), `admin.fxPrimarySource/fxFallbackSource` (+CustomUrl; prototype `fx` select could use it), `user.lodgingRatingCategories` (see lodging below).

## 3. Per travel domain: every user-level setting today vs. prototype

Domains: DOMAIN_KEYS = flight, cruise, lodging, poi, roadtrip, rail, rental, bus, ferry, tour (`backend/src/shared/domains.ts`). LOYALTY_DOMAINS = flight, cruise, lodging, rail, rental. REMINDER_DOMAINS = flight, cruise, rail, bus, ferry, lodging, rental, roadtrip, poi (`services/reminders/prefs.ts:13`). Proto reminder list = flights, cruises, hotels, trains, bus, ferry, rental, roadtrips (no places).

| domain | today (backend or UI) | prototype place | MISSING |
|---|---|---|---|
| flight | enable (enabledDomains); home airports (dated); defaults status/class/airline/purpose; cost tracking; aircraft registration; phone track upload (flightLiveTrackingEnabled); live updates (autoUpdateEnabled), approval, expiry; enrichment on/conf/max/candidates; reminder; loyalty cards; keys AirLabs/Aviationstack/AeroDataBox/AeroAPI/OpenSky/ADS-B | reisearten d_flights; reisearten homeair; fluege fklasse/fairline/fanlass; costs; kennz; flugweg; live; approve; expiry; enrich*; erinnerungen rem_flights; treue tr_flights; dienstek cards | defaults `fstatus` (Status). `autoUpdateCheckInterval`/`autoUpdateOnlyDuringFlight` have no UI today and none in prototype (fixed per A.2) |
| cruise | enable; cruiseCountSeaDays; default line + cabin; reminder; loyalty; AISstream key; ships/ports catalogues | d_cruises; seetage; klinie/kkabine; rem_cruises; tr_cruises; aisstream; stamm md3/md4 | none |
| lodging | enable; reminder; loyalty; `lodgingRatingCategories` (10 built-in keys, default room/breakfast/service) + custom `LodgingRatingCategory` rows; stay suggestions (user avor); Immich evidence; hotel chains catalogue; baseCurrency (FX snapshot) | d_hotels; rem_hotels; tr_hotels; staysug; photoev; stamm md5; basecur | **rating categories** (stay-editor-only today: `RatingCategoriesManager`, routes/lodging/ratingCategories.ts; no registry row, no prototype row). No other lodging setting |
| poi / places | enable; reminder (backend + registry r_poi); Google Places key; fixed places, privacy zones, stay scan (markets/venues); Immich visit photos (immvisit); AI place type (kiort); Overpass URL | d_places; places key `placesapi`; tt-aufz orte/zonen; tt-erk scan/gelaende/aiplace; eigene overpass | **reminder for places** (r_poi). `immvisit`. Own Google Places key for accounts is NEW (no user column) |
| rail | enable; reminder; loyalty (BahnBonus); import options U-Bahn/tram + bus (railImportLocalTransit/railImportBus); timetable sources transitous/db-rest; contact string; OpenRailRouting URL; orphan component RailLocalTransitReroute (mounted nowhere) | d_trains; rem_trains; tr_trains; ubahn/busleg; rail; internet (sources) | `bahnkontakt` (railLookupContact). Reroute-local-transit action has no mount today and no prototype row |
| bus | enable; reminder; no other user setting | d_bus; rem_bus | none |
| ferry | enable; reminder | d_ferry; rem_ferry | none |
| rental | enable; reminder; loyalty domain exists in backend but NO editor today (LoyaltySection.tsx l.48-52, deliberate) | d_rental; rem_rental | loyalty for rental: missing in prototype, also not drawn today (backend only) |
| tour | enable (beta gate `roadtrips` via DOMAIN_BETA_GATES); GPX/track archive export+import; Strava; ORS/GraphHopper keys (routing) | d_tours (beta); daten gpxzip/gpxin (when tours or roadtrips on); dienstek strava/ors/graphhopper | no reminder row for tour (none in backend either) |
| roadtrip | enable (beta); reminder (r_roadtrip) | d_roadtrips (beta); rem_roadtrips | registry has no `d_roadtrip` row today (ModuleSection iterates domains, so the toggle is drawn) |
| cross-domain | countryThreshold; homePlace/homeCountry; TravTrack `track_gap_minutes` (user_settings.trackGapMinutes default 120, migration 20261109221237, GET/PUT /settings/track-gap, `TrackGapSetting` inside `LocationSourceSection`; not in registry) | country, home, heimatland; **track gap: no prototype row** | **track gap** (tt-aufz has no row for it) |

Reminder detail: backend stores per domain `enabled`, `leadHours[]` (presets 24, 2; custom up to 168), `channel` app|mail|both. Prototype: one global channel (`rchan`) and one lead select per domain (Aus / 2 h / 24 h / 2 Tage). The multi-lead and per-domain channel capability has no prototype control; `rchan` has no single backing field.

## 4. Size estimate

Pure regrouping/relabel/level change (frontend registry + page mounts only, no backend): konto/treue, telefone, ueber, kreuzfahrten, reisearten (except `d_roadtrips` registry row), freunde, fluege, daten, tt-aufz, tt-daten, tt-bereit, server/nutzer, srvconn, stamm, adressen, eigene (the routing select maps to existing routingProvider), sicherungen (levels only; plus env-vs-column retention bug fix), datenschutz, buchungen (+`userkeys` writes two existing columns), allgemein, email (UI-only except derived port/name), erinnerungen (UI collapse only if per-domain channel/leads are dropped; otherwise needs a rule).

Needs backend work (rows with status NEW, and CHANGED rows whose derivation/behaviour does not exist):
- `internet` master switch (folds 6 admin columns: openDataEnabled, operatorLogosOpenDataEnabled, fxCdnFallbackEnabled, railTransitousEnabled, railDbRestEnabled, updateCheckEnabled; readers of each must consult it).
- `findable`: setter endpoint for `users.federationFindable` (column read-only today).
- `cur` display currency vs `basecur`: second currency has no reader after the merge (`data.units.currency`).
- `planai`, `planwx`: per-account switches, no backend.
- `debug24`: 24 h timer for verbose logging (today an on/off toggle).
- Service model: auto-enable on first key / pause semantics; one AI key per vendor (merge global*/llm* columns); own key for Gemini and Google Places (no user column).
- Derived values with no derivation today: smtp port/TLS detection, smtp sender name = server name, home country from home place, federation origin = public address, phone address = public address (and the open frontendUrl/publicUrl crossing, spec A.5).
- Backup retention reads env instead of the admin column (spec A.3).
- Reminder address: prototype `remaddr` is derived "= Profil-E-Mail"; both rows already write `users.notificationEmail`, so only the empty-means-off rule changes.

By page (rows that need backend / total prototype rows): profil 1 (findable), anzeige 1 (cur), plan/pl-plan 2, server/funktionen 1 (internet), server/wartung 1 (debug24), dienste/dienstek 2 cards (gemini, placesapi) plus the pause/auto-enable behaviour. All other pages: 0.
