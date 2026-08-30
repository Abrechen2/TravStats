<div align="center">

<img src="docs/images/logo.svg" alt="TravStats" width="140" />

# TravStats

**Self-hosted travel logbook for small households and groups (1–10 users).**
It's a logbook, not a live tracker — you record trips manually, scan a boarding pass, or import a confirmation email, and TravStats turns them into history, stats and maps.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Release](https://img.shields.io/github/v/release/Abrechen2/TravStats?include_prereleases&sort=semver)](https://github.com/Abrechen2/TravStats/releases)
[![GHCR](https://img.shields.io/badge/container-ghcr.io-181717?logo=github)](https://github.com/Abrechen2/TravStats/pkgs/container/travstats)
[![Docker Hub](https://img.shields.io/docker/pulls/abrechen2/travstats?logo=docker&label=Docker%20Hub)](https://hub.docker.com/r/abrechen2/travstats)
[![CI](https://github.com/Abrechen2/TravStats/actions/workflows/ci.yml/badge.svg)](https://github.com/Abrechen2/TravStats/actions/workflows/ci.yml)
[![Discord](https://img.shields.io/badge/Discord-join%20chat-5865F2?logo=discord&logoColor=white)](https://discord.gg/CRnjB9f78t)

</div>

---

<p align="center">
  <img src="docs/images/globe.png" alt="Interactive 3D globe with flights and cruises radiating from a Munich hub across Europe, Asia and the Atlantic" width="90%" />
  <br />
  <sub>Multi-domain 3D globe — flights and cruises on one map, colour-coded by frequency and status</sub>
</p>

## Why TravStats

Log every flight **and cruise** you take, visualise your routes on
interactive 2D and 3D maps, collect 140+ achievements, and import flights
from boarding passes (QR / PDF417 / OCR), confirmation emails, or
Excel/CSV — all on your own server, no cloud, no telemetry.

It's a logbook, not a live tracker — you record trips manually, scan a
boarding pass, or import a confirmation email, and TravStats turns them
into history, stats and maps. Flight data is optionally enriched from
AirLabs / Aviationstack / OpenSky, but everything you record lives in
your own PostgreSQL. No accounts on someone else's servers, no analytics,
no ads.

- 🚢 **Flights *and* cruises** — import a cruise from email or PDF: the ship, every port of call and sea day; fly-and-cruise trips link both
- 🗺️ **Multi-domain maps** — routes, heatmap, animated trips and a 3D globe for flights and cruises, colour-coded by frequency and status
- 📊 **Cross-domain statistics** — distance, countries, active days, top airlines and cruise lines, with year and all-time views
- 🏆 **140+ achievements** across flights, cruises and cross-domain — bronze to diamond
- 🎫 **Boarding-pass scanner** — QR / barcode / OCR
- 📧 **Email import** — plain text, HTML, Outlook `.msg`, `.eml`, with optional local LLM parsing via Ollama
- 📑 **Excel/CSV round-trip import** — export, edit in Excel, re-import; rows with an `id` update existing flights
- 🤖 **Public REST API + OpenAPI 3.0 / Swagger UI** — Personal Access Tokens with `read` / `write` / `admin` scopes for AI agents and automation
- 💾 **Automated backups** with retention + optional WebDAV sync
- 🔐 **Invite-only by default** — toggle public registration anytime from the admin UI; JWT in HttpOnly cookies, 18 rate limiters on sensitive endpoints
- 🌐 **German + English UI** with browser-locale auto-detection, i18n-ready

## Is TravStats for you?

Being honest about the fit costs one paragraph and saves an evening of
someone else's time.

**It probably is, if you** want your travel history on hardware you
control; keep a household's or a small group's trips in one place; already
run Docker and Postgres, or are happy to let the bundled compose file run
Postgres for you; like filling in a logbook after the fact and getting
maps, stats and achievements out of it; and want flights *and* cruises
(and hotels and places) in one timeline rather than four apps.

**It probably is not, if you** want live flight tracking or a radar — this
records where you have been, it does not watch aircraft move; expect a
hosted account you just sign up for, because there is no SaaS version and
running it means running a server; need to onboard more than a handful of
people, since it is built and tested for roughly 1–10 users on one
instance and has no SSO, no org/tenant model and no per-team permissions;
need it on a phone as the primary interface — the web UI is responsive,
but the native app is not released yet; or need automatic, hands-off
import of everything, because a lot of travel history is typed in or
imported from files you supply.

---

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
    <td width="50%"><img src="docs/images/achievements.png" alt="Achievements gallery with 143 unlockables across flights, cruises and cross-domain" /></td>
  </tr>
  <tr>
    <td align="center"><sub>Cross-domain stats with year and all-time views</sub></td>
    <td align="center"><sub>140+ achievements, bronze to diamond</sub></td>
  </tr>
</table>

---

## Quick start

The only thing you set in a file is a database password. Everything else —
instance name, user cap, API keys, Ollama model, backup schedule, WebDAV —
is captured by the first-run setup wizard in the browser.

### Option A — Stack (bundled Postgres, recommended)

```bash
# 1. Grab the compose file
curl -O https://raw.githubusercontent.com/Abrechen2/TravStats/Main/docker-compose.prod.yml

# 2. Set one variable
echo "DB_PASSWORD=$(openssl rand -base64 32)" > .env

# 3. Start
docker compose -f docker-compose.prod.yml up -d

# 4. Open the setup wizard
open http://localhost:3000/setup
```

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
> then point TravStats at it from **Admin → Parser**. Multi-flight
> confirmation mails and unknown airline templates are then handled locally —
> nothing leaves your network.

### Image tags

Both registries (GHCR and Docker Hub) carry the same digests for these
moving tags. Pick the one your platform defaults to.

| Tag | Points to | Use for |
|---|---|---|
| `:latest`, `:stable` | Newest promoted stable release | Normal production. Auto-updates to the next promoted release. |
| `:X.Y.Z` | Pinned immutable release | Reproducible installs, audit, regulated environments. |
| `:rc-latest` | Newest Release Candidate | Beta testers — receive every fresh RC via `docker compose pull`. May include breaking schema changes across major bumps; an in-place backup is taken automatically on first start of a new major. |

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
| `TZ` | Non-UTC container clock (not recommended) | `UTC` |

See [`.env.prod.example`](.env.prod.example) for the annotated list.

### Runtime-configurable from the admin UI

- Instance name, public URL, user cap, registration mode
- **AirLabs / OpenSky / Aviationstack** API keys (encrypted at rest)
- **Ollama** endpoint + model (default `gemma3:12b`)
- Backup schedule and retention
- WebDAV off-site backup sync (Nextcloud, HiDrive, …)
- SMTP for invitation and password-reset emails
- Logging level and retention

TravStats works without any API key; manual flight entry and boarding-pass
scanning cover the full feature set.

---

## What's in a release

See [CHANGELOG.md](CHANGELOG.md) for the full history and
[ROADMAP.md](ROADMAP.md) for where things are heading. A native iOS &
Android app (boarding-pass scan, a 3D globe of your travels) is in the
works — no release date yet; hotels & places-of-interest, CO₂ tracking
and a trip planner are on the map too.

## Known limitations

Things worth knowing before you commit a weekend to this. None of them are
secrets; they are just easier to read here than to discover later.

- **amd64 only.** The published images carry a single `linux/amd64`
  manifest. A Raspberry Pi or an Apple-Silicon Mac cannot run them
  natively — you would have to build the image yourself for your
  architecture.
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
  emails and CSV/Excel are parsed for you, but there is no mailbox polling
  and no airline account linking. You bring the file or the text.
- **The native mobile app is not released.** It is in development; the web
  UI is responsive and is the way to use TravStats today.
- **Some features sit behind a beta flag.** An admin toggle hides
  unfinished areas on production instances. If something in the docs or a
  screenshot is not visible in your install, that is usually why.
- **Solo project.** One maintainer. Issues and fixes move at the pace that
  implies — see the commit history for an honest picture of it.

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

**1. Mint a Personal Access Token**: in the app, go to **Settings →
API Tokens**, give it a label and a scope (`read`, `write`, `admin`),
and copy the `ts_pat_…` value. The plaintext is shown exactly once —
only the bcrypt hash is persisted.

**2. Browse the spec**: open `https://<your-host>/api/v1/docs`
(Swagger UI) or fetch `/api/v1/openapi.json` for the raw OpenAPI 3.0
document. Request and response shapes come from the same Zod schemas
the backend validates with, so a documented field cannot describe a
shape the server rejects. Coverage is enforced separately: a test walks
the live route table and fails the build when an endpoint ships without
a spec entry. The admin API and the first-boot wizard are excluded on
purpose and named as such — they are not integration surfaces.

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

Token requests get their own per-token rate-limit bucket so an
aggressive script can't lock the user out of the web UI.

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

### What CI checks

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs typecheck and
lint on both trees, the Vitest suite, and a Prettier check scoped to the
frontend files a change touches. The Jest backend suite runs there too
against a throwaway Postgres, but is marked advisory rather than blocking:
it currently has pre-existing test-isolation failures that have nothing to
do with the change under review. The measured numbers and both root causes
are written at the top of that job.

[`.github/workflows/security.yml`](.github/workflows/security.yml) runs
`npm audit` over production dependencies (blocking at *critical*), plus
Trivy and CodeQL, whose findings land in the repository's Security tab.

Locally, [`.pre-commit-config.yaml`](.pre-commit-config.yaml) runs
typecheck and lint for whichever tree a commit touches, alongside the
formatting and hygiene hooks. Install it once with `pre-commit install`.

Deep-dive developer reference: [CLAUDE.md](CLAUDE.md).

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

## Support the project

TravStats is a solo side project. If it's useful to you,
[a small donation via PayPal](https://www.paypal.com/donate?hosted_button_id=HW9MPYVURCT42)
keeps the lights on for AirLabs quota top-ups. ❤️

---

<div align="center">

**[⭐ Star on GitHub](https://github.com/Abrechen2/TravStats)** ·
[Releases](https://github.com/Abrechen2/TravStats/releases) ·
[Roadmap](ROADMAP.md) ·
[Issues](https://github.com/Abrechen2/TravStats/issues)

<sub>Made with ❤️ and a bit of AI for flight enthusiasts.</sub>

</div>
