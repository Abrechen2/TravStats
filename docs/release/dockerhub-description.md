<!--
Canonical product description for the Docker Hub long description.

Everything below the closing marker of this comment is the body. Keep it within
Docker Hub's 25,000-character limit, in English, and free of private hosts or data.
Source of truth for the facts is README.md; the achievement count comes from
backend/src/data/achievementSeeds (count the `code:` entries) — do not write version
numbers or "fixed in x.y.z" notes here, they go stale (the README comment on image
tags says why).

Re-PATCH after editing (never print the PAT or the JWT):

    PAT=$(cat ~/.docker-hub-pat)
    JWT=$(curl -s -H "Content-Type: application/json" -X POST \
      -d "{\"username\":\"abrechen2\",\"password\":\"$PAT\"}" \
      https://hub.docker.com/v2/users/login/ | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
    python3 - "$JWT" <<'PY'
    import json, sys, urllib.request
    body = open("docs/release/dockerhub-description.md").read().split("-->\n", 1)[1].strip()
    req = urllib.request.Request(
        "https://hub.docker.com/v2/repositories/abrechen2/travstats/",
        data=json.dumps({"full_description": body, "description": "Self-hosted travel logbook: flights, cruises, stays, rail, bus, ferries and places. No cloud, no telemetry."}).encode(),
        headers={"Authorization": "JWT " + sys.argv[1], "Content-Type": "application/json"},
        method="PATCH")
    print(urllib.request.urlopen(req).status)
    PY
-->
# TravStats

**Self-hosted travel logbook for small households and groups (1–10 users).**
Flights, cruises, stays, rail, bus, ferries, rentals and places in one timeline — on your own server, with no cloud account and no telemetry.

Documentation: <https://travstats.de/docs/> · Source and issues: <https://github.com/Abrechen2/TravStats>

## What TravStats is

TravStats is a logbook first. You record trips by hand, scan a boarding pass, import a confirmation e-mail or let the Companion app record them — and TravStats turns them into history, statistics and maps. Everything you record lives in your own PostgreSQL. It does not follow aircraft or people, nobody sees where you are unless you create a share link yourself, and every outside service (flight data, geocoding, AI parsing, photos) is optional and switched on by you.

## What it does

- **Logbook** — flights, cruises (ports and sea days), stays and loyalty cards, rail, bus, ferries, rentals, roadtrips and tours, places and curated checklists, all with documents, costs and photos. Entries can be marked private or business and filtered by it.
- **Import, always as a proposal you confirm** — boarding passes (QR / PDF417 / OCR), e-mails (`.eml`, `.msg`), PDFs, spreadsheets, a mailbox folder or a forwarding address. Optional local LLM parsing through Ollama.
- **Statistics and maps** — year and all-time statistics, 360+ achievements, a passport page, a year review, and 2D/3D maps with a globe.
- **TravTrack** *(opt-in location history)* — record from the Companion, OwnTracks or Overland, or import GPX / KML / GeoJSON / TCX, a Google Timeline export or a Dawarich history. Privacy zones cut points on the server; a recording can become a roadtrip.
- **Plugins and calendar** — signed HTTPS suggestion plugins answer "what was here?"; ICS and CalDAV calendars serve as read-only evidence.
- **Sharing and federation** — linked trip copies between accounts and servers with consent first, expiring public trip links, `.travstats` trip files.
- **Comparison** — compare totals (never single trips) with friends on your server or another one.
- **MCP and API** — authenticated REST API with OpenAPI, personal access tokens, and a local MCP server for assistants such as Claude.
- **Backups** — scheduled backups of the database and every upload folder, an optional WebDAV copy, restore from the admin area, and a recovery key so a lost server can be restored with its encrypted credentials intact.
- **Security** — JWT in HttpOnly cookies, rate limiting, Zod validation on every endpoint, Helmet CSP, invite-only registration by default.
- **German and English UI.**

## Companion app (beta)

A phone app that records trips and flights, scans documents and reads your logbook offline. It uploads to your own server, which stays the record. The web UI is drawn for tablets and is the main interface. See <https://travstats.de/docs/user-guide/companion-app/>.

## Quick start

The only thing you set in a file is a database password; the setup wizard in the browser captures everything else.

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

The container seeds the airport database on first boot (about 30 s) and generates its own JWT secret. To use an existing Postgres server, set `DATABASE_URL` and drop the `db` service from the compose file. Unraid users: Community Apps templates are in <https://github.com/Abrechen2/docker-templates>.

Update with `docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d`. Starting a version you have not run on your data before takes a database snapshot first, into `/app/data/backups/`.

## Image tags

Docker Hub and GHCR (`ghcr.io/abrechen2/travstats`) carry the same digests for these tags.

| Tag | Points to | Use for |
|---|---|---|
| `:latest`, `:stable` | Newest promoted stable release | Normal production; follows the next promoted release. |
| `:X.Y.Z` | Pinned immutable release | Reproducible installs. |
| `:rc-latest` | Newest release candidate | Testers. May include breaking schema changes; a backup is taken automatically on the first start of any new version. |

Specific RC and beta tags live on GHCR only. Which version the moving tags currently resolve to is on the [releases page](https://github.com/Abrechen2/TravStats/releases).

## Requirements

- An amd64 host (release candidates are amd64 only; check a final tag's platforms before running on arm64)
- PostgreSQL with PostGIS (bundled in the compose file)
- Roughly 250 MB RAM for the app plus the database
- Optional: a machine running Ollama for local LLM parsing of confirmation e-mails (a GPU is recommended)

## Behind a reverse proxy

Never let a cache rule apply to `/api/`: every API response belongs to one signed-in user. In Nginx Proxy Manager leave "Cache Assets" off, and in Cloudflare exclude `/api/*` from cache rules.

## Links

- Website: <https://travstats.de>
- Documentation: <https://travstats.de/docs/>
- Releases: <https://github.com/Abrechen2/TravStats/releases>
- Report a bug: <https://github.com/Abrechen2/TravStats/issues/new/choose> (or the in-app "Report Bug" button, which bundles anonymised diagnostics)
- Security reports: GitHub Security Advisories, never a public issue
- Licence: AGPL-3.0-or-later

A project by [`<abrechen2 />`](https://www.abrechen2.de/en/) · Ein Projekt von [`<abrechen2 />`](https://www.abrechen2.de/)
