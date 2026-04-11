# TravStats — Feature Roadmap Phase 2–6

**As of:** 2026-03-11
**Phase 1:** ✅ Completed (PR #32) — Email as primary input type + community template system

---

## Phase 2: BCBP Barcode Decoder + PDF Support

**Goal:** Boarding pass becomes a fully-fledged second input path

- BCBP (Bar Coded Boarding Pass, IATA standard) decoder
  - Reads barcode data directly from image uploads (QR/Aztec/PDF417)
  - Ground truth for template validation (compared against email parsing)
- PDF attachment detection and parsing
  - PDF boarding passes and PDF booking confirmations
  - Text extraction from PDFs (pdfjs or pdf-parse)
- Integrate BCBP data into ParsedBooking
- Out of scope: CO₂, fine-tuning

---

## Phase 3: Actual Times, Delay Tracking, CO₂

**Goal:** Extend flight data with real-time and environmental data

- Actual departure/arrival times (vs. scheduled)
- Delay calculation and display
- CO₂ footprint calculation per flight
  - Formula: distance × emission factor × cabin factor
  - Display in kg and "elephant" equivalent (as prepared in FunStats)
- New fields in the Prisma schema: `actualDeparture`, `actualArrival`, `delayMinutes`, `co2Kg`

---

## Phase 4: LLM Training Pipeline

**Goal:** Use the collected ParseTrainingLog data for fine-tuning

- Export function for anonymized training data
  - Fields: airline, templateUsed, templateHit, fields+confidence, missing
  - No userId/PII in the export
- Fine-tuning workflow (OpenAI / Anthropic)
- Capture user corrections as ground-truth labels
  - When the user corrects parsed fields in FlightReview → store as a correction
- Admin dashboard: training dataset overview, export button
- Out of scope: fine-tuning execution itself (→ manual/external)

---

## Phase 5: Extended Statistics

**Goal:** More insights from the flight data

- Airline loyalty score and ranking
- Cost per km and cost per hour (BusinessStats already partially implemented)
- Expand seat analysis (window/aisle/middle trends)
- Time-zone hopping statistics
- Country distribution and continent explorer
- Improved visualizations for existing FunStats/UniqueStats
- Export as a PDF report ("My flying year")

---

## Phase 6: Calendar Import (ICS) — Optional

**Goal:** Import flights from calendar invitations

- ICS/iCal file parsing
- Detect flight events (airline, flight number, times from calendar entries)
- Integrate into the existing import flow as a fourth tab
- Low priority — only after Phases 2–5 are complete

---

## Implementation Order

```
Phase 2 → BCBP + PDF  (technical foundation for better data quality)
Phase 3 → Actual Times + CO₂  (extends the data basis)
Phase 4 → LLM Training  (uses data collected in phases 1-3)
Phase 5 → Statistics  (builds on a complete data basis)
Phase 6 → ICS  (nice-to-have)
```
