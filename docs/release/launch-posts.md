# Launch posts — v1.0.0

Six drafts, different angle per community. **Do NOT copy-paste across
subs** — reddit mods flag identical content across subs as spam. Each
version below leads with a different hook.

Post schedule (recommended, staggered):

1. T+0: GitHub Release (this is the artefact everyone links to)
2. T+1h: awesome-selfhosted PR
3. T+2h: r/selfhosted
4. T+1d: Unraid CA submission
5. T+2d: Show HN
6. T+3d: r/homelab OR r/flying (pick one, don't cross-post the same day)
7. T+5d: r/aviation
8. T+7d: r/de_EDV or r/Homeserver_de

---

## 1. awesome-selfhosted PR

**PR title:** Add TravStats — self-hosted travel logbook (flights, cruises, more)

**Entry to add** under `## Personal Dashboards` or `## Media Management - Other` (verify current category layout before submission):

```markdown
- [TravStats](https://github.com/Abrechen2/TravStats) - Self-hosted travel
  logbook for small households and groups. Log flights (cruises in v2)
  manually, by boarding-pass OCR, or by email/PDF import via local LLM
  (Ollama). Interactive 2D/3D maps, 58 achievements, automated backups
  with optional WebDAV sync. Invite-only. Not a live tracker — your
  trips, your records, your server.
  `AGPL-3.0` `Docker/TypeScript/Express/React`
```

---

## 2. r/selfhosted — "I built a self-hosted travel logbook, v1 is out"

**Title (≤300 chars):** I built a self-hosted travel logbook for small households — TravStats v1.0 is out (flights now, cruises soon)

**Body:**

> Hi r/selfhosted,
>
> I've been running TravStats as the family's travel logbook for about six
> months. It's a logbook, not a live tracker — you record flights manually,
> scan a boarding pass, or import a confirmation email, and TravStats turns
> them into history, stats and maps. After a full black-box pentest with all
> findings fixed, it's now at v1.0. Sharing in case it's useful to anyone
> else here.
>
> **What it does:**
> - Log every flight with categories, tags, travel companions, costs
> - Scan boarding passes (QR / barcode / OCR) on desktop and mobile
> - Import flight confirmation emails (text / HTML / `.msg` / `.eml`) — either
>   via templates or an optional local Ollama LLM (default model gemma3:12b,
>   nothing leaves your LAN)
> - Six map modes from route arcs to a 3D globe (deck.gl + MapLibre)
> - Auto-lookup from AirLabs / OpenSky / Aviationstack with a pending-update
>   inbox so nothing changes without your approval
> - Automated database backups with retention + optional WebDAV off-site sync
> - 58 Battlefield-style achievements and a vintage-passport PNG certificate
>   you can share
>
> **Stack:** Express + TypeScript (Prisma + Postgres/PostGIS) · React + Vite ·
> deck.gl 9 / MapLibre 5 · Ollama (optional). AGPL-3.0.
>
> **Security posture:** invite-only, JWT in HttpOnly cookies, 15 rate limiters,
> Zod validation on every endpoint, Helmet CSP, Prisma-parameterised queries.
> The pentest report is summarised in SECURITY.md — per-finding details are
> kept internal for the obvious reason.
>
> **Intended scale:** 1–10 users (it's a family logbook, not a public SaaS).
>
> **Quickstart:** GHCR image + docker-compose, or Unraid CA template (just
> submitted). Setup is `docker compose up -d` + one env variable.
>
> Repo: https://github.com/Abrechen2/TravStats
>
> Genuinely keen on feedback — especially edge cases around boarding-pass
> parsing and email import for airlines I haven't covered yet. The app has a
> one-click "Report Bug" button that bundles anonymised diagnostics to save
> you from re-describing context.

*Attach 2–3 screenshots: stats page, map (3D Globe mode), certificate.*

---

## 3. Show HN

**Title:** Show HN: TravStats – self-hosted travel logbook (flights, cruises soon) with local LLM parsing

**Body:**

> I built TravStats because Google Flights / FlightDiary / MyFlightradar24
> all want me to log in somewhere I didn't pick, and the Flighty subscription
> model doesn't fit for a 4-person household. v1.0 ships today.
>
> The interesting bit is the parser: booking emails from different airlines
> have wildly different layouts, and the template-first approach worked for
> maybe 60% of what we imported. For the rest I plugged in Ollama — everything
> runs on a local container, no tokens go over the wire. Benchmarked
> `gemma3:12b` at 100% accuracy on our test corpus (~200 confirmations across
> ~15 carriers). `qwen3` was faster but unreliable; `gemma4` missed seat
> assignments consistently.
>
> Other bits that are maybe interesting:
> - deck.gl 9 + MapLibre 5 via `MapboxOverlay` — the naïve `<DeckGL>` React
>   component fights MapLibre 5.x for the WebGL context, overlay pattern fixes it
> - HttpOnly cookie auth (no Bearer), separate cookie for force-password-reset
>   flow, no localStorage token storage
> - Backup path uses `spawn()` with argument arrays instead of `exec()` with
>   an assembled shell string — one of the CRITICAL findings in the pentest
>
> Stack: Express/TS + Prisma + Postgres/PostGIS, React + Vite, Ollama. AGPL-3.0.
>
> https://github.com/Abrechen2/TravStats

---

## 4. r/homelab — infra angle

**Title:** Self-hosted travel logbook with local LLM parsing (Ollama) + automated backups — TravStats v1.0

**Body:**

> Small-household travel logbook I've been running for six months — log
> flights (cruises landing in v2) manually, by boarding-pass scan, or by
> email import; not a live tracker. Might be interesting for anyone who
> already has Ollama + Postgres containers in their homelab.
>
> **Lab fit:**
> - Runs in a single container (~200 MB); one Postgres + optional Ollama
>   sidecar
> - Unraid Community Apps template in `docs/unraid/travstats.xml`
> - Backup scheduler writes to `/app/data/backups`, optional WebDAV mirror
>   to Nextcloud / HiDrive
> - UTC everywhere — container and Postgres are both pinned to UTC because
>   node-cron + Postgres silently fight over timezone otherwise
> - LAN-only HTTP by default, TLS delegated to your existing reverse proxy
>
> **Features:** manual flight entry, boarding-pass OCR, email/PDF import via
> template parsers + Ollama, auto-lookup via AirLabs / OpenSky, six map
> modes, automated backups with retention.
>
> Full README: https://github.com/Abrechen2/TravStats

---

## 5. r/flying / r/aviation — enthusiast angle

**Title (r/flying):** Built a free, self-hosted flight log because the commercial options didn't fit — sharing in case it's useful

**Body:**

> Hobby project that grew into something I actually use daily. TravStats is
> a personal flight log — every flight I've taken, scheduled, flown,
> cancelled, historical — with the things I actually care about: seat +
> zone + class, travel companions, costs, route map, year-over-year
> comparison. (It's a logbook, not an ADS-B tracker — you enter the
> flights, it gives you the history.)
>
> Things flight-nerds might like:
> - 58 achievements (longest layover, transcontinental, marathon flight,
>   window streak, …)
> - Vintage-passport PNG certificate you can actually share
> - 3D globe visualisation of all routes (deck.gl + MapLibre)
> - Boarding-pass scan works offline (QR / PDF417 / OCR)
> - Per-seat analytics — actually shows you if you lean window or aisle
>   across hundreds of flights
> - Cruises module is v1.1, already in planning
>
> It's self-hosted (Docker), so your flight history stays yours. AGPL-3.0.
>
> https://github.com/Abrechen2/TravStats

*Attach: stats page + certificate.*

---

## 6. German — r/de_EDV or r/Homeserver_de

**Titel:** TravStats v1.0 — selbstgehostetes Reise-Logbuch für Familien (1–10 User, Flüge jetzt, Kreuzfahrten in v2)

**Body:**

> Hi zusammen,
>
> ich habe die letzten 6 Monate TravStats als Familien-Reise-Logbuch
> entwickelt und nach einem vollständigen Pentest (alle Findings gefixt)
> ist jetzt v1.0 raus. Es ist ein Logbuch, kein Live-Tracker — Flüge
> werden manuell erfasst, per Boardingpass gescannt oder aus Mails
> importiert; daraus werden Historie, Statistiken und Karten. Falls jemand
> hier was Ähnliches sucht:
>
> - Flüge manuell loggen oder per Boardingpass-Scan (QR / Barcode / OCR)
> - E-Mail-Import (Klartext / HTML / `.msg` / `.eml`), optional mit lokaler
>   LLM via Ollama (`gemma3:12b`, läuft komplett im LAN)
> - 6 Kartenmodi inkl. 3D-Globus, Jahresvergleich, Sitz-/Klassen-Statistik
> - 58 Achievements im Battlefield-Stil, downloadbares Zertifikat als PNG
> - Auto-Lookup über AirLabs / OpenSky mit Freigabe-Queue vor jeder Änderung
> - Automatische DB-Backups mit Retention + optionaler WebDAV-Sync
>
> Stack: Express + Prisma/Postgres · React + Vite · AGPL-3.0.
> Läuft auf Unraid (CA-Template dabei), Synology, jedem Docker-Host.
>
> Feedback und Bug-Reports gerne — im Admin-Panel gibt's einen "Fehler
> melden"-Button, der anonymisiert Diagnose-Bundle + Log-Tail kopiert.
>
> Repo: https://github.com/Abrechen2/TravStats

---

## Common Qs to prepare answers for

| Question | Short answer |
|---|---|
| Why not [existing tracker / logbook X]? | Not self-hosted; or tied to a subscription; or locks your data in |
| Does it work without API keys? | Yes — manual entry + boarding-pass scan cover the full UX; APIs are only for enrichment |
| Multi-user? | Invite-only, 1–10 users recommended, each user sees their own flights only |
| Mobile app? | PWA planned for v1.7; responsive web works today |
| CO₂ tracking? | v1.3 |
| Can I self-host this behind my existing reverse proxy? | Yes — the container serves plain HTTP; `COOKIE_SECURE` auto-detects from `X-Forwarded-Proto` and the public URL is captured once by the setup wizard |
| Dozens of airlines I don't cover? | Template parser is extensible; Ollama handles the long tail. v1.8 ships community-shared templates via GitHub |
| How do I back up? | Built-in scheduler + WebDAV mirror, or roll your own with `pg_dump` against the DB container |

## After launch

- Watch for early bug reports — they're goldmines for v1.0.1 patch notes
- If Unraid CA review lands within 48 h, add it to the post threads as an
  edit with a short line ("✅ Now on Unraid CA")
- Don't launch v1.0.1 within 72 h unless there's a real regression; let v1.0
  breathe in the communities you posted to
