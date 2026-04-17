# r/selfhosted — New Project Megathread comment

> **Context:** r/selfhosted moved all "younger than 3 months" project posts
> into a **weekly New Project Megathread** (policy change dated 16 Apr 2026).
> Standalone posts for new projects are removed — we post as a top-level
> comment in the current week's megathread instead.
>
> **Current megathread:** search "New Project Megathread - Week of" on
> r/selfhosted, sorted by "New" — a fresh thread drops every Friday.
>
> **Template required by the sub:** Project Name · Repo/Website Link ·
> Description · Deployment · AI Involvement.

---

## Comment body (paste as top-level reply)

**Project Name:** TravStats

**Repo/Website Link:** https://github.com/Abrechen2/TravStats

**Description:**

Self-hosted flight tracker for small households (1–10 users). Solves the "I want my travel history without handing it to FlightDiary/MFR24/Flighty" problem.

Features:
- Track flights with categories, tags, up to 50 companions, cost + currency
- Five flight states (flown / scheduled / cancelled / historical / duplicated)
- Boarding-pass scanner — QR / PDF417 / OCR
- Email + PDF import — plain text, HTML, Outlook `.msg`, `.eml`. Template parsers for common airlines; optional local LLM parsing via Ollama (`gemma3:12b` default, 100% accuracy on my ~200-email test corpus) for the long tail
- Six map modes — Routes, Heatmap, Hexagon, 3D columns, animated Trips, 3D Globe (deck.gl 9 + MapLibre 5)
- Auto-lookup via AirLabs / OpenSky / Aviationstack with a pending-update inbox — every change shows statistics impact before you approve
- 58 achievements across five categories
- Automated DB backups with retention + optional WebDAV off-site sync
- JWT in HttpOnly cookies, 15 rate limiters, Zod validation on every endpoint, 22 pentest findings mitigated
- AGPL-3.0-or-later, German + English UI

**Deployment:**

Docker Compose (bundled Postgres):
```
curl -O https://raw.githubusercontent.com/Abrechen2/TravStats/main/docker-compose.prod.yml
echo "DB_PASSWORD=$(openssl rand -base64 32)" > .env
docker compose -f docker-compose.prod.yml up -d
open http://localhost:3000/setup
```

Images on both [GHCR](https://github.com/Abrechen2/TravStats/pkgs/container/travstats) and [Docker Hub](https://hub.docker.com/r/abrechen2/travstats) — `abrechen2/travstats:1.0.0`. Unraid Community Apps submission pending; manual templates live at [Abrechen2/docker-templates](https://github.com/Abrechen2/docker-templates).

Setup wizard takes only `username + password + confirm` — everything else (instance name, API keys, Ollama, backups, WebDAV) is configured from the admin UI afterwards.

Full README: https://github.com/Abrechen2/TravStats
Release notes: https://github.com/Abrechen2/TravStats/releases/tag/v1.0.0

**AI Involvement:**

Substantial. Codebase was written in a pair-programming flow with Claude (Anthropic) — I specified features, reviewed architecture decisions, ran tests, made the design calls, and pushed every commit myself. AI helped with: boilerplate scaffolding, i18n double-entry (DE/EN), test mocks, and refactoring passes. Domain logic (parser rules, stats calculations, achievement thresholds, security hardening) was human-written + AI-reviewed. Pentest was performed by an external human pentester, not AI — all 22 findings were fixed manually.

---

## Tips for the megathread format

- **Top-level comment only** — don't reply under someone else's post; the megathread sorts by comment votes / recency.
- **Images:** comments don't render inline screenshots. Upload to [imgur](https://imgur.com) as an album, then append a single line at the end of the comment:
  `Screenshots: https://imgur.com/a/xxxxxx` — routes map · stats dashboard · passport certificate.
- **Keep it scannable** — reviewers skim 30–40 projects per megathread. The template order (Name → Repo → Description → Deployment → AI) is what they expect.
- **AI Involvement — be honest.** The community is actively rejecting "no AI" claims from projects that clearly were AI-assisted. Transparent "pair-programmed with Claude, I made the design calls" lands far better than dodging the question.
- **Replies:** answer questions within 2 h if you can. Megathread velocity is lower than a standalone post, but engagement quality is higher.
- **Don't repost** to a new megathread next Friday unless there's a substantial update (e.g. v1.1 or Unraid CA approval).
