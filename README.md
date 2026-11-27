<div align="center">

<img src="docs/images/logo.svg" alt="TravStats" width="140" />

# TravStats

**Self-hosted travel logbook for small households and groups (1–10 users).**
Flights, cruises, stays, rail, bus, ferries, rentals and places in one timeline — on your own server, with no cloud account and no telemetry.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Release](https://img.shields.io/github/v/release/Abrechen2/TravStats?include_prereleases&sort=semver)](https://github.com/Abrechen2/TravStats/releases)
[![GHCR](https://img.shields.io/badge/container-ghcr.io-181717?logo=github)](https://github.com/Abrechen2/TravStats/pkgs/container/travstats)
[![Docker Hub](https://img.shields.io/docker/pulls/abrechen2/travstats?logo=docker&label=Docker%20Hub)](https://hub.docker.com/r/abrechen2/travstats)
[![CI](https://github.com/Abrechen2/TravStats/actions/workflows/ci.yml/badge.svg)](https://github.com/Abrechen2/TravStats/actions/workflows/ci.yml)
[![Discord](https://img.shields.io/badge/Discord-join%20chat-5865F2?logo=discord&logoColor=white)](https://discord.gg/CRnjB9f78t)
[![Documentation](https://img.shields.io/badge/docs-travstats.de-0A7EA4?logo=readthedocs&logoColor=white)](https://travstats.de/docs/)

**[travstats.de](https://travstats.de)** ·
**[Documentation](https://travstats.de/docs/)** — installation, the parsers,
the API and day-to-day operation.

A project by [`<abrechen2 />`](https://www.abrechen2.de/en/) ·
Ein Projekt von [`<abrechen2 />`](https://www.abrechen2.de/)

</div>

---

<p align="center">
  <img src="docs/images/globe.png" alt="Interactive 3D globe with flights and cruises radiating from a Munich hub across Europe, Asia and the Atlantic" width="90%" />
  <br />
  <sub>Multi-domain 3D globe — flights and cruises on one map, colour-coded by frequency and status</sub>
</p>

## What TravStats is

TravStats is a logbook first. You record trips by hand, scan a boarding pass,
import a confirmation e-mail or let the Companion app record them — and
TravStats turns them into history, statistics and maps. Everything you record
lives in your own PostgreSQL. It does not follow aircraft or people, nobody sees
where you are unless you create a share link yourself, and every outside service
(flight data, geocoding, AI parsing, photos) is optional and switched on by you.

## What it does

**Logbook** — flights, cruises (ports and sea days), stays and loyalty cards,
rail, bus, ferries, rentals, roadtrips and tours, places and curated checklists,
all with documents, costs and photos. Entries can be marked private or business
(built-in or your own purposes) and filtered by it. Import from boarding passes
(QR / PDF417 / OCR), e-mails (`.eml`, `.msg`), PDFs, spreadsheets, a mailbox
folder or a forwarding address — always as a proposal you confirm.
Statistics, 360+ achievements, a passport page, a year review and 2D/3D maps.

**TravTrack** *(opt-in location history)* — record from the Companion, OwnTracks
or Overland, or import GPX / KML / GeoJSON / TCX, a Google Timeline export or a
copy of your Dawarich history. Days are drawn from the best source, with
questionable days listed, privacy zones that cut points on the server, stops
named from your places, a calendar or a plugin (with a stated confidence), and an
optional road-matching cleanup. A recording can become a roadtrip.

**Plugins and calendar** — suggestion plugins (small signed HTTPS services you run
or trust) answer "what was here?" and can keep a list of their places or tidy
their own locations after your per-item confirmation; ICS and CalDAV calendars
(including iCloud) serve as read-only evidence. Template and contract:
[`packages/travstats-plugin-template`](packages/travstats-plugin-template).

**Sharing and federation** — linked trip copies between accounts and between
servers, with consent first; public trip links that expire; `.travstats` trip
files. A new share can be linked to a copy that already exists instead of
duplicating it.

**Comparison** — compare totals, never single trips, with friends on your server
or another one: head-to-head tables, fun figures, badges and curated-list progress.

**MCP and API** — an authenticated REST API with OpenAPI, personal access tokens,
and [`travstats-mcp`](packages/travstats-mcp), a local MCP server for assistants
such as Claude: read tools, and write tools that add an entry only after you
confirm it.

**Backups** — scheduled backups of the database and every upload folder, an
optional WebDAV copy, restore from the admin area, and a **recovery key** that
lets a lost server be restored with its encrypted credentials intact.

**Companion app** *(beta)* — pair a phone to record trips and flights, scan
documents and read your logbook offline; it uploads to your own server, which
stays the record. See the
[Companion guide](https://travstats.de/docs/user-guide/companion-app/).

## Screenshots

<table>
  <tr>
    <td width="50%"><img src="docs/images/cruises.png" alt="Cruise list across Royal Caribbean, AIDA, MSC, TUI and more with dates, ports, status and price" /></td>
    <td width="50%"><img src="docs/images/cruise-detail.png" alt="Cruise detail: a Norwegian-fjords itinerary with port timeline and sea-route map" /></td>
  </tr>
  <tr>
    <td align="center"><sub>Every cruise — ship, line, ports, sea days, status</sub></td>
    <td align="center"><sub>Per-cruise itinerary with the reconstructed sea route</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/images/stats.png" alt="Cross-domain statistics: lifetime totals, countries, active days and a stacked activity-per-year chart" /></td>
    <td width="50%"><img src="docs/images/achievements.png" alt="Achievements gallery with 360+ unlockables across flights, cruises and cross-domain" /></td>
  </tr>
  <tr>
    <td align="center"><sub>Cross-domain stats with year and all-time views</sub></td>
    <td align="center"><sub>360+ achievements, bronze to diamond</sub></td>
  </tr>
</table>

---

## Quick start

The only thing you set in a file is a database password. Everything else —
instance name, user cap, API keys, Ollama model, backup schedule, WebDAV —
is captured by the first-run setup wizard in the browser.

The same route with screenshots and the per-platform detail:
[Installation](https://travstats.de/docs/getting-started/installation/) and
[First run](https://travstats.de/docs/getting-started/first-run/).

### Option A — Stack (bundled Postgres, recommended)

```bash
# 1. Grab the compose file
curl -O https://raw.githubusercontent.com/Abrechen2/TravStats/main/docker-compose.prod.yml

# 2. Set one variable
echo "DB_PASSWORD=$(openssl rand -base64 32)" > .env

# 3. Start
docker compose -f docker-compose.prod.yml up -d

# 4. Open the setup wizard
open http://localhost:3000/setup
```

A fresh install runs the app as an ordinary Postgres role (`flights`), not a
superuser: a one-time init script in the compose file creates the role and the
PostGIS extension, then deletes the password of the bootstrap `postgres`
account, so `DB_PASSWORD` opens the ordinary role only (`postgres` stays
reachable from inside the container via `docker exec`). An install made with an older compose file keeps its
superuser role and works unchanged; to switch it over, run once
`docker exec travstats-db psql -U flights -d flights -c "ALTER ROLE flights NOSUPERUSER;"`.
Backup and restore work with either kind of role.

That's the complete install. The container seeds the airport database on
first boot (~30 s), auto-generates a JWT secret, and the setup wizard
persists instance settings to the database.

### Option B — External Postgres

If you already run a Postgres server (homelab, managed DB), skip the
bundled `db` service by providing `DATABASE_URL` and removing the `db` and
`depends_on` blocks from the compose file:

```bash
DATABASE_URL=postgresql://user:pass@postgres.lan:5432/travstats
```

### Unraid

Community Apps templates live in a dedicated repo —
[Abrechen2/docker-templates](https://github.com/Abrechen2/docker-templates).
Install `travstats-db` from there first, then `TravStats`, set the
`Database URL` password, open `/setup`. Walk-through with screenshots in
[`docs/unraid/README.md`](docs/unraid/README.md).

> **Optional local LLM parsing:** install the
> [Ollama Community App](https://unraid.net/community/apps?q=ollama)
> (or run Ollama anywhere else on your network), pull `gemma3:12b` (~7.5 GB),
> then point TravStats at it from *Einstellungen → Server → Buchungen lesen*. Multi-flight
> confirmation mails and unknown airline templates are then handled locally —
> nothing leaves your network.

### Image tags

Both registries (GHCR and Docker Hub) carry the same digests for these
moving tags. Pick the one your platform defaults to.

| Tag | Points to | Use for |
|---|---|---|
| `:latest`, `:stable` | Newest promoted stable release | Normal production. Auto-updates to the next promoted release. |
| `:X.Y.Z` | Pinned immutable release | Reproducible installs, audit, regulated environments. |
| `:rc-latest` | Newest Release Candidate | Beta testers — receive every fresh RC via `docker compose pull`. May include breaking schema changes; an in-place backup is taken automatically on the first start of ANY new version (see [Upgrades](#upgrades)). |

<!-- These rows deliberately name no version numbers. They used to read
     "currently 2.2.0" / "currently 2.2.1-rc.1" and were still saying that
     at 2.5.2 and 2.6.0-rc.26 — hand-maintained version prose goes stale
     the first time someone ships without re-reading the README, and then
     it misinforms with an air of precision. The badges at the top of this
     file resolve live; the releases page is always current. -->

Which version those moving tags currently resolve to is on the
[releases page](https://github.com/Abrechen2/TravStats/releases) and in the
Release badge at the top of this file.

Specific RC and beta tags (`:X.Y.Z-rc.N`, `:X.Y.Z-beta.N`) and dev builds
live on GHCR only — Docker Hub only mirrors the moving tags above plus
pinned final releases.

---

## Configuration

Almost nothing to configure via environment variables. The setup wizard
captures everything instance-level (name, public URL, user cap,
registration mode) and the admin UI handles API keys, Ollama, backup
schedule and WebDAV sync.

| Env variable | When to set it | Default |
|---|---|---|
| `DB_PASSWORD` | Always — shared secret between app and bundled Postgres | **required** |
| `APP_PORT` | Different host port | `3000` |
| `DATABASE_URL` | External Postgres instead of the bundled service | *(derived from `DB_PASSWORD`)* |
| `COOKIE_SECURE` | Reverse proxy doesn't send `X-Forwarded-Proto` | *(auto-detected)* |
| `CORS_ORIGIN` | Frontend lives on a different hostname than the API | *(same-origin only)* |
| `TRUST_PROXY` | Another reverse proxy (NPM, Traefik, Caddy …) sits in front — name its address, e.g. `loopback, 192.168.1.10`, or every visitor shares one login rate limit | `loopback` |
| `TZ` | Non-UTC container clock (not recommended) | `UTC` |
| `SKIP_PRE_MIGRATION_BACKUP` | Upgrade even though the automatic pre-upgrade backup cannot be taken — see [Upgrades](#upgrades) | *(unset; only the literal `true` counts)* |

See [`.env.prod.example`](.env.prod.example) for the annotated list.

### Behind a reverse proxy or CDN

**Never let a cache rule apply to `/api/`.** Every API response — receipts,
avatars, photos, documents, exports — belongs to one signed-in user. The app
marks all of them `Cache-Control: no-store` (or `private` where a browser may
keep them), but several common proxy settings ignore that header:

- **Nginx Proxy Manager → "Cache Assets"** caches every URL ending in `.png`,
  `.jpg`, `.svg`, `.js`, `.css` … for 30 minutes, keyed on host and path only,
  ignores the app's `Cache-Control` and `Set-Cookie`, and strips
  `Cache-Control` from the response. Whatever it caches is handed to the next
  visitor, signed in or not.
- **Cloudflare** caches a fixed list of extensions by default (`.pdf`, `.png`,
  `.jpg`, `.zip`, `.gz`, `.csv`, `.xlsx` …). It honours `no-store` — unless a
  proxy in front of the app removed it, which is exactly what the NPM switch
  above does. "Cache Everything" page/cache rules and "Edge Cache TTL"
  overrides ignore the header outright.

The API itself serves no private data at a URL that ends in a file
extension: files live at extension-less URLs (`…/content`, `…/file`),
older URLs answer only with a redirect, and any other `/api/` path ending in a
cacheable extension is refused with a 404. That closes the gap for
extension-based rules, but not for a rule that caches everything. So:

- In Nginx Proxy Manager, leave **Cache Assets** off for the TravStats proxy
  host.
- In Cloudflare, scope any cache rule to exclude `/api/*` — or add a rule that
  bypasses the cache for `/api/*`.
- In any other proxy (Traefik, Caddy, plain nginx), do not put `proxy_cache`
  or an equivalent on `/api/`.


### Runtime-configurable from the admin UI

Instance name, public URL, user cap and registration mode; flight-data API keys
(encrypted at rest); Ollama endpoint and model; routing; backup schedule and
retention; WebDAV copy; SMTP; logging. TravStats works without any API key —
manual entry and boarding-pass scanning cover the full feature set.

The optional integrations and every admin field are documented under
[Admin panel](https://travstats.de/docs/operations/admin-panel/),
[External services](https://travstats.de/docs/external-services/) and
[Backups](https://travstats.de/docs/operations/backups/).

Maps use OpenFreeMap by default (no key, no server of your own). The map provider
sees the visitor's IP address and the tiles requested; attributions must stay.
Operators may set public https style URLs with `MAP_STYLE_STANDARD_URL`,
`MAP_STYLE_LIGHT_URL`, `MAP_STYLE_DARK_URL` and `MAP_STYLE_VOYAGER_URL` (no
credentials or query strings); `GET /api/v1/map-config` serves them to clients.
Provider terms: <https://openfreemap.org/tos/>.

---

## Updating and backups

**Update:** `docker compose -f docker-compose.prod.yml pull && docker compose -f
docker-compose.prod.yml up -d`. Pin `VERSION` in `.env` to a release tag
(`VERSION=X.Y.Z`) if you do not want `:latest`.

**Service credentials live in the instance settings.** API keys and addresses of
external services (flight data, routing, geocoder, AI providers, Immich, Dawarich,
Strava, WebDAV, federation, ferry positions and the like) are not read from
environment variables. The first start copies each such variable that is still set
into the instance settings (only where the setting is empty, secrets encrypted) and
never reads it again. Manage them under *Einstellungen → Server → Dienste* and
remove them from your compose file.

**A snapshot before every version change.** Starting a version you have not run on
this data before takes a database snapshot BEFORE any migration, into
`/app/data/backups/` as `pre-v<version>-upgrade-<timestamp>.sql`. If it cannot be
taken, the container refuses to start with a `[pre-migration-backup] FATAL` block
naming the cause — nothing has been migrated, and the previous image still runs.
The usual causes: `pg_dump` older than the server (the client must be at least the
server's major version), a renamed database container (`DOCKER_DB_CONTAINER`), or no
free space. To upgrade anyway, set `SKIP_PRE_MIGRATION_BACKUP: "true"` (only the
literal `true` counts), take your own backup first and unset it afterwards.

**Scheduled backups** are off until you switch them on (*Einstellungen → Server →
Sicherungen*). An archive holds the database dump, every upload folder and a
metadata file; an optional **WebDAV** copy (Nextcloud, HiDrive, …) goes off-host.

**Save the recovery key.** The archive holds API keys, tokens and the SMTP password
only encrypted, and the key is deliberately not in it. Once an off-site copy exists,
administrators are asked to reveal, store and confirm a **recovery key**; a restore
on a new server can take it instead of the key file. Keep it outside the server, in
a password manager. See
[Recovery key](https://travstats.de/docs/operations/recovery-key/) and
[Backups & Restore](https://travstats.de/docs/operations/backups/).

---

## Known limitations

Things worth knowing before you commit a weekend to this. None of them are
secrets; they are just easier to read here than to discover later.

- **amd64 first.** Release candidates are published for `linux/amd64` only. Check
  a final tag's platforms (`docker buildx imagetools inspect`) before running it on
  a Raspberry Pi or an Apple-Silicon Mac; otherwise build the image yourself.
- **Single instance, small groups.** Designed and tested for roughly 1–10
  users on one instance. There is no multi-tenancy, no SSO/OIDC/LDAP, and
  no per-team permission model; accounts are invite-only by default and
  managed by an admin.
- **Postgres is required.** Bundled in the compose file, but there is no
  SQLite fallback, so the database is part of what you operate and back up.
- **Enrichment depends on third-party APIs.** Flight enrichment via
  AirLabs / Aviationstack / OpenSky is optional and works on free tiers,
  which means their rate limits and occasional gaps are yours too. Nothing
  breaks without a key — you just enter more by hand.
- **Local LLM parsing needs real hardware.** The Ollama path
  (`gemma3:12b`) handles messy multi-flight mails and unknown airline
  templates. On a shared, CPU-only VM it has been measured at a fraction of
  a token per second, which times out and falls back to the template
  parser. Budget a machine with a GPU or accept the regex path.
- **Import is assisted, not automatic.** Boarding passes, confirmation
  e-mails and CSV/Excel are parsed for you, and a mailbox folder or forwarding
  address can feed the inbox, but everything arrives as a proposal you confirm.
  There is no airline account linking.
- **The Companion app is in beta.** The web UI is drawn for tablets and is the
  main interface; the phone app records and reads your logbook.
- **Some features sit behind a beta flag.** An admin toggle hides
  unfinished areas on production instances. If something in the docs or a
  screenshot is not visible in your install, that is usually why.
- **Solo project.** One maintainer. Issues and fixes move at the pace that
  implies — see the commit history for an honest picture of it.

Symptoms that do have a fix — a container that won't start, a parser that
returns nothing, a reverse proxy that breaks the login cookie — are collected
in [Troubleshooting](https://travstats.de/docs/troubleshooting/).

## Security

See [SECURITY.md](SECURITY.md) for the hardening summary, audit history, and
verification commands. TL;DR: JWT in HttpOnly cookies, 18 distinct rate
limiters, Zod validation on every endpoint, Prisma-parameterised queries,
Helmet CSP, invite-only by default.

Report vulnerabilities via
[GitHub Security Advisories](https://github.com/Abrechen2/TravStats/security/advisories/new)
— **please do not open a public issue**.

## API for external tools

TravStats ships an authenticated REST API for AI agents, automation
scripts and integrations. Everything the web UI shows — flights,
cruises, lodging, places, trips and the statistics over them — is
reachable programmatically with the same token.

**1. Mint a Personal Access Token**: in the app, go to *Einstellungen → Mein Konto →
Profil & Anmeldung → API-Schlüssel* (expert view), give it a label and a scope (`read`, `write`, `admin`),
and copy the `ts_pat_…` value. The plaintext is shown exactly once —
only the bcrypt hash is persisted. Scopes, rotation and revocation:
[Personal access tokens](https://travstats.de/docs/api/personal-access-tokens/).

**2. Browse the spec**: open `https://<your-host>/api/v1/docs`
(Swagger UI) or fetch `/api/v1/openapi.json` for the raw OpenAPI 3.0
document. Request and response shapes come from the same Zod schemas
the backend validates with, so a documented field cannot describe a
shape the server rejects. Coverage is enforced separately: a test walks
the live route table and fails the build when an endpoint ships without
a spec entry. The admin API and the first-boot wizard are excluded on
purpose and named as such — they are not integration surfaces. A prose
walk-through of the endpoints, pagination and error shapes is at
[REST API](https://travstats.de/docs/api/rest-api/).

**3. Call it**: every endpoint accepts the token via the standard
`Authorization` header.

```bash
TOKEN="ts_pat_…"

# List your flights
curl -H "Authorization: Bearer $TOKEN" \
  https://travstats.example.com/api/v1/flights

# Create a flight (write or admin scope required)
curl -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"departure":{"iata":"FRA","lat":50.0379,"lon":8.5622},
          "arrival":{"iata":"JFK","lat":40.6413,"lon":-73.7781},
          "departureTime":"2026-05-01T08:00:00.000Z",
          "arrivalTime":"2026-05-01T17:00:00.000Z",
          "flightNumber":"LH400"}' \
  https://travstats.example.com/api/v1/flights
```

Pass `?merge=true` on `POST /flights` to enrich an existing matching
flight (boarding-pass re-import, email confirmation upgrade) instead
of creating a duplicate. Read-only tokens are blocked from mutating
endpoints with 403; admin endpoints additionally require an
`admin`-scoped token even if the owning user is an admin.

## Contributing

Bug reports, feature ideas and pull requests are welcome. The
[Report Bug](https://github.com/Abrechen2/TravStats/issues/new/choose) button
in the app copies an anonymised diagnostic bundle for you.
See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide.

## Development

```bash
npm run install:all     # install backend + frontend
npm run dev             # backend :8000 + frontend :3000
npm run typecheck       # tsc --noEmit on both
npm run lint            # eslint on both
npm run test:frontend   # Vitest (backend tests need Postgres)
```

CI (`.github/workflows/ci.yml`) runs typecheck, lint, Prettier, the file-size and
schema-drift checks and the Vitest and Jest suites; `security.yml` runs `npm audit`
and Trivy. [`.pre-commit-config.yaml`](.pre-commit-config.yaml) runs the same
checks locally (`pre-commit install`). Developer reference: [CLAUDE.md](CLAUDE.md).

---

## License

Copyright © 2026 Dennis Wittke · **AGPL-3.0-or-later**

You may use, modify and redistribute TravStats, but if you run it as a web
service (even modified) you must make the complete source code of your
modifications available under the same licence. See [LICENSE](LICENSE).

### Third-party data and assets

- **Airline logos** — [soaring-symbols](https://github.com/soaring-symbols/soaring-symbols),
  MIT, © 2024 Anh Thang. Vendored under `backend/data/airline-logos/` so a
  self-hosted instance gets logos with no API key and no external request.
  *The logos are the trademarks of the respective airlines. They are shown to
  identify the carrier of a flight (nominative use) and neither TravStats nor
  the asset authors claim any right in them, nor imply any endorsement by or
  affiliation with the airlines.*
- **Airports** — [OurAirports](https://ourairports.com/), public domain.
- **Shipping lanes** — Eurostat *marnet* network, © European Union.
- **Rail stations** — [Trainline stations](https://github.com/trainline-eu/stations),
  ODbL 1.0. A filtered copy (stations with a position that Trainline offers
  in its own search, plus their parents; nine columns) is vendored under
  `backend/data/rail/`, which carries the licence and how it was built. That
  derivative is itself available under the ODbL.
- **Train lookup and traced lines** — [Transitous](https://transitous.org/)
  and the timetables of [its sources](https://transitous.org/sources/), used
  for open-source, non-commercial purposes as its terms ask; German journeys
  can also be looked up through [db-rest](https://v6.db.transport.rest/). Both
  are asked only when a user presses "look the train up", and an admin can
  switch either off.

## Support the project

TravStats is a solo side project. If it's useful to you,
[a small donation via PayPal](https://www.paypal.com/donate?hosted_button_id=HW9MPYVURCT42)
keeps the lights on for AirLabs quota top-ups.

---

<div align="center">

**[Star on GitHub](https://github.com/Abrechen2/TravStats)** ·
[Releases](https://github.com/Abrechen2/TravStats/releases) ·
[Documentation](https://travstats.de/docs/) ·
[Roadmap](ROADMAP.md) ·
[Issues](https://github.com/Abrechen2/TravStats/issues)

A project by [`<abrechen2 />`](https://www.abrechen2.de/en/) ·
Ein Projekt von [`<abrechen2 />`](https://www.abrechen2.de/)

</div>
