# Roadmap

TravStats is a solo-maintained side project. This roadmap is a direction,
not a commitment — features land when they're ready and the maintainer has time.
[CHANGELOG.md](CHANGELOG.md) is the record of what shipped when; this file
keeps the shape of it and what is still ahead.

---

## ✅ Shipped

Everything in this section is in the server and the web app today (2.8).
Items marked *(beta)* sit behind the instance's beta switch.

**Logbook and capture**
- Flights, cruises, rail, bus, ferry, rental cars, hotels and places, road trips and day tours — each with its own forms, map layer and statistics
- Boarding-pass scanner (QR, barcode, OCR), email and PDF import (plain text, HTML, `.msg`/`.eml`) with optional local LLM parsing via Ollama
- Importers: Flightradar24, OpenFlights, App in the Air, FlightAware, Excel/CSV round trip, bahn.de connections, GPX/KML/GeoJSON/TCX tracks, Google Timeline, a Dawarich copy
- Trips that group any mix of domains; duplicate detection with a "save anyway" escape hatch; companions, tags, costs in any currency with a recorded rate

**TravTrack and the Companion**
- TravTrack, an opt-in own location history with privacy zones and an explored-places view *(beta)*; positions from the Companion, OwnTracks, Overland, files and a Dawarich copy
- Device pairing and the Companion app (iOS/Android, in beta); the server keeps what the phone records — flight tracks and trip recordings (forgejo#316 slice 1)
- Recorded flight tracks (GPX/KML/TCX/FIT) drawn on the flight page and the map; calendar subscription (`.ics`) for upcoming trips

**Planning and sharing**
- TravPlan, the planning mode for trips that have not happened yet *(beta)*
- Immich albums on trips (link or import); public share links; trip sharing between servers with consent on both sides *(beta)*; friend leaderboard *(beta)*

**Visualisation and statistics**
- Map modes per domain, a 3D globe, sea routes from the shipping-lane network, colour modes for flights and cruises
- Cross-domain statistics, year-over-year views, CO₂ for every mode, punctuality, global search from the top bar
- 270+ achievements, curated checklists, the vintage-passport flight certificate

**Data and automation**
- Flight-data lookup (AirLabs, Aviationstack, OpenSky and others), live tracking, historical enrichment, weather and elevations from open data
- Reminders by e-mail, automated backups with retention and WebDAV sync, an anonymised diagnostic bundle, export to CSV, GeoJSON, KML and GPX

**Admin and operations**
- Invite-only users, two-factor authentication and passkeys, a rebuilt settings area (2.8), external-service credentials managed in the admin UI
- Public REST API with OpenAPI 3.0 and Swagger UI, Personal Access Tokens with `read` / `write` / `admin` scopes

---

## 🔭 Ahead

What is still open. Nothing here is promised for a particular release.

**Release the betas** — TravTrack, TravPlan, trip sharing between servers and
the leaderboard leave the beta switch one by one, each on the owner's word after
a field test (the registry in `frontend/src/config/betaFeatures.ts` names the
condition for each).

**Server is the record** — forgejo#316 slice 2: the stay and place suggestions
read recorded trip points as evidence.

**Companion** — a public store build (today: TestFlight) and the rest of the
app-side features that need server data.

## 🤖 Parsers and automation

- Two-stage multi-flight email parser (block-split + per-flight extraction)
- Community-shared airline templates via the template repository
- Cloud-mode parser — Groq and Gemini Flash adapters as fallbacks for users
  without a self-hosted Ollama

## 💰 Costs

Costs and the currency pipeline are in (see Shipped); what remains is the
structural rewrite of the cost data model.

- **Unified `Expense` model** — one row per cost line, attached polymorphically
  to a flight, booking, trip, cruise or cruise stop, each with the original
  amount plus a snapshot of the exchange rate taken at entry time
- Payment metadata (method, paid-by, reimbursement status), trip-level budget
  and default currency, and a stats overhaul on top (`SUM(amountInBase)` per
  category, per-trip P&L)
- Migration of the legacy price columns into the new rows

## 🚢 Live data

- Opt-in AIS layer (AISStream.io) showing a booked or current ship's position
  on the cruise map, fed by one backend WebSocket fanned out to clients

## 👥 Social and insights

- Year-in-review share graphics (Instagram story, Twitter card, animated WebM)
- Shared route-map images (PNG/SVG, customisable themes)
- Pattern detection ("your most active month is …"), route recommendations,
  seat-preference analytics, jetlag score and recovery estimation

## 📱 Web as an app

- Service worker, offline access, install-as-app manifest, push notifications
  (gate changes, check-in reminders). The phone itself is the Companion's job.

---

## 🧰 Continuous improvements

Running in parallel across versions.

- E2E test coverage expansion
- Performance: Redis caching, server-side pagination for large datasets
- Error tracking, performance dashboard
- Route-aggregation clustering (replace median for multi-corridor routes)
- Confidence-score calibration via user feedback loop
- OurAirports CSV as fallback / cross-check source for the airport seed

---

## 🤝 Contributing

Feedback, bug reports and pull requests are welcome. See
[CONTRIBUTING.md](CONTRIBUTING.md) for how to submit changes or report issues.

*This roadmap is reviewed with each release. Priority shifts based on real-world use and community feedback.*
