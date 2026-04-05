# Phase 1: Email als primärer Eingabetyp — Design Spec

**Datum:** 2026-03-11
**Status:** Approved
**Scope:** Email-Parsing Pipeline, Community Plugin-System, neue Datenfelder, LLM Training Signal

---

## Ziel

Email-Buchungsbestätigungen werden zum primären Eingabeweg für Flugdaten. Boarding Pass und manueller Import werden zu sekundären Optionen. Ein Community-Plugin-System ermöglicht airline-spezifische Templates mit niedrigem Einstiegs-Barrier.

---

## 1. Email-Parsing Pipeline

### Ablauf

```
Email (.eml / .msg / .txt / PDF-Attachment)
  → Airline Detector (From / Subject / Domain)
  → Template Registry (JSON + optionale Transforms)
  → ParsedBooking (erweiterte Felder)

Kein Template gefunden:
  → LLM Fallback (wie bisher)
  → User Notice: "Kein Template für [Airline] — möchtest du eines beitragen?"
  → Miss wird anonym für LLM-Training gespeichert
```

### Airline Detector

Erkennt die Airline anhand (Priorität absteigend):
1. `From`-Adresse (z.B. `@lufthansa.com`, `@ryanair.com`)
2. `Subject`-Pattern (z.B. "Buchungsbestätigung", "Your booking confirmation")
3. HTML-Domain-Fingerprint (falls andere Felder fehlen)

### Template Registry

- Templates werden beim App-Start aus lokalem Cache geladen
- Täglicher Background-Sync mit GitHub-Registry
- Fallback auf eingebaute Core-Templates (Top-20-Airlines) falls kein Internet

---

## 2. Community Plugin-System

### Template-Format (Hybrid JSON + Transforms)

```json
{
  "airline": "Lufthansa",
  "iata": "LH",
  "version": "2024-03",
  "from": ["@lufthansa.com", "@miles-and-more.com"],
  "subject": ["Buchungsbestätigung", "Booking Confirmation"],
  "selectors": {
    "flightNumber": ".flight-info td:nth-child(1)",
    "pnr": ".booking-reference",
    "departureTime": "[data-dep-time]",
    "arrivalTime": "[data-arr-time]",
    "departureCode": ".dep-airport-iata",
    "arrivalCode": ".arr-airport-iata",
    "seat": ".seat-info",
    "seatClass": ".cabin-class",
    "price": ".total-price",
    "currency": ".currency-code",
    "taxes": ".tax-amount",
    "fees": ".fee-amount",
    "baggage": ".baggage-allowance",
    "frequentFlyer": ".miles-more-number",
    "ticketNumber": ".ticket-number",
    "bookingClass": ".booking-class-letter"
  },
  "transforms": {
    "departureTime": "value => value.replace('h', 'T') + ':00'"
  },
  "testCases": [
    {
      "input": "samples/lh-booking-2024.eml",
      "expected": {
        "flightNumber": "LH400",
        "pnr": "ABC123"
      }
    }
  ]
}
```

### Distribution

- **Repo:** `travstats-airline-templates` (separates öffentliches GitHub-Repo)
- **Struktur:** `templates/<IATA>.json` + `samples/<IATA>/` (anonymisierte Test-Emails)
- **CI/CD:** GitHub Actions führt alle `testCases` automatisch aus bei jedem PR
- **BCBP Validierung:** Wenn Test-Email einen Barcode enthält, wird BCBP-Dekodierung als Ground-Truth genutzt

### In-App Template-Ansicht

- Liste aller erkannten Airlines im eigenen Datensatz
- Template-Status: ✅ Template vorhanden / ⚠️ LLM-Fallback / ❌ Kein Template
- Template-Version + letztes Update-Datum
- "Update verfügbar" Badge bei neuen Versionen
- Link zu GitHub für Beiträge

---

## 3. Neue Datenfelder (Prisma Schema)

| Feld | Typ | Quelle |
|------|-----|--------|
| `baggageAllowance` | `String?` | Email/Boarding Pass |
| `frequentFlyerNumber` | `String?` | Email/BCBP |
| `bookingClassLetter` | `String?` | Email/BCBP (z.B. "Y", "C", "J") |
| `coPassengers` | `String[]` | Email |
| `parserTemplate` | `String?` | Tracking: welches Template genutzt |
| `parserConfidence` | `Int?` | Konfidenz 0–100 |

---

## 4. UI-Priorisierung

Import-Dialog wird umgebaut:

```
Tab 1: 📧 Email  ← NEU PRIMÄR
  - Drag & Drop für .eml, .msg, .txt
  - PDF-Attachment-Erkennung
  - Paste-Bereich für Email-Text

Tab 2: 📷 Boarding Pass  ← bisher primär
  - Bild-Upload wie bisher
  - BCBP Barcode-Upload (Phase 2)

Tab 3: ✏️ Manuell  ← bisher sekundär
  - Formular wie bisher
```

---

## 5. LLM Training Signal

Jeder Parse-Vorgang erzeugt einen Trainings-Datenpunkt:

```typescript
interface ParseTrainingRecord {
  airline?: string;
  templateUsed?: string;          // Template-Name oder null
  templateHit: boolean;           // false = LLM Fallback
  fields: Record<string, {
    value: string;
    confidence: number;
    userCorrected?: string;       // Wenn User korrigiert hat
  }>;
  timestamp: DateTime;
  anonymized: true;               // Keine PII
}
```

- Template-Miss → sofort gespeichert (hilft Community zu priorisieren)
- User-Korrekturen → Ground Truth Label für Fine-Tuning
- BCBP-Match → automatische Validierung der Parsing-Qualität

---

## Implementierungsreihenfolge

1. `AirlineDetector` Service (From/Subject Matching)
2. Template-Loader (lokales JSON + GitHub Sync)
3. Template-Engine (CSS-Selektor + Transform-Ausführung)
4. Neue Prisma-Felder + Migrations
5. LLM Fallback mit User-Notice
6. Training-Record Speicherung
7. UI: Tab-Reihenfolge + Drag & Drop
8. In-App Template-Ansicht
9. Initiale Templates: LH, LX, OS, SN, FR, U2, W6, EW

---

## Nicht in Scope (Phase 1)

- BCBP Barcode-Decoder (→ Phase 2)
- PDF-Bordkarten-Parsing (→ Phase 2)
- CO₂-Berechnung (→ Phase 3)
- Actual Times / Delay-Tracking (→ Phase 3)
- Fine-Tuning Ausführung (→ Phase 4)
