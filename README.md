<div align="center">

<img src="docs/images/logo-large.png" alt="TravStats" width="140" />

# TravStats

**Self-hosted flight tracker for small households and groups.**
Track every flight, visualise routes on interactive maps, collect achievements — all on your own server.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Release](https://img.shields.io/github/v/release/Abrechen2/TravStats?include_prereleases&sort=semver)](https://github.com/Abrechen2/TravStats/releases)
[![Container](https://img.shields.io/badge/container-ghcr.io-181717?logo=github)](https://github.com/Abrechen2/TravStats/pkgs/container/travstats)
[![CI](https://github.com/Abrechen2/TravStats/actions/workflows/ci.yml/badge.svg)](https://github.com/Abrechen2/TravStats/actions/workflows/ci.yml)

</div>

---

<p align="center">
  <img src="docs/images/map-2d.png" alt="2D route map centred on Munich with 120 flights radiating across Europe" width="85%" />
</p>

## Why TravStats

Built for 1–10 users who just want to know *where they've been*. No accounts to
create on someone else's servers, no tracking, no ads — your flights stay on
your machine. Flight data is enriched from AirLabs / Aviationstack / OpenSky,
but everything you record lives in your own PostgreSQL.

- 🗺️ **Six map modes** — Routes, Heatmap, Hexagon, 3D columns, animated Trips, 3D Globe
- 📊 **Year-over-year statistics** across flights, distance, seats, classes, routes
- 🏆 **58 Battlefield-style achievements** across five categories
- 🎫 **Boarding-pass scanner** — QR / barcode / OCR
- 📧 **Email import** — plain text, HTML, Outlook `.msg`, `.eml`, with optional local LLM parsing via Ollama
- 💾 **Automated backups** with retention + optional WebDAV sync
- 🔐 **Invite-only** — no public registration, JWT in HttpOnly cookies, rate limiting on every sensitive endpoint
- 🌐 **German + English UI**, i18n-ready

---

## Screenshots

<table>
  <tr>
    <td width="50%"><img src="docs/images/certificate.png" alt="Vintage passport-style flight certificate" /></td>
    <td width="50%"><img src="docs/images/achievements.png" alt="Achievements gallery with 58 unlockables" /></td>
  </tr>
  <tr>
    <td align="center"><sub>Downloadable PNG certificate with your totals</sub></td>
    <td align="center"><sub>58 Battlefield-style achievements</sub></td>
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
curl -O https://raw.githubusercontent.com/Abrechen2/TravStats/main/docker-compose.prod.yml

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

A Community Apps template is shipped at
[`docs/unraid/travstats.xml`](docs/unraid/travstats.xml).
Install PostGIS from CA first, then TravStats from CA, set
`DATABASE_URL`, open `/setup`. See
[`docs/unraid/README.md`](docs/unraid/README.md) for the step-by-step.

> **AI-powered email import (optional):** the bundled Ollama service pulls
> `gemma3:12b` on first use (~8 GB) and parses flight confirmations locally —
> nothing leaves your network. Enable or disable from the admin UI after
> setup.

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
[ROADMAP.md](ROADMAP.md) for where things are heading (cruises module,
CO₂ tracking, trip planner, PWA).

## Security

See [SECURITY.md](SECURITY.md) for the hardening summary, audit history, and
verification commands. TL;DR: JWT in HttpOnly cookies, 15 distinct rate
limiters, Zod validation on every endpoint, Prisma-parameterised queries,
Helmet CSP, invite-only by default.

Report vulnerabilities via
[GitHub Security Advisories](https://github.com/Abrechen2/TravStats/security/advisories/new)
— **please do not open a public issue**.

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
npm run test:frontend   # Vitest (backend tests need Postgres)
```

Deep-dive developer reference: [CLAUDE.md](CLAUDE.md).

---

## License

Copyright © 2026 Dennis Wittke · **AGPL-3.0-or-later**

You may use, modify and redistribute TravStats, but if you run it as a web
service (even modified) you must make the complete source code of your
modifications available under the same licence. See [LICENSE](LICENSE).

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
