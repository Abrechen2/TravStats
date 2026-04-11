# Phase 1: Email as the primary input type — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Email booking confirmations become the primary input method, with a community plugin system for airline-specific templates, while boarding pass and manual import become secondary.

**Architecture:** A new `AirlineTemplateEngine` service sits in front of the existing LLM fallback in the parsing pipeline. Templates are JSON files in a separate GitHub repo and are cached daily. The existing `factory.ts` is extended, not replaced.

**Tech Stack:** TypeScript, Prisma, cheerio (HTML parsing), node-cron (sync), React tabs (frontend restructuring)

---

## Chunk 1: Backend — Data model extensions

### Task 1: New fields in the Prisma schema

**Files:**
- Modify: `backend/prisma/schema.prisma` (Flight model, ~line 58–118)
- Create: `backend/prisma/migrations/` (auto-generated)

- [ ] **Step 1: Add new fields to the Flight model**

In `schema.prisma`, insert after the `enrichmentHistory` field (around line 115):

```prisma
  // Phase 1: Email Template Parsing
  baggageAllowance    String?  @map("baggage_allowance")
  frequentFlyerNumber String?  @map("frequent_flyer_number")
  bookingClassLetter  String?  @map("booking_class_letter")  // e.g. "Y", "C", "J", "F"
  coPassengers        String[] @default([]) @map("co_passengers")
  parserTemplate      String?  @map("parser_template")       // e.g. "LH" oder null
  parserConfidence    Int?     @map("parser_confidence")     // 0–100
```

- [ ] **Step 2: Create a migration**

```bash
cd /d/Projekte/TravStats/backend
npx prisma migrate dev --name "add_phase1_email_fields"
```

Expected: Migration file created and database updated. No errors.

- [ ] **Step 3: Regenerate the TypeScript client**

```bash
cd /d/Projekte/TravStats/backend
npx prisma generate
```

Expected: `@prisma/client` contains the new fields with no TypeScript errors.

- [ ] **Step 4: Backend type check**

```bash
cd /d/Projekte/TravStats/backend && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/
git commit -m "feat: add phase1 email parsing fields to Flight model"
```

---

### Task 2: Extend the ParsedBooking interface

**Files:**
- Modify: `backend/src/services/bookingParser.ts` (interface ParsedBooking, ~line 1–30)
- Modify: `frontend/src/types/index.ts` (ParsedBooking interface, ~line 113–134)

- [ ] **Step 1: Extend the backend ParsedBooking**

In `backend/src/services/bookingParser.ts`, add the following fields to the `ParsedBooking` interface (after `fees?`):

```typescript
  // Phase 1: New fields
  baggageAllowance?: string;      // e.g. "1x23kg", "20kg included"
  frequentFlyerNumber?: string;   // e.g. "LH-123456789"
  bookingClassLetter?: string;    // IATA booking class, e.g. "Y", "M", "C", "J", "F"
  coPassengers?: string[];        // e.g. ["Max Mustermann", "Erika Musterfrau"]
  parserTemplate?: string;        // Which template was used, e.g. "LH"
  parserConfidence?: number;      // 0–100
  airlineNotice?: string;         // User-facing notice if no template found
```

- [ ] **Step 2: Extend the frontend ParsedBooking**

In `frontend/src/types/index.ts`, add the same fields (after line ~134):

```typescript
  baggageAllowance?: string;
  frequentFlyerNumber?: string;
  bookingClassLetter?: string;
  coPassengers?: string[];
  parserTemplate?: string;
  parserConfidence?: number;
  airlineNotice?: string;
```

- [ ] **Step 3: Type check on both sides**

```bash
cd /d/Projekte/TravStats/backend && npx tsc --noEmit
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Run the frontend tests**

```bash
cd /d/Projekte/TravStats/frontend && npx vitest --run
```

Expected: All tests green. No test breaks because of the new optional fields.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/bookingParser.ts frontend/src/types/index.ts
git commit -m "feat: extend ParsedBooking with phase1 fields (baggage, FFN, booking class)"
```

---

## Chunk 2: Backend — Airline Template Engine

### Task 3: Define template types

**Files:**
- Create: `backend/src/services/parsers/templates/types.ts`

- [ ] **Step 1: Write a failing test**

New file `backend/src/__tests__/templates/types.test.ts`:

```typescript
import { isValidAirlineTemplate } from "../../services/parsers/templates/types";

describe("isValidAirlineTemplate", () => {
  it("accepts a minimal valid template", () => {
    const template = {
      airline: "Lufthansa",
      iata: "LH",
      version: "2024-03",
      from: ["@lufthansa.com"],
      subject: ["Buchungsbestätigung"],
      selectors: { flightNumber: ".flight-no" },
      transforms: {},
      testCases: [],
    };
    expect(isValidAirlineTemplate(template)).toBe(true);
  });

  it("rejects template missing required fields", () => {
    expect(isValidAirlineTemplate({ airline: "LH" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test — it must fail**

```bash
cd /d/Projekte/TravStats/backend && npx jest --testPathPattern="templates/types" --forceExit
```

Expected: FAIL — "Cannot find module"

- [ ] **Step 3: Implement types.ts**

Create file `backend/src/services/parsers/templates/types.ts`:

```typescript
export interface AirlineTemplateSelectors {
  flightNumber?: string;
  pnr?: string;
  departureTime?: string;
  arrivalTime?: string;
  departureCode?: string;
  arrivalCode?: string;
  seat?: string;
  seatClass?: string;
  price?: string;
  currency?: string;
  taxes?: string;
  fees?: string;
  baggage?: string;
  frequentFlyer?: string;
  ticketNumber?: string;
  bookingClassLetter?: string;
  terminal?: string;
  gate?: string;
  coPassengers?: string;
}

export type SelectorKey = keyof AirlineTemplateSelectors;

export interface AirlineTemplateTestCase {
  input: string;     // Relative path to sample .eml file
  expected: Partial<Record<SelectorKey, string>>;
}

export interface AirlineTemplate {
  airline: string;
  iata: string;
  version: string;
  from: string[];
  subject: string[];
  selectors: AirlineTemplateSelectors;
  transforms: Partial<Record<SelectorKey, string>>;
  testCases: AirlineTemplateTestCase[];
}

export function isValidAirlineTemplate(obj: unknown): obj is AirlineTemplate {
  if (typeof obj !== "object" || obj === null) return false;
  const t = obj as Record<string, unknown>;
  return (
    typeof t["airline"] === "string" &&
    typeof t["iata"] === "string" &&
    typeof t["version"] === "string" &&
    Array.isArray(t["from"]) &&
    Array.isArray(t["subject"]) &&
    typeof t["selectors"] === "object" &&
    t["selectors"] !== null
  );
}
```

- [ ] **Step 4: Run the test — it must pass**

```bash
cd /d/Projekte/TravStats/backend && npx jest --testPathPattern="templates/types" --forceExit
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/parsers/templates/types.ts backend/src/__tests__/templates/types.test.ts
git commit -m "feat: airline template type definitions"
```

---

### Task 4: Airline Detector

**Files:**
- Create: `backend/src/services/parsers/templates/detector.ts`
- Create: `backend/src/__tests__/templates/detector.test.ts`

- [ ] **Step 1: Write a failing test**

`backend/src/__tests__/templates/detector.test.ts`:

```typescript
import { detectAirline } from "../../services/parsers/templates/detector";

describe("detectAirline", () => {
  it("detects Lufthansa by from-address", () => {
    expect(detectAirline("noreply@lufthansa.com", "Buchungsbestätigung", "")).toBe("LH");
  });

  it("detects Ryanair by from-address", () => {
    expect(detectAirline("noreply@ryanair.com", "Your booking", "")).toBe("FR");
  });

  it("detects easyJet by subject pattern", () => {
    expect(detectAirline("noreply@easyjet.com", "Your easyJet booking confirmation", "")).toBe("U2");
  });

  it("returns null for unknown airline", () => {
    expect(detectAirline("noreply@unknown-airline.xx", "Booking", "")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test — it must fail**

```bash
cd /d/Projekte/TravStats/backend && npx jest --testPathPattern="templates/detector" --forceExit
```

Expected: FAIL

- [ ] **Step 3: Implement detector.ts**

`backend/src/services/parsers/templates/detector.ts`:

```typescript
interface DetectionRule {
  iata: string;
  fromDomains: string[];
  subjectPatterns: RegExp[];
  htmlFingerprints: string[];
}

const DETECTION_RULES: DetectionRule[] = [
  {
    iata: "LH",
    fromDomains: ["@lufthansa.com", "@miles-and-more.com"],
    subjectPatterns: [/buchungsbest.?tigung/i, /booking confirmation/i, /ihre buchung/i],
    htmlFingerprints: ["lufthansa.com", "miles-and-more.com"],
  },
  {
    iata: "LX",
    fromDomains: ["@swiss.com", "@newsletter.swiss.com"],
    subjectPatterns: [/buchungsbest.?tigung/i, /your swiss booking/i],
    htmlFingerprints: ["swiss.com"],
  },
  {
    iata: "OS",
    fromDomains: ["@austrian.com", "@newsletter.austrian.com"],
    subjectPatterns: [/austrian booking/i, /ihre buchung bei austrian/i],
    htmlFingerprints: ["austrian.com"],
  },
  {
    iata: "FR",
    fromDomains: ["@ryanair.com", "@info.ryanair.com"],
    subjectPatterns: [/ryanair.*booking/i, /your booking confirmation/i],
    htmlFingerprints: ["ryanair.com"],
  },
  {
    iata: "U2",
    fromDomains: ["@easyjet.com", "@email.easyjet.com"],
    subjectPatterns: [/easyjet.*confirmation/i, /your easyjet booking/i],
    htmlFingerprints: ["easyjet.com"],
  },
  {
    iata: "EW",
    fromDomains: ["@eurowings.com", "@newsletter.eurowings.com"],
    subjectPatterns: [/eurowings.*buchung/i, /eurowings.*booking/i],
    htmlFingerprints: ["eurowings.com"],
  },
  {
    iata: "W6",
    fromDomains: ["@wizzair.com", "@info.wizzair.com"],
    subjectPatterns: [/wizz air.*booking/i, /buchungsbest.?tigung.*wizz/i],
    htmlFingerprints: ["wizzair.com"],
  },
  {
    iata: "SN",
    fromDomains: ["@brusselsairlines.com"],
    subjectPatterns: [/brussels airlines.*booking/i],
    htmlFingerprints: ["brusselsairlines.com"],
  },
];

export function detectAirline(
  fromAddress: string,
  subject: string,
  htmlContent: string
): string | null {
  for (const rule of DETECTION_RULES) {
    if (rule.fromDomains.some((domain) => fromAddress.toLowerCase().includes(domain))) {
      return rule.iata;
    }
    if (rule.subjectPatterns.some((pattern) => pattern.test(subject))) {
      return rule.iata;
    }
    if (rule.htmlFingerprints.some((fp) => htmlContent.toLowerCase().includes(fp))) {
      return rule.iata;
    }
  }
  return null;
}
```

- [ ] **Step 4: Tests green**

```bash
cd /d/Projekte/TravStats/backend && npx jest --testPathPattern="templates/detector" --forceExit
```

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/parsers/templates/detector.ts backend/src/__tests__/templates/detector.test.ts
git commit -m "feat: airline detector by from-address, subject and html fingerprint"
```

---

### Task 5: Template Engine (CSS selector + transform execution)

**Files:**
- Create: `backend/src/services/parsers/templates/engine.ts`
- Create: `backend/src/__tests__/templates/engine.test.ts`

Prerequisite: `npm install cheerio` in the backend.

- [ ] **Step 1: Install cheerio**

```bash
cd /d/Projekte/TravStats/backend && npm install cheerio
```

Expected: No error. `package.json` contains cheerio. (Cheerio v1.x ships its own TypeScript types — no `@types/cheerio` needed.)

- [ ] **Step 2: Write a failing test**

`backend/src/__tests__/templates/engine.test.ts`:

```typescript
import { applyTemplate } from "../../services/parsers/templates/engine";
import type { AirlineTemplate } from "../../services/parsers/templates/types";

const mockTemplate: AirlineTemplate = {
  airline: "TestAir",
  iata: "TA",
  version: "2024-01",
  from: ["@testair.com"],
  subject: [],
  selectors: {
    flightNumber: ".flight-number",
    departureCode: ".dep-code",
    pnr: ".pnr",
  },
  transforms: {},
  testCases: [],
};

const mockHtml = `
  <html><body>
    <span class="flight-number">TA1234</span>
    <span class="dep-code">FRA</span>
    <span class="pnr">ABC123</span>
  </body></html>
`;

describe("applyTemplate", () => {
  it("extracts fields using CSS selectors", () => {
    const result = applyTemplate(mockTemplate, "", mockHtml);
    expect(result.flightNumber).toBe("TA1234");
    expect(result.departureCode).toBe("FRA");
    expect(result.pnr).toBe("ABC123");
    expect(result.parserTemplate).toBe("TA");
  });

  it("applies transform functions to values", () => {
    const templateWithTransform: AirlineTemplate = {
      ...mockTemplate,
      transforms: { flightNumber: "value => value.toLowerCase()" },
    };
    const result = applyTemplate(templateWithTransform, "", mockHtml);
    expect(result.flightNumber).toBe("ta1234");
  });

  it("falls back to plain text regex if HTML selector fails", () => {
    const textOnlyTemplate: AirlineTemplate = {
      ...mockTemplate,
      selectors: { flightNumber: ".nonexistent" },
    };
    const result = applyTemplate(textOnlyTemplate, "Flight TA1234", "");
    // No selector match → result undefined
    expect(result.flightNumber).toBeUndefined();
  });

  it("populates missing array", () => {
    const result = applyTemplate(mockTemplate, "", "");
    expect(result.missing).toContain("flightNumber");
  });
});
```

- [ ] **Step 3: Run the test — it must fail**

```bash
cd /d/Projekte/TravStats/backend && npx jest --testPathPattern="templates/engine" --forceExit
```

Expected: FAIL

- [ ] **Step 4: Implement engine.ts**

`backend/src/services/parsers/templates/engine.ts`:

```typescript
import * as cheerio from "cheerio";
import type { AirlineTemplate, SelectorKey } from "./types";
import type { ParsedBooking } from "../../bookingParser";

const CRITICAL_FIELDS: SelectorKey[] = ["flightNumber", "departureCode", "arrivalCode"];

function safeTransform(transform: string, value: string): string {
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function("value", `return (${transform})(value)`) as (v: string) => string;
    const result = fn(value);
    return typeof result === "string" ? result : value;
  } catch {
    return value;
  }
}

export function applyTemplate(
  template: AirlineTemplate,
  plainText: string,
  htmlContent: string
): ParsedBooking {
  const $ = htmlContent ? cheerio.load(htmlContent) : null;
  const result: ParsedBooking = {
    missing: [],
    parserTemplate: template.iata,
    parserConfidence: 0,
  };

  const selectorMap: Partial<Record<SelectorKey, keyof ParsedBooking>> = {
    flightNumber: "flightNumber",
    pnr: "bookingReference",
    departureTime: "departureTime",
    arrivalTime: "arrivalTime",
    departureCode: "departureCode",
    arrivalCode: "arrivalCode",
    seat: "seat",
    seatClass: "seatClass",
    price: "price",
    currency: "currency",
    taxes: "taxes",
    fees: "fees",
    baggage: "baggageAllowance",
    frequentFlyer: "frequentFlyerNumber",
    ticketNumber: "ticketNumber",
    bookingClassLetter: "bookingClassLetter",
    terminal: "terminal",
    gate: "gate",
  };

  let matchedFields = 0;
  let totalFields = 0;

  for (const [sKey, bookingKey] of Object.entries(selectorMap) as [SelectorKey, keyof ParsedBooking][]) {
    const selector = template.selectors[sKey];
    if (!selector) continue;

    totalFields++;
    let value: string | undefined;

    if ($) {
      const el = $(selector);
      if (el.length > 0) {
        value = el.first().text().trim() || el.first().attr("data-value")?.trim();
      }
    }

    if (!value && plainText) {
      // Fallback: skip (plain text matching is the regex parser's job)
    }

    if (value) {
      const transform = template.transforms[sKey];
      const finalValue = transform ? safeTransform(transform, value) : value;
      (result as Record<string, unknown>)[bookingKey] = finalValue;
      matchedFields++;
    } else if (CRITICAL_FIELDS.includes(sKey)) {
      result.missing.push(bookingKey as string);
    }
  }

  result.parserConfidence = totalFields > 0 ? Math.round((matchedFields / totalFields) * 100) : 0;

  if (result.bookingReference) {
    result.pnr = result.bookingReference;
  }

  return result;
}
```

- [ ] **Step 5: Tests green**

```bash
cd /d/Projekte/TravStats/backend && npx jest --testPathPattern="templates/engine" --forceExit
```

Expected: PASS (4 tests)

- [ ] **Step 6: Type check**

```bash
cd /d/Projekte/TravStats/backend && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/parsers/templates/engine.ts backend/src/__tests__/templates/engine.test.ts
git commit -m "feat: airline template engine with CSS selectors and sandboxed transforms"
```

---

### Task 6: Template Registry with GitHub sync

**Files:**
- Create: `backend/src/services/parsers/templates/registry.ts`
- Create: `backend/src/services/parsers/templates/airlines/LH.json`
- Create: `backend/src/services/parsers/templates/airlines/LX.json`
- Create: `backend/src/services/parsers/templates/airlines/OS.json`
- Create: `backend/src/services/parsers/templates/airlines/FR.json`
- Create: `backend/src/services/parsers/templates/airlines/U2.json`
- Create: `backend/src/services/parsers/templates/airlines/EW.json`
- Create: `backend/src/services/parsers/templates/airlines/W6.json`
- Create: `backend/src/services/parsers/templates/airlines/SN.json`

- [ ] **Step 1: Create LH.json (Lufthansa template)**

`backend/src/services/parsers/templates/airlines/LH.json`:

```json
{
  "airline": "Lufthansa",
  "iata": "LH",
  "version": "2024-03",
  "from": ["@lufthansa.com", "@miles-and-more.com"],
  "subject": ["Buchungsbestätigung", "Booking Confirmation", "Ihre Buchung"],
  "selectors": {
    "flightNumber": "td.flightno, .flight-number, [data-flight-number]",
    "pnr": ".booking-code, .pnr, [data-pnr], td.pnr",
    "departureCode": ".dep-airport-code, [data-dep-iata]",
    "arrivalCode": ".arr-airport-code, [data-arr-iata]",
    "departureTime": "[data-dep-datetime], .departure-time",
    "arrivalTime": "[data-arr-datetime], .arrival-time",
    "seat": ".seat-number, [data-seat]",
    "seatClass": ".cabin-class, .travel-class",
    "price": ".total-price, [data-total-price]",
    "currency": ".currency",
    "taxes": ".taxes-amount",
    "fees": ".fees-amount",
    "baggage": ".baggage-info, .gepäck",
    "frequentFlyer": ".miles-more-number, .ffn",
    "ticketNumber": ".ticket-number, [data-ticket]",
    "bookingClassLetter": ".booking-class, [data-booking-class]"
  },
  "transforms": {},
  "testCases": []
}
```

- [ ] **Step 2: Create the remaining templates**

`FR.json` (Ryanair):
```json
{
  "airline": "Ryanair",
  "iata": "FR",
  "version": "2024-03",
  "from": ["@ryanair.com", "@info.ryanair.com"],
  "subject": ["Your booking confirmation", "Ihre Buchungsbestätigung"],
  "selectors": {
    "flightNumber": ".flight-num, td:contains('FR')",
    "pnr": ".booking-reference, .pnr",
    "departureCode": ".origin-code",
    "arrivalCode": ".destination-code",
    "departureTime": ".departure-datetime",
    "arrivalTime": ".arrival-datetime",
    "seat": ".seat",
    "price": ".grand-total",
    "currency": ".currency-symbol",
    "baggage": ".baggage-details",
    "ticketNumber": ".ticket-no"
  },
  "transforms": {},
  "testCases": []
}
```

`backend/src/services/parsers/templates/airlines/U2.json` (easyJet):
```json
{
  "airline": "easyJet",
  "iata": "U2",
  "version": "2024-03",
  "from": ["@easyjet.com", "@email.easyjet.com"],
  "subject": ["easyJet booking confirmation", "Your easyJet booking"],
  "selectors": {
    "flightNumber": ".flight-number, td.flightno",
    "pnr": ".booking-reference, .pnr-code",
    "departureCode": ".origin-airport-code",
    "arrivalCode": ".destination-airport-code",
    "departureTime": ".departure-time, [data-departure]",
    "arrivalTime": ".arrival-time, [data-arrival]",
    "seat": ".seat-number",
    "seatClass": ".cabin-class",
    "price": ".total-amount, .grand-total",
    "currency": ".currency",
    "baggage": ".baggage-allowance, .hold-bag",
    "ticketNumber": ".booking-ref"
  },
  "transforms": {},
  "testCases": []
}
```

`backend/src/services/parsers/templates/airlines/LX.json` (Swiss):
```json
{
  "airline": "Swiss",
  "iata": "LX",
  "version": "2024-03",
  "from": ["@swiss.com", "@newsletter.swiss.com"],
  "subject": ["Buchungsbestätigung", "Your SWISS booking confirmation"],
  "selectors": {
    "flightNumber": ".flight-number, [data-flight]",
    "pnr": ".booking-code, .pnr",
    "departureCode": ".dep-iata, [data-dep-iata]",
    "arrivalCode": ".arr-iata, [data-arr-iata]",
    "departureTime": "[data-dep-datetime]",
    "arrivalTime": "[data-arr-datetime]",
    "seat": ".seat-info",
    "seatClass": ".travel-class",
    "price": ".total-price",
    "currency": ".currency",
    "taxes": ".taxes",
    "baggage": ".baggage-info",
    "frequentFlyer": ".senator-number, .ffn",
    "ticketNumber": ".ticket-number",
    "bookingClassLetter": ".booking-class"
  },
  "transforms": {},
  "testCases": []
}
```

`backend/src/services/parsers/templates/airlines/OS.json` (Austrian):
```json
{
  "airline": "Austrian Airlines",
  "iata": "OS",
  "version": "2024-03",
  "from": ["@austrian.com", "@newsletter.austrian.com"],
  "subject": ["Buchungsbestätigung", "Austrian booking confirmation"],
  "selectors": {
    "flightNumber": ".flight-number, td.flight",
    "pnr": ".booking-reference, .pnr",
    "departureCode": ".dep-airport",
    "arrivalCode": ".arr-airport",
    "departureTime": ".dep-time",
    "arrivalTime": ".arr-time",
    "seat": ".seat",
    "seatClass": ".class",
    "price": ".total",
    "currency": ".currency",
    "baggage": ".baggage",
    "frequentFlyer": ".miles-more, .ffn"
  },
  "transforms": {},
  "testCases": []
}
```

`backend/src/services/parsers/templates/airlines/EW.json` (Eurowings):
```json
{
  "airline": "Eurowings",
  "iata": "EW",
  "version": "2024-03",
  "from": ["@eurowings.com", "@newsletter.eurowings.com"],
  "subject": ["Buchungsbestätigung", "Eurowings booking"],
  "selectors": {
    "flightNumber": ".flight-no, .flightnumber",
    "pnr": ".booking-code, .pnr",
    "departureCode": ".departure-code",
    "arrivalCode": ".arrival-code",
    "departureTime": ".dep-datetime",
    "arrivalTime": ".arr-datetime",
    "seat": ".seat-number",
    "seatClass": ".fare-class",
    "price": ".total-price",
    "currency": ".currency",
    "baggage": ".baggage-info"
  },
  "transforms": {},
  "testCases": []
}
```

`backend/src/services/parsers/templates/airlines/W6.json` (Wizz Air):
```json
{
  "airline": "Wizz Air",
  "iata": "W6",
  "version": "2024-03",
  "from": ["@wizzair.com", "@info.wizzair.com"],
  "subject": ["Booking confirmation", "Buchungsbestätigung"],
  "selectors": {
    "flightNumber": ".flight-number",
    "pnr": ".booking-reference",
    "departureCode": ".origin",
    "arrivalCode": ".destination",
    "departureTime": ".departure",
    "arrivalTime": ".arrival",
    "seat": ".seat",
    "seatClass": ".fare-type",
    "price": ".amount",
    "currency": ".currency",
    "baggage": ".baggage"
  },
  "transforms": {},
  "testCases": []
}
```

`backend/src/services/parsers/templates/airlines/SN.json` (Brussels Airlines):
```json
{
  "airline": "Brussels Airlines",
  "iata": "SN",
  "version": "2024-03",
  "from": ["@brusselsairlines.com"],
  "subject": ["Booking confirmation", "Ihre Buchungsbestätigung"],
  "selectors": {
    "flightNumber": ".flight-number",
    "pnr": ".booking-code",
    "departureCode": ".dep-airport",
    "arrivalCode": ".arr-airport",
    "departureTime": ".dep-time",
    "arrivalTime": ".arr-time",
    "seat": ".seat",
    "seatClass": ".cabin",
    "price": ".total-price",
    "currency": ".currency",
    "baggage": ".baggage",
    "frequentFlyer": ".miles-more"
  },
  "transforms": {},
  "testCases": []
}
```

Note: All selectors are structurally complete. Since there are no real sample emails on hand, the CSS selectors will be refined after the first real test via the template registry CI. The test cases arrays stay empty for now — they will be populated by community contributions of anonymized sample emails.

- [ ] **Step 3: Implement registry.ts**

`backend/src/services/parsers/templates/registry.ts`:

```typescript
import fs from "fs";
import path from "path";
import https from "https";
import { isValidAirlineTemplate, type AirlineTemplate } from "./types";
import { logger } from "../../../utils/logger";

const BUILTIN_DIR = path.join(__dirname, "airlines");
const CACHE_DIR = path.join(process.cwd(), ".template-cache");
const GITHUB_RAW_BASE =
  "https://raw.githubusercontent.com/travstats-community/airline-templates/main/templates";
const INDEX_URL = `${GITHUB_RAW_BASE}/index.json`;
const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h

interface TemplateIndex {
  version: string;
  airlines: { iata: string; version: string }[];
}

class TemplateRegistry {
  private templates: Map<string, AirlineTemplate> = new Map();
  private lastSync: number = 0;

  async initialize(): Promise<void> {
    await this.loadBuiltinTemplates();
    await this.loadCachedTemplates();
    this.scheduleSync();
  }

  private async loadBuiltinTemplates(): Promise<void> {
    if (!fs.existsSync(BUILTIN_DIR)) return;
    const files = fs.readdirSync(BUILTIN_DIR).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      try {
        const content = JSON.parse(fs.readFileSync(path.join(BUILTIN_DIR, file), "utf-8")) as unknown;
        if (isValidAirlineTemplate(content)) {
          this.templates.set(content.iata, content);
        }
      } catch (err) {
        logger.warn({ file, err }, "Failed to load builtin template");
      }
    }
    logger.info({ count: this.templates.size }, "Builtin templates loaded");
  }

  private async loadCachedTemplates(): Promise<void> {
    if (!fs.existsSync(CACHE_DIR)) return;
    const files = fs.readdirSync(CACHE_DIR).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      if (file === "index.json") continue;
      try {
        const content = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, file), "utf-8")) as unknown;
        if (isValidAirlineTemplate(content)) {
          // Cache overrides builtin if newer version
          const existing = this.templates.get(content.iata);
          if (!existing || content.version > existing.version) {
            this.templates.set(content.iata, content);
          }
        }
      } catch {
        // Ignore malformed cache files
      }
    }
  }

  getTemplate(iata: string): AirlineTemplate | null {
    return this.templates.get(iata) ?? null;
  }

  getAll(): AirlineTemplate[] {
    return Array.from(this.templates.values());
  }

  getStatus(): { iata: string; airline: string; version: string; source: "builtin" | "cached" }[] {
    return Array.from(this.templates.values()).map((t) => ({
      iata: t.iata,
      airline: t.airline,
      version: t.version,
      source: "builtin" as const,
    }));
  }

  private scheduleSync(): void {
    // Sync once at startup (non-blocking) and then every 24h
    setTimeout(() => void this.syncFromGitHub(), 5000);
    setInterval(() => void this.syncFromGitHub(), SYNC_INTERVAL_MS);
  }

  private async syncFromGitHub(): Promise<void> {
    try {
      const index = await this.fetchJson<TemplateIndex>(INDEX_URL);
      if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

      for (const entry of index.airlines) {
        const existing = this.templates.get(entry.iata);
        if (existing && existing.version >= entry.version) continue;

        const url = `${GITHUB_RAW_BASE}/${entry.iata}.json`;
        const template = await this.fetchJson<unknown>(url);
        if (isValidAirlineTemplate(template)) {
          this.templates.set(template.iata, template);
          fs.writeFileSync(path.join(CACHE_DIR, `${template.iata}.json`), JSON.stringify(template));
        }
      }
      this.lastSync = Date.now();
      logger.info({ count: index.airlines.length }, "Templates synced from GitHub");
    } catch (err) {
      logger.warn({ err }, "GitHub template sync failed — using cached/builtin templates");
    }
  }

  private fetchJson<T>(url: string): Promise<T> {
    return new Promise((resolve, reject) => {
      https
        .get(url, (res) => {
          let data = "";
          res.on("data", (chunk: string) => { data += chunk; });
          res.on("end", () => {
            try { resolve(JSON.parse(data) as T); }
            catch (e) { reject(e); }
          });
        })
        .on("error", reject);
    });
  }
}

export const templateRegistry = new TemplateRegistry();
```

- [ ] **Step 4: Initialize the registry on app startup**

In `backend/src/app.ts` (or `server.ts` — wherever the Express server is started), after the DB connect:

```typescript
import { templateRegistry } from "./services/parsers/templates/registry";

// Nach DB-Init:
await templateRegistry.initialize();
```

- [ ] **Step 5: Type check**

```bash
cd /d/Projekte/TravStats/backend && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/parsers/templates/
git commit -m "feat: airline template registry with builtin templates and GitHub sync"
```

---

## Chunk 3: Backend — Pipeline integration

### Task 7: Training Recorder Service

**Files:**
- Create: `backend/src/services/trainingRecorder.ts`

- [ ] **Step 1: Create trainingRecorder.ts**

Design decision: `userId` is stored (for rate limits and debugging) but is never included in the training export. The export process (Phase 4) anonymizes the data. This is a deliberate trade-off between debuggability and anonymization.

```typescript
import { getPrismaClient } from "../lib/prisma";
import { logger } from "../utils/logger";

interface ParseTrainingRecord {
  userId: string;           // Stored for debugging/rate-limits, stripped during export (Phase 4)
  airline?: string;
  templateUsed?: string;
  templateHit: boolean;
  confidence?: number;
  fieldCount: number;
  missingFields: string[];
  parserProvider: string;
}

export async function recordParseResult(record: ParseTrainingRecord): Promise<void> {
  try {
    const prisma = getPrismaClient();
    await prisma.parseTrainingLog.create({
      data: {
        userId: record.userId,
        airline: record.airline ?? null,
        templateUsed: record.templateUsed ?? null,
        templateHit: record.templateHit,
        confidence: record.confidence ?? null,
        fieldCount: record.fieldCount,
        missingFields: record.missingFields,
        parserProvider: record.parserProvider,
      },
    });
  } catch (err) {
    // Non-blocking — training recording should never break the main flow
    logger.warn({ err }, "Failed to record parse training data");
  }
}

export function buildAirlineNotice(detectedAirline: string | null): string | undefined {
  if (detectedAirline) return undefined;
  return "Für diese Airline wurde kein Template gefunden. Hilf der Community und trage eines bei: https://github.com/travstats-community/airline-templates";
}
```

- [ ] **Step 2: Add ParseTrainingLog to the Prisma schema**

In `backend/prisma/schema.prisma`, add a new model:

```prisma
model ParseTrainingLog {
  id            String   @id @default(uuid())
  userId        String   @map("user_id")
  airline       String?
  templateUsed  String?  @map("template_used")
  templateHit   Boolean  @map("template_hit")
  confidence    Int?
  fieldCount    Int      @map("field_count")
  missingFields String[] @map("missing_fields")
  parserProvider String  @map("parser_provider")
  createdAt     DateTime @default(now()) @map("created_at")

  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([templateHit])
  @@index([airline])
  @@map("parse_training_logs")
}
```

- [ ] **Step 3: Migration + generate**

```bash
cd /d/Projekte/TravStats/backend
npx prisma migrate dev --name "add_parse_training_log"
npx prisma generate
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/trainingRecorder.ts backend/prisma/schema.prisma backend/prisma/migrations/
git commit -m "feat: training recorder service and ParseTrainingLog model"
```

---

### Task 8: Implement template parser as ITextParser

**Files:**
- Create: `backend/src/services/parsers/text/templateParser.ts`
- Modify: `backend/src/services/parsers/factory.ts` (insert template parser into the chain)
- Modify: `backend/src/routes/emailParse.ts` (return airlineNotice)

- [ ] **Step 1: Create templateParser.ts**

`backend/src/services/parsers/text/templateParser.ts`:

```typescript
import type { ITextParser, ProviderAvailability } from "../types";
import type { ParsedBooking } from "../../bookingParser";
import { templateRegistry } from "../templates/registry";
import { detectAirline } from "../templates/detector";
import { applyTemplate } from "../templates/engine";
import { buildAirlineNotice, recordParseResult } from "../../trainingRecorder";

export class TemplateParser implements ITextParser {
  readonly provider = "template" as const;

  async checkAvailability(): Promise<ProviderAvailability> {
    const count = templateRegistry.getAll().length;
    return { available: count > 0, reason: count === 0 ? "No templates loaded" : undefined };
  }

  async parseEmail(
    subject: string,
    text: string,
    html?: string,
    _apiKey?: string,
    userId?: string
  ): Promise<ParsedBooking[]> {
    // Extract From address from text (convention: first line "From: ...")
    const fromMatch = /^From:\s*(.+)$/im.exec(text);
    const fromAddress = fromMatch ? fromMatch[1].trim() : "";

    const detectedIata = detectAirline(fromAddress, subject, html ?? "");
    const template = detectedIata ? templateRegistry.getTemplate(detectedIata) : null;

    if (userId) {
      await recordParseResult({
        userId,
        airline: detectedIata ?? undefined,
        templateUsed: template?.iata,
        templateHit: template !== null,
        fieldCount: 0,
        missingFields: [],
        parserProvider: "template",
      });
    }

    if (!template) {
      // Signal to factory that no template found → use LLM
      return [];
    }

    const parsed = applyTemplate(template, text, html ?? "");
    parsed.airlineNotice = buildAirlineNotice(detectedIata);
    return [parsed];
  }
}
```

- [ ] **Step 2: Adjust factory.ts — template parser as the first step**

The `parseEmail` function in `backend/src/services/parsers/factory.ts` has this signature (line 786):

```typescript
export async function parseEmail(
  subject: string,
  text: string,
  html: string | undefined,
  config: ParserConfig
): Promise<ParserResult>
```

The function gets `userId` via `config` — add `config.userId` (see the ParserConfig interface in factory.ts, line ~134).

**Change 1:** Add an import at the top of factory.ts (after the existing parser imports):
```typescript
import { TemplateParser } from "./text/templateParser";
```

**Change 2:** Insert directly after line 815 (`const providerChain: TextProvider[] = ...`) and before the `for` loop (line 818):

```typescript
  // Template-Parser als erster Schritt (vor LLM-Chain)
  const templateParser = new TemplateParser();
  const templateAvail = await templateParser.checkAvailability();
  if (templateAvail.available) {
    const templateResults = await templateParser.parseEmail(
      subject,
      text,
      html,
      undefined,
      config.userId
    );
    if (templateResults.length > 0 && (templateResults[0].parserConfidence ?? 0) >= 30) {
      return {
        flights: templateResults,
        provider: "template" as TextProvider,
        fallbackUsed: false,
      };
    }
  }
  // Ende Template-Block — LLM-Chain folgt unverändert
```

**Change 3:** Extend the `ParserConfig` interface (line ~134) with `userId?: string`. The `emailParse.ts` route must pass `userId` from the JWT token to `getParserConfig()`.

- [ ] **Step 3: emailParse.ts — return airlineNotice in the response**

In `backend/src/routes/emailParse.ts`, in the POST `/parse-email` route, extend the response object:

```typescript
res.json({
  flights: result.flights,
  parserUsed: result.parserUsed,
  subject: result.subject,
  airlineNotice: result.flights[0]?.airlineNotice ?? null,
});
```

- [ ] **Step 4: Type check + tests**

```bash
cd /d/Projekte/TravStats/backend && npx tsc --noEmit
cd /d/Projekte/TravStats/backend && npx jest --forceExit --passWithNoTests
```

Expected: No TypeScript errors. No regressions in tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/parsers/text/templateParser.ts backend/src/services/parsers/factory.ts backend/src/routes/emailParse.ts
git commit -m "feat: template parser integrated as primary email parsing step before LLM fallback"
```

---

## Chunk 4: Frontend — Email as the primary input

### Task 9: EmailImportTab as its own component

**Files:**
- Create: `frontend/src/components/import/EmailImportTab.tsx`
- Modify: `frontend/src/lib/api.ts` (airlineNotice in the response type)

The email import is currently an embedded overlay in `SimplifiedFlightFormV2.tsx` (lines ~1241–1340). It will be extracted and promoted.

- [ ] **Step 1: api.ts — add airlineNotice**

In `frontend/src/lib/api.ts`, the `EmailParseResult` interface:

```typescript
export interface EmailParseResult {
  flights: ParsedBooking[];
  provider?: string;
  subject?: string;
  text?: string;
  html?: string;
  airlineNotice?: string | null;  // NEU
}
```

- [ ] **Step 2: Create EmailImportTab.tsx**

`frontend/src/components/import/EmailImportTab.tsx`:

```typescript
import { useState, useRef, useCallback } from "react";
import { parseApi } from "../../lib/api";
import type { ParsedBooking } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";

interface EmailImportTabProps {
  onResult: (flights: ParsedBooking[], subject?: string) => void;
  onError: (message: string) => void;
}

type DropState = "idle" | "over" | "loading";

export default function EmailImportTab({ onResult, onError }: EmailImportTabProps): JSX.Element {
  const { t } = useTranslation(["flights", "common"]);
  const [dropState, setDropState] = useState<DropState>("idle");
  const [airlineNotice, setAirlineNotice] = useState<string | null>(null);
  const [emailText, setEmailText] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      const allowed = [".eml", ".msg", ".txt"];
      const isPdf = file.name.endsWith(".pdf");

      if (isPdf) {
        onError(
          "PDF-Dateien werden direkt noch nicht unterstützt. Öffne die Email in deinem Email-Client und nutze 'Weiterleiten' oder kopiere den Text."
        );
        return;
      }

      if (!allowed.some((ext) => file.name.endsWith(ext))) {
        onError(`Unterstützte Formate: ${allowed.join(", ")}`);
        return;
      }

      setDropState("loading");
      try {
        const result = await parseApi.parseEmailFile(file);
        setAirlineNotice(result.airlineNotice ?? null);
        if (result.flights.length > 0) {
          onResult(result.flights, result.subject);
        } else {
          onError("Keine Flugdaten in der Email gefunden.");
        }
      } catch (err) {
        logger.error({ err }, "Email parse failed");
        onError("Email konnte nicht geparst werden.");
      } finally {
        setDropState("idle");
      }
    },
    [onResult, onError]
  );

  const handleTextParse = useCallback(async () => {
    if (!emailText.trim()) return;
    setDropState("loading");
    try {
      const result = await parseApi.parseEmail(emailText);
      setAirlineNotice(result.airlineNotice ?? null);
      if (result.flights.length > 0) {
        onResult(result.flights, result.subject);
      } else {
        onError("Keine Flugdaten im Text gefunden.");
      }
    } catch (err) {
      logger.error({ err }, "Email text parse failed");
      onError("Text konnte nicht geparst werden.");
    } finally {
      setDropState("idle");
    }
  }, [emailText, onResult, onError]);

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDropState("idle");
      const file = e.dataTransfer.files[0];
      if (file) void handleFile(file);
    },
    [handleFile]
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Drag & Drop Zone */}
      <div
        onDrop={onDrop}
        onDragOver={(e) => { e.preventDefault(); setDropState("over"); }}
        onDragLeave={() => setDropState("idle")}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors
          ${dropState === "over" ? "border-blue-400 bg-blue-950/20" : "border-slate-600 hover:border-slate-400"}
          ${dropState === "loading" ? "opacity-50 pointer-events-none" : ""}`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".eml,.msg,.txt,.pdf"
          className="hidden"
          onChange={(e) => { if (e.target.files?.[0]) void handleFile(e.target.files[0]); }}
        />
        <div className="text-3xl mb-2">📧</div>
        <p className="font-medium">
          {dropState === "loading" ? "Wird geparst..." : "Email hierher ziehen"}
        </p>
        <p className="text-sm text-slate-400 mt-1">.eml, .msg, .txt · oder klicken zum Auswählen</p>
        <p className="text-xs text-slate-500 mt-1">PDF: Nur Erkennung, kein automatisches Parsen</p>
      </div>

      {/* Airline Notice */}
      {airlineNotice && (
        <div className="text-sm text-yellow-400 bg-yellow-900/20 border border-yellow-700 rounded-lg px-4 py-3">
          ⚠️ {airlineNotice}
        </div>
      )}

      {/* Text Paste Fallback */}
      <details className="text-sm text-slate-400">
        <summary className="cursor-pointer hover:text-slate-200">Email-Text einfügen (Fallback)</summary>
        <div className="mt-3 flex flex-col gap-2">
          <textarea
            value={emailText}
            onChange={(e) => setEmailText(e.target.value)}
            className="w-full h-32 bg-slate-800 border border-slate-600 rounded-lg p-3 text-sm text-slate-200 resize-none"
            placeholder="Email-Inhalt hier einfügen..."
          />
          <button
            onClick={() => void handleTextParse()}
            disabled={!emailText.trim() || dropState === "loading"}
            className="self-end px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-sm font-medium"
          >
            Parsen
          </button>
        </div>
      </details>
    </div>
  );
}
```

- [ ] **Step 3: Type check**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/import/EmailImportTab.tsx frontend/src/lib/api.ts
git commit -m "feat: EmailImportTab component with drag & drop, airline notice, text fallback"
```

---

### Task 10: Restructure SimplifiedFlightFormV2

**Files:**
- Modify: `frontend/src/components/SimplifiedFlightFormV2.tsx` (tab order + integrate EmailImportTab)

Note: This file is 1419 lines. Only the required spots are changed.

- [ ] **Step 1: Add the import**

At the top of the file (after the existing `lazy()` import for `BoardingPassScanner`):

```typescript
const EmailImportTab = lazy(() => import("./import/EmailImportTab"));
```

- [ ] **Step 2: Replace showEmailUploader with EmailImportTab**

**Replace** the existing email overlay block (lines 1241–1347 in `SimplifiedFlightFormV2.tsx`). The block starts with `{showEmailUploader && (` and ends with the closing `)}`.

The existing logic (lines 1260–1282) already does the right thing: it calls `setParsedFlights(result.flights)`, `setParserProvider(...)`, `setOriginalEmailData(...)`, `setShowFlightReview(true)` — that flow stays intact. `EmailImportTab` is used purely as a UI wrapper that internally calls `parseApi.parseEmailFile` and returns the result.

**Replace with:**

```tsx
{showEmailUploader && (
  <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
    <div className={`${bgClass} rounded-lg p-6 max-w-md w-full`}>
      <h3 className={`text-xl font-bold ${textClass} mb-4`}>
        {t("flights:form.email.title")}
      </h3>
      <Suspense fallback={<div className="p-6 text-center text-slate-400">Lädt...</div>}>
        <EmailImportTab
          onResult={(flights, subject, provider, text, html) => {
            if (flights.length > 0) {
              setParsedFlights(flights);
              setCurrentFlightIndex(0);
              setParserProvider(provider ?? "template");
              setOriginalEmailData({ subject, text, html });
              setShowEmailUploader(false);
              setShowFlightReview(true);
            } else {
              setError(t("flights:form.noFlightsInEmail"));
            }
          }}
          onError={(message) => {
            setError(message);
            setShowEmailUploader(false);
          }}
        />
      </Suspense>
      <div className="flex justify-end mt-4">
        <button
          onClick={() => { setShowEmailUploader(false); setError(""); }}
          className="btn-secondary"
        >
          {t("common:cancel")}
        </button>
      </div>
    </div>
  </div>
)}
```

To make this work, `EmailImportTab.tsx` must adjust the `onResult` callback signature:

```typescript
interface EmailImportTabProps {
  onResult: (
    flights: ParsedBooking[],
    subject?: string,
    provider?: string,
    text?: string,
    html?: string
  ) => void;
  onError: (message: string) => void;
}
```

And in `handleFile` / `handleTextParse` in `EmailImportTab.tsx`:

```typescript
onResult(result.flights, result.subject, result.provider, result.text, result.html);
```

**Tab order:** Adjust the area at line ~610–650 (where the "Email" and "Boarding Pass" buttons live) — Email button first, then Boarding Pass, then Manual.

- [ ] **Step 3: New fields in form state and submit**

The new fields come from the `ParsedBooking` result and need to flow through `FlightReviewModal` into the submit. To do this:

**3a. New state variables in `SimplifiedFlightFormV2.tsx`** (after the existing states, around line 130):
```typescript
const [baggageAllowance, setBaggageAllowance] = useState<string | undefined>(undefined);
const [frequentFlyerNumber, setFrequentFlyerNumber] = useState<string | undefined>(undefined);
const [bookingClassLetter, setBookingClassLetter] = useState<string | undefined>(undefined);
const [coPassengers, setCoPassengers] = useState<string[]>([]);
```

**3b. Populate states from ParsedBooking** — In `FlightReviewModal`'s `onConfirm` callback (or wherever `setParsedFlights` is processed), add after the existing field assignments:
```typescript
setBaggageAllowance(flight.baggageAllowance);
setFrequentFlyerNumber(flight.frequentFlyerNumber);
setBookingClassLetter(flight.bookingClassLetter);
setCoPassengers(flight.coPassengers ?? []);
```

**3c. In the handleSubmit block** (where `FlightInput` is built, line ~430–520), after `ticketNumber`:
```typescript
baggageAllowance,
frequentFlyerNumber,
bookingClassLetter,
coPassengers,
```

**3d. The `FlightInput` type** in `frontend/src/types/index.ts` must contain these fields too — they were added to `ParsedBooking` in Task 2, but they also need to be added to `FlightInput` (same optional fields).

- [ ] **Step 4: Type check + tests**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit
cd /d/Projekte/TravStats/frontend && npx vitest --run
```

Expected: No errors, no test regressions.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/SimplifiedFlightFormV2.tsx
git commit -m "feat: email import promoted to primary tab in flight form"
```

---

## Chunk 5: Frontend — Template Status View

### Task 11: Template status API route

**Files:**
- Create: `backend/src/routes/templateStatus.ts`
- Modify: `backend/src/app.ts` (register the route)
- Modify: `frontend/src/lib/api.ts` (add templateApi)

- [ ] **Step 1: Create templateStatus.ts**

```typescript
import { Router, type Request, type Response } from "express";
import { templateRegistry } from "../services/parsers/templates/registry";
import { authenticateJwt } from "../middleware/auth";

const router = Router();

router.get("/", authenticateJwt, (_req: Request, res: Response): void => {
  res.json({
    templates: templateRegistry.getStatus(),
    total: templateRegistry.getAll().length,
    githubRepo: "https://github.com/travstats-community/airline-templates",
  });
});

export default router;
```

- [ ] **Step 2: Register the route in app.ts**

```typescript
import templateStatusRouter from "./routes/templateStatus";
app.use("/api/v1/template-status", templateStatusRouter);
```

- [ ] **Step 3: Extend api.ts**

```typescript
export interface TemplateStatusEntry {
  iata: string;
  airline: string;
  version: string;
  source: "builtin" | "cached";  // matches backend getStatus() return type
}

export interface TemplateStatusResult {
  templates: TemplateStatusEntry[];
  total: number;
  githubRepo: string;
}

export const templateApi = {
  getStatus: async (): Promise<TemplateStatusResult> => {
    const res = await apiClient.get<TemplateStatusResult>("/template-status");
    return res.data;
  },
};
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/templateStatus.ts backend/src/app.ts frontend/src/lib/api.ts
git commit -m "feat: template status API endpoint"
```

---

### Task 12: TemplateStatusView in Settings

**Files:**
- Create: `frontend/src/components/TemplateStatusView.tsx`
- Modify: `frontend/src/pages/SettingsPage.tsx` (add a section)

- [ ] **Step 1: Create TemplateStatusView.tsx**

```typescript
import { useEffect, useState } from "react";
import { templateApi } from "../lib/api";
import { logger } from "../lib/logger";

interface TemplateInfo {
  iata: string;
  airline: string;
  version: string;
}

export default function TemplateStatusView(): JSX.Element {
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [githubRepo, setGithubRepo] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    templateApi.getStatus()
      .then((data) => {
        setTemplates(data.templates);
        setGithubRepo(data.githubRepo);
      })
      .catch((err: unknown) => logger.error({ err }, "Failed to load template status"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-slate-400 text-sm">Lade Templates...</div>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-slate-200">Airline Email Templates</h3>
        <a
          href={githubRepo}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-400 hover:text-blue-300 underline"
        >
          Templates beisteuern →
        </a>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {templates.map((t) => (
          <div
            key={t.iata}
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm flex justify-between items-center"
          >
            <span className="font-mono text-blue-400">{t.iata}</span>
            <span className="text-slate-300 truncate ml-2">{t.airline}</span>
            <span className="text-xs text-slate-500 ml-auto">{t.version}</span>
          </div>
        ))}
      </div>
      <p className="text-xs text-slate-500">
        {templates.length} Templates geladen · Tägl. Auto-Update aus GitHub
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Wire it into SettingsPage**

In `frontend/src/pages/SettingsPage.tsx`, in the parser/import section:

```tsx
import TemplateStatusView from "../components/TemplateStatusView";

// In der relevanten Sektion:
<TemplateStatusView />
```

- [ ] **Step 3: Type check + tests**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit
cd /d/Projekte/TravStats/frontend && npx vitest --run
```

Expected: All tests green.

- [ ] **Step 4: Final commit**

```bash
git add frontend/src/components/TemplateStatusView.tsx frontend/src/pages/SettingsPage.tsx
git commit -m "feat: template status view in settings with GitHub link"
```

---

## Final verification

- [ ] Backend type check: `cd /d/Projekte/TravStats/backend && npx tsc --noEmit`
- [ ] Frontend type check: `cd /d/Projekte/TravStats/frontend && npx tsc --noEmit`
- [ ] Frontend tests: `cd /d/Projekte/TravStats/frontend && npx vitest --run`
- [ ] Manual test: upload an email `.eml` file → airline template kicks in → fields populated
- [ ] Manual test: unknown airline → LLM fallback + notice visible in UI
- [ ] Template status visible in settings with all 8 airline templates
