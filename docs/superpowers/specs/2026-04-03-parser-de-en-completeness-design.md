# Parser DE/EN Completeness — Design Spec

## Goal

Fix a bug and extend `regexParser.ts` so that common German and English email formats are fully recognized: DACH city names, flight-number keyword variants, gate keywords, and — most importantly — labeled date fields (`Abflug:` / `Departure:`) that reliably assign departure vs. arrival times.

## Architecture

All changes are confined to `backend/src/services/parsers/text/regexParser.ts` plus corresponding tests in `backend/src/__tests__/parsers.text.test.ts`. No schema changes, no route changes, no frontend changes.

**File structure unchanged** — this is targeted improvement inside the existing class.

---

## Section 1: Bug Fix + Data Additions

Four independent, low-risk additions.

### 1a. Remove VIE from false-positive filter

`extractAirportCodes` has a hardcoded `falsePositives` array that incorrectly includes `'VIE'` (Vienna airport). Remove it. The multi-flight path (`extractAllAirportPairs`) already handles VIE correctly via `isValidIATACode`; this fixes the single-flight path.

### 1b. DACH cities in `CITY_TO_IATA`

Add to the module-level map:

| Key(s) | Code |
|--------|------|
| `wien`, `vienna` | `VIE` |
| `salzburg` | `SZG` |
| `graz` | `GRZ` |
| `innsbruck` | `INN` |
| `linz` | `LNZ` |
| `basel` | `BSL` |
| `bern` | `BRN` |

### 1c. Flight number keywords

Extend both patterns in `parseMultipleFlights`:

```
Current:  (?:FLIGHT|FLUG)
Extended: (?:FLIGHT|FLUG|FLUGNUMMER|FLUG-NR|FLT)
```

### 1d. Gate DE keywords

Extend `PATTERNS.GATE` in `shared/utils.ts`:

```
Current:  (?:Gate|Boarding)
Extended: (?:Gate|Boarding|Ausgang|Steig)
```

---

## Section 2: Label-Based Date Assignment

### Problem

The current logic assigns dates by position: first date found = departure, second = arrival. This breaks when emails contain non-flight dates before the itinerary (booking date, issue date, etc.).

### Solution

New private method `extractLabeledDates(source: string)` on `RegexTextParser`. It scans for departure/arrival label keywords immediately followed by a parseable date/time, and returns `{ departureTime?, arrivalTime? }`.

**Supported labels (case-insensitive):**

| Role | Labels |
|------|--------|
| Departure | `Abflug`, `Abflugzeit`, `Abreise`, `Departure`, `Departing`, `Departs`, `Dep` |
| Arrival | `Ankunft`, `Ankunftszeit`, `Arrival`, `Arriving`, `Arrives`, `Arr` |

**Pattern per label group:**
```
/(?:label1|label2|...)\s*:?\s*(<date-pattern>)/gi
```
Where `<date-pattern>` is the same German/English date regex already used in the parser (ISO format and `d. Month YYYY HH:MM` variants).

**Important:** Short labels like `Dep` and `Arr` must be followed by `:` or whitespace + a digit/month-name to avoid matching IATA codes in route strings (e.g. `DEP` in `DEP→ARR`). The `\s*:?\s*` separator before the date pattern enforces this — a bare `DEP` followed by an arrow will not match.

**Integration (Option A):**

Both `extractAllTimePairs` and `parseBookingEmailRegex` call `extractLabeledDates` first:
- If labeled dep **and** arr found → use both, skip positional scan
- If only labeled dep found → use it for departure, positional scan for arrival
- If only labeled arr found → positional scan for departure, use it for arrival
- If no labels → positional scan as today (unchanged behavior)

**Date parsing reuse:** `extractLabeledDates` uses `MONTH_NAMES` and `addDays` already defined at module level. No new date parsing logic introduced.

---

## Testing

New tests in `parsers.text.test.ts`:

| Scenario | Test |
|----------|------|
| VIE recognized as airport | single-flight email `VIE → MUC` |
| Wien → VIE city mapping | `Von Wien nach München` |
| `Flugnummer: LH103` | flight number extracted |
| `Flt. LH103` | flight number extracted |
| `Abflug:` label assigns departureTime | label before ISO and German date |
| `Ankunft:` label assigns arrivalTime | label before ISO and German date |
| `Departure:` / `Arrival:` EN labels | same |
| Booking date before flight date ignored | without labels → positional; with labels → correct |
| Mixed: only one label found | dep from label, arr from position |

---

## Out of Scope

- No new city mappings beyond DACH (France, Italy, etc. — can be added later as needed)
- No time-only parsing (e.g., `23:45 → 01:30 +1` without a date context)
- No changes to LLM parsers (Claude, OpenAI, Ollama) — they handle labels naturally
