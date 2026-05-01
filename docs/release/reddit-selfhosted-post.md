# r/selfhosted — v1.0.0 launch post

> ⚠️ **Superseded 2026-04-16:** r/selfhosted moved all projects younger than
> three months into a weekly **New Project Megathread**. Standalone posts
> are removed. Use [`reddit-selfhosted-megathread.md`](./reddit-selfhosted-megathread.md)
> for the megathread-compliant comment instead. This file is kept for
> reference + future use once TravStats passes the 3-month mark.


> **Subreddit:** [r/selfhosted](https://www.reddit.com/r/selfhosted/)
> **Flair:** `Release`
> **Best posting time (DE):** Dienstag oder Mittwoch 8–10 Uhr MESZ (= 2–4 Uhr US-East-Coast Morning Browse) — Wochenenden sind auch OK, r/selfhosted ist Homelab-lastig.
> **Screenshots in Upload-Reihenfolge:** `docs/images/map-2d.png` (Hero), `docs/images/stats.png`, `docs/images/certificate.png`

---

## Title

```
TravStats v1.0 — self-hosted travel logbook (flights now, cruises soon) with boarding-pass OCR, email import via local LLM, 3D maps, and zero-config install (AGPL-3.0)
```

*(195 Zeichen, Reddit-Limit 300)*

---

## Body (paste everything below this line)

Hi r/selfhosted,

I've been running TravStats as the family's travel logbook for ~6 months on my Unraid box. It's a logbook, not a live tracker — you record flights manually, scan a boarding pass, or import a confirmation email, and TravStats turns them into history, stats and maps. (Cruises landing in v2 — same model, different transport.) After a full black-box pentest (22 findings, all fixed) and a week of UAT, it just hit v1.0. Dropping it here in case it fits anyone else's homelab.

## What it does

- **Log every flight** with categories, tags, travel companions, cost + currency
- **Five flight states** — flown, scheduled, cancelled, historical, duplicated
- **Boarding-pass scanner** — QR / PDF417 / OCR fallback, works on desktop + mobile
- **Email & PDF import** — plain text / HTML / Outlook `.msg` / `.eml`. Template parsers handle the common airlines; for the long tail I plugged in Ollama — benchmarked `gemma3:12b` at 100% accuracy on my test corpus (~200 confirmations across ~15 carriers). Nothing leaves your LAN.
- **Six map modes** — Routes, Heatmap, Hexagon, 3D Columns, animated Trips, 3D Globe (deck.gl 9 + MapLibre 5)
- **Auto-lookup** via AirLabs / OpenSky / Aviationstack with a **pending-update inbox** — every change shows its statistics impact *before* you approve it
- **58 achievements** across 5 categories (Explorer / Distance / Collector / Elite / Special)
- **Automated DB backups** with retention + optional WebDAV sync (Nextcloud, HiDrive, …)
- **Vintage-passport PNG certificate** with your totals — shareable

## Stack

Express + TypeScript (Prisma + Postgres/PostGIS) · React + Vite · deck.gl 9 / MapLibre 5 · Ollama (optional). **AGPL-3.0-or-later**.

## Security posture

- JWT in an `HttpOnly`, `SameSite=Strict`, `Secure`-aware cookie — no Bearer fallback, no token in `localStorage`
- 15 distinct rate limiters on auth, external-API-backed routes and admin exports (LAN skipped, so your own browser doesn't throttle itself)
- Zod validation on every input endpoint; Prisma-parameterised queries; Helmet CSP; `server_tokens off`
- 22 pentest findings mitigated across the beta — 2 CRITICAL, 5 HIGH, 8 MEDIUM, 7 LOW. Reproducible verification commands in `SECURITY.md`
- JWT + AES-GCM encryption keys auto-generated on first boot and persisted inside the data volume — nothing secret in your `.env`
- Invite-only by default; public registration toggles from the admin UI

## Install

**Docker Compose (bundled Postgres):**

```
curl -O https://raw.githubusercontent.com/Abrechen2/TravStats/main/docker-compose.prod.yml
echo "DB_PASSWORD=$(openssl rand -base64 32)" > .env
docker compose -f docker-compose.prod.yml up -d
open http://localhost:3000/setup
```

**Unraid:** Community Apps templates at [Abrechen2/docker-templates](https://github.com/Abrechen2/docker-templates). Install `travstats-db` → `TravStats`, set the password, open `/setup`. CA submission is pending.

Setup wizard asks for `username + password + confirm`. Instance name, user cap, API keys, Ollama endpoint, backup schedule, WebDAV creds — all configured from the admin UI afterwards.

## Intended scale

1–10 users. It's a family tracker, not a public SaaS. Each user sees only their own flights.

## Repo

https://github.com/Abrechen2/TravStats

Genuinely keen on feedback — especially edge cases around boarding-pass parsing and airline templates I haven't covered yet. There's a one-click "Report Bug" button in the top nav that bundles anonymised diagnostics + a log tail and opens a pre-filled GitHub Issue Form, so you don't have to re-describe context.

Safe travels.

---

## Pre-post checklist

- [ ] Sub-Regeln gelesen (r/selfhosted Rule 1 "self-hostable" ✅, Rule 5 "flair your post" → `Release`)
- [ ] Screenshots im Reddit-Editor hochgeladen (nicht extern verlinkt — Reddit rendert Album besser)
- [ ] README-Hero-Image lädt sofort (2D-Map, GitHub-CDN)
- [ ] GitHub Issues offen (für eingehende Bug-Reports)
- [ ] Docker-Compose Install-Command in frischem Pfad einmal durchgelaufen

## First 2 hours — critical

- **Upvote-Velocity** entscheidet über "Hot"-Platzierung. Kommentare persönlich beantworten (no pitching).
- **Keine Edits** in den ersten 30 Min — Reddit-Algo bestraft Post-Edits als "spam-like".
- Feedback sammeln, aber **nicht** mit "great suggestion!" antworten — konkrete technische Antworten ziehen mehr Upvotes.

## After 24 h

- Top-Bugs in ein GitHub Issue ziehen, im Post-Thread auf das Issue verlinken (zeigt Reaktionsfähigkeit)
- Falls Unraid CA in der Zwischenzeit durchgeht: Edit am Post-Ende hinzufügen ("Edit: now on Unraid Community Apps")
- **Nicht** denselben Post auf r/homelab oder r/aviation croß-posten — Reddit-Mods flaggen identische Bodies als Spam. Andere Subs bekommen den jeweils drafteten Post aus `launch-posts.md`.
