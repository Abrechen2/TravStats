# Anonymous Usage Statistics — Design

**Date:** 2026-07-10
**Status:** Approved (brainstorming), pending implementation plan
**Branch:** `dev/usage-stats` (off `main`, merged **after** 2.3.0 is promoted)
**Target version:** 2.4.0 (minor — new feature, matches the `/deploy` bump rule)
**Repos touched:** `TravStats` (client + consent UI), `TravStatsWeb` (public
dashboard + privacy docs), new `travstats-stats` micro-service
**Depends on:** `2026-07-10-whats-new-modal-design.md` (Phase 0 — hosts the
consent card)

## 1. Summary

Add an **opt-in, anonymous usage-statistics** system so TravStats can show
worldwide adoption on a public dashboard at `travstats.de/stats`. Each consenting
install reports a small anonymous payload roughly once per 24 h to a standalone
micro-service, which aggregates it into a cached, read-only rollup that the
marketing site renders.

Modelled directly on the Sublarr implementation
(`Sublarr/docs/superpowers/specs/2026-07-09-anonymous-usage-stats-design.md` and
the live `sublarr-stats` service), with three deliberate divergences: the payload
is TravStats-shaped, the service is Node/TypeScript rather than Flask, and the
GDPR posture is stricter (§3).

This is unrelated to the per-user in-app statistics pages, which are unaffected.

## 2. Goals / Non-goals

**Goals**
- Opt-in only, default off, transparent, GDPR-clean, trivially revocable.
- Ask new installs (setup wizard) **and existing installs** (What's-New modal).
- Minimal anonymous payload. No PII, no paths, no travel details, no keys, no
  stored IP.
- Public dashboard with two headline numbers — active installs and total
  kilometres travelled by the community — plus adoption breakdowns and a trophy
  rarity ranking.

**Non-goals (Phase 1)**
- Geo/region breakdown, retention cohorts, per-user analytics.
- Any identifying, per-user, or per-trip data.
- Coupling the telemetry store to the product's production database.

## 3. GDPR — the load-bearing decisions

**We treat the payload as personal data even though it is formally anonymous.**
On a single-user install, "128,400 km flown, trophy `night_owl` unlocked"
describes exactly one natural person. Recital 26 would probably exempt us; relying
on "probably" on behalf of other people's self-hosted instances is the wrong risk.
So the full data-subject rights apply by construction, not by request.

| Concern | Decision |
|---|---|
| **Legal basis** | Consent, Art. 6 (1) a. Default `unset` — no ping ever. Yes and No carry equal visual weight. No pre-ticking, no re-prompt loop. |
| **Withdrawal (Art. 7 (3))** | The Admin toggle. Withdrawal is exactly as easy as granting. |
| **Erasure (Art. 17)** | Flipping to `denied` fires one `DELETE /v1/install/<install_id>`; the server drops the row. No e-mail required. If the request fails, retention (below) catches it. |
| **Storage limitation** | `installs` rows unseen for **180 days** are hard-deleted by a daily cron. `daily_active` holds only counts with no subject link and is retained indefinitely. |
| **IP addresses** | Needed for rate limiting → Art. 6 (1) f, legitimate interest (abuse prevention). Hashed, in-memory, TTL-bounded, **never persisted**. |
| **Access logs** | **nginx and cloudflared access logging for the `stats.travstats.de` vhost must have IP logging disabled.** Otherwise the IP lands on disk and the entire promise is void. This is an explicit implementation task, not a footnote. |
| **Cloudflare** | Terminates the tunnel and therefore sees client IPs. Disclosed in the privacy notice, including the third-country transfer. |
| **Transparency (Art. 13)** | A docs page on travstats.de reproducing the payload **verbatim**, not paraphrased. Linked from every consent surface. |
| **Accountability (Art. 30)** | A record of processing activities committed to the `travstats-stats` repo. |
| **Subject access** | `install_id` is displayed in the Admin UI so an operator can evidence an access or erasure request by e-mail. |

**Never sent:** IP, hostname, filesystem paths, airport / port / ship / airline
names, travel dates, usernames, e-mail addresses, API keys, or exact counts — with
the sole exception of the two rounded distance sums and the trophy total.

## 4. Consent model

Instance-wide, admin-only. The payload describes the *installation*, not a user,
so a per-user toggle would raise an unanswerable question: what do we send when
two of three users consent?

Two new columns on `AdminSettings`:

| Column | Type | Default | Meaning |
|---|---|---|---|
| `usageStatsConsent` | `String` | `"unset"` | `unset` \| `granted` \| `denied` |
| `usageStatsInstallId` | `String?` | `null` | random uuid4 hex, generated on first grant |

`usageStatsInstallId` is a **purely random uuid4**. Never derived from IP,
hostname, MAC address, database ID, or any path. It is a dedup key, not a
fingerprint.

### Consent surfaces

1. **`SetupPage`** — a Yes/No step during first boot.
2. **`WhatsNewModal`** — a consent card passed through the modal's `extraSlot`,
   shown once to existing installs at their next update. Answering persists, so it
   never re-prompts. Admin users only; non-admins see the modal without the card.
3. **`AdminPage` → General** — a permanent toggle flipping `granted` ⇄ `denied`.

Every surface links "Was wird gesendet?" to the docs page. DE primary, EN mirrored,
per the project language policy.

On **granting**, the client fires one immediate ping so the dashboard reflects the
new install without waiting up to 24 h.

## 5. Payload schema (the complete contract)

```json
{
  "install_id": "<random uuid4 hex>",
  "version": "2.4.0",
  "arch": "amd64 | arm64",
  "enabled_domains": ["flight", "cruise"],
  "users_bucket": "1 | 2-5 | 6-20 | 20+",
  "flights_bucket": "<50 | 50-250 | 250-1k | 1k+",
  "cruises_bucket": "0 | 1-5 | 6-20 | 20+",
  "distance_km": { "flight": 128400, "cruise": 9200 },
  "achievements": { "unlocked_total": 87, "keys": ["globetrotter", "night_owl"] },
  "features": {
    "llm_parser": true,
    "backups": true,
    "webdav_sync": false,
    "historical_enrichment": false,
    "live_tracking": true
  },
  "flight_api_providers": ["airlabs", "opensky"],
  "locale": "de | en",
  "reported_at": "<ISO 8601 UTC>"
}
```

### Where every field actually comes from

The brainstorm assumed a config surface that does not exist. Verified against
`backend/prisma/schema.prisma` and the settings routes, each field resolves as:

| Field | Source |
|---|---|
| `version` | `appVersion` from `backend/src/utils/version.ts` (prerelease suffix stripped) |
| `arch` | `process.arch` → `x64` → `amd64`, `arm64` → `arm64` |
| `enabled_domains` | **Union** of `UserSettings.enabledDomains` across all users. It is a per-user column, not an instance setting. |
| `users_bucket` | `prisma.user.count()` |
| `flights_bucket` | `prisma.flight.count()` |
| `cruises_bucket` | `prisma.cruise.count()` |
| `distance_km.flight` | `SUM(Flight.routeDistance)` — nullable, so NULLs are skipped |
| `distance_km.cruise` | `SUM(CruiseLeg.distanceKm)` — non-null |
| `achievements.unlocked_total` | `prisma.userAchievement.count()` |
| `achievements.keys` | distinct `Achievement.code` joined via `UserAchievement` |
| `features.llm_parser` | derived: `AdminSettings.ollamaUrl` set **or** `globalOpenaiApiKey` set **or** `globalClaudeApiKey` set |
| `features.backups` | `AdminSettings.backupEnabled` |
| `features.webdav_sync` | `AdminSettings.webdavSyncEnabled` |
| `features.historical_enrichment` | **any** user with `UserSettings.historicalEnrichmentEnabled = true` (per-user column) |
| `features.live_tracking` | **any** flight with `Flight.hasLiveTracking = true`. There is no global toggle. |
| `flight_api_providers` | which `AdminSettings.global*ApiKey` columns are non-null. Names only, never values. |
| `locale` | most frequent `UserSettings.data.display.language` across users (it lives inside the `data` JSON blob, not a column); ties resolve to `en` |

**Corrections against the brainstorm.** `features.immich` was **dropped**: there is
no Immich integration anywhere in `backend/` or `frontend/` — it lives unmerged on
`dev/immich-albums`. Shipping a telemetry field for a feature that does not exist
would report `false` for every install forever. `features.live_tracking` was
redefined, because it is a per-flight boolean rather than a setting.
`enabled_domains`, `historical_enrichment`, and `locale` were all assumed to be
instance-level and are in fact per-user, so each becomes an aggregate.

Notes on specific fields:

- **`db_backend` is absent.** Sublarr needs it (SQLite vs Postgres); TravStats is
  always Postgres.
- **`cruises_bucket` has an explicit `"0"` bucket.** "Cruise domain enabled but
  never used" is the single most interesting adoption signal, and it would vanish
  inside a `<50` bucket.
- **`distance_km`** — sums across all users of the instance, **rounded to the
  nearest 100 km**. Summable, so the dashboard can print a community total.
  Rounding stops an exact odd number from acting as a de-facto instance
  fingerprint across pings.
  `flight` sums `Flight.routeDistance`, which is **nullable** — flights without a
  resolved route contribute nothing. The sum is therefore a *lower bound*, and the
  dashboard must label it as such ("mindestens"). `cruise` sums
  `CruiseLeg.distanceKm`.
- **`achievements.keys`** — `Achievement.code` slugs, deduplicated, no per-key
  counts. Counts would leak how many users hold a given trophy, which on a
  two-user instance indirectly reveals per-user data for negligible analytical
  gain.
- **`flight_api_providers`** — which providers are *configured*. Never the keys.

## 6. Client

New module `backend/src/services/usageStats.ts`:

- `getConsent()` / `setConsent(value)` — read/write `AdminSettings`.
- `getOrCreateInstallId()` — random uuid4, persisted on first call.
- `buildUsagePayload()` — **pure aggregation over the DB, no I/O to the network.**
  Independently testable; this is where the no-PII assertion bites.
- `sendPing(payload, endpoint)` / `sendDelete(installId, endpoint)` — best-effort,
  short timeout (~5 s), **never throws**, `logger.debug` on failure.
- `usageStatsTick()` — the scheduled entry point.

`usageStatsTick()` returns immediately unless consent is `granted` **and** the
endpoint is non-empty. Registered as a `node-cron` job in
`backend/src/jobs/`, following the existing scheduler modules
(`flightUpdateScheduler.ts`, `backupScheduler.ts`). Daily, with jitter so a
thousand installs do not all ping at midnight UTC.

**Telemetry must never affect the running app.** Every failure path swallows,
logs at debug, and returns.

## 7. Server — `travstats-stats`

**Stack:** Node 24 + Express + Zod, storage via **`node:sqlite`** (the Node
built-in). No native dependency, no build toolchain, no Postgres.

**Placement — mirroring the live `sublarr-stats` setup exactly:** CT133
(`travstats.de`, DMZ, **3.9 GB disk / 256 MB RAM**, no Docker) is far too small
for Docker + Postgres. So: a **systemd service** bound to `127.0.0.1:8088`,
running as `www-data`, SQLite file at `/opt/travstats-stats/stats.db`, exposed as
a second public hostname `stats.travstats.de` on the **existing `travstats-web`
Cloudflare tunnel** (`ddd96c4a-d3d9-40de-9c8e-0f6321917f08`).

The 256 MB RAM budget is precisely why `node:sqlite` beats `better-sqlite3`
(native build) and why Postgres is off the table.

### Endpoints

| Endpoint | Behaviour |
|---|---|
| `POST /v1/ping` | Zod-validate; per-IP rate limit (hashed, in-memory, transient); upsert one row per `install_id`, updating `last_seen` and the latest field values. |
| `DELETE /v1/install/:id` | Consent withdrawal. Deletes the row. Rate-limited. Idempotent — a missing row returns 204, not 404, so we never confirm or deny an id's existence. |
| `GET /v1/aggregate` | Cached rollup JSON, recomputed every ~5–10 min. `Cache-Control` set. `Access-Control-Allow-Origin: *`. "Active" = pinged within 30 days. |
| `GET /health` | Liveness. |

### Storage

```
installs(install_id PK, first_seen, last_seen, version, arch,
         enabled_domains, users_bucket, flights_bucket, cruises_bucket,
         distance_flight_km, distance_cruise_km,
         achievements_total, achievement_keys,
         features, flight_api_providers, locale)

daily_active(day DATE PK, active_count INT)
```

JSON-shaped columns (`enabled_domains`, `achievement_keys`, `features`,
`flight_api_providers`) are stored as JSON text — SQLite has no array type and the
rollup reads them whole.

### Cron jobs

- **Daily rollup** → one `daily_active` row. Without this the growth chart cannot
  be reconstructed after installs age out.
- **Daily retention purge** → delete `installs` rows with `last_seen` older than
  180 days (§3).

### Hardening

Zod whitelists for `arch`, all bucket values, and `locale`. Length caps on
`achievement_keys` and `flight_api_providers`. A plausibility ceiling on
`distance_km` — otherwise one actor pings 10^12 km and the headline number is
garbage. Rate limiting on both write endpoints.

Spoofing a vanity metric is not perfectly preventable. The rate limit, the schema
validation, the plausibility ceiling, and the 30-day active window (fake installs
age out) keep it honest enough. **Accepted, as in Sublarr.**

## 8. Public dashboard — `travstats.de/stats`

An Astro page in TravStatsWeb fetching `GET /v1/aggregate` client-side.

- **Headlines:** "**N aktive Installationen**" and "**zusammen mindestens X,X Mio.
  km gereist**" — the "mindestens" is required by the nullable-distance caveat in
  §5, not marketing hedging.
- **Sections:** growth line chart (from `daily_active`) · version distribution ·
  domain usage · arch split (amd64 vs arm64; arm64 labelled "ARM64 — Raspberry Pi,
  Apple Silicon, …" since the payload cannot distinguish them) · feature adoption ·
  deployment-size distribution · **trophy rarity ranking**.
- Charts follow the `dataviz` skill palette, theme-aware.

**CT133's nginx CSP `connect-src` must be extended with
`https://stats.travstats.de`**, in `/etc/nginx/snippets/security-headers.conf`.
This is the same trap `sublarr-stats` hit. Note also the project's known
`add_header` inheritance gotcha: a server-level header is silently dropped once
any `location` block adds its own.

## 9. Configuration

| Key | Type | Default | Effect |
|---|---|---|---|
| `usageStatsConsent` | `AdminSettings` column | `unset` | `granted` enables pings; `denied`/`unset` disables |
| `usageStatsInstallId` | `AdminSettings` column | *(generated on first grant)* | anonymous random dedup key |
| `TRAVSTATS_STATS_ENDPOINT` | env | `https://stats.travstats.de` | service **base URL**; **empty string disables all sending**, regardless of consent — the self-hoster override and kill-switch |

The variable holds the base URL, not the ping path. The client appends `/v1/ping`
and `/v1/install/<id>` itself. Sublarr's equivalent points at the full ping path,
which works only because it has no second endpoint to call; a base URL is the
right shape here.

## 10. Testing

**Client**
- `buildUsagePayload()` field correctness and bucket boundaries.
- **An assertion that actively scans the payload for PII markers** (hostname,
  paths, usernames, e-mails, key-shaped strings) rather than merely asserting the
  expected keys are present. Asserting presence cannot catch an accidental
  addition; scanning can.
- Distance rounding; nullable `routeDistance` excluded without throwing.
- Consent gate: no ping when `unset` or `denied`.
- Kill-switch: no ping when the endpoint is empty, even when `granted`.
- `install_id` stable across calls.
- Withdrawal sends exactly one DELETE.
- `sendPing` never throws on network failure, timeout, or 500.

**Server**
- Schema accept/reject cases, including the plausibility ceiling and length caps.
- Upsert dedups by `install_id` (second ping updates, does not insert).
- Aggregate rollup correctness; 30-day active window.
- Rate-limit behaviour on both write endpoints.
- `DELETE` on an unknown id returns 204.
- 180-day retention purge.

**Frontend**
- Consent card renders in `SetupPage` and in `WhatsNewModal`'s `extraSlot`.
- The card is hidden from non-admin users.
- Admin toggle round-trips and triggers the DELETE on withdrawal.
- Both DE and EN i18n keys resolve.

## 11. Version and sequencing

**Target is 2.4.0.** This is a `feat:`, and the project rule maps `feat:` → minor,
so `/deploy` auto-determines 2.4.0 with no override needed.

**Sequencing.** `2.3.0-rc.3` is still awaiting promotion on the RC server (CT107).
`dev/usage-stats` branches from `main` and merges only **after** 2.3.0 is final.
Per the project rules: merge `main` into the branch regularly, never rebase, and
never touch `backend/VERSION` or `CHANGELOG.md` on the branch.

## 12. Phasing

- **Phase 0:** What's-New modal (separate spec, ships standalone).
- **Phase 1:** client ping + 3 consent surfaces + admin toggle + ingest service +
  dashboard + privacy docs page + record of processing activities.
- **Later:** coarse region breakdown (from a transient IP, separately opt-in),
  retention cohorts, provider co-occurrence.

## 13. Risks and open items

- **Low participation** despite the active ask. Accepted — the data is a bonus,
  not a dependency.
- **`install_id` resets on a config wipe** → slight long-run over-count. Mitigated
  by the 30-day active window.
- **A new deployable to maintain.** Accepted; kept deliberately tiny and isolated
  from the product database.
- **Ping spoofing** inflating numbers. Mitigated, not eliminated. Accepted.
- **Access-log IP leakage** on CT133 — the single highest-consequence
  implementation detail in this design. It must be verified on the live host, not
  assumed from config.
- **Prisma migration drift.** `schema.prisma` carries known pre-existing drift vs.
  the migration history. Inspect the generated SQL for the two `AdminSettings`
  columns and strip anything unrelated before committing.
