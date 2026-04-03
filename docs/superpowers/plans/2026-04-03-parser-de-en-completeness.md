# Parser DE/EN Completeness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the VIE false-positive bug and extend the regex parser with DACH city names, additional flight/gate keywords, and label-based date assignment (`Abflug:` / `Departure:` → departureTime).

**Architecture:** All changes in `regexParser.ts` (data + one new private method) plus `shared/utils.ts` (PATTERNS.GATE). The new `extractLabeledDates` method is called first in `parseBookingEmailRegex`; if it finds dep/arr via labels it takes priority over the existing positional scan. `extractAllTimePairs` (multi-flight path) is unchanged — positional ordering is reliable there.

**Tech Stack:** TypeScript, Jest, existing `MONTH_NAMES` + `addDays` helpers already at module level in `regexParser.ts`.

---

### Task 1: Bug fix + data additions

**Files:**
- Modify: `backend/src/services/parsers/text/regexParser.ts`
- Modify: `backend/src/services/parsers/shared/utils.ts`
- Test: `backend/src/__tests__/parsers.text.test.ts`

- [ ] **Step 1: Write failing tests**

Add to the `RegexTextParser > parseEmail` describe block in `backend/src/__tests__/parsers.text.test.ts`:

```typescript
it('should recognize VIE as Vienna airport code', async () => {
  const subject = 'Flight booking';
  const text = `
    Flight: OS431
    VIE → MUC
    2025-03-10T10:30
    2025-03-10T11:45
  `;
  const result = await parser.parseEmail(subject, text);
  const found = result.find(r => r.departureCode === 'VIE' || r.arrivalCode === 'VIE');
  expect(found).toBeDefined();
});

it('should map Wien to VIE', async () => {
  const subject = 'Flugbuchung';
  const text = `
    Flug: OS431
    Von Wien nach München
    am 10. März 2025, 10:30
  `;
  const result = await parser.parseEmail(subject, text);
  expect(result[0].departureCode).toBe('VIE');
  expect(result[0].arrivalCode).toBe('MUC');
});

it('should map Salzburg to SZG', async () => {
  const subject = 'Flight booking';
  const text = `
    Flight: OS123
    Von Salzburg nach Wien
    am 10. März 2025, 08:00
  `;
  const result = await parser.parseEmail(subject, text);
  expect(result[0].departureCode).toBe('SZG');
});

it('should extract flight number from Flugnummer keyword', async () => {
  const subject = 'Buchungsbestätigung';
  const text = `
    Flugnummer: LH103
    MUC → LUX
    2025-11-18T11:00
    2025-11-18T12:55
  `;
  const result = await parser.parseEmail(subject, text);
  expect(result[0].flightNumber).toBe('LH103');
});

it('should extract flight number from Flt keyword', async () => {
  const subject = 'Booking confirmation';
  const text = `
    Flt. LH103
    MUC → LUX
    2025-11-18T11:00
    2025-11-18T12:55
  `;
  const result = await parser.parseEmail(subject, text);
  expect(result[0].flightNumber).toBe('LH103');
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && npx jest --testPathPattern="parsers.text" --forceExit 2>&1 | grep -E "(✓|✗|×|√|PASS|FAIL|●)" | tail -20
```

Expected: the 5 new tests fail.

- [ ] **Step 3: Fix VIE false positive**

In `backend/src/services/parsers/text/regexParser.ts`, in `extractAirportCodes` (around line 220), change:

```typescript
// BEFORE
'OGO', 'CRA', 'VIE', 'DAN', 'VIEL', 'DANK', 'SEHR', 'WICHT', 'BEST',

// AFTER
'OGO', 'CRA', 'DAN', 'VIEL', 'DANK', 'SEHR', 'WICHT', 'BEST',
```

- [ ] **Step 4: Add DACH cities to CITY_TO_IATA**

In `backend/src/services/parsers/text/regexParser.ts`, extend the `CITY_TO_IATA` map (currently ends at line ~28):

```typescript
// Add after the existing entries, before the closing };
  wien: 'VIE', vienna: 'VIE',
  salzburg: 'SZG',
  graz: 'GRZ',
  innsbruck: 'INN',
  linz: 'LNZ',
  basel: 'BSL',
  bern: 'BRN',
```

- [ ] **Step 5: Add flight number keywords**

In `backend/src/services/parsers/text/regexParser.ts`, in `parseMultipleFlights` (around line 251), change:

```typescript
// BEFORE
/(?:FLIGHT|FLUG)\s*:?\s*([A-Z]{2,3}\s?\d{1,4})\b/gi,

// AFTER
/(?:FLIGHT|FLUG|FLUGNUMMER|FLUG-NR|FLT\.?)\s*:?\s*([A-Z]{2,3}\s?\d{1,4})\b/gi,
```

- [ ] **Step 6: Add gate DE keywords**

In `backend/src/services/parsers/shared/utils.ts`, change `PATTERNS.GATE` (around line 215):

```typescript
// BEFORE
GATE: /(?:Gate|Boarding)\s*:?\s*([A-Z]?\d{1,3}[A-Z]?)/i,

// AFTER
GATE: /(?:Gate|Boarding|Ausgang|Steig)\s*:?\s*([A-Z]?\d{1,3}[A-Z]?)/i,
```

- [ ] **Step 7: Run tests — should pass**

```bash
cd backend && npx jest --testPathPattern="parsers.text" --forceExit 2>&1 | grep -E "(Tests:|✓|√)" | tail -5
```

Expected: all 5 new tests pass, no regressions.

- [ ] **Step 8: Type-check**

```bash
cd backend && npx tsc --noEmit
```

Expected: no output (clean).

- [ ] **Step 9: Commit**

```bash
cd backend && git add src/services/parsers/text/regexParser.ts src/services/parsers/shared/utils.ts src/__tests__/parsers.text.test.ts
git commit -m "fix: parser DE/EN — VIE false-positive, DACH cities, Flugnummer/Flt keywords, Ausgang/Steig gate"
```

---

### Task 2: Label-based date assignment (`extractLabeledDates`)

**Files:**
- Modify: `backend/src/services/parsers/text/regexParser.ts`
- Test: `backend/src/__tests__/parsers.text.test.ts`

- [ ] **Step 1: Write failing tests**

Add to the `RegexTextParser > parseEmail` describe block in `backend/src/__tests__/parsers.text.test.ts`:

```typescript
it('should assign departureTime from Abflug label', async () => {
  const subject = 'Buchungsbestätigung';
  const text = `
    Buchungsdatum: 01. November 2025
    Flug: LH103
    MUC → LUX
    Abflug: 18. November 2025, 11:00
    Ankunft: 18. November 2025, 12:55
  `;
  const result = await parser.parseEmail(subject, text);
  expect(result[0].departureTime).toContain('2025-11-18T11:00');
  expect(result[0].arrivalTime).toContain('2025-11-18T12:55');
});

it('should assign departureTime from Departure label (EN)', async () => {
  const subject = 'Booking confirmation';
  const text = `
    Booking date: 01 November 2025
    Flight: LH103
    MUC → LUX
    Departure: 18 November 2025, 11:00
    Arrival: 18 November 2025, 12:55
  `;
  const result = await parser.parseEmail(subject, text);
  expect(result[0].departureTime).toContain('2025-11-18T11:00');
  expect(result[0].arrivalTime).toContain('2025-11-18T12:55');
});

it('should assign departureTime from Departure label with ISO date', async () => {
  const subject = 'Booking confirmation';
  const text = `
    Issue date: 2025-10-01
    Flight: LH103
    MUC → LUX
    Departure: 2025-11-18T11:00
    Arrival: 2025-11-18T12:55
  `;
  const result = await parser.parseEmail(subject, text);
  // Without label logic, issue date 2025-10-01 would be picked as departure
  expect(result[0].departureTime).toBe('2025-11-18T11:00');
  expect(result[0].arrivalTime).toBe('2025-11-18T12:55');
});

it('should work with partial labels — only Abflug found', async () => {
  const subject = 'Buchungsbestätigung';
  const text = `
    Flug: LH103
    MUC → LUX
    Abflug: 18. November 2025, 11:00
    18. November 2025, 12:55
  `;
  const result = await parser.parseEmail(subject, text);
  expect(result[0].departureTime).toContain('2025-11-18T11:00');
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && npx jest --testPathPattern="parsers.text" --forceExit 2>&1 | grep -E "(Tests:|✓|√|✗|×|●)" | tail -10
```

Expected: the 4 new tests fail (booking date picked as departureTime instead of flight date).

- [ ] **Step 3: Add `extractLabeledDates` method**

In `backend/src/services/parsers/text/regexParser.ts`, add this private method to the `RegexTextParser` class, just before `parseBookingEmailRegex`:

```typescript
/**
 * Scan source for dep/arr label keywords immediately followed by a parseable date.
 * Returns whichever of {departureTime, arrivalTime} it finds; caller uses positional
 * fallback for any field not found here.
 */
private extractLabeledDates(source: string): { departureTime?: string; arrivalTime?: string } {
  const result: { departureTime?: string; arrivalTime?: string } = {};

  const DEP_LABELS = /(?:Abflug|Abflugzeit|Abreise|Departure|Departing|Departs|Dep)\s*:?\s*/gi;
  const ARR_LABELS = /(?:Ankunft|Ankunftszeit|Arrival|Arriving|Arrives|Arr)\s*:?\s*/gi;

  const parseFromPos = (pos: number): string | undefined => {
    const slice = source.slice(pos, pos + 50);
    // ISO format (TZ suffix stripped)
    const isoM = slice.match(/^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?)(?:[+-]\d{2}:?\d{2}|Z)?/);
    if (isoM) return isoM[1].replace(' ', 'T');
    // German/English date format
    const deM = slice.match(
      /^(\d{1,2})[.\s]+(\d{1,2}|[A-Za-zÄÖÜäöü]{3,9})[.\s]+(\d{4})(?:[,\s]+(\d{1,2}):(\d{2}))?/
    );
    if (deM) {
      const d = deM[1].padStart(2, '0');
      const raw = deM[2].toUpperCase();
      const mo = MONTH_NAMES[raw] ?? (deM[2].length <= 2 ? deM[2].padStart(2, '0') : '01');
      const h = deM[4] ? deM[4].padStart(2, '0') : '00';
      const min = deM[5] ?? '00';
      return `${deM[3]}-${mo}-${d}T${h}:${min}`;
    }
    return undefined;
  };

  for (const m of source.matchAll(DEP_LABELS)) {
    const t = parseFromPos(m.index! + m[0].length);
    if (t) { result.departureTime = t; break; }
  }

  for (const m of source.matchAll(ARR_LABELS)) {
    const t = parseFromPos(m.index! + m[0].length);
    if (t) { result.arrivalTime = t; break; }
  }

  return result;
}
```

- [ ] **Step 4: Integrate into `parseBookingEmailRegex` (Option A)**

In `backend/src/services/parsers/text/regexParser.ts`, in `parseBookingEmailRegex`, replace the ISO time extraction block:

```typescript
// BEFORE (around line 545):
// Times - improved extraction with multiple formats
// ISO format — TZ offset/Z suffix consumed but not captured (local time kept)
const isoTimeMatches = Array.from(
  source.matchAll(/(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?)(?:[+-]\d{2}:?\d{2}|Z)?(?=[^\d]|$)/g)
);
if (isoTimeMatches.length >= 1) data.departureTime = isoTimeMatches[0][1].replace(' ', 'T');
if (isoTimeMatches.length >= 2) data.arrivalTime = isoTimeMatches[1][1].replace(' ', 'T');

// German/English date format — abbreviated and full month names, time optional
if (!data.departureTime || !data.arrivalTime) {
  const germanDatePattern = /(\d{1,2})[.\s]+(\d{1,2}|[A-Za-zÄÖÜäöü]{3,9})[.\s]+(\d{4})(?:[,\s]+(\d{1,2}):(\d{2}))?/gi;
  const dateMatches = Array.from(source.matchAll(germanDatePattern));
  const toIso = (m: RegExpMatchArray, src: string): string => {
    const d = m[1].padStart(2, '0');
    const raw = m[2].toUpperCase();
    const mo = MONTH_NAMES[raw] ?? (m[2].length <= 2 ? m[2].padStart(2, '0') : '01');
    const y = m[3];
    const h = m[4] ? m[4].padStart(2, '0') : '00';
    const min = m[5] ?? '00';
    let iso = `${y}-${mo}-${d}T${h}:${min}`;
    // Detect +N next-day marker — exclude timezone offsets like +01:00
    const after = src.slice(m.index! + m[0].length, m.index! + m[0].length + 8);
    const nextDay = after.match(/^\s*\(?\+(\d)\)?(?!\d*:)/);
    if (nextDay) iso = addDays(iso, Number(nextDay[1]));
    return iso;
  };
  if (dateMatches.length > 0) {
    if (!data.departureTime) data.departureTime = toIso(dateMatches[0], source);
    if (!data.arrivalTime && dateMatches.length > 1) data.arrivalTime = toIso(dateMatches[1], source);
  }
}
```

```typescript
// AFTER:
// Times — label-based first (Option A), positional fallback
const labeled = this.extractLabeledDates(source);
if (labeled.departureTime) data.departureTime = labeled.departureTime;
if (labeled.arrivalTime) data.arrivalTime = labeled.arrivalTime;

if (!data.departureTime || !data.arrivalTime) {
  // ISO format — TZ offset/Z suffix consumed but not captured (local time kept)
  const isoTimeMatches = Array.from(
    source.matchAll(/(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?)(?:[+-]\d{2}:?\d{2}|Z)?(?=[^\d]|$)/g)
  );
  if (!data.departureTime && isoTimeMatches.length >= 1) data.departureTime = isoTimeMatches[0][1].replace(' ', 'T');
  if (!data.arrivalTime && isoTimeMatches.length >= 2) data.arrivalTime = isoTimeMatches[1][1].replace(' ', 'T');
}

if (!data.departureTime || !data.arrivalTime) {
  // German/English date format — abbreviated and full month names, time optional
  const germanDatePattern = /(\d{1,2})[.\s]+(\d{1,2}|[A-Za-zÄÖÜäöü]{3,9})[.\s]+(\d{4})(?:[,\s]+(\d{1,2}):(\d{2}))?/gi;
  const dateMatches = Array.from(source.matchAll(germanDatePattern));
  const toIso = (m: RegExpMatchArray, src: string): string => {
    const d = m[1].padStart(2, '0');
    const raw = m[2].toUpperCase();
    const mo = MONTH_NAMES[raw] ?? (m[2].length <= 2 ? m[2].padStart(2, '0') : '01');
    const y = m[3];
    const h = m[4] ? m[4].padStart(2, '0') : '00';
    const min = m[5] ?? '00';
    let iso = `${y}-${mo}-${d}T${h}:${min}`;
    const after = src.slice(m.index! + m[0].length, m.index! + m[0].length + 8);
    const nextDay = after.match(/^\s*\(?\+(\d)\)?(?!\d*:)/);
    if (nextDay) iso = addDays(iso, Number(nextDay[1]));
    return iso;
  };
  if (dateMatches.length > 0) {
    if (!data.departureTime) data.departureTime = toIso(dateMatches[0], source);
    if (!data.arrivalTime && dateMatches.length > 1) data.arrivalTime = toIso(dateMatches[1], source);
  }
}
```

- [ ] **Step 5: Run tests — should pass**

```bash
cd backend && npx jest --testPathPattern="parsers.text" --forceExit 2>&1 | grep -E "(Tests:|✓|√)" | tail -5
```

Expected: all 4 new tests pass, no regressions (total ~47 passing, 1 pre-existing Claude logger failure).

- [ ] **Step 6: Type-check**

```bash
cd backend && npx tsc --noEmit
```

Expected: no output (clean).

- [ ] **Step 7: Commit**

```bash
cd backend && git add src/services/parsers/text/regexParser.ts src/__tests__/parsers.text.test.ts
git commit -m "feat: parser — label-based date assignment (Abflug/Departure/Ankunft/Arrival)"
```
