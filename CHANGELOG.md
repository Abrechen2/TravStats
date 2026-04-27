# Changelog

All notable changes to TravStats are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)

## [1.2.0] - 2026-04-27

### Fixed
- **Reminder emails for manually-entered flights fired 1–2 h off** — Manual entries, parser results, and CSV imports stored departure/arrival times as wall-clock-as-fake-UTC, while API-imported flights stored real UTC. The reminder scheduler compared `now` (real UTC) to a mixed-convention `departureTime` column, so the 24-hour-before email triggered an hour early in CET, two hours early in CEST, etc. All flight create/update paths now write canonical real UTC built from a `(local datetime, IANA timezone)` pair, and the scheduler normalises legacy rows on the fly via the airport timezone before the ±15-minute window check.
- **Schema drift between `prisma/schema.prisma` and prod migrations reconciled** — The drift file now uses idempotent `IF EXISTS` drops, backfills NULLs before flipping NOT NULL, and guards every foreign-key add. Previously a fresh deploy could fail mid-migration on rows with NULL `has_live_tracking` or `historical_enrichment_*` flags.

### Changed
- **Flight write contract is now `(local, timezone)` pairs** — `POST /flights`, `PUT /flights/:id`, and `POST /flights/batch` no longer accept ISO datetime strings. Clients send `departureLocal` (`YYYY-MM-DDTHH:mm`) plus `depTimezone` (IANA, e.g. `Europe/Berlin`); the server runs `fromZonedTime` to derive the canonical real-UTC `Date` it stores. The update endpoint also rejects raw `departureTime` / `arrivalTime` fields. Frontend submit, edit, review, duplicate, and CSV import flows were updated end-to-end.
- **Time-semantics tagging during the cutover** — Every new write is tagged `dep_time_semantics = 'UTC'`. Existing rows default to `'UNKNOWN'` and are left unchanged by the normaliser until the backfill script reclassifies them as `'UTC'` (API-sourced) or `'LEGACY_FAKE_UTC'` (manual/parser-sourced, converted in place). `tzAwareDurationMinutes` short-circuits when both sides are UTC and only re-interprets when both are explicitly LEGACY.

### Added
- **In-app update banner** — A pulsing yellow `Update` badge appears next to the wordmark in the header whenever a newer stable GitHub release exists. Click it to open a popover with the version number, release date, a 600-character preview of the release notes, a link to the full notes on GitHub, and an `Ignore this version` action that hides the badge until an even newer release ships. Backend caches the GitHub query in process memory for 6 hours, filters out RC and pre-releases, and degrades to "no banner" when the GitHub call fails — so air-gapped or firewalled instances stay quiet rather than throwing errors.

### Removed
- **Floating `?` help icon on the dashboard** — Removed the corner help button and its three orphaned i18n keys (`dashboard:map.help2d/help3d/helpExpanded`). It only said "Switch between 2D and 3D" — information that's already visible from the mode selector.

### Database
- **`flights.dep_time_semantics` / `arr_time_semantics`** — Two new `TEXT NOT NULL DEFAULT 'UNKNOWN'` columns tag the storage convention of each row during the cutover. Migration is additive and idempotent (`IF NOT EXISTS`); zero-downtime safe.

### Migration
- **Backfill runs automatically at container boot** — `docker-entrypoint.sh` invokes `dist/scripts/backfillTimeSemantics.js --apply` once migrations succeed, so existing self-hosted instances pick up the fix on the first start of `1.2.0` without any manual SSH step. The script is idempotent (`WHERE dep_time_semantics='UNKNOWN' OR arr_time_semantics='UNKNOWN'`), so subsequent boots return zero rows and finish in milliseconds. Disable with `TIMESEMANTICS_AUTO_BACKFILL=false` if you prefer to run it by hand. Manual invocation remains available: `node /app/backend/dist/scripts/backfillTimeSemantics.js [--apply]` (defaults to dry-run). On the dev DB the backfill classified 160 flights (37 UTC, 123 LEGACY converted, 0 errors); production numbers will differ per install.

### Tests
- **+37 tests covering the new contract** — 11 covering `legacyFakeUtcToRealUtc`, `normalizeFlightTimeUtc`, and semantics-aware `tzAwareDurationMinutes` (CEST / CET / JST / LAX→JFK transcontinental). 9 covering the new Zod schema (paired contract, half-pair rejection, IANA validation, malformed local, legacy-field rejection, historical exemption, partial updates). 8 reminder-scheduler and flights-route integration updates. 9 covering the update-banner semver comparator (rc/beta stripping, edge cases, malformed inputs).

### Docs
- **Workflow revised** — Branching strategy in `CLAUDE.md` is now scoped to change size (direct `main` / `fix/*` / `feat/*` / `dev/*`); long-running dev branches must merge `main → dev` early and often, never the reverse, and never touch `VERSION` or `CHANGELOG.md` (both owned by `/deploy` on `main`).

## [1.1.0] - 2026-04-18

### Added
- **Birthday Flight achievement** — New `BIRTHDAY_FLIGHT` achievement counts flown flights that depart on the user's birthday (month + day, year irrelevant). Profile settings now include an optional birthdate field used by the check.
- **Kurios calendar easter eggs** — Six hidden achievements tied to aviation and calendar observances: ICAO Day (7 Dec), Wright Day (19 Aug), May the Fourth (4 May), Pi Day (14 Mar), Pi Precision (3 141 km ± 5 % on Pi Day) and Halloween (31 Oct).
- **Branded GlobeLoader** — Monochrome spinning-globe loader replaces the generic spinner at every large-area loading surface (maps, stats, flight pages, admin). Paints in < 16 ms so users see feedback before deck.gl / three.js finish booting, holds for ≥ 2 s to avoid flashing, and keeps spinning regardless of `prefers-reduced-motion`. Reads live CSS tokens so it reacts to dark-mode toggles without remount.
- **New logo system (v1.0)** — Luggage-tag mark with `TS` monogram and a cross-dot `TRAV✛STATS` wordmark ship as `LogoMark`, `LogoMarkFilled`, `LogoWordmark` and `LogoLockup` components. Visible in the nav header (desktop + mobile), all four auth screens and the favicon (SVG with dark background + PNG fallback). The README and Unraid forum / release docs point at `docs/images/logo.svg`.
- **App version vs build version split** — Runtime now exposes the deployed app version (from `backend/VERSION`) and the Docker image build version as distinct fields, so About can show `1.1.0 (built from 1.1.0-rc.3)` during the RC cycle.

### Changed
- **Achievements modules split** — `backend/src/utils/achievements.ts` (1 073 lines) reorganised into three files (orchestrator + stats + checks); `backend/src/data/achievements.ts` (1 306 lines) split into two seed parts plus a thin composition layer. Public API unchanged. Every file now respects the 800-line cap.
- **Achievement stats are immutable** — `checkAndUpdateAchievements` builds a fresh `augmentedStats` via spread rather than mutating the object returned from `calculateUserStats`; `Set`s are cloned, never mutated in place.

### Fixed
- **GlobeLoader no longer freezes for reduced-motion users** — The loader is feedback, not decoration; it now always animates.
- **Favicon visible on light browser chrome** — The new SVG favicon shipped transparent, which made the amber strokes disappear on Safari / iOS tab bars. A dark background is now baked into the SVG.
- **`LogoMarkFilled` survives theme switches** — Inverse colour used to be hardcoded `#0b0d10`; now reads `var(--bg-base)` so the mark stays legible in light mode.
- **Screen-reader announcements for the header logo and mobile drawer** — Home link now announces as "TravStats — Home" once, not the visible text three times. Mobile drawer Donate / Star links carry the `aria-label` attributes their desktop twins already had.
- **`GlobeLoader` canvas no longer churns on parent rerenders** — Derived `buffer` dimension is memoised so the effect dep array is stable.

### Database
- **`users.birthdate`** — New nullable `TIMESTAMP` column backing the Birthday Flight achievement. Additive only; no data transform; safe to deploy with zero downtime.

### Tests
- **Brand/Logo component suite** — 9 new Vitest tests cover the four logo components (a11y attributes, theme-token defaults, layout modes). Total frontend coverage is now 257 tests across 54 files.

## [1.0.1] - 2026-04-17

### Security
- **Base images refreshed and patched** — Builders moved from `node:20-alpine` to `node:22-alpine`; production stage moved from `node:20-slim` to `node:22-bookworm-slim`. The production image now also runs `apt-get upgrade` at build time so every rebuild pulls the latest Debian security feed on top of the base layer. Closes the Critical CVE-2026-6100 and eleven High-severity npm CVEs (tar, minimatch, cross-spawn) that Docker Scout reported against `v1.0.0`. Drop-in replacement — no schema, config, or runtime behaviour changes.
- **CI aligned with runtime** — GitHub Actions now runs backend and frontend checks on Node 22 to match the container image.

## [1.0.0] - 2026-04-16

First stable release. TravStats exits its public beta period after roughly
six months of daily use and a 22-finding black-box pentest (all findings
mitigated). The surface below is what ships out of the box.

### Core tracking
- Manual flight entry with categories, tags, up to 50 travel companions, costs and currency
- Five flight states — `flown`, `scheduled`, `cancelled`, `historical`, `duplicated` — each with dedicated forms and validation
- Timezone-aware durations via `date-fns-tz`
- Duplicate detection (same `flightNumber` × day) with a confirmed "save anyway" escape hatch and a dedicated `duplicated` status that skips time validation

### Boarding-pass scanner
- QR code, PDF417 barcode and OCR fallback (Tesseract) with automatic airport/airline resolution
- Camera capture and image upload, desktop + mobile

### Email and PDF import
- Template-based parsing with annotation-driven template builder for new airlines
- Optional local LLM parsing via Ollama (default model `gemma3:12b`, benchmarked 100% accuracy on the TravStats test corpus)
- Support for plain text, HTML email, Outlook `.msg` and `.eml`
- Parser rate metrics per template and per LLM model in the admin UI

### Automatic flight-data lookup
- AirLabs as primary source, OpenSky OAuth and Aviationstack as fallbacks
- Live gate, terminal, actual-departure, actual-arrival tracking while a flight is in progress
- Pending-update inbox with per-flight statistics-impact preview; approve, edit, reject
- Historical enrichment scheduler backfills gate/terminal/aircraft data for past flights
- Configurable per-user: approval gate on/off, check interval, only-during-flight window

### Maps and visualisation
- Six visualisation modes: Routes (ArcLayer), Heatmap, Hexagon (3D), 3D Columns, animated Trips, 3D Globe
- Deck.gl 9.x + MapLibre GL 5.x using `MapboxOverlay` for a shared WebGL context
- Two-stage route/trip popup → sidebar detail view
- Scheduled flights rendered as cyan arcs and excluded from stats until flown

### Statistics
- Year-over-year comparison, year-filter and all-time totals clearly separated
- Seat distribution (window/middle/aisle/zone/class), distance, flight time, costs, top routes, top airlines
- PDF year report with year auto-selected to the most recent flown year
- Downloadable vintage-passport PNG certificate: hero-km number, equivalences ("N × around the Earth"), deterministic serial, layered radial gradients compatible with `html2canvas`

### Gamification
- 58 Battlefield-style achievements across 5 categories (Sammler, Distanz, Elite, Entdecker, Survivor) + Planner and Special tiers
- Automatic unlock on milestone reach, readable locked cards on the achievement page

### Admin and operations
- Invite-only user management with per-invitation tokens (can't be reused)
- Admin-triggered user deletion with cascade (self-delete and last-admin delete blocked)
- SMTP configuration with test-connection
- Encrypted API-key storage (AirLabs, Aviationstack, OpenSky, SMTP password)
- Automated database backups with retention (`daily`/`weekly`/`monthly`) + optional WebDAV sync (Nextcloud, HiDrive, …)
- Backup restore via `pg_dump` with argument-array `spawn()` (no shell injection)
- Parse-log statistics dashboard (template hit rate, LLM hit rate per model)

### Bug reporting
- "Bug" button in the top navigation generates an anonymised diagnostic JSON bundle in-browser
- Bundle v2 ships: time-windowed log tails (24 h app / 7 d error) from live and rotated `.log.gz` files, per-user flight-state aggregates (byStatus counts + pipeline counters), allow-listed user settings (no credentials)
- Server-side scrubbing of IPs, emails, JWTs and UUIDs; user IDs replaced with short opaque markers
- One-click "Report Bug" copies the bundle to the clipboard and opens a pre-filled GitHub Issue Form

### Export and import
- CSV, GeoJSON, KML (Google Earth) export from the admin panel
- Email notifications: configurable 24 h / 2 h pre-departure reminders (SMTP)

### Internationalisation
- Full German and English UI via react-i18next
- German as primary locale, English as the mirror translation

### Security
- JWT stored in an `HttpOnly`, `SameSite=Strict`, `Secure`-aware cookie; no Bearer fallback
- 15 distinct rate limiters across auth, external-API-backed routes and admin exports
- Zod validation on every input endpoint; Prisma-parameterised queries; Helmet CSP; `server_tokens off`
- 22 pentest findings (2 CRITICAL, 5 HIGH, 8 MEDIUM, 7 LOW) surfaced and mitigated across the beta; see [SECURITY.md](SECURITY.md)
- Patched four moderate-severity transitive CVEs via `npm audit fix` (GHSA-r4q5-vmmm-2653 `follow-redirects`, GHSA-39q2-94rc-95cp `dompurify`, GHSA-j452-xhg8-qg39 `protocol-buffers-schema`). Lockfile-only; no behaviour change.
- Hardcoded LAN IP in the Ollama URL placeholder (admin UI, German + English) replaced with `http://localhost:11434`; the corresponding benchmark note in `backend/OLLAMA_OPTIMIZATION.md` and the default in `scripts/parse-samples.mjs` were scrubbed at the same time.
- JWT secret and AES-GCM encryption key are auto-generated on first boot and persisted to `/app/data/secrets/` (mode 0700, key files 0600), inside the single data volume. Pre-1.0 installs on the dedicated `/app/secrets` mount are migrated once at entrypoint time.

### Zero-config install
- The Docker compose file now requires **one environment variable only** — `DB_PASSWORD`. Everything else (instance name, public URL, user cap, registration mode, API keys, Ollama, backup schedule, WebDAV) is captured by the first-run setup wizard or configured later from the admin UI.
- `AdminSettings` gains nine new columns (`instance_name`, `max_users`, `allow_registration`, `frontend_url`, `webdav_*`). The WebDAV password is AES-GCM-encrypted at rest via the same helper used for the other API keys.
- Setup wizard extended: instance name, public URL (pre-filled from the request origin), user cap and registration toggle are captured alongside the admin username/password.
- New admin section "Instance" for the instance-level fields. WebDAV sync moved into the existing "Backups" admin section with a dedicated password field that is never echoed back to the client.
- Legacy `INSTANCE_NAME` / `MAX_USERS` / `ALLOW_REGISTRATION` / `FRONTEND_URL` / `WEBDAV_*` environment variables are still read as a one-time fallback for pre-1.0 deployments, then superseded as soon as an admin saves from the UI.
- Secrets and data consolidated into a single `/app/data` volume. The `/app/secrets` mount is gone; JWT and encryption keys live at `/app/data/secrets/` inside the same persistent volume. Unraid, compose and Docker Desktop users now manage one mount point instead of two. Pre-1.0 installs with the old split layout are migrated automatically at boot.
- Unraid Community Apps template slimmed down to two configurable knobs — `DATABASE_URL` (required) and `TZ` (advanced). `OLLAMA_URL`, `COOKIE_SECURE` and `CORS_ORIGIN` were dropped from the template: Ollama is wired up from the admin UI, cookie-secure is auto-detected from the reverse-proxy `X-Forwarded-Proto` header, and CORS defaults to same-origin behind a proxy. All three are still honoured as environment overrides for exotic setups.

### Breaking changes from 0.x beta

- Docker image is published to **GHCR** (`ghcr.io/abrechen2/travstats`) as the primary build target. Starting with 1.0.0 final, `X.Y.0` releases are also mirrored bit-identically to **Docker Hub** (`docker.io/abrechen2/travstats`) for discovery. Pre-releases and patches live on GHCR only.
- The default LLM model changed from `qwen2.5:7b` to `gemma3:12b`. Pull the new model with `docker exec travstats-ollama ollama pull gemma3:12b` or set `OLLAMA_MODEL` explicitly.
- Parser-feedback collection and the template-correction table were removed. If you had custom code consuming `analytics_events` parser rows, it no longer populates.
- `.env.prod.example` has been shrunk to five variables (one required). Existing values continue to work, but the example no longer advertises them.

## [0.29.0-beta] - 2026-04-16

### Added
- **One-click Report Bug flow** — The diagnostic-export modal's former "Issue öffnen" link is now a primary "Fehler melden" / "Report Bug" button. Clicking it copies the JSON bundle to the clipboard and opens a new tab at a GitHub Issue Form with the `version` field pre-filled and the `bug` label already applied. A toast confirms the clipboard step so the paste target is obvious. If the clipboard write is blocked (non-secure context, permissions, etc.), the issue URL still opens and the user is directed to the Download button as a fallback.
- **Structured GitHub Issue templates** — New `.github/ISSUE_TEMPLATE/` entries for "Bug Report" (7 fields: summary, actual, expected, reproduction, version, diagnostic bundle, additional context) and "Feature Request" (4 fields). `blank_issues_enabled: false` steers non-maintainer contributors through one of the two templates so every incoming issue arrives pre-structured.

## [0.28.0-beta] - 2026-04-16

### Added
- **Diagnostic Export v2 — self-sufficient bug-report bundle** — The JSON bundle produced by the "Diagnose-Export" admin action now includes two new sections so a GitHub issue rarely needs follow-up questions:
  - `settings` — the reporter's auto-update and historical-enrichment preferences (booleans and integers only, credentials are never projected). Defends against future schema additions via a hand-written allowlist.
  - `flightState` — per-user aggregates (`byStatus` counts + pipeline counters including `withNextApiCheck`, `withPendingUpdates`, `withLiveTracking`, `withActualTimes`, `zombieCandidates`) so the maintainer can see at a glance what the scheduler is looking at.

  Log tails are now time-windowed instead of entry-capped: 24 h for `appTail`, 7 d for `errorTail`. Rotated `.log.gz` files are read transparently; a broken archive is skipped rather than breaking the whole bundle. Pino's duplicate `time`/`timestamp` pair is deduped on read, cutting bundle size by roughly 50 %. Caps (5 000 entries / ~2 MiB) prevent a flooded log from blowing up the download. Each section is collected in isolation — a DB hiccup on one section now returns `{ error: "failed to collect <section>" }` for that slice only, the rest of the bundle still succeeds with HTTP 200.

## [0.27.2-beta] - 2026-04-16

### Fixed
- **Historical enrichment stayed pending forever** — When users had turned off the approval gate (`autoUpdateRequireApproval=false`), newly created historical enrichments were nonetheless left as "pending" and never surfaced on the flight. The scheduler now mirrors the live auto-update path and auto-applies them.
- **Zombie-flip missed flights with corrupted arrival time** — The stale-scheduled safety net only considered `arrivalTime + 6h` and was silent when a bad API lookup pushed `arrivalTime` into the future. Added a second `departureTime + 30h` trigger that flips the flight regardless of arrival-time state (30h comfortably covers ultra-long-haul like SIN→JFK).
- **Gate, terminal and actual departure/arrival never persisted** — `lookupFlightDetails` silently dropped per-flight live fields (gate, terminal) by letting the static airport record shadow them, and `actualDeparture`/`actualArrival` were missing from the snapshot pipeline entirely. Both AirLabs and Aviationstack paths now forward these end-to-end, and `delayMinutes` is recomputed on apply.

## [0.27.1-beta] - 2026-04-15

### Fixed
- **Duplicate flight: airline + flight number nullToUndef** — Older imported flights have these columns NULL in the DB, but the frontend Flight type lies and types them as required strings, so they slipped past the previous nullToUndef fix. All four nullable-typed-as-required fields now go through the helper.
- **Certificate: black vertical bands in exported PNG** — html2canvas does not render the SVG `feTurbulence` filter consistently and produced solid-black stripes from the noise data URI. Replaced with two layered radial gradients that give the parchment depth without the rasteriser hazard. Also removed `mixBlendMode: multiply` on the postmark for the same reason.
- **Stats page: clear separation between year-filter and totals** — Both four-card rows looked identical. Added a labelled separator above each row ("── Jahr 2026 ──" / "── Gesamt (alle Jahre) ──") with a subtle bottom-border so the scope is unambiguous.
- **Diagnostic export "Copy" worked on HTTPS only** — `navigator.clipboard` requires a secure context. Falls back to the legacy `execCommand('copy')` with a temporary off-screen textarea on plain HTTP.
- **Bug-Report button hidden on narrower screens** — Was tucked into the `xl:` breakpoint group with Donate/Star. Lifted out so it shows on all desktop widths.
- **/settings rate limiter removed** — The 1000/15min cap kept tripping during normal use. Real rate-limiting belongs on auth (brute-force), external-API-backed routes (cost) and admin exports (DB-wide reads), not on a user reading their own preferences.
- **Historical-flight month "Unbekannt" snapped back to Januar** — Storing `YYYY-01-01` for both January and "unknown" meant the parser couldn't distinguish them. Now stores year-only (`YYYY`) for the unknown-month case and expands to `YYYY-01-01` only at submit.

### Changed
- **Removed parser-feedback collection** — Same anti-pattern as the already-removed pattern-updater: data was collected into `analytics_events` but no longer consumed automatically. With Ollama as primary parser, the feedback was unused. Removed the `parserFeedback` service + route, the `/admin/parser-feedback/stats` and `/details` endpoints, the `/admin/parse-logs/promote` endpoint, the `FeedbackAnalytics` admin tab and the parser-correction submission from the FlightReviewModal. The `ParseTrainingLog`-based parser hit-rate dashboard (a different system) is unchanged.

## [0.27.0-beta] - 2026-04-15

### Added
- **Anonymous diagnostic export for GitHub bug reports** — A new "Bug" button in the top navigation opens a modal that generates a sanitised JSON bundle of recent app and error log entries plus system info. IP addresses, email addresses, JWT tokens and UUIDs are scrubbed server-side; user IDs are replaced with short opaque markers. Three actions: copy to clipboard, download as file, or open the GitHub issue page.
- **Save + add return flight** — A second submit button on the manual flight form saves the outbound and immediately prepares the form for the return leg. Departure and arrival airports are swapped, airline / category / tags / companions carry over, and leg-specific fields (flight number, aircraft, terminal, gate, seat, times) are cleared so the user fills them in.
- **Redesigned flight certificate** — The shareable PNG certificate has been completely redesigned around a vintage aviation passport aesthetic: parchment paper with grain texture, deep ink-blue typography, burnished bronze accents and a faded vermillion postmark stamp. New typography (Fraunces, Big Shoulders Display, JetBrains Mono), the total kilometres rendered as a dominant hero number, equivalence captions ("X × around the Earth at the equator"), and a deterministic 6-character serial number per certificate.
- **Admin panel: delete user** — Admins can now permanently delete users from the user-management table. Cascade clears the user's flights, trips, achievements, settings and pending updates. Self-deletion and last-admin deletion are blocked.

### Fixed
- **PDF year report button no longer permanently greyed out** — The advanced statistics page now auto-selects the most recent year as soon as flights have loaded, so the "PDF Jahresbericht" button is enabled out of the box instead of waiting for the user to discover the year dropdown.
- **Historical flight year input accepted keystrokes** — Typing a digit into the year field for a historical flight no longer cleared itself. The form re-derived the visible year from a stored YYYY-MM-DD string with a strict 4-digit regex; relaxed to accept partial input so the field echoes each keystroke.
- **Diagnostic export modal no longer trips its own rate limit** — The fetch effect re-ran on every parent re-render due to unstable `t` and `addToast` dependencies, exhausting the 10/hour rate limit within seconds. Now fires once per modal open.
- **Duplicate flight succeeds again** — The "duplicate as same / return flight" action sent `null` for unset optional fields, which Prisma's optional-but-not-nullable Zod schema rejected. Nullable values are now coerced to undefined, and duplicates are created with the dedicated "duplicated" status (no time-fields requirement) so the user fills in dates in the edit modal that opens immediately.

### Changed
- **Admin panel cleanup** — Removed the dead Hardware-info section, dropped the unused TemplateCorrection table, and retired the orphan pattern-updater / pattern-analyzer infrastructure that never actually applied any patterns. Tabs and i18n strings simplified accordingly.
- **Certificate layout** — Footer no longer overlaps the "of note" rows; postmark stamp was repositioned tighter into the corner with a multiply blend so it reads as ink on parchment.

## [0.26.0-beta] - 2026-04-15

### Added
- **Duplicate flight action** — Each row in the flights table now has a "Duplicate" dropdown with two options: "As same flight" (copy route) or "As return flight" (swap departure/arrival). Airline, flight number, aircraft, category, tags, companions and notes carry over; time, seat, gate, terminal, booking references and pricing are cleared so the user fills in the trip-specific details. The edit modal opens automatically on the new flight.

### Fixed
- **Auto-update endless loop** — When "require approval" was disabled the scheduler created a pending update on every check but never applied it, so the same changes were re-detected and re-written every 10-15 minutes. Updates with approval off are now applied immediately while the pending row is still kept for audit.
- **API check cadence** — Each flight used to be polled every 15 minutes while in the air, burning 30-50+ API calls per long-haul. Scheduling now uses exactly three checkpoints: 30 minutes before departure, 60 minutes before scheduled arrival, and 30 minutes after arrival.
- **Zombie-scheduled cutoff** — Flights stuck on "scheduled" past their arrival are now auto-flipped to "flown" after 6 hours (was 48h), so they stop showing up in the API-check queue.
- **Scheduler log output** — The `significant_changes_found` log line now lists real field names (e.g. `gate`, `terminal`, `aircraft`) instead of array indices.

## [0.25.4-beta] - 2026-04-14

### Fixed
- **Settings page no longer trips its own rate limit** — The auto-save effect listed `t` (from useTranslation) in its dependency array, which is unstable across renders, so the debounced save was firing on every keystroke instead of only when units actually changed. Combined with new banner/home-airport fetches this hit the `/settings` rate limit (60→200→1000) within a couple minutes of normal use. Removed the unstable dep and bumped the limit to 1000/15min so background polling has plenty of headroom while still blocking scripted abuse.

## [0.25.3-beta] - 2026-04-14

### Fixed
- **Autocomplete shows both active and closed airport for shared codes** — Searching "MUC" now returns Munich Airport (active) followed by Munich-Riem (closed) instead of only the active one. The exact-match step returns all rows with the same IATA/ICAO ordered by `isClosed ASC` so users can pick the historical predecessor for old flights.

## [0.25.2-beta] - 2026-04-14

### Fixed
- **Closed predecessor IATA assignment** — When a closed airport's keywords list a single 3-letter token, that's almost always its own historical IATA (Munich-Riem `EDDM, MUC, XMUC` → MUC). When multiple are present the first is usually the successor (Tempelhof `BER, EDDI, THF` → BER is Brandenburg, THF is the closed one), so prefer the candidate not used by an active airport. Both cases now resolve correctly.

## [0.25.1-beta] - 2026-04-14

### Fixed
- **Closed predecessors no longer overwrite active airports** — Munich-Riem (closed) shares ICAO EDDM and IATA MUC with the active Munich Airport; the seeder was overwriting the active row with the closed predecessor's data, breaking searches for "MUC". The Airport schema now uses composite uniqueness on `(iata, isClosed)` and `(icao, isClosed)` so both rows can coexist, and the seeder upserts by the composite key. Closed airports are still listed alongside their successors in autocomplete with the "geschlossen" badge.
- **Airport autocomplete prefers active over closed** — Search and lookup now order by `isClosed ASC` so a typed code like "MUC" returns the active airport first, with the closed predecessor below.

## [0.25.0-beta] - 2026-04-14

### Added
- **Home airport with relocation history** — Pick a home airport once during onboarding and change it later under Einstellungen › Heimatflughafen. A move never overwrites the past: every flight keeps the home airport that was active at its date, so old statistics stay truthful.
- **Copy-down date and estimate arrival time buttons** — Two new icon buttons in the Add Flight and Edit Flight forms: a down-arrow that copies the departure date into the arrival date, and a calculator that estimates the arrival time from the great-circle distance using the arrival airport's local timezone. A "+1 Tag" hint appears below the arrival date for overnight flights.
- **Flughäfen statistics section** — New stats card group with distinct airports, countries, continents (5/6), top 5 most-visited airports, top countries, rarest airports (visited only once), new airports this year, farthest airport from home, and a continent breakdown bar chart. Plus a new "Kürzester Layover" companion stat.
- **Closed airports in autocomplete** — Permanently closed airports like Berlin Tegel (TXL) are now seeded too and remain selectable for historical flights, marked with a "geschlossen" badge.

### Fixed
- **Längster Layover no longer counts living at home as a layover** — Capped at 24 hours and arrivals at the home airport active on that date are excluded. Old: "47944.6h in MUC" (5.5 years). New: realistic transit times only.
- **Historical flight year input no longer locks to NaN** — Parsing the stored date with `new Date()` could produce `Invalid Date`, then `getFullYear()` wrote "NaN" back into the input and froze it. Now parsed directly from YYYY-MM-DD with regex.

### Changed
- **Settings rate limit raised** — From 60 to 200 requests per 15 min. The previous limit was tripping on normal navigation now that the settings page has more sub-sections and a new home-airport banner.

## [0.24.4-beta] - 2026-04-14

### Fixed
- **Aviationstack now respects Free-tier budget** — Blocks Aviationstack calls outside the flight's live window (±3h of departure, in-flight, or 2h post-arrival) and caps them at an admin-configurable daily budget (default 3/day, enough to stay inside the Free tier's 100/month). Outside the window — the bulk of daily polls, which are just schedule lookups from T-24h to T-6h — the lookup goes straight to AirLabs, which has a much larger Free quota. An 8-flight test account now consumes about 5–8 Aviationstack calls over a 24h window instead of 240+. Skip reasons (`outside_live_window`, `daily_budget_exceeded`, `cooldown`) are logged at every lookup for debuggability.
- **New admin setting:** `aviationstackDailyBudget` (default 3). Migration adds the column; set to 0 to disable Aviationstack entirely and rely solely on AirLabs + OpenSky.

## [0.24.3-beta] - 2026-04-14

### Fixed
- **Historical flights with unknown date are enrichable again** — `findEnrichmentCandidates` queried `departureTime: { gte: maxAgeDate }`, which in Prisma/Postgres also excludes `NULL`. Historical flights (the primary use case: "I flew this but don't remember when") were therefore never candidates for enrichment, even when a full reference pool existed. Now the query accepts both dated and dateless flights, and `getEnrichmentMode` returns `slim` for null so dateless flights use the conservative ICAO + terminal-only aggregation.

## [0.24.2-beta] - 2026-04-14

### Fixed
- **Enrichment bootstrap deadlock resolved** — The auto-update and historical enrichment pipelines never produced results on fresh accounts because of a chain of five interacting bugs: the significance filter dropped first-fill gate/terminal changes, `hasLiveTracking` never got seeded (gating all future enrichment), scheduled flights past their arrival time became permanent zombies, and Aviationstack times without seconds silently failed to parse. Each is now fixed — first-fill changes count as significant on their own, `hasLiveTracking` flips on any non-empty API response, a new zombie-transition job flips `status=scheduled` → `flown` after arrival + 48h (marked `lastModifiedBy='zombie_auto_flown'`), and the time parser now accepts the space-separator-without-seconds format observed from the live API.
- **Aviationstack 429 retry storm prevented** — The free tier is 100 requests per month. A single 429 previously triggered aviationstack retries on every 5-minute scheduler tick. Now a 1h in-memory cooldown blocks Aviationstack after a 429, falling through to AirLabs.
- **OpenSky credential validation** — If stored credentials decrypt to an unusable pair (neither full OAuth2 client credentials nor full basic auth), the resolver now returns `null` instead of an empty object so downstream logs no longer lie about configuration state.

### Changed
- **Historical-enrichment threshold lowered for slim mode** — Flights aged ≥ 1 year now require only 3 reference flights instead of 5 for aggregation. Full mode (< 1 year) keeps the 5-reference minimum. This unlocks enrichment for niche routes in small deployments where 5 same-flight-number references would be unreachable.

### Docs
- Added three post-V1 roadmap items surfaced by the v0.24.1 critical review: route clustering to replace per-dimension median aggregation, confidence calibration via user-feedback loop, and a cross-user consent model for future multi-tenant deployments.

## [0.24.1-beta] - 2026-04-14

### Security
- **Admin password reset via SMTP (Pentest H4)** — When the target user has a notification email on file and SMTP is enabled, the generated temporary password is now delivered via email instead of being returned in the HTTP response body. Falls back to response body for deployments without a mail server. Remaining deferred pentest items (H5 leaderboard enumeration, M7 TLS, L2/L3 SSH, L4 Dozzle) are now formally documented as accepted — by-design for the family tracker or infrastructure-level outside the repository.

### Fixed
- **Map-only filter hidden on list pages** — The "min times flown" route-frequency slider only affects the deck.gl route layer. It no longer appears on the flight list page, where it was a silent no-op that misled users into thinking their list was filtered.

### Changed
- **Dead canTrainLLM flag dropped** — Removed an unused permission relic of the deleted LLM training pipeline. The field was never set or read by the backend, so the frontend gate always evaluated to false. Parser access is now gated exclusively by `isAdmin`. Prisma migration drops the column; `hasTrainingAccess` renamed to `hasParserAccess`.

### Tests
- **+21 new service tests** — covers email service (password reset, invitation, admin reset), reminder scheduler (dedupe, per-window error isolation, user opt-out), and cloud sync service (WebDAV upload, download, list, with all failure paths).

## [0.24.0-beta] - 2026-04-13

### Security
- **Shell injection in backup service fixed** — Replaced `execAsync` with `spawn` on Unix pg_dump paths to prevent command injection via crafted database URLs (C1).
- **API credentials no longer leaked in PUT response** — Admin API key update endpoint now returns masked values instead of decrypted plaintext secrets (C2).
- **Removed `targetDatabaseUrl` from restore API** — Eliminates SSRF and command injection amplification via admin-supplied database URLs (H3).
- **Rate limiting added to flight lookup and enrichment endpoints** — Prevents external API quota exhaustion and database load abuse (H1, M5).
- **Analytics event types whitelisted** — Only `parser_feedback` and `pattern_suggestion` are accepted, preventing pipeline poisoning (H2).
- **13 additional fixes** — changeToken body fallback removed (M2), backup path containment check (M3), typed editedData preview (M4), SMTP password encrypted at rest (M6), nginx security headers on static assets (M1/M8), dotfile access blocked, `Math.random()` replaced with `crypto.randomBytes()` (L1), setup rate limited (L6), `parseInt` radix (L5), RFC 5987 Content-Disposition encoding (L7).

### Added
- **Parser system marked as beta** — Navigation and parser page show a beta badge and notice explaining that only LLM-based parsing is fully tested.
- **SECURITY.md** — Comprehensive security architecture documentation with verification commands, audit history, and vulnerability reporting via GitHub Private Security Advisories.

### Changed
- **Multi-flight parser roadmap** — V1.8 roadmap updated with two-stage hybrid parser design (block splitting + per-block extraction) and multi-version template scoring.

## [0.23.1-beta] - 2026-04-13

### Fixed
- **Sidebar overflow on small screens** — The navigation menu, flight list, and stats sidebars used fixed pixel widths (w-80/w-72) that overflowed on narrow viewports. All three panels are now capped at calc(100vw - 3rem), leaving a 48px tap area to close the backdrop. Also fixed the mobile menu DOM nesting by moving it outside the header element into a fragment.

## [0.23.0-beta] - 2026-04-13

### Added
- **Smart API check scheduling** — Replaces fixed-interval polling with per-flight scheduling using a geometric midpoint approach. Checks become more frequent as departure nears (min 10 min), run every 15 min in-flight, and stop 2 hours after arrival. Existing scheduled flights are backfilled on startup.

### Fixed
- **Aircraft name normalization** — Aircraft type names are now normalized consistently across statistics, achievements, and the input form. Existing names in the database are cleaned up on startup.

## [0.22.0-beta] - 2026-04-13

### Fixed
- **Timezone-aware statistics** — All airport timezone data is now derived from coordinates via geo-tz and backfilled on startup. Fixes timezoneHopper (was always 0), fastestRoute showing impossible speeds (e.g. 5560 km/h), and incorrect flight durations for cross-timezone flights.
- **Airline name normalization** — Duplicate airline entries caused by different import-source spellings (EgyptAir/Egyptair, AIR CANADA, Vietnam Airline) are now merged in statistics.
- **WebGL2 graceful fallback** — Browsers without WebGL2 support no longer crash deck.gl; the map renders correctly.
- **i18n encoding fixes** — Corrected garbled German umlauts in error messages and added missing translation key.

### Changed
- **Same-day flights stat renamed** — "Same-Day Returns" renamed to "Tagesflüge" / "Same-Day Flights" to accurately reflect the metric (flights landing on the same calendar day, not round trips).

### Added
- **Native MapLibre route fallback** — WebGL1-only browsers now get a native MapLibre GeoJSON route layer instead of no map at all.

## [0.21.0-beta] - 2026-04-13

### Added
- **Historical flights** — Flights can now be recorded as route-only
  entries without departure/arrival times. Includes a form checkbox,
  year/month partial date picker, grey map arcs, and a "HISTORISCH"
  badge in the flight list.
- **Duplicate flight dialog** — One-click duplication of any flight
  as outbound or return, with correct status and time fields.
- **Airport autocomplete in review modal** — The FlightReviewModal
  (used for email/boarding pass imports) now has full airport
  autocomplete with IATA/ICAO priority matching.
- **Airline and aircraft autocomplete** — All flight forms now offer
  suggestions from a merged list of ~150 airlines and ~90 aircraft
  types (static seed data + user's flight history). Custom entries
  are remembered for future sessions.
- **Year/month picker in edit modal** — Historical flights can be
  edited with a year/month-only date picker instead of requiring
  a full date.
- **Three UX improvements for flight forms** — Enhanced form usability
  across add, edit, and review workflows.

### Fixed
- **Achievement leaderboard inflated** — The leaderboard was counting
  all tracked achievements (55) instead of only unlocked ones (34),
  showing 12,595 points instead of the correct 3,630.
- **Recent achievements showed non-unlocked entries** — The /recent
  endpoint now filters to only actually unlocked achievements.
- **deck.gl map crash on load** — Fixed a luma.gl "r is null" race
  condition by deferring the DeckGLOverlay until MapLibre's WebGL
  context is ready (onLoad gate). Updated maplibre-gl 5.19→5.23.
- **FlightEditModal date handling** — Overhauled date fields, feature
  flags, and historical status switching in the edit modal.
- **Duplicate flight payload errors** — Fixed null field coercion,
  missing times, and incorrect status when duplicating flights.
- **Validation errors hidden** — Detailed Zod validation errors are
  now displayed in the flight form instead of a generic error message.
- **Flight schema rejects null** — Callsign and aircraft fields now
  correctly accept null values.
- **Airport search ranking** — Exact IATA/ICAO matches are now
  prioritized over partial name/city matches.

### Docs
- **Post-V1 roadmap** — Added ROADMAP-POST-V1.md with detailed specs
  for V1.1 (Cruises module) through V2.0 (Multi-user platform).

## [0.20.0-beta] - 2026-04-12

### Added
- **Historical flights** — New flight status for route-only entries
  without departure/arrival times. Historical flights count toward
  distance, airport, and geographic achievements but are excluded
  from flight-time statistics. Includes a form checkbox, grey map
  arcs (thinner width), a "HISTORISCH" badge in the flight list,
  and nullable times across the full Prisma schema.

### Fixed
- **Null-safe frontend types** — Made departureTime/arrivalTime
  nullable across 17 frontend components to prevent runtime crashes
  when displaying historical flights without timestamps.

## [0.19.0-beta] - 2026-04-12

### Added
- **Scheduled flight distinction** — Future flights are automatically
  marked as "scheduled", shown with cyan arcs on the map and a
  "GEPLANT" badge in the flight list. Scheduled flights are excluded
  from all statistics.
- **Flight list sort selector** — The sidebar flight list now has
  sort buttons for date (asc/desc), route, airline, and status.
- **Planner & Survivor achievements** — Five new achievements for
  planned flights (Wanderlust, Globetrotter Planner, Year Ahead)
  and cancelled flights (Survivor, Turbulence Veteran).
- **Improved airport labels** — IATA labels on the map are slightly
  larger with a more visible dark background for better readability.

### Fixed
- **Achievements page readability** — Locked achievements are no
  longer blurred; they show at reduced opacity with a lock icon
  centered-right in the card. All text and progress bars remain
  clearly readable.
- **Achievements page scroll** — The survivor/planner categories
  at the bottom of the page are no longer cut off.

## [0.18.1-beta] - 2026-04-12

### Fixed
- **Achievement seeding on every server start** — Achievement
  definitions are now ensured on every backend startup (idempotent),
  not only during the Docker entrypoint init script. Fixes empty
  achievements after fresh deploys or database resets.
- **Round-trip route popup** — Route popup now correctly shows
  both airports (e.g. "Munich Airport → Helsinki Vantaa") instead
  of showing the departure airport twice for round-trip routes.

## [0.18.0-beta] - 2026-04-12

### Added
- **Two-stage route/trip info popup** — Clicking a route arc on
  the map now shows a redesigned popup with full airport names,
  distance, average duration, airlines, and seat class. A
  "Route Details" / "Trip Details" button opens a rich sidebar
  view with route statistics and a chronological flight list
  (or numbered trip legs for trip-routes mode).

## [0.17.0-beta] - 2026-04-12

### Added
- **Ollama model selector** — The admin parser settings page now
  shows a dropdown of all models available on the Ollama server
  instead of a free-text field. A "Pull model" section lets admins
  download new models directly from the UI.
- **Cost tracking feature gate** — The cost breakdown section
  (price, currency, taxes, fees) in the flight review modal is now
  hidden unless the enableCostTracking feature flag is active.

### Fixed
- **Timezone-aware flight durations** — Flight duration calculations
  now account for timezone differences between departure and arrival
  airports using IANA timezone data. Fixes inflated durations for
  international flights (e.g. LAX→MUC showed 20h instead of ~11h).
- **Achievement checks for all flights** — Achievement progress is
  now evaluated after every flight creation, not only for flights
  with status "flown".

## [0.16.1-beta] - 2026-04-12

### Fixed
- **Setup page simplified** — Removed privacy info box, tips section, and
  instance name field. Only the essential username + password form remains.
- **Profile shows account username** — The settings profile now displays the
  actual account username instead of the default "Traveler".
- **Language auto-detected from browser** — On first use, the UI language is
  auto-detected from `navigator.language` (de/en) instead of defaulting to
  English.
- **Route click selects all flights** — Clicking a route arc on the map now
  highlights all flights on that route instead of only the last one.
- **Flight list refreshes after batch import** — The map and sidebar now
  update automatically after importing multiple flights via email.
- **Batch import errors shown as toast** — Import errors (e.g. rate limit)
  are now displayed as a visible toast notification instead of silently
  failing behind a closed modal.
- **Batch rate limit increased** — Raised from 10 to 50 requests per hour
  to support bulk email import workflows without hitting 429 errors.
- **Achievement notifications on batch import** — The batch endpoint now
  returns newly unlocked achievements, and the popup is shown after bulk
  imports (previously only worked for single-flight additions).

### Changed
- **Cost tracking defaults to off** — Cost input fields are now opt-in via
  Settings > Features instead of being visible by default.

## [0.16.0-beta] - 2026-04-12

### Security
- **Full pentest with 32 findings resolved** — Comprehensive code review
  uncovered 4 critical, 10 high, 12 medium, and 6 low severity issues.
  All 32 have been fixed: admin data export no longer leaks password
  hashes or decrypted API keys; shell injection in backup restore
  replaced with safe `spawn()` calls; Bearer header fallback removed
  (JWT only via HttpOnly cookie); force-change-password token now
  delivered via HttpOnly cookie instead of response body; login timing
  oracle eliminated (constant-time bcrypt for unknown users); MAX_USERS
  hard limit enforced even with ALLOW_REGISTRATION=true; SSRF
  protection on Ollama URL; invitation registration wrapped in
  serializable transaction; SameSite upgraded to Strict; CORS dev
  bypass removed; DB password default removed from prod compose; rate
  limiters keyed by userId on authenticated endpoints; nginx security
  headers on static routes. Zero npm audit vulnerabilities in both
  backend and frontend.

### Added
- **Default Ollama model switched to gemma3:12b** — Benchmarked at 100%
  accuracy across all test email samples, replacing qwen2.5:7b.

### Changed
- **Dead LLM training system removed** — Deleted modelManager,
  trainingAuth middleware, training settings route, 6 Python scripts,
  and ~2 GB of PyTorch dependencies from the Docker image. Dead Prisma
  schema fields dropped via migration.
- **Oversized files split** — regexParser.ts (824 to 338 lines + 4
  modules), backupService.ts (1129 to 378 + 4 modules), statsCalculator.ts
  (886 to 17 barrel + 4 modules). All files now under the 800-line limit.

### Tests
- **Backend test isolation improved** — 7 test suites refactored to seed
  users via Prisma instead of the register endpoint, run serially via
  `maxWorkers=1`, and wipe state before each test.

## [0.15.2-beta] - 2026-04-11

### Fixed
- **Password min length aligned with the backend on the invited
  register page** — The client-side check rejected passwords below 6
  characters while the backend Zod schema already required at least 8,
  so 6- or 7-character passwords slipped past the client and hit the
  generic "Validation error" envelope from the backend error handler.
  The invited user saw a red box with no explanation. Fix: the client
  check is now 8 characters to match, the `register.passwordTooShort`
  string in both DE and EN says "mindestens 8" / "at least 8", and the
  error handler now prefers `details[0].message` (the actual Zod
  per-field message) over the generic envelope when the backend does
  return one. Verified locally against a fresh invitation: a 7-char
  password now surfaces the exact "at least 8" message client-side,
  a valid 10-char password completes the flow.

## [0.15.1-beta] - 2026-04-11

### Fixed
- **Copy-to-clipboard on insecure HTTP origins** — Every "Copy link"
  button in the admin area silently did nothing when TravStats was
  accessed over plain HTTP on a LAN IP (the typical deployment), because
  `navigator.clipboard.writeText` is only available in a secure context
  (HTTPS or `localhost`). A new shared `copyToClipboard` utility tries
  the modern API first and falls back to a hidden-textarea plus
  `document.execCommand("copy")` path when the modern API is
  unavailable or rejects. The fix is wired into the invitation success
  modal, the row-level copy action in the invitation list, and the
  admin temporary-password reveal. Verified locally by running the dev
  server on a LAN IP (`window.isSecureContext === false`,
  `navigator.clipboard === undefined`) — both copy buttons now surface
  the success toast and actually write to the clipboard.

## [0.15.0-beta] - 2026-04-11

### Added
- **Invitation system v2** — The admin invitation surface is rebuilt
  end-to-end. Two distinct entry points replace the browser `prompt()`:
  a "Create link" modal that generates a shareable URL with an
  expiration radio (24h / 7d / 30d), and a "Create by email" modal
  that additionally sends the invitation through SMTP to a given
  recipient. The success modal keeps the link visible with a copy
  button until the admin dismisses it, so the URL is never "lost in
  a toast" again. On SMTP failure the invitation is still created
  and the modal shows an amber warning with the concrete error and
  the fallback link.
- **Row-level invitation management** — Every invitation row in the
  admin list now has context-aware actions: re-copy the link on any
  active invitation, resend the email (only for rows with an email
  attached and a null/failed send status), and revoke (hard-delete)
  any non-used invitation. A filter chip row above the table
  (`Alle` / `Aktiv` / `Verwendet` / `Abgelaufen`) narrows the view,
  and a new "Verwendet von" column shows which user consumed each
  used invitation.
- **`MAX_USERS` enforcement at invitation create time** — Both
  create endpoints now run a serializable transaction that counts
  `users + active invitations` and rejects with `409 User limit
  reached` before any row is inserted. `MAX_USERS` was previously
  only a warning log that never actually blocked anything.
- **Auto-populated `notificationEmail` on invited registrations** —
  When a user registers through an invitation that carried an email
  address, that address is copied into the new user's
  `notificationEmail` field during the same insert. Password reset
  works for invited users out of the box without a manual visit to
  the settings page.
- **Email delivery tracking per invitation** — The `invitations`
  table gets three new columns (`email_status`, `email_error`,
  `email_sent_at`) so the list row can show the last send outcome
  and the resend action can target failed deliveries specifically.
  The `used_by` foreign key is tightened to `ON DELETE SET NULL`
  so deleting a user no longer cascades to historical invitation
  rows.
- **Dedicated `sendInvitationEmail` helper** — A new function in
  `emailService.ts` mirrors the existing `sendPasswordResetEmail`
  pattern but throws on SMTP misconfiguration instead of silently
  returning. The route handler catches the throw, marks the
  invitation `email_status='failed'` with the underlying error
  text, and still returns 200 — the *invitation* create succeeded
  even when the *email send* did not.

## [0.14.1-beta] - 2026-04-11

### Fixed
- **Invitation system wired end-to-end** — The register flow never
  forwarded the invitation token to the backend, so invited users
  silently registered as normal uninvited users and the invitation
  record stayed forever "active" in the admin list. `authApi.register`
  now accepts a third `invitationToken` argument, `RegisterPage` reads
  the `?token=` query parameter via `useSearchParams`, and a green
  "you are registering with an invitation" banner confirms that the
  link was picked up. Companion prod-config change: `FRONTEND_URL` and
  `ALLOW_REGISTRATION=false` should be set in the production
  docker-compose.yml so invite URLs no longer point to
  localhost and public registration is actually gated on a valid
  invite. Verified end-to-end against a local dev instance: registration
  without a token is blocked, an admin-created invite flows through
  the register page, the `invitedBy` column is populated, and a second
  use of the same token is rejected by the database unique constraint.

## [0.14.0-beta] - 2026-04-11

### Added
- **Help texts on every settings and admin surface** — 10 components
  (SmtpManager, ParserSettings, ApiKeys, Backup, Defaults, Features, Map,
  Notifications, Profile, Units) now ship expandable InlineHelp blocks with
  DE + EN explanations covering scope, dependencies and gotchas. Coverage
  is now 27 components with 198 checked i18n keys.
- **Help audit script** — `scripts/audit-inline-help.mjs` walks every
  InlineHelp and HelpIcon element and verifies each `t()` key against DE
  and EN. Exits non-zero on missing translations; usable as a CI gate.

### Fixed
- **Backup creation via the UI** — The route handler passed pre-computed
  paths to the service through `existingRecord`, but the service generated
  a fresh timestamp internally and therefore ran `mkdirSync` on a different
  directory than it tried to write to. Result: `pg_dump >
  .../temp/database.sql: Directory nonexistent`. The service now takes
  `backupDir`/`tempDir` directly from `existingRecord`.
- **"Date unknown" in the backup table** — `serializeBigInt()` fell into
  the `typeof === 'object'` branch for Date objects and turned them into
  `{}` because `Object.entries(date) === []`. Fix: non-plain objects are
  passed through unchanged so Express can call `Date.toJSON()` for wire
  serialization. +7 regression tests.
- **Consistent airline column** — Some flights showed "Lufthansa", others
  just "LH". A new `resolveAirlineDisplay()` helper expands 2-char IATA
  codes to the full airline name; applied everywhere (FlightsTablePage,
  FlightList, FlightCalendar, FlightSelectStep, YearHeatmap).
- **Trip filter chips** — The buttons rendered the raw i18n keys
  `filter.with` / `filter.without` because the JSON held `withTrip` /
  `withoutTrip`. Keys renamed in both DE and EN to match the code.
- **Missing lib files committed** — `airlineUtils.ts` and
  `filterEmailText.ts` were imported by `FlightReviewModal` and
  `EmailAnnotation` but only existed locally (untracked). A clean clone
  would have failed to build.
- **White input fields on auth pages** — LoginPage, ForceChangePasswordPage,
  ResetPasswordPage and AdminPasswordResetModal referenced a CSS class
  `.input-field` that does not exist anywhere, so the inputs fell back to
  the browser default (white). Switched to the existing `.input` class.
- **"Note" label in developer mode help** — The key
  `settings:developer.help.noteLabel` was missing in both languages, so
  the UI rendered the raw i18n key when the help was expanded. Added in
  DE + EN.

## [0.13.0-beta] - 2026-04-06

### Added
- **Email-based password reset** — Users can request a reset link from
  the login page via "Forgot password?". The link is delivered by email
  (only when SMTP is configured).
- **Admin password reset** — Admins can reset a user's password from
  user management: either generate a random temporary password (shown
  once, with a copy button) or set a password directly. Optionally, a
  "Must change password on next login" flag can be enabled.
- **Forced password change** — When the admin sets the flag, the user
  must choose a new password on the next login before they can access
  the app.
- **Rate limiting on reset endpoints** — Password reset requests are
  limited to 5 requests per 15 minutes to prevent abuse.

### Fixed
- **Force-change-password route** — After login the frontend incorrectly
  called `/force-change-password` instead of `/change-password`; fixed.
- **Unique constraint on token fields** — Reset and change tokens now
  have a database unique index that enforces single-use semantics at
  the DB level.

## [0.12.2-beta] - 2026-04-06

### Security
- **nginx version leak fixed** — `server_tokens off` in the nginx config
  prevents exposure of the nginx version in response headers.
- **Duplicate security headers removed** — nginx no longer sets security
  headers; Helmet owns them completely, avoiding conflicts on
  X-XSS-Protection, Referrer-Policy and HSTS.
- **XSS sanitization in flight notes** — HTML tags are stripped from the
  backend `notes` field before being stored.

### Fixed
- **Express 404 pages** — Missing routes now return `{"error":"Not
  found"}` instead of the internal Express HTML page.
- **JSON parse errors anonymized** — Invalid JSON bodies now return a
  generic error message instead of the internal parser error text.

## [0.12.1-beta] - 2026-04-06

### Security
- **CORS tightened** — The CORS wildcard now only applies in development
  mode (`NODE_ENV === development`), not in all non-production
  environments.
- **Additional rate limiting** — Upload endpoint (30/hr) and every
  settings route (60/15min) now have rate limits guarding against disk
  exhaustion and enumeration.
- **Minimum password length raised** — Minimum length raised from 6 to
  8 characters.

### Fixed
- **Database start failures surfaced immediately** — Missing DB
  configuration now aborts server startup instead of just warning.
- **Global error handlers** — Unhandled promise rejections and uncaught
  exceptions from schedulers are now logged instead of silently crashing
  the server.
- **Parser settings endpoint corrected** — PUT `/api/v1/settings/parser`
  incorrectly returned 200 OK without saving anything; now correctly
  returns 501 Not Implemented.
- **Query parameter validation** — `parseInt()` in admin parse-log
  routes replaced with Zod schemas (prevents NaN reaching DB queries).
- **Trip list query bounded** — GET `/trips` now loads at most 500 trips
  + 200 flights per trip (was: unbounded).
- **ErrorBoundary logging** — `console.error` in ErrorBoundary is now
  scoped to development mode.
- **package.json versioned** — `backend/package.json` and
  `frontend/package.json` synchronized to `0.12.1-beta`.

## [0.12.0-beta] - 2026-04-06

### Added
- **Empty map view** — New users now see a hint card with a direct
  "Add flight" button instead of an empty globe.
- **ICAO code in the airport tooltip** — Clicking an airport label now
  additionally shows the ICAO code as a badge next to the IATA code.
- **Gate, terminal, boarding group and companions in the edit modal**
  — These four fields are now fully editable in the flight edit dialog.

### Fixed
- **Language support** — Hardcoded German strings in the map tooltip,
  trips tab and flight counter replaced with i18n keys; dead
  ContextualHint reference removed. All text now reacts correctly to
  the language setting.
- **Umlaut bug** — `¨e` (a Prettier artifact) in the plural "Flüge"
  fixed.
- **Exit highlight mode** — Clicking on empty map space now reliably
  ends trip or flight highlight.

### Changed
- **Tooltip performance** — `onMove` handler throttled via
  requestAnimationFrame; tooltip recalculation runs at most once per
  frame instead of up to 60 times per second.
- **Code quality** — Plane and pulse animations extracted from
  DeckGLMap into dedicated hooks (DeckGLMap: 582 → 430 lines);
  TooltipContainer and formatDuration provided as shared primitives.

## [0.11.0-beta] - 2026-04-06

### Added
- **Trips tab in the sidebar** — Quick selection of all saved trips
  directly from the flight panel, including flight count, year and
  total kilometers.
- **TripTooltip on the map** — Selecting a trip now shows an info card
  with the route chain, travel dates, total duration, distance,
  airlines and aircraft types.
- **Airport statistics tooltip** — Clicking an IATA code or airport
  point opens a stats card with departures/arrivals, most common
  routes, total kilometers and operating airlines for that airport.
- **Auto-highlight when using "Show on map"** — All flights of a trip
  are automatically selected as soon as the user switches into the
  trip route view via "Show on map".
- **Airport markers on the trip route layer** — Pulsed rings and
  labels for all departure and destination airports of the active
  trip.
- **5 demo trips** — Seed data for new users now includes five
  predefined trips (Barcelona, Dubai & Singapore, Japan, Scandinavia,
  USA West Coast).

### Fixed
- **Tooltips follow the map** — All info windows (flight, trip,
  airport) update their position while scrolling and zooming through
  geo-anchored projection.
- **Trip info card above the arcs** — Tooltip is positioned above the
  bounding box of all airports so it does not sit on top of the route
  lines.
- **Sidebar stays open** — Selecting a trip from the sidebar panel no
  longer auto-closes the panel.
- **Back to the normal view** — Closing the trip tooltip resets
  `visMode` to "routes" and clears the trip selection.
- **Arc click tolerance** — `pickingRadius: 5` on the MapboxOverlay
  fixes the issue where clicks on thin arcs were not registered.
- **deck.gl layer re-rendering** — Colors are pre-computed in the data
  so deck.gl reliably repaints on selection.

Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

## [Unreleased]

---

## [0.10.0-beta] - 2026-04-05 (Update 2)

### Added
- **`operatingAirline` field**: New optional DB field `operating_airline`
  (migration `20260405000000_add_operating_airline`). Stores the
  operating carrier for codeshare flights as well as rail/bus tickets.
- **"Operated by" form field**: Added to `FlightEditModal` and
  `FlightCompleteStep` with `<datalist>` autocomplete.
- **Airline autocomplete**: All airline fields now have browser-native
  `<datalist>` autocomplete with ~75 airlines including rail/bus
  operators (DB, FlixTrain, Flixbus, ÖBB, SBB, TGV, Eurostar).
- **`cleanEmailBody()` utility**: Cleans up plain-text email bodies
  before parsing — strips HTML tags, URLs, normalizes whitespace.
  Mirrors the `filterEmailText` function used in the annotation view.

### Changed
- **Parser runs against cleaned text**: `parseEmail()` applies
  `cleanEmailBody()` before handing text to any parser — parser and
  annotation view now see identical text.
- **`EmailAnnotation` stores filtered text**: `fullText` on annotations
  is stored as `filterEmailText(raw)` instead of raw — annotation
  positions and pattern derivation are consistent.
- **Airline auto-derived**: Post-processing derives the airline name
  from the flight number prefix (`LH2316` → `LH` → `"Lufthansa"`) when
  `airline` is empty.
- **Parser recognizes "operated by"**: Patterns like `"operated by X"`
  / `"durchgeführt von X"` are automatically captured as
  `operatingAirline`.
- **`AIRLINE_IATA_MAP`** expanded from 15 to ~75 airlines.

### Fixed
- **400 error when adding a flight**: The Zod schema threw when
  `airline: ""` (empty string) was submitted. Fix:
  `emptyStringToUndefined` transform on `airline` and `flightNumber` in
  `baseFlightSchema`.
- **LH-old template**: `flightNumber` pattern changed to
  `^([A-Z]{2}\s+\d{3,4})$` — works after `cleanEmailBody()` because
  `<img.png>\tLH 2316\t` becomes `LH 2316` on its own line. Template
  version bumped to `2025-04b` and pushed to the GitHub templates
  repository.

---

## [0.10.0-beta] - 2026-04-04

### Added
- **Enrichment two-mode system**: flights < 1 year → full enrichment
  (aircraft, ICAO codes, route, terminal, gate); flights ≥ 1 year →
  slim enrichment (ICAO codes + terminal only).
- **`getEnrichmentMode()`**: Exported helper that determines enrichment
  mode from flight age.
- **Route median interpolation**: `aggregateRoutes` now resamples all
  reference routes to 20 points and computes per-position median
  lat/lon — replaces the "take newest route" approach.
- **Enrichment badge in PendingUpdateCard**: Full (green) / slim
  (amber) badge plus an "estimated · not verified" disclaimer with
  reference flight count and confidence score.
- **Two-mode explanation panel** in Settings → Enrichment tab.

### Changed
- **`findEnrichmentCandidates`**: Now excludes flights with `pending`
  or `rejected` pending updates (previously only `applied` was excluded
  — caused infinite nightly re-processing).
- **Settings simplified**: `requireApproval` and `autoProcess` removed
  — enrichments always create a pending update requiring manual
  confirmation. Settings reduced from 6 to 3 fields (`enabled`,
  `minConfidence`, `maxPerDay`).
- **Scheduler**: Runs for all users with
  `historicalEnrichmentEnabled=true` (no longer gated on
  `autoProcess`).

### Removed
- **`historicalEnrichmentMaxAgeYears`**,
  **`historicalEnrichmentAutoProcess`**,
  **`historicalEnrichmentRequireApproval`** from the `UserSettings`
  schema and DB.

---

## [0.9.6-beta] - 2026-04-03

### Added
- **Ollama config in admin UI**: `ollamaUrl`, `ollamaModel`,
  `ollamaVisionModel` stored in the `AdminSettings` DB table; editable
  in Admin → Parser Settings.
- **Backup schedule in admin UI**: `backupEnabled`, `backupInterval`,
  `backupRetentionDays` stored in `AdminSettings`; editable in Admin →
  Backup Management.
- **`dateUtils.ts`**: Timezone-aware date/time formatting with
  `Intl.DateTimeFormat`; graceful UTC fallback for invalid timezone
  strings.
- **Timezone-aware flights table**: `FlightsTablePage` now formats
  dates using the user's configured timezone from the settings store.

### Changed
- **`getParserConfig()`**: Reads `ollamaUrl/Model/VisionModel` from the
  `adminSettings` parameter with ENV fallback.
- **`backupScheduler.ts`**: `getBackupSettings()` reads backup config
  from the DB instead of ENV; runtime validation via `VALID_INTERVALS`
  / `toBackupInterval()`.
- **`BackupSection`** (Settings): Now a read-only status view; backup
  schedule configuration moved to Admin → Backup Management.
- **`NotificationsSection`** (Settings): Removed dead toggles; now
  renders only `NotificationPreferences`.

### Removed
- **`debugLoggingEnabled`** + **`requireUserApiKeys`** from
  `AdminSettings` schema — log level from ENV, API keys always
  required.
- **`trainingSeparateModels`** from the `UserSettings` schema.
- **`SystemSettings`** model dropped entirely.
- **Ghost backup/notification fields** from `settingsStore`,
  `useSettingsPage`, API types.

---

## [0.9.5-beta] - 2026-04-03

### Removed
- **LLM training dead code**: Deleted orphaned `TrainingDashboard`,
  `TrainingDataFilters`, `TrainingDataPreview` components (never
  imported after the TrainingPage → ParserPage refactor).
- **Save + Train button**: Removed the LoRA fine-tuning trigger from
  `EmailAnnotation` and `BoardingPassAnnotation` — annotation now
  always derives templates via the `annotate` endpoint only.
- **Dead `trainingApi` methods**: `saveAndTrain`, `trainOnly`,
  `getData`, `getJobs`, `getJobLogs`, `triggerTraining`,
  `cancelTraining`, `deleteTrainingData` removed from the frontend API
  client.
- **Dead TypeScript types**: `TrainingJob`, `TrainingJobLog`,
  `TrainingJobLogsResponse` removed from `types/index.ts`.
- **LLM-only backend endpoints**: `POST /:id/save-and-train`, `POST
  /:id/train-only`, `GET /data`, `GET /jobs`, `GET /jobs/:id/logs`,
  `DELETE /:id`, `POST /trigger`, `POST /jobs/:id/cancel`, `GET
  /data/analysis` removed from the training route.

---

## [0.9.3-beta] - 2026-04-03

### Added
- **Annotation-driven template parser**: Users can annotate parsed
  email fields to derive regex-based templates. Annotated patterns are
  stored as `ParserTemplate` records and applied as step 0 in the
  parser factory for future emails from the same airline.
- **TemplateDeriver**: Derives multi-flight regex templates from user
  annotations (`textSelections`) with field source tracking
  (`fieldSources`).
- **FingerprintMatcher**: Matches incoming emails to existing user
  templates by airline/subject fingerprint.
- **UserTemplateEngine**: Executes derived templates against email
  bodies with multi-flight extraction.
- **Parser templates CRUD API**: `GET/POST/DELETE
  /api/v1/parser-templates` — list, activate, disable, delete
  user-derived templates.
- **TemplateReviewCard**: UI card shown after annotation save to
  display the newly derived template with confidence score.
- **Colour-coded confidence borders** in `FlightReviewModal`: green
  (template match), yellow (LLM fallback).
- **`fieldSources`** on `ParsedBooking` — tracks which field was
  extracted by which method.

### Fixed
- Regex PNR `matchAll` missing `g` flag — caused 500 errors during
  email parsing.
- `GET /api/v1/parser-templates/:id` endpoint added (was missing).
- Body length guard against ReDoS attacks in parser template routes.
- `TemplateReviewCard` async error handling and loading states.

---

## [0.9.2-beta] - 2026-04-02

### Changed
- **Map amber redesign**: The glassmorphism theme now uses TravStats
  brand colors (amber → orange → red) throughout all visualization
  modes. Replaces the previous indigo/cyan color scheme.
- **Filter as FAB**: Filter button moved from the bottom-center bar to
  a bottom-right FAB stack (frosted-glass style, opens upward). The
  mode FAB is stacked above the filter.
- **CSS tokens**: `--map-accent`, `--map-fab-gradient`, `--map-active-*`,
  `--map-badge-*` all updated to amber. Sepia CSS filter on the map
  canvas removed. Dark-matter map style restored unconditionally.

### Added
- **Globe night earth**: Night-earth texture (`earth-night.jpg`) with
  amber atmosphere glow + starfield background (`night-sky.png`) in
  globe mode.
- **Globe legend stacking**: Auto-rotation toggle and route-frequency
  legend share the bottom-left column (no overlap).

### Fixed
- Airport labels (`TextLayer`) now always render above arc lines
  (`depthCompare: "always"`).

---

## [0.9.1-beta] - 2026-03-31

### Added
- **Email import as the primary tab**: Email import promoted to the
  main "Import" tab in the UI. `EmailImportTab` component with drag &
  drop, airline notice and text fallback.
- **Template status view**: Settings page shows GitHub-linked template
  status. New `TemplateStatusView` component + `/api/v1/templates/status`
  endpoint.
- **Duplicate flight detection**: POST `/api/v1/flights` returns 409
  with `existingFlight` details when a duplicate is detected. The
  frontend shows a confirmation dialog with an "Add anyway" option
  (`?force=true` bypass).
- **Year-over-year statistics**:
  `/api/v1/stats/summary?year=YYYY&compareYear=YYYY` with delta badges
  (↑↓ % change).
- **Travel companions**: `companions` field on the Flight model.
  Tag-style input in `SimplifiedFlightFormV2`.
- **Seat statistics**: `GET /api/v1/stats/seats` — distribution by
  position, zone and cabin class.
- **Flight certificate**: `FlightCertificate.tsx` generates a
  downloadable PNG stats card via html2canvas.
- **Email notifications**: SMTP config, per-user notification
  preferences, node-cron reminder scheduler.
- `statsLimiter` (30 req/min) and `adminExportLimiter` (5/hr) rate
  limiters.

### Changed
- **deck.gl visualization**: 6 map modes — routes, heatmap, hexagon
  (3D), 3D columns, trips (animated), globe (react-globe.gl).
- `VisModeSelector`, `TimeSlider`, layer factories for all
  visualization modes.
- Map integration refactored from Leaflet to deck.gl 9.x + MapLibre GL
  5.x.
- `flightNumber` now included in `calculateChanges` comparison fields
  (was silently ignored before).

### Fixed
- Fresh-DB migration ordering: early migrations (`202501xx`) wrapped in
  `IF EXISTS` guards; catch-up migration (`20251221`) recovers all
  columns.
- Backend CI: ESLint added as an explicit dependency, ESLint 9 rule
  violations resolved.
- All 156 backend tests now pass (assertions aligned with actual
  service/route return types).
- GeoJSON layer factories now read from `geometry.coordinates`, not
  unpopulated airport `lat`/`lon` fields.

---

## [0.9.0-beta] - 2026-02-24

First public beta release. Re-versioned from 1.0.x to 0.9.0-beta to
reflect that not all planned features are complete yet.

### Added
- Version badge in About tab (reads from package.json).
- Rate limiting on backup-restore (3/hr) and training-trigger (2/hr)
  endpoints.
- Zod validation for stats route query parameters.
- PayPal donation and GitHub Star buttons in Settings → About.
- i18n translations for all hardcoded strings in
  `SimplifiedFlightForm`.
- Missing `unknownDate` i18n key in dashboard translations.
- i18n translations for hardcoded strings in `DashboardPage` (PDF
  export, map/stats fallbacks).

### Changed
- Package versions bumped to `0.9.0-beta` (frontend + backend).
- Admin page refactored to sidebar layout.
- All plain browser checkboxes replaced with the styled `.checkbox`
  class.

### Fixed
- `alert()` calls in AchievementsPage replaced with toast
  notifications.
- `console.debug()` calls in `barcodeExtractor.ts` replaced with
  `logger.debug()`.
- Dark mode issues across all pages (hardcoded Tailwind colors → CSS
  variables).

---

## [1.0.1] - 2026-02-23

### Added
- Prettier formatter for frontend TypeScript/TSX/CSS (`format` and
  `format:check` scripts).
- ts-prune dead code detection scripts in frontend and backend
  (`dead-code` script).
- Vitest coverage reporting with v8 provider and regression thresholds
  (`test:coverage` script).
- ruff.toml Python linter config; auto-fixed 220 issues in training
  scripts.
- bandit security config (`.bandit.yml`) for Python script scanning.
- License whitelist (`LICENSE_WHITELIST.txt`) covering all project
  dependencies.
- Pre-commit hooks: trailing whitespace, YAML/JSON validation, secret
  detection, ruff, Prettier.
- GitHub Actions CI workflow: backend (typecheck + lint + test with
  Postgres), frontend (typecheck + lint + format + coverage), Python
  (ruff + bandit).
- Dev setup scripts (`scripts/setup-dev.sh` and
  `scripts/setup-dev.ps1`) for onboarding.
- Smoke test script (`scripts/smoke-test.sh`) for post-deploy
  verification.

### Changed
- Docker security hardening: `cap_drop: ALL` + minimal `cap_add`,
  `no-new-privileges`, log rotation, and resource limits on `app`,
  `db`, and `ollama` services.

### Fixed
- Removed unnecessary `CAP_SETUID`/`CAP_SETGID` from the app container
  (root can setuid without them).
- Corrected the pre-commit prettier hook entry to properly forward
  filenames (`npx --prefix frontend prettier --write`).
- Removed dead coverage config block from `vite.config.ts` (shadowed
  by `vitest.config.ts`).

## [1.0.0] - 2026-02-23

### Added
- Initial stable release.
- Flight tracking with map visualization (Leaflet, 3D globe).
- Statistics dashboard (distance, time, routes, heatmaps).
- Achievements & gamification system (20+ badges).
- Boarding pass scanner (QR/barcode + OCR via Tesseract.js).
- Email booking import (manual upload + IMAP polling).
- Flight data lookup (AirLabs API integration).
- OpenFlights airport database (~14,000 airports).
- Export: CSV, GeoJSON, KML.
- Tags & categories (business/private).
- Cost tracking per flight.
- Dark/light mode.
- Multi-language support (DE/EN).
- LLM-powered parsing (Ollama integration).
- LoRA fine-tuning pipeline for email/boarding-pass models.
- Pre-training data quality analysis (`checkTrainingData.py`).
- Post-training model evaluation (`evalModel.py`).
- Training metrics parsing (loss, steps, epochs).
- Docker deployment with nginx + supervisor.
- JWT authentication with secure cookie handling.
