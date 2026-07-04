# 🏨 Unterkünfte-Domain — Design-Entwurf

Danke an alexkuenzel für den ausführlichen Brief — den hab ich 1:1 als Grundlage genommen und das Design an der bestehenden **Cruise-Domain** ausgerichtet (gleiche Bausteine: Modelle, Import-Parser, Karte, Timeline, Achievements, Stats). Mockup als HTML im Anhang 👇

## Grundstruktur (wie vorgeschlagen)
- **Hotel** = eigener, wiederverwendbarer Datensatz
- **Aufenthalt** = eigenes Event, mehrere pro Hotel, **standalone ODER einer Reise zugeordnet** (wie Flüge — keine „Reise" nötig für einen kurzen Business-Trip)
- **Hotelketten** + **Mitgliedschaften** als eigene Referenzdaten
- Hotel-Ø-Bewertung = Mittel der Aufenthalts-Bewertungen
- Reise-Timeline: Check-in + Check-out je Aufenthalt

## Was ich ergänzt habe (passt zu TravStats)
- 📍 **Koordinaten + Karte** — Adresse → Koordinaten via **OpenStreetMap (kostenlos)**, Hotels als Pins
- 💶 **Währung** beim Preis + **Nächte** als eigene Kennzahl (1 Aufenthalt = evtl. 5 Nächte)
- 🗓️ **Status** (geplant / abgeschlossen / storniert) — auch zukünftige Buchungen
- 📎 **Buchungsbestätigung anhängen** (nicht nur auslesen)
- 🏆 **Achievements** + 📊 **Statistiken** (Nächte, Ausgaben, Ketten, Länder) — quer über alle Domains
- 🔁 **Import-Dedup:** mehrfach im selben Hotel → der Import erkennt das bestehende Hotel und hängt nur den Aufenthalt an (keine Duplikate)

## Bewertungen
**1–5 Sterne** (halbe möglich) für **Zimmer / Frühstück / Service / Gesamt**.

## Import + Enrichment
- **Buchungsbestätigung-Upload** (E-Mail/PDF) = primäre Quelle — **plus** manuelle Eingabe
- Zusatz-Infos später über **freie APIs**: OpenStreetMap (Koordinaten), optional Amadeus/Foursquare. *Google Places fällt raus — kein Gratis-Tier mehr seit Feb 2025.*

## Camping + POI
- **Camping** kommt später als zweiter „Typ" derselben Domain — kein Umbau nötig, nur ein Feld
- **Custom-POIs** (McDonald's, Hard Rock Cafe …) = **eigener POI-Tab** später, teilt sich Karte/Geocoding mit den Hotels

## Umsetzung in 3 Phasen
**A** Kern (Modell · Eingabe · Karte · Timeline · Stats · Achievements) → **B** Buchungs-Import → **C** Geocoding/Enrichment

---

📎 **Mockup:** `lodging-mockup.html` im Anhang (im Browser öffnen) — Hotel-Liste, Hotel-Detail mit Aufenthalten, Aufenthalt-Editor, Karte, Import-Vorschau.

**Feedback willkommen** — vor allem: fehlen euch Felder? Ist die Bewertungs-Aufteilung ok? Kennt ihr gute (freie) APIs für Hotel-Daten?
