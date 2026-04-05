# TravStats — Feature Roadmap Phase 2–6

**Stand:** 2026-03-11
**Phase 1:** ✅ Abgeschlossen (PR #32) — Email als primärer Eingabetyp + Community Template System

---

## Phase 2: BCBP Barcode-Decoder + PDF-Support

**Ziel:** Boarding Pass als vollwertiger zweiter Eingabeweg

- BCBP (Bar Coded Boarding Pass, IATA Standard) Decoder
  - Liest Barcode-Daten direkt aus Bild-Uploads (QR/Aztec/PDF417)
  - Ground-Truth für Template-Validierung (Vergleich mit Email-Parsing)
- PDF-Attachment-Erkennung und -Parsing
  - PDF-Bordkarten und Buchungsbestätigungen als PDF
  - Text-Extraktion aus PDFs (pdfjs oder pdf-parse)
- BCBP-Daten in ParsedBooking integrieren
- Nicht in Scope: CO₂, Fine-Tuning

---

## Phase 3: Actual Times, Delay-Tracking, CO₂

**Ziel:** Flugdaten um Echtzeit- und Umweltdaten erweitern

- Actual departure/arrival times (vs. scheduled)
- Delay-Berechnung und -Anzeige
- CO₂-Fußabdruck-Berechnung pro Flug
  - Formel: Distanz × Emissionsfaktor × Kabinenfaktor
  - Anzeige in kg und "Elefanten"-Äquivalent (wie in FunStats vorbereitet)
- Neue Felder im Prisma-Schema: `actualDeparture`, `actualArrival`, `delayMinutes`, `co2Kg`

---

## Phase 4: LLM Training Pipeline

**Ziel:** Gesammelte ParseTrainingLog-Daten für Fine-Tuning nutzen

- Export-Funktion für anonymisierte Trainingsdaten
  - Felder: airline, templateUsed, templateHit, fields+confidence, missing
  - Kein userId/PII im Export
- Fine-Tuning Workflow (OpenAI / Anthropic)
- User-Korrekturen als Ground-Truth Labels erfassen
  - Wenn User Parsed-Felder in FlightReview korrigiert → als Korrektur speichern
- Admin-Dashboard: Training-Datensatz-Übersicht, Export-Button
- Nicht in Scope: Fine-Tuning Ausführung selbst (→ manuell/extern)

---

## Phase 5: Erweiterte Statistiken

**Ziel:** Mehr Insights aus den Flugdaten

- Airline-Treue-Score und Ranking
- Kosten-pro-km und Kosten-pro-Stunde (BusinessStats bereits teilweise implementiert)
- Sitzplatz-Analyse erweitern (Fenster/Gang/Mitte Trends)
- Zeitzonenhopping-Statistiken
- Länderverteilung und Kontinent-Explorer
- Verbesserte Visualisierungen für bestehende FunStats/UniqueStats
- Export als PDF-Report ("Mein Flieger-Jahr")

---

## Phase 6: Kalender-Import (ICS) — Optional

**Ziel:** Flüge aus Kalender-Einladungen importieren

- ICS/iCal Datei-Parsing
- Erkennung von Flug-Events (Airline, Flugnummer, Zeiten aus Kalendereinträgen)
- Integration in bestehenden Import-Flow als vierter Tab
- Niedrige Priorität — nur wenn Phases 2–5 abgeschlossen

---

## Implementierungsreihenfolge

```
Phase 2 → BCBP + PDF  (technische Grundlage für bessere Datenqualität)
Phase 3 → Actual Times + CO₂  (erweitert Datenbasis)
Phase 4 → LLM Training  (nutzt gesammelte Phase 1-3 Daten)
Phase 5 → Statistiken  (baut auf vollständiger Datenbasis auf)
Phase 6 → ICS  (nice-to-have)
```
