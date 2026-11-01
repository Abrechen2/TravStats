# TravStats settings — functional inventory (branch int/2.8.0-rc9)

Scope of this document: what can be changed, what it does, who may change it, how it saves, which failures must be visible. No current copy, layout or visuals.

## Conventions

- **Scope**: `account` = stored per user (server, follows the user); `instance` = one value for the whole server (admin only); `device` = browser/phone only, never leaves the device.
- **Level today**: `standard` / `expert` is the page/section/row level of the current settings area (the level itself is an account setting, see 1.x). "expert rows" = single rows hidden inside a standard section.
- **Saves**: `auto` = debounced autosave of the personal-settings document with one status line (idle / pending / saving / saved / failed with retry); `now` = each control writes at once; `button` = explicit Save; `job` = server background job the client polls.
- **Demo account**: the shared demo user may not change identity, security, notification, device, token, backup and connection settings. A designer must plan a "locked for demo" state for every group marked (D).
- **Beta gating**: instance switch "Show beta features" opens the registry: devicePairing, roadtrips, travPlan, cruiseTracks, flightTrackUpload, comparison, encryptedShare, calendarFeed, federatedTripSharing, travTrack. A section opened by a link stays reachable even when its gate is closed (only `devices`).
- Defaults marked `(c)` are client-side defaults (not a DB column).
- Standard failure for every `auto` row: the write fails, the control reverts to the last confirmed value, a persistent "not saved" state with retry stays until the next edit. Only exceptions are listed per row.

---

# PART A — The settings area

## A1. Account & security  (page "account"; demo-locked D)

| item | controls | value | default | scope | level | shown when | depends / conflicts | saves | failure states |
|---|---|---|---|---|---|---|---|---|---|
| Profile picture | the user's avatar | image upload, PNG/JPG, max 5 MB; removable | none | account | standard | not demo | shown in header | now (upload / remove) | wrong file type; too large; upload failed |
| First name | real name shown in header | text, max 100, clearable | empty | account (User column) | standard | not demo | none | button (Save profile) | save failed |
| Last name | same | text, max 100, clearable | empty | account | standard | not demo | none | button | save failed |
| Username | sign-in name | read-only | n/a | account | standard | always | cannot be renamed (no uniqueness/session design) | n/a | n/a |
| E-mail address (profile) | contact / password-reset address | e-mail | empty | account | standard | not demo | separate from the reminder address (A2) | button | invalid e-mail; save failed |
| Birthday | drives the "Birthday Flight" achievement | date, optional | empty | account | standard | not demo | none | button | save failed |
| Settings level | switches the whole area between Standard and Expert | standard / expert | existing accounts expert, new accounts standard | account | n/a (it IS the level) | always (also offered as "show in Expert" reveal on links and search) | decides which sections/rows exist | auto | standard |
| Password | change own password | old + new + confirm; new 8–100 chars | n/a | account | standard | not demo | admin can force change on next login | explicit (modal submit) | wrong old password; mismatch; too short |
| Two-factor authentication (TOTP) | second factor on top of password | on/off; QR + manual key; code to activate | off | account | standard | not demo | API tokens bypass 2FA (warning shown); passkeys satisfy 2FA by themselves; 2FA is asked before a forced password change | explicit (setup/disable flows) | setup could not start; wrong code; wrong password on disable/regenerate |
| Recovery codes | one-time backup codes | regenerate (needs password); shown once | generated at 2FA setup | account | standard | 2FA on | invalidates old set | explicit | wrong password |
| Passkeys | passwordless sign-in credentials | list; add (name) / rename-free remove | none | account | standard | not demo; usable only if admin set rpId + HTTPS origin | replaces password AND 2FA; bound to one rpId forever; needs secure context (UI must explain "unavailable" reasons: insecure origin, not configured) | explicit | creation failed; removal failed; insecure origin; not configured |
| Paired devices (Companion app) | list of phones bound to the account; pairing code / QR | sign out per device; mint code (expires, countdown) | none | account | standard | beta key devicePairing (or link); needs instance public URL | needs admin "Public URL (device pairing)"; unpaired device loses access at once | explicit | no public URL configured; load/start/unpair failed; code expired |
| API tokens | personal access tokens for scripts/agents | label (max 80) + scope read / write / admin (admin scope only for admins); revoke | none | account | **expert** | not demo | tokens bypass 2FA; separate from paired devices | explicit (create shows token ONCE) | label required; create/revoke failed; load failed |

Actions
- **Request/perform account deletion** — i18n copy exists (danger zone, "deletion pending") but no mounted control found; see "Not classified".
- **Create / revoke API token** — revoke is destructive (tool loses access immediately); no job.
- **Sign out device** — destructive for that phone; no job.
- **Disable 2FA / regenerate recovery codes** — need password; regenerate invalidates old codes.
- **Download my data** → see A11.

## A2. Notifications  (page "account", section "notifications"; D)

| item | controls | value | default | scope | level | shown when | depends / conflicts | saves | failure states |
|---|---|---|---|---|---|---|---|---|---|
| Reminder e-mail address | where mail reminders go | e-mail or empty (= none) | none | account | standard | not demo | mail channel unavailable without it (reason "no e-mail") | now (on leaving the field) | invalid address; not saved + retry per row |
| Reminders on/off per area | master switch per area | boolean per area: flight, cruise, rail, bus, ferry, lodging | derived from legacy 24 h / 2 h flags ("carried over") | account | standard | area row shown for each area; if the domain is switched off the row is disabled with a pointer to Domains | domain off ⇒ no reminders | now | row-level "not saved" + retry |
| Lead times per area | how long before | presets 24 h and 2 h as chips + at most ONE custom value, whole hours 1–168 | 24 h + 2 h | account | standard | row enabled | custom may not equal a preset | now | custom out of range; equals preset |
| Channel per area | where | app / mail / both | derived (mail and/or app) | account | standard | row enabled | mail blocked when no e-mail; app blocked when no push-registered device (push status is per CALLING device) | now | mail unavailable (no e-mail); app unavailable (push not enabled on instance or device not registered) |
| Load state | — | loading / loaded / failed | — | — | — | — | do not show "off" when load failed (would be saved over) | — | load failed + retry |

Actions: none (all switches). Writes are serialised (one PUT in flight, edits merge into a queued patch).

## A3. Appearance, language & units  (page "display"; sections display, units)

| item | controls | value | default | scope | level | shown when | depends / conflicts | saves | failure states |
|---|---|---|---|---|---|---|---|---|---|
| Language | UI language and date formats | de / en | detected from browser (c) | account | standard | not demo | also switches UI immediately | auto | standard |
| Time zone | profile zone for showing local times, daily buckets, TravTrack days | any IANA zone (~450, select) | detected (c) | account | standard | not demo | refused by server if zone unknown (ZONE_UNKNOWN); related flag `timezoneFollowsDevice` exists in schema (no editor found) | auto | unknown zone rejected |
| Date format | prose and forms (tables stay ISO) | DD.MM.YYYY / MM/DD/YYYY / YYYY-MM-DD | detected (c) | account | standard | not demo | none | auto | standard |
| Time format | departure/arrival/check-in times | 24 h / 12 h | 24 h (c) | account | standard | not demo | none | auto | standard |
| Distance unit | distances and statistics | kilometers / miles / nautical miles | kilometers (c) | account | standard | always | display-only | auto | standard |
| Weight unit | unit of a bare baggage allowance number | kg / lb | kg (c) | account | standard | always | nothing is converted | auto | standard |
| Base currency | the one currency everything is converted INTO (spend totals, lodging FX snapshots) | the ~30 ECB currencies | EUR | account (UserSettings.baseCurrency) | standard | always | conversions already recorded keep their value; ECB rates back to 1999; an older second currency `units.currency` still exists in the schema (flights) — the UI exposes only baseCurrency | auto | standard |
| Light/dark theme | colour scheme | light / dark | light (c) | account (settings doc) | — | **no editor found in Settings** | — | — | — |
| Map theme | map chrome style | glassmorphism / classic | glassmorphism | account via web prefs (section `theme`) | — | edited in the map panel (see Part B) | — | now | — |

Actions: none.

## A4. Domains  (page "display", sections "domains", "countryCounting")

| item | controls | value | default | scope | level | shown when | depends / conflicts | saves | failure states |
|---|---|---|---|---|---|---|---|---|---|
| Domain on/off | which travel types exist in navigation/dashboard/forms | per domain: flight, cruise, lodging, poi (places), roadtrip, rail, rental, bus, ferry | flight only | account (`enabledDomains`) | standard | domains behind a beta key (roadtrip) only when the key is open; unavailable domains listed as "coming soon" | off ⇒ reminders for it disabled, loyalty block hidden, settings page for it (flight, cruise) hidden, master-data pages hidden; shared code must iterate available domains | auto | standard |
| Domain colour | accent colour per domain | colour per domain; reset to brand colours | brand colours | account (web prefs `domainColors`) | standard | next to each domain row | very dark colours get a hairline outline note; does NOT affect map colours (map has its own modes) | auto/now | standard |
| TravPlan on/off | planning area | boolean | off (stays on for accounts that already had plans) | account (`travPlanEnabled`) | standard | beta key travPlan open AND instance switch on (admin, B3) | instance switch off ⇒ nothing works; plans are kept | auto | standard |
| Country counting threshold | evidence tier from which a country counts as visited | slept / visited / transited / connection, or "follow instance" (null) | follow instance (instance default "transited") | account | standard | always | the rule text is shown at expert level; no hours-based option by design | auto | standard |

Actions: reset colours (non-destructive).

## A5. Trips & inbox  (page "trips")

| item | controls | value | default | scope | level | shown when | depends / conflicts | saves | failure states |
|---|---|---|---|---|---|---|---|---|---|
| Create trips automatically on import | silent grouping of flights sharing a booking reference | boolean | on | account | standard | always | the explicit "detect trips" action is not gated by it | auto | standard |
| Default colour for new trips | starting colour of every new trip | colour or "Automatic" (rotating palette) | automatic | account | standard | always | applies to imports and suggestions too | auto | standard |
| Trip suggestions | inbox proposes new trips / assigns entries | boolean | on | account | standard | always | off ⇒ nothing computed; earlier decisions kept | auto | standard |
| Stay suggestions | inbox proposes stays from location history | boolean | on | account | standard | needs location source (Dawarich or TravTrack) | also paused while Places domain is off | auto | standard |
| Immich photos as place evidence | uses Immich photos near the stay | boolean | on | account | standard | stay suggestions on; Immich connected | disabled drawn when stays off | auto | standard |
| AI place-type classification | model guesses place type from nearby names (names only, no coordinates) | boolean | off | account | standard | stay suggestions on | needs the instance AI (a local Ollama first); depends on instance `llmEnabled` and consent | auto | standard |
| Calendar subscription link | secret .ics link for calendar apps | none / active; one link per account | none | account | standard | beta key calendarFeed | link visible ONLY at creation; older links cannot be shown again (still work); unreachable for Google Calendar unless instance has a public URL | explicit | not available on instance; create/regenerate/revoke failed; "public address missing" |
| Trip sharing — requests | ask another account on this server to share trips | username → request; consents list (outgoing/incoming) with status pending/agreed/declined/withdrawn | none | account | standard | not demo | withdrawing keeps already-shared trips as own copies, stops further changes | explicit | unknown user; request failed |
| Link companion to account | maps a typed companion to the account that agreed | per companion: account or unlink | not linked | account | standard | at least one agreed consent | needed before sharing with that person | explicit | link failed |
| Cross-server sharing — invitation codes | connect to companions on other TravStats servers | create code (single-use, expires), withdraw, redeem a code | none | account | standard | beta key federatedTripSharing AND instance trip federation on | needs admin federation + trusted peers | explicit | code invalid/expired; peer unreachable |

Actions
- **Create / regenerate / revoke calendar link** — revoke/regenerate are destructive for existing subscriptions.
- **Withdraw consent** — destructive for future sync (data kept).
- **Create/withdraw/redeem invitation code.**

## A6. Companions (people)  (page "companions")

| item | controls | value | default | scope | level | shown when | depends | saves | failure states |
|---|---|---|---|---|---|---|---|---|---|
| Companion list | every person typed into an entry, tidied by hand | rename, merge into another, delete (one or "delete all unused") | derived from entries | account | standard | always (not a domain) | merge changes every entry that used it; delete asks what happens to entries | explicit per action | name clash; delete blocked/used |

Actions: **Rename** (non-destructive); **Merge** (destructive, irreversible re-pointing); **Delete** / **Delete unused** (destructive). All synchronous.

## A7. Loyalty programmes  (page "loyalty")

| item | controls | value | default | scope | level | shown when | depends | saves | failure states |
|---|---|---|---|---|---|---|---|---|---|
| Programme cards, per domain | CRUD of cards: programme name, member number (masked), tier, notes | per domain: airline (airline codes, alliance picker, frequent-flyer suggestions from flights), cruise (cruise lines), rail (operators), lodging (chains + individual hotels; the 2.6 hotel editor) | none | account | standard | block per domain only while that domain is on (rail: while rail visible); rental excluded | card coverage derived; activity line (count, nights, last activity) is read-only | explicit per card | load failed (cards); cruise lines unavailable |

Actions: **Add / edit / delete card**; **Accept frequent-flyer suggestion**; **Link chains/hotels to a card**. Delete destructive for that card only.

## A8. Location: source, TravTrack, Dawarich, stay scan, trip recording  (page "location")

| item | controls | value | default | scope | level | shown when | depends / conflicts | saves | failure states |
|---|---|---|---|---|---|---|---|---|---|
| Location source | where positions are read from for country days, stays, routes, and what the Companion records for | none / TravTrack / Dawarich | none | account (`locationProvider` + revision) | standard | always | TravTrack requires beta key + instance switch; Dawarich requires an own connection; switching moves/deletes nothing | now | Dawarich chosen but connection missing/broken; TravTrack chosen but unavailable on server |
| "Use Dawarich as source?" hint | shortcut shown when Dawarich is connected and source is none | one-click | — | account | standard | Dawarich connected | duplicates the source choice | now | — |
| Dawarich connection | base URL + API key | text + secret | none (instance-wide connection may exist) | account (+ instance, see B) | standard | in External services (account) | account value overrides instance value; test | button (Save & test) | auth / unreachable / protocol / not found / invalid URL |
| TravTrack summary | what is stored | read-only: count, span, devices | — | account | standard | section shown only while the account holds data or the instance offers TravTrack | needs home confirmed to recognise trips (pointer to Home) | — | — |
| Privacy zones | no recording inside | name + centre (coordinates or maps link) + radius 50–5000 m; add / remove | none | account | standard | TravTrack section | adding deletes already stored points inside (confirm with count); removing does not restore | explicit | not saved; unreadable coordinates |
| City lookup in monthly values | names cities stayed ≥ 30 min | boolean | off | account (`travtrackCityLookup`) | standard | TravTrack section | sends rounded (~1 km) positions to the instance geocoder; turning off removes determined cities | now | not saved |
| Further sources (OwnTracks / Overland keys) | per-device key so those apps post positions | device label + app; create, revoke | none | account | standard | TravTrack section | these apps cannot know privacy zones (server discards) | explicit (key shown once) | create/revoke failed |
| GPX imports (history) | one-off file import into TravTrack | GPX file; delete an import | — | account | standard | TravTrack (now under the Track page; settings holds a pointer) | respects privacy zones/deleted spans; report counts | job | interrupted; invalid file |
| Copy Dawarich history | copy history into TravTrack | whole history (to yesterday) or span of days (UTC from/until); pause / resume | — | account | standard | TravTrack section | needs OWN Dawarich connection (shared one not allowed) | job | unreachable, interrupted (server restarted), incomplete list, paused |
| Delete a span | remove stored positions of days | from / to (profile clock) | — | account | standard | TravTrack section | the span STAYS deleted (offline phones cannot re-add) | explicit (confirm with count) | not deleted |
| Export history | download positions | from / to; GPX or JSON | — | account | standard | TravTrack section | privacy-zone content absent | explicit | file too large ⇒ "export the rest" parts |
| Diagnostics | why positions are missing | pick day + device; download/delete log | — | account | standard | TravTrack section | needs Companion diagnostics log switched on in the app | explicit | no log for that day |
| Trip recording | store positions sent by the Companion for trips | boolean | on | account | standard | always | off ⇒ server refuses new positions; stored ones stay until deleted; server must hold the data (server is the record) | auto | standard |
| Stay scan — detect stays automatically | 6-hourly scan for stays (and whole-venue areas: markets, malls, parks, zoos, museums) from location history | boolean | off until consented (state per account) | account | standard | needs Dawarich connection OR TravTrack; paused when stay suggestions off or Places domain off | one switch covers stays AND venue areas | now | no own Dawarich connection; no points returned; data over 24 h old; market data partial/stale/cancelled |
| Scan period | window for a manual scan | last N days (select) | 7 | per scan, not stored | standard | scan enabled | — | n/a | — |

Actions
- **Scan now** — job (polled), non-destructive; produces inbox suggestions.
- **Copy Dawarich history** — job, pausable/resumable.
- **Import GPX / Delete import** — import is job; delete is destructive (that import's positions).
- **Delete positions of a span; add privacy zone (deletes)** — destructive.
- **Create / revoke OwnTracks-Overland key.**
- **Download diagnostics log; Delete diagnostics log (all devices).**

## A9. Views & maps (page "views" — settings only point elsewhere)

All three sections are link cards; the real controls live in context (Part B3). Listed for navigation: Map appearance (route colours/palettes, show/hide route lines per area, layers & labels), Dashboard (which domains shown, map mode per domain), Lists (columns, sorting, page size).

| item | controls | value | default | scope | level | shown when | saves |
|---|---|---|---|---|---|---|---|
| Map appearance link | jumps to map panel | — | — | — | standard | always | — |
| Dashboard link | jumps to dashboard | — | — | — | standard | always | — |
| Lists link | jumps to flight list | — | — | — | standard | always | — |

## A10. Domain pages: Flights and Cruises  (pages "flight", "cruise"; only while that domain is on)

| item | controls | value | default | scope | level | shown when | depends / conflicts | saves | failure states |
|---|---|---|---|---|---|---|---|---|---|
| Home (residence + home airports, with periods) | where you live and which airports (1–3, one default); old periods kept | residence place + name; 1–3 airports; from / until dates; "I moved" creates a new period; confirm prompt for legacy accounts | none | account | standard | flight domain | distances measured from home; dates keep old trips on old home; also needed by TravTrack trip recognition | explicit (editor save) | place search failed/degraded; > 3 airports; delete period confirm |
| Home country | orders booking templates (home market first); never filters | ISO country or not set | not set | account | standard | profile page | none | auto | load / save failed |
| Home place | single home location (also used by Companion "time to leave") | place search | not set | account (`homePlace`) | standard | profile page | duplicates Home residence conceptually | auto | search failed; place service unreachable ("not no match") |
| Passport valid until | Companion warns 6 months ahead | date | not set | account (`passportExpiry`) | standard | profile page | none | auto | save failed |
| Flight defaults — status | pre-fill of new flights | scheduled / flown | scheduled | account | standard | flight | none | auto | standard |
| Flight defaults — seat class | pre-fill | none / economy / premium economy / business / first | none | account | standard | flight | none | auto | standard |
| Flight defaults — favourite airline | pre-fill | airline text | empty | account | standard | flight | none | auto | standard |
| Flight defaults — category | pre-fill | none / business / private / vacation | none | account | standard | flight | statistics only | auto | standard |
| Cost tracking | tax/fee fields and business cost statistics | boolean | (schema: off) | account | standard | flight | price/currency always available | auto | standard |
| Track tail numbers | persist aircraft registration + Mode-S from lookups | boolean | on | account | standard | flight | off ⇒ aggregates only | auto | standard |
| Live tracking | Companion records flight path and sends it here | boolean | on | account | standard | flight | off ⇒ server stops accepting flight paths | auto | standard |
| Seat statistics | show seats block in flight stats | boolean | on | account | standard | flight | data kept when hidden | auto | standard |
| Automatic updates | fetch live data while a flight is under way | boolean | off | account | standard | flight | feeds "Pending updates"; needs a flight data provider | auto | standard |
| Require approval for updates | pending updates applied only after approval | boolean | on | account | standard | auto-update on | — | auto | standard |
| Update expiry | how long pending updates stay | 1–168 h | 24 h | account | **expert row** | auto-update on | check interval and "only during flight" no longer have UI (API keeps them) | auto | standard |
| Historical enrichment | fill older flights from live-tracked flights with same number | boolean | off | account | **expert section** | flight | suggestions only (inbox proposal) | auto | standard |
| Enrichment min. confidence | threshold | 0–100 % | 60 | account | expert | enrichment on | — | auto | standard |
| Enrichment max per day | suggestions per night | 1–1000 | 50 | account | expert | enrichment on | — | auto | standard |
| Cruise — default line | prefill for manual cruises | text ≤ 200 | empty | account | standard | cruise | — | auto | standard |
| Cruise — default cabin category | prefill | none / inside / oceanview / balcony / suite | none | account | standard | cruise | — | auto | standard |
| Show cruise routes on map | bezier lines between ports | boolean | (schema: on) | account | standard | cruise | also relevant to map layers (duplicate, see B3) | auto | standard |
| Count sea days | sea days count towards cruise travel days | boolean | on | account | standard | cruise | off ⇒ travel days exclude sea days; sea-day number still shown | auto | standard |

Actions: **Enrich** (per candidate flight; creates an inbox proposal, flight changes only after apply); **View pending updates** (link).

## A11. Data: backup status, export, import  (page "data")

| item | controls | value | default | scope | level | shown when | depends / conflicts | saves | failure states |
|---|---|---|---|---|---|---|---|---|---|
| Instance backup status | last backup, running, size | read-only | — | instance (read) | standard | always | says "managed by administrator"; admin variant points to Admin | — | — |
| Backup extra row | one expert-only row inside the section | (expert) | — | — | expert row | expert | exact row not classified (WebDAV-related) | — | — |
| Download my data | personal JSON export (no passwords/tokens/keys; photos, documents not included) | file | — | account | standard | always | — | job-like (preparing …) | preparing failed |
| Excel export | editable spreadsheet, one sheet per area incl. bus; ID column | file | — | account | standard | per enabled domains | round-trips with Excel import | job-like (building) | build failed |
| Excel import | re-read an edited export, also into another account; preview before apply | mode: Add only / Merge / Replace contents; file | Merge | per run | standard | always | Replace deletes everything missing from file; shows count and requires an "I understand" confirm; a full backup is taken first; refuses while another backup runs | explicit (preview then apply) | unrecognised sheets; per-row errors (unknown values dropped/kept); backup running; outcome unknown after server loss |
| Recordings as GPX | ZIP of every tour/roadtrip recording | file | — | account | standard | tours/roadtrips visible | — | job-like | — |
| Read GPX / TCX / FIT / ZIP | import recordings; preview then apply | files, ZIP limits 500 files, 200 MB unpacked, 15 MB per recording | — | per run | standard | tours/roadtrips visible | a TravStats-made file returns to its tour | explicit | too large; invalid |
| WebDAV sync (own storage) | scheduled upload of own full export | on/off; URL (public https; LAN only for admins); user; password (stored, removable); folder; schedule daily/weekly; versions to keep 1–30 | off | account | standard (setup row expert-gated for the extras) | not demo; instance must not forbid WebDAV connections | duplicated in External services; test via "Sync now" | button (Save) | outcome unknown; partial (uploaded, old versions not deleted); auth/quota/unreachable |
| Import lists hub | entry to list imports (flights CSV/FR24/other apps, etc.) | file tiles + CSV mapping wizard + preview + commit | — | per run | standard | per area | duplicate detection flags; unresolvable rows | explicit | per-row warnings (duration mismatch, duplicate, unresolvable); complete/skip counts |
| Import log | revert a whole list import | per import: undo | — | account | standard | after imports | revertible only while entries still originate from the import; kept items reported | explicit | some entries kept (others reference them) |
| Rail import: U-Bahn/tram legs | what a bahn.de import preselects | skip / as rail journey | skip | account | standard | rail visible | can still be chosen per import | now | not saved |
| Rail import: bus legs | preselect for bus legs | skip / as bus ride | skip | account | standard | rail visible | bus domain | now | not saved |

Actions: **Download my data**, **Excel export**, **Excel import (apply)** — Replace is destructive; **GPX export/import**; **WebDAV Sync now** (job); **Undo import** (destructive); **Commit list import**.

## A12. Privacy, sharing & comparison  (page "privacy")

| item | controls | value | default | scope | level | shown when | depends / conflicts | saves | failure states |
|---|---|---|---|---|---|---|---|---|---|
| Public links list | links the user created for flight / trip / year in review | per link: kind, expiry, view count, revoke | none | account | standard | always | creation lives in context (Part B4); link URL shown only once | explicit (revoke) | list load failed; revoke failed |
| "Allow public links" | instance permission, mirrored read-only for users (switch for admins) | boolean | off | instance | standard | users read-only; admins see the switch | switching OFF revokes EVERY link of every user at once | now | save failed |
| Comparison consent | leaderboard consents per direction | link card into /compare | off | account | standard | beta key comparison | totals only, signed not E2E across servers | in context | — |
| Encrypted sharing grants | device-encrypted full-record transfer | link card into /encrypted-share | none | account | standard | beta key encryptedShare | must never share code with leaderboard | in context | — |

## A13. External services — account side  (page "services")

Source: backend catalogue `services/externalServices/catalogue.ts` (36 services). Account page has three blocks: My connections, Own keys, AI approvals; plus read-only "Provided by the instance".

| item | controls | value | default | scope | level | shown when | depends / conflicts | saves | failure states |
|---|---|---|---|---|---|---|---|---|---|
| Dawarich connection | base URL + API key | url + secret | none | account | standard | admin allows account connections for dawarich | overrides instance Dawarich; used by location source, stay scan, history copy | button (Save & test) | auth, unreachable, protocol, not found, invalid URL; "saved but unverified" |
| Immich connection | base URL + API key | url + secret | none | account | standard | admin allows own Immich | overrides instance Immich; no egress restriction (LAN by design) | button (Save & test) | same kind vocabulary (not configured, unreachable, auth, not found, protocol, invalid URL) |
| Nightly photo scan | scan Immich for trips/stays/visits not yet logged | boolean | off | account | standard | Immich connected | skipped when Immich silent; last result shown | now | Immich unreachable (skipped, reason) |
| Strava connection | OAuth connect/disconnect | connect / disconnect | disconnected | account | standard | admin allows strava AND instance Strava app set | admin must register the instance Strava app; data not given to AI | explicit | not set up on this instance; Strava unreachable |
| WebDAV own target | same as A11 WebDAV sync | — | — | account | standard | admin allows webdav | **second place for the same setting** | button | see A11 |
| Own API key per provider | account key overriding instance key (airlabs, aviationstack, aerodatabox, OpenSky client id/secret [+ username/password expert], openrouteservice, graphhopper) | secret per provider; "remove own key" | none | account | standard; OpenSky username/password expert | admin did not forbid own keys for that service | resolution order own > instance > ENV; secret stored encrypted, never shown again | button (Save & test) | auth rejected; rate limit; quota used; timeout; unreachable |
| Turn off a service for my account | account-level off switch per service | boolean per service | on | account (`externalServicePrefs.disabled`) | standard | every service the account could use | admin "switched off" wins | now | — |
| AI approval per provider | consent that import text may go to a cloud/remote AI provider | agree / withdraw per provider; consent is bound to the endpoint it was given for | not agreed | account | standard | admin allowed that AI provider | nothing is sent until the account agrees; sends text ≤ 12,000 chars, only when local parser finds nothing | explicit (dialog + checkbox) | consent void when destination changed |
| Provided by the instance | read-only list of instance services and status | — | — | — | standard | always | only admin changes | — | — |
| Search / category filter / "Info about X" | navigation within the page | categories: flight data, maps & routes, photos & location, AI, open data, sync & mail, instance | — | device | standard | always | — | — | — |

Actions: **Test** (per service; result remembered with time and reason), **Save & test**, **Connect/Disconnect** (Strava), **Remove own key**, **Agree/Withdraw AI approval**.

---

# PART B — Lives in context (outside the settings area)

## B1. Map panel (all map views)
Stored in web prefs sections (follow the account via `/settings/web-prefs`, last-write-wins per section, per-section bounds 16 KB / 64 KB total). **Device-only** keys stay local: panel expanded state, panel sections, lodging list open, dashboard legend open, last dashboard mode/projection, map camera, one-time notices.

| item | controls | value | default | scope | shown when | depends / notes |
|---|---|---|---|---|---|---|
| Base map style | map tile style | style id | dark | account (mapAppearance) | map | — |
| Flight route shape / width | arcs vs lines; thickness | arc / …; scale | arc, 1 | account | flights visible | — |
| Cruise route width, marker size, arrow scale | — | numbers | 1 | account | cruise | duplicates "show cruise routes" in A10 |
| Lodging / place / flight / cruise marker sizes | — | numbers | 1 | account | per domain | — |
| Airport colour, port colour, route colours (flight, cruise) | explicit colour modes (by status / frequency / single colour) | colour or null | null | account | per domain | layers AND legend must resolve through the colour-mode stores (never hardcoded) |
| Terrain, place labels, labels mode, place-label source | layers/labels | bool / important…/ list | off / on / important / list | account | map | — |
| Recorded flight paths | show recorded paths | boolean | off | account | flights | beta flightTrackUpload for the upload side |
| Show/hide route lines per area | leave out lines, keep markers | per domain | all shown | account | map | saved by the map panel |
| Globe auto-rotation, day/night shading | globe chrome | booleans | off/off | account (globeChrome) | globe mode | — |
| Map theme | glassmorphism / classic | — | glassmorphism | account (theme) | map | — |
| Track map (layers, route colour, opacity, pause split) | TravTrack map prefs | object | defaults | account (trackMap) | Track page | — |

## B2. Dashboard
| item | value | default | scope | notes |
|---|---|---|---|---|
| Visible domains (domain filter) | per domain hidden/shown | all | account (dashboardHiddenDomains) | "Only X" navigates to the single-domain tab; tab routes still resolve |
| Map mode per tab/domain | routes / heatmap / trips / globe and domain-specific modes | per tab | device (last mode in localStorage) with URL carrying tab+mode | single-domain tabs offer extra modes (stats-map, itinerary, port-frequency, nights, chains, markers, sea-routes) |
| Statistics compare year | compare toggle + year | off | account (statsCompare) | — |
| Hidden statistics blocks | per stats tab, list of hidden sections | none hidden | account (statsHiddenSections) | seat statistics also has a settings switch (A10) — duplicate |

## B3. Lists and tables
| item | value | default | scope |
|---|---|---|---|
| Hidden columns per table | list of column ids | none | account (tablePrefs) |
| Sort per table | column + asc/desc | table default | account (tablePrefs) |
| Page size | number (flight list is the entry point) | table default | account/device (not verified) |

## B4. Share links (per link, created from a flight / trip / year in review)
| item | controls | value | default | notes |
|---|---|---|---|---|
| Fields shown on the public page | checklist per kind | flight: owner first name, flight number, route, schedule, progress, aircraft, last position; trip: owner, name, dates, totals, countries, route, costs, companions, photos (≤ 12, GPS stripped), notes (only those marked shareable), itinerary; year: owner, totals, top airline, top route | per kind (preview shows exactly what a viewer sees) | requires instance switch (B-admin); empty selection blocked |
| Validity | until landing (+2 h) / 1 / 7 / 30 / 90 days | — | link URL shown once; revoke only afterwards |
| Photos omitted warnings | unsupported type (WebP), unreadable, over the 12 limit | read-only | — |
| Failure states | public links disabled by admin; status check failed; preview load failed; copy failed (select manually) |

## B5. Trip / entry level
| item | where | notes |
|---|---|---|
| Immich album link per trip: Link mode (zero bytes, proxy) vs Import mode (downloads originals) | trip album picker | account default mode `immichDefaultMode` (link) read in the picker; **the card that edited it in settings (`ImmichConnectionCard`) is not mounted** — the default mode and "Link visit photos with Immich" job are currently unreachable from Settings |
| Per-import choices (rail legs, bus legs, tram) | import wizard | pre-selected from A11 memory rows |
| Parse source consent | import | AI approval dialog (A13) appears when first needed |
| Trip colour, name, dates | trip editor | default colour in A5 |
| Pending updates approval | flight "Pending updates" | gate from A10 auto-update |
| Enrich proposals | inbox | A10 |
| Inbox suggestion accept/dismiss | inbox | gated by A5 |
| TravPlan per-trip planning | plan area | module switch A4 |
| Tour routing provider choice | tour editor | uses instance routing provider; account own keys in A13 |

## B6. Other clients
| item | where | notes |
|---|---|---|
| Companion app preferences (units, date/time formats …) | opaque JSON blob `app_prefs`, ≤ 32 KB, last-write-wins from the device clock; PAT and device identity never in it | edited in the app, restored on re-pair |
| Companion diagnostics log, location accuracy, "Always" permission | app | surfaced indirectly in TravTrack diagnostics |

---

# PART C — Administration  (admin only; "/admin", pages per menu group)

Menu: Manage (Instance, Users, Invitations) · Operations (External services, Import & parser, Email delivery, Backups, Time model, Logging, System) · Master data per domain (airlines, aircraft, airports | ships, ports | hotel chains). Master data, time model, logging, system, federation, push, template repo are **expert**. Master-data pages appear only while the domain is on.

## C1. Instance (page "instance")

| item | controls | value | default | scope | level | shown when | depends / conflicts | saves | failure states |
|---|---|---|---|---|---|---|---|---|---|
| Instance name | shown in UI, e-mails, backup metadata | text | empty | instance | standard | always | — | button | save failed |
| Public URL | base for invitation / reset links; empty = auto-detect | URL | empty | instance | standard | always | **also** set for pairing (next row); also needed for Google Calendar subscriptions | button | invalid URL |
| Public URL for device pairing | externally reachable address in the pairing QR | URL | empty (falls back to Public URL / request) | instance | standard | always | devices page warns when missing | button | invalid URL |
| Internal URL (LAN) | optional second address for devices on the same network | URL ≤ 500 | empty | instance | **expert row** | expert | secondary hint for app | button | — |
| Maximum users | hard cap on accounts | integer | 10 | instance | standard | always | system page warns at the limit | button | — |
| Allow public registration | sign-up without invitation | boolean | off | instance | standard | always | "not recommended"; conflicts with invitation-only workflow | button | — |
| Show beta features | opens the beta registry for everyone | boolean + read-only list of what it opens | off (on for RC/beta servers) | instance | standard | always | gates the 10 registry keys (list above) | button | — |
| Country counting default | instance starting point for "a country counts from …" | slept / visited / transited / connection | transited | instance | standard | always | accounts may override | button | — |
| Passkey domain (rpId) | WebAuthn relying party | bare domain; empty = derive from first origin | empty | instance | **expert row** | expert | **bound forever**: changing it invalidates every registered passkey; bare IP invalid | button | status shown: usable / not configured / insecure origin / invalid rpId |
| Allowed origins | list of origins the browser may be on | one per line with scheme and port; first authoritative | empty | instance | **expert row** | expert | several only if they share the rpId; plain http outside localhost is no secure context | button | same statuses |
| Sign-in page images | custom login background photos | upload many; remove all to return to shipped set | 5 shipped | instance | standard | always | public (visible before sign-in) | now | partial accept (rejected non-images listed) |
| About | version, build, links | read-only | — | — | standard | always | moved here from personal settings | — | — |
| TravTrack offered | server switch for TravTrack | boolean | off | instance | standard | beta key travTrack | accounts can then choose it as source | now | — |
| TravPlan offered | server switch | boolean | off (stays on for accounts with plans) | instance | standard | beta key travPlan | off keeps plans, hides area | now | — |
| TravPlan daily limits | AI requests / weather lookups per account per UTC day | numbers, max enforced | server defaults | instance | **expert** | TravPlan switch | requests, not cost | button (Save limits) | too high (max shown); load failed + retry |
| Public links permission | allow users to create public links | boolean | off | instance | standard | always | OFF deletes every existing link | now | save failed |
| Import mode | lifts upload/import rate limits for 24 h | off / on for all accounts / on for one account; start, end now | off | instance (time-boxed) | standard | always | cannot be left on: expires | now | unknown account (deleted) |
| Anonymous usage statistics | opt-in daily pseudonymous report | unset / granted / denied; install id (read-only); endpoint | unset | instance | standard | always | endpoint can be disabled by ENV (nothing sent) | now | — |
| Trip sharing across servers | allow trips to be shared with trusted servers | boolean | off | instance | **expert** | beta key + federation identity | requires federation on | now | — |

## C2. Users and invitations

| item | controls | value | default | scope | level | shown when | depends | saves | failure states |
|---|---|---|---|---|---|---|---|---|---|
| User list | username, role, 2FA on/off, flights, achievements, status | read-only list | — | instance | standard | admin | role is displayed but no role-change control found | — | load failed |
| Invitation list | status filter, email, creator, expiry, used-by | read-only + actions | — | instance | standard | admin | link works once, expires in 7 days | — | — |

Actions (users): **Deactivate / Activate** (deactivated cannot sign in; data kept); **Reset password** (generate temporary 12-char or set directly; optional "must change on next login"); **Reset two-factor** (the way back in when device lost); **Delete user** (destructive, all data). Synchronous.
Actions (invitations): **Create link** (single-use, validity choice); **Invite by e-mail** (needs SMTP); **Copy link**; **Resend / Send e-mail**; **Revoke**.

## C3. External services — admin side  (page "externalServices")

Per service row (36 catalogue entries; categories as in A13). Common controls:

| item | controls | value | default | scope | level | shown when | depends / conflicts | saves | failure states |
|---|---|---|---|---|---|---|---|---|---|
| Service on/off | policy switch; existing switch columns for services that had one (ADS-B Lol, rail timetables [Transitous + db-rest], open data, update check, per cloud AI opt-in) | boolean | on (policy absent = enabled); ADS-B Lol, open data off; Aeroapi tracks off | instance | standard | not for always-on services | off blocks ALL accounts even with own keys; nothing is requested, not even a test | now | — |
| Always-on services | geocoder, FX (exchange rates) | cannot be switched off | — | — | standard | — | core; the page says why | — | — |
| Allow account keys | whether accounts may bring own keys (per service) | boolean | on | instance (`accountKeysForbidden`) | standard | services of level instanceAndAccount | own key wins over instance key | now | — |
| What accounts may connect | per connection service: dawarich, immich, strava, webdav | allowed / forbidden + count of accounts connected | allowed | instance (`connectionsForbidden`) | standard | always | admin only decides allowance; each account sets credentials | now | — |
| Credential fields | per service key/secret/URL/number/switch fields | see list below | per service | instance | standard; marked fields expert | per service | secrets stored encrypted, shown masked, empty = keep | button (Save & test) | auth / rate limit / quota exhausted / timeout / unreachable / not configured / budget exhausted / disabled |
| Test | per service connection test, result remembered | — | never tested | instance | standard | tester exists | test needs saved config | now | reasons list above |
| Quota / budget display | observed quota for flight providers; AeroAPI monthly budget used/limit | read-only | — | instance | standard | provider with quota | stops before limit | — | — |
| Consent to enable a cloud AI provider | confirm what leaves (text of e-mails/PDFs ≤ 12,000 chars; when local parser finds nothing) | checkbox + confirm | not allowed | instance | standard | AI providers (OpenAI, Anthropic, Gemini, custom, remote Ollama) | each account additionally agrees; local Ollama needs no consent | explicit | — |

Service-specific fields (catalogue): AirLabs key; Aviationstack key + daily budget (0 disables; default 3); AeroDataBox key; AeroAPI key + plan tier (personal / personal_feeder / custom) + monthly USD limit (custom) + fetch real tracks after arrival (default off); OpenSky client id/secret [+ username/password expert]; ADS-B Lol enabled (default off; a saved key counts as enabled); ADS-B Exchange key; AISStream key; rail timetables: Transitous switch, db-rest switch (both on), lookup contact (expert); Google Places key (off until set); geocoder: Photon URL, Nominatim URL, own geo server URL (all expert); self-hosted routing: OSRM URL, OpenRailRouting URL (expert; both off when empty); OpenRouteService key, GraphHopper key; Immich instance connection (URL + key, specialised form); Dawarich instance connection (URL + key; has the sweep action; no admin row besides "what accounts may connect"); Strava app (client id + secret); Ollama (URL, model, vision model expert; remote opt-in); OpenAI / Anthropic / Gemini (key, model expert, opt-in); custom OpenAI-compatible (base URL expert incl. version path, model expert, key, opt-in); open data (switch; Overpass URL expert); logos (Logostream key; operator-logo lookup switch default on); FX (CDN fallback switch default on); WebDAV (backup sync switch, URL, user, password, backup path expert); SMTP (host, user, password, from email; port, TLS, from name expert); push (relay URL expert); federation (origin expert); usage stats (consent); updates & templates (update check on/off; template repo URL expert).

Actions
- **Test connection** (per service).
- **Sweep country days now** (Dawarich) — job, may take minutes; "already running" and "outcome unknown after restart" states.
- **Refresh airline logos** (also nightly) — job-like, shows refreshed/checked.
- **Re-seed catalogues** (airports background job with progress; airlines, aircraft synchronous) — see C7.

## C4. Import & parser  (page "parsers")

| item | controls | value | default | scope | level | shown when | depends / conflicts | saves | failure states |
|---|---|---|---|---|---|---|---|---|---|
| Who reads first | order of readers for ALL domains | templates first / AI first | templates first | instance | standard | always | measured: templates read 31/31 flight mails < 1 s | button | — |
| Use the AI model | master AI switch (parsing, CSV mapping suggestions, trip summaries) | boolean | on | instance | standard | always | off ⇒ no language model at all even if Ollama URL set | button | — |
| Ollama model / vision model | model names, pulled from the server | select / text | env default | instance | **expert rows** (2) | Ollama configured | address and remote consent live in External services | button | model not found; not reachable |
| Cloud provider priority | fallback order of cloud providers | reorder openai, anthropic, google, custom | openai,anthropic,google,custom | instance | standard | AI on | only providers with BOTH key AND consent are tried; Ollama always first | button | provider "key missing" / "ready" status |
| Template repository | where booking templates come from | raw-file root URL (https, or http for local hosts) | official repository | instance | **expert** | always | env var also exists; admin value wins | button | invalid URL |
| Update check | ask GitHub for new releases | boolean | on | instance | standard | in External services | — | now | — |
| Built-in readers (Tesseract OCR, regex templates) | informational | not switchable | — | — | standard | always | — | — | — |
| Boarding-pass parser strategy (per user) | `parser-only / parser-with-api / api-only` | enum | unset | account | — | **no UI found** | per-user parser endpoint answers 501 "not configurable" | — | — |

Actions: **Test Ollama connection**; **Download a model** to the Ollama server (job-like; progress/result); **Save**.

## C5. E-mail delivery  (page "smtp")

| item | controls | value | default | scope | level | shown when | depends | saves | failure states |
|---|---|---|---|---|---|---|---|---|---|
| Enable e-mail notifications | master switch | boolean | off | instance | standard | always | invitations by mail, reminders, password reset depend on it | button | — |
| Host / username / password / from address | SMTP credentials | text / secret | none | instance | standard | always | Gmail/Outlook need app passwords; From should match server domain | button | connection test failure |
| Port | — | number | 587 (hint) | instance | expert row | expert | 587 STARTTLS with Secure off; 465 with Secure on | button | — |
| Secure (TLS) | implicit TLS | boolean | off | instance | expert row | expert | — | button | — |
| From name | — | text | — | instance | expert row | expert | — | button | — |

Actions: **Test connection**; **Delete credentials** (destructive: instance sends no e-mail at all — no reminders, no invitations).

## C6. Backups  (page "backups", sections backups + WebDAV)

| item | controls | value | default | scope | level | shown when | depends | saves | failure states |
|---|---|---|---|---|---|---|---|---|---|
| Automatic backup | scheduled backup | boolean | off | instance | standard | always | overrides env vars | button | — |
| Interval | frequency (daily / on Sundays / 1st of month) | daily / weekly / monthly | weekly | instance | standard | auto on | runs at 02:00 in the zone below | button | — |
| Retention | days to keep | 1–365 | 30 | instance | standard | auto on | last full backup always retained; cleanup after a successful automatic backup | button | — |
| Time zone of backup hour | IANA zone | zone or host zone | host zone | instance | standard | auto on | upgrade keeps old hour | button | — |
| Also delete expired from WebDAV | cloud retention | boolean | off | instance | standard | WebDAV on | — | button | — |
| WebDAV off-site sync | upload each successful backup | boolean | off | instance | standard | always | duplicated in External services (WebDAV service) | button | auth / quota / timeout / unreachable / share error |
| WebDAV URL, user, password | connection | url / text / secret (AES-GCM) | none | instance | standard | sync on | save before test | button | test needs saved + enabled config |
| WebDAV backup path | subfolder | path | /TravStats/backups/ | instance | expert row | expert | — | button | — |

Actions
- **Create backup now** (job; polled; busy-state; failure codes: tool missing, disk full, permission denied, DB unreachable, tool version mismatch, interrupted).
- **Download / Upload (to WebDAV) / Delete backup** (delete asks whether to also delete the WebDAV copy; target-changed state).
- **Restore** — destructive; scope full / database only / files only; optional backup-before; requires typing a confirm word; refuses archives from a newer version; warns on encryption-key mismatch (credentials must be re-entered); reports incomplete archive / schema incomplete.
- **Load backups from WebDAV** into the list (after moving servers); checksum-unverified marker.
- **Test WebDAV connection**.

## C7. Logging, System, Time model, Master data

**Logging (expert)**
| item | value | default | notes |
|---|---|---|---|
| Debug mode | on/off (sets verbose) | off | performance warning |
| Log level | error/warn/info/debug/trace | info | may be pinned by LOG_LEVEL env: setting saved but ineffective; show effective level |
| Log retention | 1–90 days | 7 | auto-delete daily and at start |
| Log HTTP requests / DB queries / parser operations | booleans | off | written only at debug/trace |
| (columns without UI) max log file size, number of rotated files | MB / count | 10 / 7 | stored, no editor found |
Actions: log file list (download, delete, view), **cleanup old logs** (destructive), log viewer (file, level, category, text filter, paging).

**System (expert)**: read-only version and build (build may differ from displayed version), registration state, user-limit warning, demo-account warning. Actions: **Delete demo user** (destructive), **Download full backup (JSON)** (all user data), **Refresh airline logos**, **Re-seed catalogues** (airports job with status pending/running/completed/failed; airlines/aircraft synchronous; rate-limited to 3 per hour; "outcome unknown" state; existing entries stay, user-added entries untouched).

**Time model (expert)**: read-only migration report (pending / running / completed; converted / already / answered / open; flags counts; deliberately left alone). Actions: **Re-resolve time zones** (dry run job → table of changes → Apply, with "skipped because changed since dry run"); links to editor/inbox for open rows. Backfill marker undo scripts exist outside the UI.

**Master data (expert, per domain)**: airlines, aircraft types, airports (flight); ships, ports (cruise); hotel chains (lodging). Browse/search/page; **Add entry** (marks isUserAdded; seeds never overwrite user-added rows). Hotel chains additionally: edit, merge, delete (dialogs). No edit/delete found for the other five catalogues.

## C8. Server connections (federation), push, templates, usage stats  (instance page, expert unless noted)

| item | controls | value | default | scope | level | depends | saves | failure states |
|---|---|---|---|---|---|---|---|---|
| Connect to other servers | federation on/off | boolean | off | instance | expert | ENV `FEDERATION_*` overrides (then read-only note); beta gate for trip sharing | now | — |
| Public address of this server | origin | https origin, no port/path | empty | instance | expert row | needed before connection file download (save first) | button | — |
| Server key | Ed25519 identity | generate / rotate | none | instance | expert | rotating cuts existing connections until peers re-pin; fingerprint shown to hand over by second channel | explicit | — |
| Trusted servers | pin peers | address + public key + fingerprint (manual or from connection file) | none | instance | expert | importing a file pins nothing until "Pin"; replaces an existing key with warning | explicit | not verified yet; needs update |
| Share trips with other servers | trip federation | boolean | off | instance | expert | beta + identity | now | — |
| Push to Companion | relay on/off with consent record | boolean | off | instance | expert | off ⇒ server never contacts relay | now | paused until (relay daily limit) |
| Relay address | custom relay | https (or http://localhost) | https://push.travstats.de | instance | expert | different address ⇒ registers anew | button | invalid address |
Actions: **Pin / verify / suspend / remove peer**; **Download connection file**, **Import connection file**; **Generate / rotate key** (destructive for connections); **Reset push registration**.

---

# PART D — Same thing editable in two places

1. **WebDAV** — personal (A11 "WebDAV sync" and A13 own connection) and instance backup sync (C6 and C3 WebDAV service row).
2. **Instance public URL** — "Public URL" and "Public URL (device pairing)" in C1; both feed different links (invitations vs QR); `lan_url` third.
3. **Dawarich connection** — account (A13) and instance (C3); stay scan/copy/location source need the OWN one.
4. **Immich connection** — account (A13) and instance (C3); plus default mode in the trip album picker.
5. **Own API keys** — account (A13) vs instance (C3) per provider; admin "allow account keys" toggles the first.
6. **Ollama / AI** — address and consent in External services, model and test in Import & parser, master AI switch + order in Import & parser.
7. **Public links** — instance switch (C1) vs mirrored switch for admins in A12 vs creation per link in context (B4).
8. **Home** — Home place and Home airport/residence (A10); Home country (A10).
9. **Cruise route display** — Settings "show cruise routes" (A10) vs map panel (B1).
10. **Seat statistics** — settings switch (A10) vs hidden stats blocks (B2).
11. **Live tracking / trip recording** — user switches (A8/A10) mirrored by Companion capture; both server-side acceptance gates.
12. **Beta features** — instance switch (C1) controls visibility of several user sections (A1 devices, A5 calendar/cross-server, A8 TravTrack, A12 comparison/encrypted).
13. **Country counting** — instance default (C1) vs account override (A4).
14. **Backups** — status in A11 read-only vs management in C6; WebDAV copy from both.
15. **Rail import memory** — settings rows (A11) vs per-import choice in the wizard (B5).
16. **Geocoder / OSRM / OpenRailRouting / Overpass URLs** — formerly separate cards, now expert rows of External services (C3).
17. **Dashboard domain filter / domain on-off** — A4 turns a domain on, B2 hides it on the dashboard only.

---

# PART E — Not classified / unclear

- Theme light/dark (`display.theme`): stored, no editor found.
- `display.timezoneFollowsDevice`: in the schema, no control found.
- Account deletion: copy exists, no mounted control found.
- `boardingPassParserStrategy`: API-only, no UI; per-user parser endpoint returns 501.
- `units.currency` (flights): schema field superseded by base currency; no editor.
- Components present but not mounted: `ImmichConnectionCard` (default Immich mode + "link visit photos" job), `ApiKeysSection` + `BulkRefreshCard` (bulk refresh of flights from provider), `RoutingProviderSection`, `GeocoderSettingsCard`, `OperatorLogosCard`, `RailProvidersCard`, `AeroapiBudgetCard` (budget now shown as a status line). Their functions now live in External services or are unreachable; the designer should decide whether the two unreachable functions (visit-photo Immich link, bulk provider refresh) return.
- Logging max file size / rotated file count: stored, no editor.
- Role change for users: description says "change roles", but no control found.
- Which exact row is the expert row in the user Backup section (and where the Rail providers expert row renders) — not determined.
- Page size of lists: persistence scope not verified.
- Defaults for cost tracking and cruise arcs: from schema/stores, not verified against the runtime default.
