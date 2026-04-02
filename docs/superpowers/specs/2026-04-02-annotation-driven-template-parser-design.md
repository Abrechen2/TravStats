# Annotation-Driven Template Parser

**Date:** 2026-04-02
**Status:** Approved for planning
**Replaces:** LoRA fine-tuning approach

---

## Problem

The existing email parser (regex + LLM) reliably finds only 1 flight per email. Nearly every booking email contains 2–3 flights (outbound + return, or multi-leg connections). The multi-flight detection (`parseMultipleFlights`) fails on real-world Lufthansa emails because the regex patterns do not match the labeled field names used by that airline's email system.

LoRA fine-tuning was the planned solution, but it requires 100–200 quality examples before showing improvement and produces a per-user model that cannot be shared. A proof-of-concept test showed that **one annotated email** produces regex templates that correctly identify 12/12 flights (100% flight count, 94% field accuracy) across 5 different emails of the same airline format.

---

## Solution: Annotation → Template → Review Form

When a user annotates an email in the Training tab, the system automatically derives a reusable **ParserTemplate** from the annotation. On the next matching email import, the template pre-fills the review form. A local LLM (Ollama, optional) fills any remaining empty fields. The user reviews, corrects if needed, and saves — corrections feed back into the template.

No model training. No external services. Fully local.

---

## Architecture

```
Email Import
    │
    ▼
1. FingerprintMatcher
   ├── Active template found?  YES → TemplateParser (deterministic)
   └── No match               NO  → existing RegexTextParser / LLMParser
    │
    ▼
2. LLM Gap-Filler (optional, Ollama)
   └── Called only for fields still empty after step 1
    │
    ▼
3. Review Form
   └── Fields colour-coded by source:
       green  = Template (high confidence)
       yellow = LLM suggestion (verify)
       red    = empty (manual entry required)
    │
    ▼
4. User saves
   └── Corrections stored → CorrectionStore
    │
    ▼
5. Template Updater (background)
   └── After N corrections on same field → update template pattern
```

---

## Data Model

### New Prisma model: `ParserTemplate`

```prisma
model ParserTemplate {
  id          String   @id @default(uuid())
  userId      String   @map("user_id")
  name        String
  status      String   @default("pending")   // pending | active | disabled
  fingerprint Json                            // see Fingerprint section
  patterns    Json                            // see Patterns section
  stats       Json?                           // matchCount, successRate, lastUsedAt
  sourceId    String?  @map("source_id")     // training_data.id that created it
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt            @map("updated_at")
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("parser_templates")
}
```

### Fingerprint (JSON field)

```json
{
  "senderDomains": ["noti.swiss.com", "lufthansa.com"],
  "subjectPatterns": ["Vielen Dank für Ihre Buchung"],
  "bodyMarkers": ["IATA-Code des Abflughafens", "Buchungsübersicht"]
}
```

A template matches when **all** `bodyMarkers` are present and at least one `senderDomain` or `subjectPattern` matches.

### Patterns (JSON field)

```json
{
  "pnr": "Buchungscode:\\s*([A-Z0-9]{5,8})",
  "reiseplanSegment": "...",
  "detailsBlock": "...",
  "aircraft": "(?:Airbus|Boeing|Embraer)\\s+([\\w\\-]+)"
}
```

Patterns are standard regex strings with one capture group per field. The `reiseplanSegment` pattern is format-agnostic (works across Lufthansa email variants) because it anchors on the structural keyword "Durchgeführt von:", which appears in all confirmed Lufthansa booking email formats.

---

## Template Derivation (`TemplateDeriver` service)

Triggered automatically when an annotation is saved with at least one `textSelection`.

**Algorithm per field:**

1. Take the annotated text and its character position in `fullText`
2. Extract context window (80 chars before, 20 chars after)
3. Strip personal data from context (names, dates, codes — replaced with regex wildcards)
4. Generate minimal regex: `<escaped_context>\\s*([<field_character_class>]{<length>})`

**Special case — structural segments (Reiseplan):**
The reiseplan segment pattern is not derived from individual character positions but from the known structure of Lufthansa emails (validated in proof-of-concept). It is included in every derived template when `"Reiseplan"` and `"Durchgeführt"` appear in `fullText`.

**Output:** A `ParserTemplate` object with `status: "pending"` and test results.

---

## Template Review UI

After annotation save, a review card appears in the Training tab:

```
┌─────────────────────────────────────────────────────────┐
│  🧩  Template abgeleitet: "Lufthansa Buchungsbestätigung DE"  │
│                                                         │
│  Getestet gegen deine importierten Mails:               │
│  ✓  LH2460  MUC→HEL   18.09.2025  (6/6 Felder)         │
│  ✓  LH9790  MUC→SIN   07.06.2025  (6/6 Felder)         │
│  ~  LX1101  MUC→ZRH   29.10.2025  (4/6 Felder)         │
│                                                         │
│  Genauigkeit: 94%  ·  12 Flüge erkannt                  │
│                                                         │
│  [Template aktivieren]   [Details]   [Ignorieren]       │
└─────────────────────────────────────────────────────────┘
```

The test runs the derived template against all emails already in the user's database (both training data and imported flights) to give a real accuracy estimate before activation.

---

## Review Form (Email Import)

When a new email is imported and a template matches, the review form is pre-filled and fields are colour-coded by confidence source:

| Colour | Source | Meaning |
|--------|--------|---------|
| Green  | Template | High confidence — derived from user's own annotation |
| Yellow | LLM (Ollama) | Suggestion — verify before saving |
| Red    | Empty | Not extracted — requires manual entry |

The user can edit any field. The form is identical to the existing manual import form; only the pre-filling and colour coding are new.

---

## LLM Gap-Filler (Optional)

**When invoked:** After template parsing, if any fields in the `ParsedBooking` result are `undefined`.

**What changes vs. current LLM parser:**
Instead of sending the full email to the LLM with a generic "extract all fields" prompt, only the missing fields and a short relevant excerpt of the email are sent:

```
Current:  llmParser.parseEmail(subject, fullText, html)  // full email
New:      llmParser.fillGaps(partialResult, missingFields, excerpt)
```

This reduces prompt size by ~80%, improves accuracy for targeted fields, and makes Ollama fast enough for interactive use.

**Configuration:** Enabled/disabled per user in settings. Defaults to disabled. When enabled, the Ollama endpoint from the existing config (`OLLAMA_URL`) is used.

**Model recommendation:** `llama3.2` or `mistral` — both available on the user's Mac mini Ollama instance and suitable for structured extraction tasks.

---

## Feedback Loop: Corrections Improve Templates

When a user corrects a green (template-sourced) field in the review form, the correction is stored:

```
{
  templateId: "...",
  field: "arrivalCode",
  expected: "FRA",
  got: "LUX",
  emailFingerprint: "..."
}
```

A background job (`TemplateUpdater`) checks corrections after each save:
- If the same field has ≥3 consistent corrections → the template pattern for that field is updated
- Updated templates are re-tested against known emails before going active

This replaces model retraining entirely: the template learns from corrections deterministically.

---

## Parser Pipeline Integration

The template step is inserted at the front of the existing pipeline in `bookingParser.ts`. No existing parser is removed — templates are purely additive:

```typescript
// New step 0 — before all existing parsers:
const templateResult = await templateParser.parse(subject, text, html, userId);
if (templateResult.confidence >= 0.8) {
  return templateResult.flights;
}
// Fall through to existing pipeline unchanged
```

The `confidence` score is the ratio of non-empty fields to total expected fields. A threshold of 0.8 means at least 80% of fields were extracted before handing off to LLM/manual.

---

## Privacy

Templates contain **only structural patterns** — no email content, no personal data, no flight details. A template derived from a Lufthansa Helsinki booking email looks identical to one derived from a Lufthansa Tokyo booking email.

**Community sharing (out of scope for this phase):**
Templates are architecture-ready for optional community export (a template JSON file has no user-identifiable content), but no sharing feature is built in this phase. Users share nothing by default.

---

## What This Replaces

| Was geplant | Wird ersetzt durch |
|---|---|
| LoRA fine-tuning | Template derivation from annotations |
| Per-user Ollama model | Shared Ollama model, targeted prompts |
| 100+ training samples needed | 1 annotation per email format |
| Training job infrastructure | TemplateDeriver service (~200 lines) |

The existing LoRA training pipeline (`trainLora.py`, `trainingService.ts` training jobs) is **not deleted** in this phase — it remains available but is no longer the primary improvement mechanism. It may be revisited if template + LLM gap-filling proves insufficient for genuinely ambiguous email formats.

---

## Out of Scope

- Community template marketplace / GitHub sync
- Multi-user template sharing
- Template versioning / rollback UI
- Support for non-email sources (boarding pass PDFs) — templates apply to text emails only

---

## Success Criteria

- [ ] 1 annotation of a new airline format → template active within 30 seconds
- [ ] Template correctly identifies ≥80% of fields on the next matching email
- [ ] Review form shows colour-coded confidence for all fields
- [ ] LLM gap-filler (when enabled) reduces red fields to near zero
- [ ] No regression in existing parser pipeline for emails without a matching template
