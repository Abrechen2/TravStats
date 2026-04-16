# Roadmap

TravStats is a solo-maintained side project. This roadmap is a direction,
not a commitment — features land when they're ready and the maintainer has time.

---

## ✈️ v1.0 — What's in the box

Everything below ships with the first stable release.

**Core tracking**
- Manual flight entry with categories, tags, travel companions, costs
- Boarding-pass scanner (QR, barcode, OCR)
- Email import (plain text, HTML, `.msg`/`.eml`) with local LLM parsing via Ollama
- Duplicate detection with a "save anyway" escape hatch
- 5 flight states: flown, scheduled, cancelled, historical, duplicated

**Visualisation**
- Six map modes: Routes · Heatmap · Hexagon (3D) · 3D Columns · Trips · Globe
- Flight timeline + calendar view with travel-intensity heatmap
- Year-over-year statistics, seat/zone/class distribution, top routes

**Automation**
- Automatic flight-data lookup via AirLabs, Aviationstack, OpenSky
- Automatic pending-update flow during active flights
- Historical enrichment scheduler
- 24h/2h email reminders before departure (SMTP)
- Automated database backups with retention + optional WebDAV sync

**Gamification**
- 58 Battlefield-style achievements across 5 categories
- Downloadable vintage-passport flight certificate (PNG export)
- Optional small-group leaderboard

**Admin & ops**
- Invite-only user management (1–10 users by default)
- SMTP, API-key, historical-enrichment and backup configuration in-app
- Anonymised diagnostic-export bundle for bug reports
- Export to CSV, GeoJSON, KML (Google Earth)

---

## 🚢 v1.1 — Cruises module

TravStats grows from "flight tracker" into "travel tracker".

- First-class cruise data model (ship, voyage, itinerary, cabin, sea days)
- `/cruises` page parallel to flights with own forms, map view, stats
- Port-to-port map visualisation alongside flight routes
- "Seafarer" achievement category
- Combined travel statistics across flights + cruises

---

## 🏆 v1.2 — Special flights & collections

- Flight highlights (first flight, jubilee flight, storm flight, longest layover, livery spots, retro cabins)
- Collections gallery with photo uploads per highlight
- "Collector" achievement category (livery hunter, route completionist, …)
- Same pattern for cruise highlights (maiden voyage, formal night, …)

---

## 🌱 v1.3 — CO₂ footprint & sustainability

- Per-flight CO₂ calculation based on aircraft type, distance, cabin class
- Per-cruise CO₂ estimation (ship class, duration, cabin category)
- Dashboard with equivalents (car km, trees needed, trips avoided)
- Class comparison (Economy vs Business vs First, Inside vs Suite)
- Carbon-conscious achievement tier

---

## 🧭 v1.4 — Trip planner & itineraries

- Group flights + cruises into **trips** with drag-and-drop
- Timeline with layovers, connections, sea days
- Minimum-connection-time warnings
- Shareable public trip pages with map + itinerary

---

## 👥 v1.5 — Social & sharing

- Year-in-review share graphics (Instagram story, Twitter card, animated WebM)
- Friend invites with side-by-side stat comparison
- Shared route-map images (PNG/SVG, customisable themes)

---

## 🧠 v1.6 — Smart insights

- Pattern detection ("your most active month is …")
- Route recommendations based on history
- Seat-preference analytics over time
- Jetlag score and recovery estimation

---

## 📱 v1.7 — PWA & mobile

- Service worker, offline access, install-as-app manifest
- Camera-first boarding-pass scan on mobile
- Push notifications (gate changes, check-in reminders)
- Touch-friendly map gestures

---

## 🤖 v1.8 — Advanced import & automation

- Two-stage multi-flight email parser (block-split + per-flight extraction)
- Community-shared airline templates via GitHub
- Multi-version template scoring (pick the best parse automatically)

---

## 🧰 Continuous improvements

Running in parallel across versions.

- E2E test coverage expansion
- Performance: Redis caching, server-side pagination for large datasets
- Error tracking, performance dashboard
- Route-aggregation clustering (replace median for multi-corridor routes)
- Confidence-score calibration via user feedback loop
- Optional 2FA for admins

---

## 🤝 Contributing

Feedback, bug reports and pull requests are welcome. See
[CONTRIBUTING.md](CONTRIBUTING.md) for how to submit changes or report issues.

*This roadmap is reviewed with each release. Priority shifts based on real-world use and community feedback.*
