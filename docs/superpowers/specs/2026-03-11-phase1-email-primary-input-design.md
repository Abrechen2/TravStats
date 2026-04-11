# Phase 1: Email as Primary Input Type — Design Spec

**Date:** 2026-03-11
**Status:** Approved
**Scope:** Email parsing pipeline, community plugin system, new data fields, LLM training signal

---

## Goal

Email booking confirmations become the primary input path for flight data. Boarding pass and manual import become secondary options. A community plugin system enables airline-specific templates with a low entry barrier.

---

## 1. Email Parsing Pipeline

### Flow

```
Email (.eml / .msg / .txt / PDF attachment)
  → Airline Detector (From / Subject / Domain)
  → Template Registry (JSON + optional transforms)
  → ParsedBooking (extended fields)

No template found:
  → LLM fallback (as before)
  → User notice: "No template for [Airline] — would you like to contribute one?"
  → Miss is stored anonymously for LLM training
```

### Airline Detector

Detects the airline based on (priority descending):
1. `From` address (e.g. `@lufthansa.com`, `@ryanair.com`)
2. `Subject` pattern (e.g. "Buchungsbestätigung", "Your booking confirmation")
3. HTML domain fingerprint (if other fields are missing)

### Template Registry

- Templates are loaded from a local cache at app startup
- Daily background sync with the GitHub registry
- Falls back to built-in core templates (top 20 airlines) if there is no internet

---

## 2. Community Plugin System

### Template Format (Hybrid JSON + Transforms)

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

- **Repo:** `travstats-airline-templates` (separate public GitHub repo)
- **Structure:** `templates/<IATA>.json` + `samples/<IATA>/` (anonymized test emails)
- **CI/CD:** GitHub Actions runs all `testCases` automatically on every PR
- **BCBP validation:** When a test email contains a barcode, BCBP decoding is used as ground truth

### In-App Template View

- List of all airlines detected in the user's own dataset
- Template status: ✅ template available / ⚠️ LLM fallback / ❌ no template
- Template version + last update date
- "Update available" badge on new versions
- Link to GitHub for contributions

---

## 3. New Data Fields (Prisma Schema)

| Field | Type | Source |
|------|-----|--------|
| `baggageAllowance` | `String?` | Email/Boarding Pass |
| `frequentFlyerNumber` | `String?` | Email/BCBP |
| `bookingClassLetter` | `String?` | Email/BCBP (e.g. "Y", "C", "J") |
| `coPassengers` | `String[]` | Email |
| `parserTemplate` | `String?` | Tracking: which template was used |
| `parserConfidence` | `Int?` | Confidence 0–100 |

---

## 4. UI Prioritization

The import dialog is reorganized:

```
Tab 1: 📧 Email  ← NEW PRIMARY
  - Drag & drop for .eml, .msg, .txt
  - PDF attachment detection
  - Paste area for email text

Tab 2: 📷 Boarding Pass  ← previously primary
  - Image upload as before
  - BCBP barcode upload (phase 2)

Tab 3: ✏️ Manual  ← previously secondary
  - Formular wie bisher
```

---

## 5. LLM Training Signal

Each parse operation produces a training data point:

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

- Template miss → stored immediately (helps the community prioritize)
- User corrections → ground-truth labels for fine-tuning
- BCBP match → automatic validation of parsing quality

---

## Implementation Order

1. `AirlineDetector` service (From/Subject matching)
2. Template loader (local JSON + GitHub sync)
3. Template engine (CSS selector + transform execution)
4. New Prisma fields + migrations
5. LLM fallback with user notice
6. Training record storage
7. UI: tab order + drag & drop
8. In-app template view
9. Initial templates: LH, LX, OS, SN, FR, U2, W6, EW

---

## Out of Scope (Phase 1)

- BCBP barcode decoder (→ Phase 2)
- PDF boarding pass parsing (→ Phase 2)
- CO₂ calculation (→ Phase 3)
- Actual times / delay tracking (→ Phase 3)
- Fine-tuning execution (→ Phase 4)
