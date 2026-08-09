# 🏨 Unterkünfte — geplanter Funktionsumfang

Das Design für die neue **Hotels-Domain** steht — hier was ihr damit machen könnt. Umsetzung kommt in Phasen (siehe unten), Mockup ist im Anhang.

## 📝 Erfassen
- Hotels & Aufenthalte anlegen — **manuell** oder per **Buchungsbestätigung-Upload** (E-Mail/PDF wird automatisch ausgelesen)
- Ein Hotel, viele Aufenthalte (mehrfach im selben Haus) — **mit oder ohne Reise** (kein „Trip" nötig für eine kurze Übernachtung)
- Pro Aufenthalt: An-/Abreise, Zimmer(-nummer/-kategorie), Verpflegung, Preis + Währung, Zimmerausstattung, Buchungsreferenz, **Bestätigung als Anhang**
- **Bewertungen 1–5 Sterne** für Zimmer / Frühstück / Service / Gesamt → Hotel-Ø automatisch
- **Hotelketten** & **Mitgliedschaften/Status** (Bonvoy, NH Rewards …)

## 🗺️ Karte
- Hotels als Pins — Koordinaten kommen **automatisch aus der Adresse** (OpenStreetMap, kostenlos, kein API-Key nötig)

## 🧳 In Reisen (der Kern!)
- Lebenszyklus **Planen → Reservieren → Erleben → Rückblick** — konsistent mit Flügen/Cruises
- Aufenthalt erscheint in der Reise-Timeline als **Check-in + Check-out**
- **Tentativ planen** (Hotel noch offen) → beim Buchen wird daraus ein echter Aufenthalt
- Auto-Status: nach Check-out automatisch „abgeschlossen"; **Storno** bleibt erhalten, zählt aber nicht in Stats

## 📊 Statistiken
Hotels · Aufenthalte · **Nächte** (pro Jahr/Monat) · Ausgaben (pro Währung) · Ø-Bewertung · Lieblingskette · Länder/Städte · Award- vs. Bar-Nächte — **quer über alle Domains** (z. B. „Fly & Stay")

## 🏆 ~40–50 Errungenschaften (Bronze → Diamant)
Vielübernachter (bis 1000 Nächte) · Hotel-/Ketten-Sammler · Marken-Treue · Sternesammler · Grenzgänger (Länder) · Punkte-Profi · Silvester-Gast · Spa-Tag · **„Fly & Stay"** · **„Grand Tour"** …

## 🔜 Später (Roadmap)
- **Camping** — zweiter „Typ" derselben Domain (kein Umbau)
- **Custom-POIs** (McDonald's, Hard Rock Cafe …) — eigener Tab, teilt sich die Karte
- Reichere Hotel-Daten über optionale APIs (Amadeus / Foursquare)
- **Foto-Verknüpfung** pro Aufenthalt (über das Immich-Feature)

## 🛠️ Umsetzung in 3 Phasen
**A** Kern (Erfassen · Karte · Timeline · Stats · Achievements) → **B** Buchungs-Import → **C** Geocoding / Enrichment

Feedback jederzeit willkommen 🙌 — fehlt euch was?
