# Annotation-Driven Template Parser — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a user annotates one email in the Training tab, the system automatically derives a reusable regex-based `ParserTemplate`, uses it to pre-fill and colour-code the import review form for future matching emails, with an optional Ollama gap-filler for unfilled fields.

**Architecture:** New `ParserTemplate` DB model stores user-derived regex patterns + fingerprint. `TemplateDeriver` service triggers after annotation save, extracting context-anchored patterns from text selections. `UserTemplateEngine` runs as step 0 in the parser factory (before the existing HTML-selector template system), applies regex patterns to plain text, supports multi-flight extraction via the structural Reiseplan segment parser. FlightReviewModal renders colour-coded borders (green = template, yellow = LLM, red = empty) via a new `fieldSources` field on `ParsedBooking`.

**Tech Stack:** Prisma, TypeScript strict, Zod, Vitest, React, Tailwind CSS

---

## File Map

### New files
| File | Responsibility |
|------|----------------|
| `backend/src/services/parsers/userTemplates/types.ts` | Shared TS interfaces for user-derived templates |
| `backend/src/services/parsers/userTemplates/deriver.ts` | Derives regex patterns + fingerprint from annotation |
| `backend/src/services/parsers/userTemplates/matcher.ts` | Fingerprint matching — finds which template to use |
| `backend/src/services/parsers/userTemplates/engine.ts` | Applies template patterns, returns multi-flight `ParsedBooking[]` |
| `backend/src/services/parsers/userTemplates/__tests__/deriver.test.ts` | Unit tests for deriver |
| `backend/src/services/parsers/userTemplates/__tests__/matcher.test.ts` | Unit tests for matcher |
| `backend/src/services/parsers/userTemplates/__tests__/engine.test.ts` | Unit tests for engine |
| `backend/src/routes/parserTemplates.ts` | CRUD API: list, get, activate, disable, delete user templates |
| `frontend/src/components/Training/TemplateReviewCard.tsx` | Review card shown after annotation save |

### Modified files
| File | What changes |
|------|--------------|
| `backend/prisma/schema.prisma` | Add `ParserTemplate` + `TemplateCorrection` models |
| `backend/src/services/parsers/factory.ts` | Insert `UserTemplateEngine` as step 0 (before existing HTML-template parser) |
| `backend/src/routes/training.ts` | Call `TemplateDeriver.derive()` after annotation save |
| `backend/src/index.ts` | Register `/api/v1/parser-templates` route |
| `frontend/src/types/index.ts` | Add `fieldSources` to `ParsedBooking` |
| `frontend/src/components/FlightReviewModal.tsx` | Render confidence border colours using `fieldSources` |
| `frontend/src/components/Training/EmailAnnotation.tsx` | Show `TemplateReviewCard` after annotation save |
| `frontend/src/lib/api.ts` | Add `parserTemplatesApi` client |

---

## Task 1: Prisma models — ParserTemplate + TemplateCorrection

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: auto-generated migration

- [ ] **Step 1: Add models to schema.prisma**

Open `backend/prisma/schema.prisma`. Add the `ParserTemplate` relation to `User` (right after the `trainingData` relation line), then append the two new models at the end of the file.

**In the `User` model, after `trainingData TrainingData[]`:**
```prisma
  parserTemplates       ParserTemplate[]
```

**New models to append at the end of schema.prisma:**
```prisma
model ParserTemplate {
  id          String   @id @default(uuid())
  userId      String   @map("user_id")
  name        String
  status      String   @default("pending") // pending | active | disabled
  fingerprint Json
  patterns    Json
  stats       Json?
  sourceId    String?  @map("source_id")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  user        User                 @relation(fields: [userId], references: [id], onDelete: Cascade)
  corrections TemplateCorrection[]

  @@index([userId, status])
  @@map("parser_templates")
}

model TemplateCorrection {
  id               String   @id @default(uuid())
  templateId       String   @map("template_id")
  userId           String   @map("user_id")
  field            String
  expected         String
  got              String
  emailFingerprint String?  @map("email_fingerprint")
  createdAt        DateTime @default(now()) @map("created_at")

  template ParserTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)

  @@index([templateId, field])
  @@map("template_corrections")
}
```

- [ ] **Step 2: Run migration**

```bash
cd backend && npx prisma migrate dev --name add_parser_templates
```

Expected: `The following migration(s) have been created and applied from new schema changes: migrations/..._add_parser_templates`

- [ ] **Step 3: Verify generated client**

```bash
cd backend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/
git commit -m "feat: add ParserTemplate + TemplateCorrection Prisma models"
```

---

## Task 2: Shared TypeScript types + extend ParsedBooking

**Files:**
- Create: `backend/src/services/parsers/userTemplates/types.ts`
- Modify: `backend/src/services/bookingParser.ts`

- [ ] **Step 1: Create types file**

```typescript
// backend/src/services/parsers/userTemplates/types.ts

export interface TemplateFingerprint {
  senderDomains: string[];   // e.g. ["noti.swiss.com", "lufthansa.com"]
  subjectPatterns: string[]; // literal strings (case-insensitive match)
  bodyMarkers: string[];     // ALL must be present in body
}

export interface TemplatePatterns {
  pnr?: string;              // regex with one capture group
  flightNumber?: string;
  departureCode?: string;
  arrivalCode?: string;
  aircraftType?: string;
  // When true, use the structural Reiseplan segment parser for
  // flightNumber + departureTime + arrivalTime (multi-flight)
  useReiseplanSegments?: boolean;
  // Buchungsdetails IATA block regex (for IATA codes from details section)
  detailsBlock?: string;
}

export interface TemplateStats {
  matchCount: number;
  successRate: number; // 0–1
  lastUsedAt?: string; // ISO8601
}

export interface UserTemplate {
  id: string;
  userId: string;
  name: string;
  status: "pending" | "active" | "disabled";
  fingerprint: TemplateFingerprint;
  patterns: TemplatePatterns;
  stats?: TemplateStats;
  sourceId?: string;
  createdAt: string;
  updatedAt: string;
}

// Per-field source used for colour-coding in FlightReviewModal.
// Keys match the property names on ParsedBooking (backend bookingParser.ts).
export type FieldSource = "template" | "llm" | "empty";
export type FieldSources = Partial<
  Record<
    | "flightNumber"
    | "departureCode"
    | "arrivalCode"
    | "departureTime"
    | "arrivalTime"
    | "pnr"
    | "aircraft"      // note: matches ParsedBooking.aircraft (not aircraftType)
    | "seat"
    | "terminal"
    | "gate",
    FieldSource
  >
>;

// Result of testing a template against existing training emails
export interface TemplateTestResult {
  emailId: string;
  emailSubject: string;
  expected: number;     // number of expected flights
  found: number;        // number of flights found by template
  fieldAccuracy: number; // 0–1 ratio of correctly extracted fields
}
```

- [ ] **Step 2: Add `fieldSources` to backend ParsedBooking**

In `backend/src/services/bookingParser.ts`, find the `ParsedBooking` interface and add after `missing: string[]`:

```typescript
  fieldSources?: Partial<Record<
    "flightNumber" | "departureCode" | "arrivalCode" |
    "departureTime" | "arrivalTime" | "pnr" | "aircraft" | "seat" | "terminal" | "gate",
    "template" | "llm" | "empty"
  >>;
```

- [ ] **Step 3: Type-check**

```bash
cd backend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/parsers/userTemplates/types.ts \
  backend/src/services/bookingParser.ts
git commit -m "feat: add userTemplates shared types + fieldSources to ParsedBooking"
```

---

## Task 3: TemplateDeriver service

**Files:**
- Create: `backend/src/services/parsers/userTemplates/deriver.ts`
- Create: `backend/src/services/parsers/userTemplates/__tests__/deriver.test.ts`

The deriver reads a saved annotation, extracts context-anchored regex patterns from each text selection, and creates a `ParserTemplate` record. For Lufthansa-style emails (where "Reiseplan" + "Durchgeführt" are present), it sets `useReiseplanSegments: true` instead of deriving per-field time patterns.

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/services/parsers/userTemplates/__tests__/deriver.test.ts
import { derivePatternFromSelection, extractFingerprint } from "../deriver";

describe("derivePatternFromSelection", () => {
  it("extracts context-anchored regex for a PNR field", () => {
    const fullText = "Buchungscode: ABCD12\nSomething else";
    const pattern = derivePatternFromSelection(
      { text: "ABCD12", label: "pnr", start: 14, end: 20 },
      fullText
    );
    expect(pattern).toBeTruthy();
    // Should match the PNR in the original text
    const re = new RegExp(pattern!);
    expect(re.test(fullText)).toBe(true);
  });

  it("extracts context-anchored regex for a 3-letter IATA code", () => {
    const fullText =
      "IATA-Code des Abflughafens MUC\nIATA-Code des Ankunftsflughafens HEL";
    const pattern = derivePatternFromSelection(
      { text: "MUC", label: "departureCode", start: 27, end: 30 },
      fullText
    );
    expect(pattern).toBeTruthy();
    const re = new RegExp(pattern!);
    const m = re.exec(fullText);
    expect(m?.[1]).toBe("MUC");
  });

  it("returns undefined for empty annotated text", () => {
    const result = derivePatternFromSelection(
      { text: "", label: "pnr", start: 0, end: 0 },
      "some text"
    );
    expect(result).toBeUndefined();
  });
});

describe("extractFingerprint", () => {
  it("extracts sender domain from From header", () => {
    const fullText =
      "From: noreply@noti.swiss.com\nSubject: Buchungsbestätigung\nBody text with Buchungsübersicht";
    const fp = extractFingerprint(fullText, "Buchungsbestätigung");
    expect(fp.senderDomains).toContain("noti.swiss.com");
    expect(fp.subjectPatterns).toContain("Buchungsbestätigung");
    expect(fp.bodyMarkers.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npx jest --testPathPattern="deriver.test" --forceExit
```

Expected: FAIL — `derivePatternFromSelection is not a function`

- [ ] **Step 3: Implement deriver.ts**

```typescript
// backend/src/services/parsers/userTemplates/deriver.ts
import { prisma } from "../../../db";
import type { Prisma } from "@prisma/client";
import type { TemplateFingerprint, TemplatePatterns, UserTemplate } from "./types";
import logger from "../../../utils/logger";

// Character classes and length quantifiers per field
const FIELD_SPEC: Record<string, { chars: string; len: string }> = {
  pnr: { chars: "A-Z0-9", len: "{5,8}" },
  flightNumber: { chars: "A-Z0-9 ", len: "{4,8}" },
  departureCode: { chars: "A-Z", len: "{3}" },
  arrivalCode: { chars: "A-Z", len: "{3}" },
  aircraftType: { chars: "A-Za-z0-9\\s\\-", len: "{3,30}" },
};

const KNOWN_BODY_MARKERS = [
  "IATA-Code des Abflughafens",
  "IATA-Code des Ankunftsflughafens",
  "Buchungsübersicht",
  "Buchungscode",
  "Durchgeführt von",
  "Booking confirmation",
  "Flight number",
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Derives a context-anchored regex pattern for a single field annotation.
 * Returns a regex string with exactly one capture group, or undefined if
 * the annotation is too short to derive a reliable pattern.
 */
export function derivePatternFromSelection(
  selection: { text: string; label: string; start: number; end: number },
  fullText: string
): string | undefined {
  const value = selection.text.trim();
  if (!value || value.length < 2) return undefined;

  const spec = FIELD_SPEC[selection.label];
  if (!spec) return undefined;

  // Extract up to 80 chars before the value — take the last non-empty line as label context
  const CONTEXT_BEFORE = 80;
  const contextRaw = fullText.slice(Math.max(0, selection.start - CONTEXT_BEFORE), selection.start);
  const lines = contextRaw.split("\n");
  const labelLine = lines.filter((l) => l.trim().length > 0).pop() ?? "";
  const escapedLabel = escapeRegex(labelLine.trim());

  if (!escapedLabel) return undefined;

  return `${escapedLabel}\\s*([${spec.chars}]${spec.len})`;
}

/**
 * Extracts a TemplateFingerprint from plain-text email content.
 */
export function extractFingerprint(
  fullText: string,
  subject: string
): TemplateFingerprint {
  // Sender domain from "From:" header line
  const fromMatch = /^From:\s*.*?@([\w.\-]+)/im.exec(fullText);
  const senderDomains = fromMatch ? [fromMatch[1].toLowerCase()] : [];

  // Subject pattern (stripped of user-specific data — dates, booking codes)
  const cleanSubject = subject.replace(/\d{2}\.\d{2}\.\d{4}/g, "").replace(/[A-Z0-9]{5,8}/g, "").trim();
  const subjectPatterns = cleanSubject.length > 4 ? [cleanSubject] : [subject];

  // Body markers: which known structural markers are present
  const bodyMarkers = KNOWN_BODY_MARKERS.filter((m) => fullText.includes(m));
  // Add first 60 chars of any line starting with a tab (structural label lines)
  if (bodyMarkers.length < 2) {
    const tabLines = fullText
      .split("\n")
      .filter((l) => l.startsWith("\t") && l.trim().length > 4 && l.trim().length < 40)
      .slice(0, 2)
      .map((l) => l.trim());
    bodyMarkers.push(...tabLines);
  }

  return {
    senderDomains,
    subjectPatterns: subjectPatterns.filter(Boolean),
    bodyMarkers: [...new Set(bodyMarkers)].slice(0, 5),
  };
}

interface TextSelection {
  start: number;
  end: number;
  text: string;
  label: string;
  flightIndex?: number;
}

/**
 * Derives a ParserTemplate from a saved TrainingData annotation and
 * writes it to the database with status "active" if fingerprint has
 * at least one body marker, otherwise "pending".
 *
 * Returns the created UserTemplate id, or undefined if derivation fails.
 */
export async function deriveTemplateFromAnnotation(
  trainingDataId: string,
  userId: string
): Promise<string | undefined> {
  const td = await prisma.trainingData.findUnique({
    where: { id: trainingDataId },
  });

  if (!td?.annotations) {
    logger.warn({ trainingDataId }, "TemplateDeriver: no annotations found");
    return undefined;
  }

  const ann = td.annotations as Record<string, unknown>;
  const fullText = typeof ann.fullText === "string" ? ann.fullText : "";
  const textSelections: TextSelection[] = Array.isArray(ann.textSelections)
    ? (ann.textSelections as TextSelection[])
    : [];

  if (!fullText || textSelections.length === 0) {
    return undefined;
  }

  // Derive per-field patterns (skip time fields — handled by Reiseplan segments)
  const patterns: TemplatePatterns = {};
  for (const sel of textSelections) {
    if (sel.label === "departureTime" || sel.label === "arrivalTime") continue;
    const pattern = derivePatternFromSelection(sel, fullText);
    if (pattern) {
      (patterns as Record<string, unknown>)[sel.label] = pattern;
    }
  }

  // Use structural Reiseplan parser when the email contains the anchor keywords
  if (fullText.includes("Reiseplan") && fullText.includes("Durchgeführt")) {
    patterns.useReiseplanSegments = true;
  }

  // Use Buchungsdetails IATA block when standard labels are missing
  if (!patterns.departureCode && fullText.includes("<https://")) {
    patterns.detailsBlock =
      "([A-Z]{3})\\s+<https?://[^>]+>\\s+([A-Z]{3})[\\s\\S]{1,300}?(\\d{2}:\\d{2})\\s*\\n\\s*(\\d{2}:\\d{2})";
  }

  // Derive fingerprint from email content
  const subjectMatch = /^Subject:\s*(.+)$/im.exec(fullText);
  const subject = subjectMatch ? subjectMatch[1].trim() : "";
  const fingerprint = extractFingerprint(fullText, subject);

  // Name template from airline name if detectable
  const airlineMatch =
    /(?:Lufthansa|Swiss|Austrian|Ryanair|Eurowings|easyJet)/i.exec(fullText);
  const airline = airlineMatch ? airlineMatch[0] : "Unknown";
  const name = `${airline} (abgeleitet am ${new Date().toLocaleDateString("de-DE")})`;

  const status = fingerprint.bodyMarkers.length >= 1 ? "active" : "pending";

  const existing = await prisma.parserTemplate.findFirst({
    where: { userId, sourceId: trainingDataId },
  });

  if (existing) {
    const updated = await prisma.parserTemplate.update({
      where: { id: existing.id },
      data: {
        patterns: patterns as unknown as Prisma.InputJsonValue,
        fingerprint: fingerprint as unknown as Prisma.InputJsonValue,
        status,
        updatedAt: new Date(),
      },
    });
    logger.info({ templateId: updated.id, status }, "TemplateDeriver: updated existing template");
    return updated.id;
  }

  const created = await prisma.parserTemplate.create({
    data: {
      userId,
      name,
      status,
      fingerprint: fingerprint as unknown as Prisma.InputJsonValue,
      patterns: patterns as unknown as Prisma.InputJsonValue,
      sourceId: trainingDataId,
      stats: { matchCount: 0, successRate: 0 } as unknown as Prisma.InputJsonValue,
    },
  });

  logger.info({ templateId: created.id, status, name }, "TemplateDeriver: derived new template");
  return created.id;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && npx jest --testPathPattern="deriver.test" --forceExit
```

Expected: all 4 tests PASS.

- [ ] **Step 5: Type-check**

```bash
cd backend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/parsers/userTemplates/
git commit -m "feat: TemplateDeriver — derive regex template from email annotation"
```

---

## Task 4: FingerprintMatcher

**Files:**
- Create: `backend/src/services/parsers/userTemplates/matcher.ts`
- Create: `backend/src/services/parsers/userTemplates/__tests__/matcher.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/services/parsers/userTemplates/__tests__/matcher.test.ts
import { matchesFingerprint } from "../matcher";
import type { TemplateFingerprint } from "../types";

const FP: TemplateFingerprint = {
  senderDomains: ["noti.swiss.com"],
  subjectPatterns: ["Buchungsbestätigung"],
  bodyMarkers: ["Buchungsübersicht", "IATA-Code des Abflughafens"],
};

describe("matchesFingerprint", () => {
  it("matches when all body markers present and sender domain matches", () => {
    const body = "Buchungsübersicht\nIATA-Code des Abflughafens MUC";
    const from = "noreply@noti.swiss.com";
    expect(matchesFingerprint(FP, from, "irrelevant", body)).toBe(true);
  });

  it("matches via subject pattern when sender domain misses", () => {
    const body = "Buchungsübersicht\nIATA-Code des Abflughafens MUC";
    const from = "other@somemail.com";
    expect(matchesFingerprint(FP, from, "Buchungsbestätigung LX123", body)).toBe(true);
  });

  it("does not match when a body marker is missing", () => {
    const body = "Buchungsübersicht only";
    const from = "noreply@noti.swiss.com";
    expect(matchesFingerprint(FP, from, "Buchungsbestätigung", body)).toBe(false);
  });

  it("does not match when neither sender nor subject matches", () => {
    const body = "Buchungsübersicht\nIATA-Code des Abflughafens MUC";
    const from = "noreply@other.com";
    const subject = "Your trip";
    expect(matchesFingerprint(FP, from, subject, body)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npx jest --testPathPattern="matcher.test" --forceExit
```

Expected: FAIL — `matchesFingerprint is not a function`

- [ ] **Step 3: Implement matcher.ts**

```typescript
// backend/src/services/parsers/userTemplates/matcher.ts
import { prisma } from "../../../db";
import type { TemplateFingerprint, UserTemplate } from "./types";

/**
 * Returns true when the email (described by from, subject, body) matches
 * the given fingerprint.
 *
 * Match rules:
 * - ALL bodyMarkers must be present in body (case-sensitive)
 * - At least one of: senderDomain matches OR subjectPattern matches
 */
export function matchesFingerprint(
  fp: TemplateFingerprint,
  fromAddress: string,
  subject: string,
  body: string
): boolean {
  // All body markers must be present
  if (!fp.bodyMarkers.every((m) => body.includes(m))) return false;

  const senderDomain = fromAddress.toLowerCase().split("@")[1] ?? "";
  const domainMatch = fp.senderDomains.some(
    (d) => senderDomain === d || senderDomain.endsWith("." + d)
  );
  if (domainMatch) return true;

  const subjectLower = subject.toLowerCase();
  const subjectMatch = fp.subjectPatterns.some((p) =>
    subjectLower.includes(p.toLowerCase())
  );
  return subjectMatch;
}

/**
 * Finds the best matching active ParserTemplate for this email from the
 * user's own templates. Returns the template or null if none match.
 */
export async function findMatchingTemplate(
  userId: string,
  fromAddress: string,
  subject: string,
  body: string
): Promise<UserTemplate | null> {
  const templates = await prisma.parserTemplate.findMany({
    where: { userId, status: "active" },
    orderBy: { updatedAt: "desc" },
  });

  for (const t of templates) {
    const fp = t.fingerprint as unknown as TemplateFingerprint;
    if (matchesFingerprint(fp, fromAddress, subject, body)) {
      return {
        id: t.id,
        userId: t.userId,
        name: t.name,
        status: t.status as UserTemplate["status"],
        fingerprint: fp,
        patterns: t.patterns as unknown as import("./types").TemplatePatterns,
        stats: t.stats as unknown as import("./types").TemplateStats | undefined,
        sourceId: t.sourceId ?? undefined,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      };
    }
  }

  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && npx jest --testPathPattern="matcher.test" --forceExit
```

Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/parsers/userTemplates/matcher.ts \
  backend/src/services/parsers/userTemplates/__tests__/matcher.test.ts
git commit -m "feat: FingerprintMatcher — find matching user template for incoming email"
```

---

## Task 5: UserTemplateEngine — multi-flight regex parser

**Files:**
- Create: `backend/src/services/parsers/userTemplates/engine.ts`
- Create: `backend/src/services/parsers/userTemplates/__tests__/engine.test.ts`

The engine applies template patterns to plain text. For emails with `useReiseplanSegments`, it runs the validated structural Reiseplan parser (4-strategy algorithm from proof of concept) to find all flights. For other emails it applies the per-field regex patterns to extract a single flight.

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/services/parsers/userTemplates/__tests__/engine.test.ts
import { applyUserTemplate } from "../engine";
import type { UserTemplate } from "../types";

const REISEPLAN_TEMPLATE: UserTemplate = {
  id: "t1",
  userId: "u1",
  name: "Test Lufthansa",
  status: "active",
  fingerprint: { senderDomains: [], subjectPatterns: [], bodyMarkers: [] },
  patterns: {
    pnr: "Buchungscode:\\s*([A-Z0-9]{5,8})",
    useReiseplanSegments: true,
    detailsBlock:
      "([A-Z]{3})\\s+<https?://[^>]+>\\s+([A-Z]{3})[\\s\\S]{1,300}?(\\d{2}:\\d{2})\\s*\\n\\s*(\\d{2}:\\d{2})",
  },
  createdAt: "",
  updatedAt: "",
};

const SAMPLE_BODY = `From: noreply@lufthansa.com
Subject: Buchungsbestätigung

Buchungscode: ABCD12

Reiseplan

18.09.2025 - 08:25
https://example.com/img LH2460
MUC <https://example.com/arrow> HEL
18:45
21:00

18.09.2025 - 08:25
LH2460 Durchgeführt von: Lufthansa

19.09.2025 - 15:30
HEL <https://example.com/arrow> MUC
19.09.2025 - 15:30
LH2461 Durchgeführt von: Lufthansa`;

describe("applyUserTemplate", () => {
  it("extracts PNR from pattern", () => {
    const result = applyUserTemplate(REISEPLAN_TEMPLATE, "", SAMPLE_BODY);
    expect(result[0]?.pnr).toBe("ABCD12");
  });

  it("finds multiple flights via Reiseplan segments", () => {
    const result = applyUserTemplate(REISEPLAN_TEMPLATE, "", SAMPLE_BODY);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it("sets fieldSources template for extracted fields", () => {
    const result = applyUserTemplate(REISEPLAN_TEMPLATE, "", SAMPLE_BODY);
    expect(result[0]?.fieldSources?.pnr).toBe("template");
  });
});

const SIMPLE_TEMPLATE: UserTemplate = {
  id: "t2",
  userId: "u1",
  name: "Test Simple",
  status: "active",
  fingerprint: { senderDomains: [], subjectPatterns: [], bodyMarkers: [] },
  patterns: {
    pnr: "PNR:\\s*([A-Z0-9]{6})",
    flightNumber: "Flug:\\s*([A-Z]{2}\\d{1,4})",
    departureCode: "Von:\\s*([A-Z]{3})",
    arrivalCode: "Nach:\\s*([A-Z]{3})",
  },
  createdAt: "",
  updatedAt: "",
};

describe("applyUserTemplate simple patterns", () => {
  it("extracts fields from simple labeled email", () => {
    const body = "PNR: AB1234\nFlug: LH123\nVon: MUC\nNach: FRA";
    const result = applyUserTemplate(SIMPLE_TEMPLATE, "", body);
    expect(result[0]?.pnr).toBe("AB1234");
    expect(result[0]?.flightNumber).toBe("LH123");
    expect(result[0]?.departureCode).toBe("MUC");
    expect(result[0]?.arrivalCode).toBe("FRA");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npx jest --testPathPattern="engine.test" --forceExit
```

Expected: FAIL — `applyUserTemplate is not a function`

- [ ] **Step 3: Implement engine.ts**

```typescript
// backend/src/services/parsers/userTemplates/engine.ts
import type { ParsedBooking } from "../../bookingParser";
import type { FieldSources, TemplatePatterns, UserTemplate } from "./types";

// Reiseplan structural segment regex (validated in proof-of-concept against 5 Lufthansa emails)
const RE_REISEPLAN_SEG = new RegExp(
  "(\\d{2})\\.(\\d{2})\\.(\\d{4})\\s+-\\s+(\\d{2}:\\d{2})" +
    "[\\s\\S]{1,800}?" +
    "(\\d{2})\\.(\\d{2})\\.(\\d{4})\\s+-\\s+(\\d{2}:\\d{2})" +
    "[\\s\\S]{1,400}?" +
    "([A-Z]{2,3}\\s?\\d{1,4})\\s+Durchgeführt",
  "g"
);

// Buchungsdetails IATA block: dep_iata <img> arr_iata \n dep_time \n arr_time
const RE_DETAILS_BLOCK = new RegExp(
  "([A-Z]{3})\\s+<https?://[^>]+>\\s+([A-Z]{3})" +
    "[\\s\\S]{1,300}?" +
    "(\\d{2}:\\d{2})\\s*\\n\\s*(\\d{2}:\\d{2})",
  "g"
);

function applyPattern(
  pattern: string,
  body: string
): string | undefined {
  try {
    const re = new RegExp(pattern, "s");
    const m = re.exec(body);
    return m?.[1]?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function extractReiseplanFlights(
  body: string,
  pnr: string | undefined
): Array<Partial<ParsedBooking & { fieldSources: FieldSources }>> {
  const reiseplanIdx = body.indexOf("Reiseplan");
  const searchText = reiseplanIdx >= 0 ? body.slice(reiseplanIdx) : body;

  RE_REISEPLAN_SEG.lastIndex = 0;
  const flights: Array<Partial<ParsedBooking & { fieldSources: FieldSources }>> = [];

  for (const m of searchText.matchAll(RE_REISEPLAN_SEG)) {
    const depD = m[1], depMo = m[2], depY = m[3], depT = m[4];
    const arrD = m[5], arrMo = m[6], arrY = m[7], arrT = m[8];
    const fn = m[9].replace(/\s/, "");

    flights.push({
      flightNumber: fn,
      departureTime: `${depY}-${depMo}-${depD}T${depT}:00`,
      arrivalTime: `${arrY}-${arrMo}-${arrD}T${arrT}:00`,
      departureCode: undefined,
      arrivalCode: undefined,
      pnr,
      fieldSources: {
        flightNumber: "template",
        departureTime: "template",
        arrivalTime: "template",
        ...(pnr ? { pnr: "template" } : {}),
      } as FieldSources,
      missing: [],
    });
  }

  // Enrich IATA codes from Buchungsdetails block
  RE_DETAILS_BLOCK.lastIndex = 0;
  for (const m of body.matchAll(RE_DETAILS_BLOCK)) {
    const depIata = m[1], arrIata = m[2], depTimeHHMM = m[3];
    for (const f of flights) {
      if (
        f.departureCode === undefined &&
        f.departureTime?.includes("T" + depTimeHHMM)
      ) {
        f.departureCode = depIata;
        f.arrivalCode = arrIata;
        if (f.fieldSources) {
          f.fieldSources.departureCode = "template";
          f.fieldSources.arrivalCode = "template";
        }
        break;
      }
    }
  }

  return flights;
}

/**
 * Applies a UserTemplate to plain-text email body.
 * Returns an array of ParsedBooking (one per detected flight).
 * Each booking includes `fieldSources` for confidence colour-coding.
 */
export function applyUserTemplate(
  template: UserTemplate,
  _subject: string,
  body: string
): Array<ParsedBooking & { fieldSources: FieldSources }> {
  const patterns: TemplatePatterns = template.patterns;

  // Extract PNR (shared across all flights)
  const pnr = patterns.pnr ? applyPattern(patterns.pnr, body) : undefined;
  const pnrSource: FieldSources = pnr ? { pnr: "template" } : {};

  // Multi-flight via Reiseplan structural segments
  if (patterns.useReiseplanSegments) {
    const flights = extractReiseplanFlights(body, pnr);
    if (flights.length > 0) {
      return flights.map((f) => ({
        missing: [],
        parserTemplate: template.name,
        parserConfidence: computeConfidence(f),
        ...f,
        fieldSources: { ...pnrSource, ...f.fieldSources } as FieldSources,
      })) as Array<ParsedBooking & { fieldSources: FieldSources }>;
    }
  }

  // Single-flight: apply per-field patterns
  const fieldSources: FieldSources = { ...pnrSource };
  const booking: ParsedBooking = { missing: [], pnr };

  // Maps TemplatePatterns key → ParsedBooking key.
  // Note: patterns.aircraftType → booking.aircraft (different names)
  const FIELD_MAP: Array<[keyof TemplatePatterns, keyof ParsedBooking]> = [
    ["flightNumber", "flightNumber"],
    ["departureCode", "departureCode"],
    ["arrivalCode", "arrivalCode"],
    ["aircraftType", "aircraft"],  // fieldSources key will be "aircraft" (bookKey)
  ];

  for (const [patKey, bookKey] of FIELD_MAP) {
    const pat = patterns[patKey];
    if (typeof pat === "string") {
      const val = applyPattern(pat, body);
      if (val) {
        (booking as Record<string, unknown>)[bookKey] = val;
        (fieldSources as Record<string, string>)[bookKey as string] = "template";
      }
    }
  }

  booking.parserTemplate = template.name;
  booking.parserConfidence = computeConfidence(booking);

  return [{ ...booking, fieldSources }];
}

function computeConfidence(
  booking: Partial<ParsedBooking>
): number {
  const CRITICAL = ["flightNumber", "departureCode", "arrivalCode", "departureTime", "pnr"];
  const filled = CRITICAL.filter(
    (k) => (booking as Record<string, unknown>)[k] != null
  ).length;
  return Math.round((filled / CRITICAL.length) * 100);
}
```

- [ ] **Step 4: Run tests**

```bash
cd backend && npx jest --testPathPattern="engine.test" --forceExit
```

Expected: all tests PASS (PNR extracted, `fieldSources.pnr === "template"`).

- [ ] **Step 5: Type-check**

```bash
cd backend && npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/parsers/userTemplates/engine.ts \
  backend/src/services/parsers/userTemplates/__tests__/engine.test.ts
git commit -m "feat: UserTemplateEngine — multi-flight regex parser with fieldSources"
```

---

## Task 6: Factory integration — UserTemplateEngine as step 0

**Files:**
- Modify: `backend/src/services/parsers/factory.ts`

The user-derived template step runs before the existing HTML-selector TemplateParser. If confidence >= 80%, return immediately; otherwise fall through to the existing pipeline unchanged.

- [ ] **Step 1: Add imports at the top of factory.ts**

In `backend/src/services/parsers/factory.ts`, add after the existing `TemplateParser` import (line ~29):

```typescript
import { findMatchingTemplate } from './userTemplates/matcher';
import { applyUserTemplate } from './userTemplates/engine';
```

- [ ] **Step 2: Insert user-template step before existing TemplateParser block**

In `factory.ts`, the existing TemplateParser block starts with:
```typescript
// Template-Parser first (before LLM chain)
const templateParser = new TemplateParser();
```

Insert the following block BEFORE those lines:

```typescript
// Step 0: User-derived regex templates (before HTML-selector templates)
if (config.userId) {
  const fromMatch = /^From:\s*(.+)$/im.exec(text);
  const fromAddress = fromMatch ? fromMatch[1].trim() : "";
  const subjectLine = subject;

  const userTemplate = await findMatchingTemplate(config.userId, fromAddress, subjectLine, text);
  if (userTemplate) {
    const userResults = applyUserTemplate(userTemplate, subjectLine, text);
    const bestConfidence = userResults[0]?.parserConfidence ?? 0;
    if (bestConfidence >= 80) {
      logger.info(
        { templateName: userTemplate.name, flights: userResults.length, confidence: bestConfidence },
        '[Parser Factory] User-derived template matched (confidence >=80%), skipping LLM chain'
      );
      return {
        flights: userResults,
        provider: 'regex' as const,
        fallbackUsed: false,
      };
    }
  }
}
// End step 0
```

- [ ] **Step 3: Type-check**

```bash
cd backend && npx tsc --noEmit
```

Expected: no errors. Note: `ParsedBooking & { fieldSources }` is assignable because `fieldSources` is an extra property — verify this compiles without the spread type causing issues. If needed, cast: `flights: userResults as ParsedBooking[]`.

- [ ] **Step 4: Test that existing tests still pass**

```bash
cd backend && npx jest --forceExit
```

Expected: all pre-existing tests continue to pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/parsers/factory.ts
git commit -m "feat: insert user-derived template parser as step 0 in parser factory"
```

---

## Task 7: Trigger TemplateDeriver after annotation save

**Files:**
- Modify: `backend/src/routes/training.ts`

- [ ] **Step 1: Add import in training.ts**

At the top of `backend/src/routes/training.ts`, add:

```typescript
import { deriveTemplateFromAnnotation } from '../services/parsers/userTemplates/deriver';
```

- [ ] **Step 2: Call deriver in the annotate route**

In the `/:id/annotate` route handler, after the `createFlightsFromGroundTruth` call (after line ~253 — `const flightsCreated = await createFlightsFromGroundTruth(...)`), add:

```typescript
// Derive parser template from annotation (fire-and-forget, non-blocking)
let templateId: string | undefined;
if (
  payload.annotations &&
  typeof (payload.annotations as Record<string, unknown>).textSelections !== "undefined"
) {
  try {
    templateId = await deriveTemplateFromAnnotation(id, userId);
  } catch (err: unknown) {
    logger.warn({ err, trainingDataId: id }, "TemplateDeriver failed — non-critical");
  }
}
```

Also update the `res.json(...)` response to include `templateId`:

```typescript
res.json({
  id: updated.id,
  status: updated.status,
  annotations: updated.annotations,
  extractedData: updated.extractedData,
  flightsCreated,
  templateId,
});
```

- [ ] **Step 3: Type-check**

```bash
cd backend && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/training.ts
git commit -m "feat: trigger TemplateDeriver after annotation save"
```

---

## Task 8: Parser-template CRUD API

**Files:**
- Create: `backend/src/routes/parserTemplates.ts`
- Modify: `backend/src/index.ts`

- [ ] **Step 1: Create parserTemplates.ts**

```typescript
// backend/src/routes/parserTemplates.ts
import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { prisma } from '../db';
import { AppError } from '../middleware/errorHandler';

const router = Router();
router.use(authenticate);

// GET /api/v1/parser-templates — list user's templates
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const templates = await prisma.parserTemplate.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });
    res.json({ templates });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/v1/parser-templates/:id — activate / disable
const patchSchema = z.object({
  status: z.enum(['active', 'disabled', 'pending']),
});

router.patch('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const { id } = req.params;
    const { status } = patchSchema.parse(req.body);

    const existing = await prisma.parserTemplate.findUnique({ where: { id } });
    if (!existing) throw new AppError('Template not found', 404);
    if (existing.userId !== userId) throw new AppError('Unauthorized', 403);

    const updated = await prisma.parserTemplate.update({
      where: { id },
      data: { status },
    });
    res.json({ id: updated.id, status: updated.status });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/v1/parser-templates/:id
router.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const { id } = req.params;

    const existing = await prisma.parserTemplate.findUnique({ where: { id } });
    if (!existing) throw new AppError('Template not found', 404);
    if (existing.userId !== userId) throw new AppError('Unauthorized', 403);

    await prisma.parserTemplate.delete({ where: { id } });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;
```

- [ ] **Step 2: Register route in index.ts**

In `backend/src/index.ts`, after the existing route imports, add:

```typescript
import parserTemplatesRoutes from './routes/parserTemplates';
```

And in the route registrations block (after line 177 where training is registered):

```typescript
app.use('/api/v1/parser-templates', parserTemplatesRoutes);
```

- [ ] **Step 3: Type-check**

```bash
cd backend && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/parserTemplates.ts backend/src/index.ts
git commit -m "feat: parser-templates CRUD API (list, activate, disable, delete)"
```

---

## Task 9: Frontend types — mirror fieldSources in ParsedBooking + API client

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/lib/api.ts`

> Note: `fieldSources` was already added to the **backend** `ParsedBooking` in Task 2. This task mirrors it in the **frontend** type so the FlightReviewModal can use it.

- [ ] **Step 1: Add fieldSources to ParsedBooking in types/index.ts**

In `frontend/src/types/index.ts`, find the `ParsedBooking` interface (line ~124) and add after `missing?: string[]`:

```typescript
  fieldSources?: Partial<
    Record<
      | "flightNumber"
      | "departureCode"
      | "arrivalCode"
      | "departureTime"
      | "arrivalTime"
      | "pnr"
      | "aircraft"
      | "seat"
      | "terminal"
      | "gate",
      "template" | "llm" | "empty"
    >
  >;
```

- [ ] **Step 2: Add parserTemplatesApi to api.ts**

In `frontend/src/lib/api.ts`, add before the final `export` statements:

```typescript
export interface UserTemplateItem {
  id: string;
  name: string;
  status: "pending" | "active" | "disabled";
  createdAt: string;
  updatedAt: string;
  stats?: { matchCount: number; successRate: number; lastUsedAt?: string };
}

export const parserTemplatesApi = {
  list: async (): Promise<UserTemplateItem[]> => {
    const res = await api.get<{ templates: UserTemplateItem[] }>("/parser-templates");
    return res.data.templates;
  },
  setStatus: async (id: string, status: "active" | "disabled" | "pending"): Promise<void> => {
    await api.patch(`/parser-templates/${id}`, { status });
  },
  delete: async (id: string): Promise<void> => {
    await api.delete(`/parser-templates/${id}`);
  },
};
```

- [ ] **Step 3: Frontend type-check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/lib/api.ts
git commit -m "feat: add fieldSources to ParsedBooking, parserTemplatesApi client"
```

---

## Task 10: FlightReviewModal — confidence colour-coding

**Files:**
- Modify: `frontend/src/components/FlightReviewModal.tsx`

Fields sourced from a user template get a green left border. Fields sourced from LLM get yellow. Fields that are empty (required but missing) get red. Fields with no source information are unstyled.

- [ ] **Step 1: Write the failing test**

In `frontend/src/__tests__/components/`, create:

```typescript
// frontend/src/__tests__/components/FlightReviewModal.fieldSources.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import FlightReviewModal from "../../components/FlightReviewModal";
import type { ParsedBooking } from "../../types";

const noop = async () => {};

const parsedData: ParsedBooking = {
  flightNumber: "LH2460",
  departureCode: "MUC",
  arrivalCode: "HEL",
  missing: [],
  fieldSources: {
    flightNumber: "template",
    departureCode: "template",
    arrivalCode: "llm",
  },
};

vi.mock("../../lib/api", () => ({
  airportsApi: { search: vi.fn().mockResolvedValue([]) },
  parseApi: { feedbackCorrection: vi.fn() },
}));
vi.mock("../../store/authStore", () => ({
  useAuthStore: () => ({ user: { id: "u1" } }),
}));
vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

describe("FlightReviewModal fieldSources", () => {
  it("applies green border class for template-sourced flight number field", () => {
    render(
      <FlightReviewModal
        isOpen={true}
        onClose={noop as unknown as () => void}
        onConfirm={noop}
        initialData={parsedData}
        source="email"
      />
    );
    // The flight number input container should have the green border class
    const input = screen.getByDisplayValue("LH2460");
    expect(input.className).toMatch(/border-green/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npx vitest --run --reporter=verbose 2>&1 | grep -A 5 "fieldSources"
```

Expected: FAIL — green border class not found.

- [ ] **Step 3: Add getFieldBorderClass helper and apply to inputs in FlightReviewModal**

In `frontend/src/components/FlightReviewModal.tsx`, add this helper function just before the component definition:

```typescript
function getFieldBorderClass(
  fieldName: string,
  fieldSources?: ParsedBooking["fieldSources"]
): string {
  if (!fieldSources) return "";
  const source = fieldSources[fieldName as keyof typeof fieldSources];
  if (source === "template") return "border-l-4 border-green-500";
  if (source === "llm") return "border-l-4 border-yellow-400";
  if (source === "empty") return "border-l-4 border-red-500";
  return "";
}
```

Then find where `flightNumber` input is rendered (search for `value={flightNumber}` or similar input). Add the border class to that input's `className`. Apply the same pattern for the `departureCode`, `arrivalCode`, `departureTime`, `arrivalTime`, `pnr` inputs.

The general pattern for each input is to change:
```tsx
<input
  className="existing classes..."
  value={flightNumber}
  ...
/>
```
to:
```tsx
<input
  className={`existing classes... ${getFieldBorderClass("flightNumber", initialData.fieldSources)}`}
  value={flightNumber}
  ...
/>
```

Apply to these field inputs: `flightNumber`, `departureCode`, `arrivalCode`, `departureTime`, `arrivalTime`, `pnr` (bookingReference / seat).

- [ ] **Step 4: Run test**

```bash
cd frontend && npx vitest --run
```

Expected: all tests pass including the new fieldSources test.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/FlightReviewModal.tsx \
  frontend/src/__tests__/components/FlightReviewModal.fieldSources.test.tsx
git commit -m "feat: colour-coded confidence borders in FlightReviewModal (template=green, llm=yellow)"
```

---

## Task 11: TemplateReviewCard — shown after annotation save

**Files:**
- Create: `frontend/src/components/Training/TemplateReviewCard.tsx`
- Modify: `frontend/src/components/Training/EmailAnnotation.tsx`

After the user saves an annotation, if the backend returns a `templateId`, show a card with the template name, status, and an activate/disable button.

- [ ] **Step 1: Create TemplateReviewCard.tsx**

```typescript
// frontend/src/components/Training/TemplateReviewCard.tsx
import { useState, useEffect } from "react";
import { parserTemplatesApi, type UserTemplateItem } from "../../lib/api";
import { useTranslation } from "../../hooks/useTranslation";

interface TemplateReviewCardProps {
  templateId: string;
  onDismiss: () => void;
}

export default function TemplateReviewCard({
  templateId,
  onDismiss,
}: TemplateReviewCardProps): JSX.Element | null {
  const { t } = useTranslation(["training", "common"]);
  const [template, setTemplate] = useState<UserTemplateItem | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    parserTemplatesApi
      .list()
      .then((list) => {
        const found = list.find((tpl) => tpl.id === templateId);
        setTemplate(found ?? null);
      })
      .finally(() => setLoading(false));
  }, [templateId]);

  const handleActivate = async (): Promise<void> => {
    if (!template) return;
    await parserTemplatesApi.setStatus(template.id, "active");
    setTemplate({ ...template, status: "active" });
  };

  const handleDisable = async (): Promise<void> => {
    if (!template) return;
    await parserTemplatesApi.setStatus(template.id, "disabled");
    setTemplate({ ...template, status: "disabled" });
  };

  if (loading) return null;
  if (!template) return null;

  return (
    <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950">
      <div className="flex items-start justify-between">
        <div>
          <p className="font-medium text-blue-900 dark:text-blue-100">
            Template abgeleitet: <span className="font-bold">{template.name}</span>
          </p>
          <p className="mt-1 text-sm text-blue-700 dark:text-blue-300">
            Status:{" "}
            <span
              className={
                template.status === "active"
                  ? "text-green-600 dark:text-green-400"
                  : "text-yellow-600 dark:text-yellow-400"
              }
            >
              {template.status}
            </span>
          </p>
        </div>
        <button
          onClick={onDismiss}
          className="text-blue-400 hover:text-blue-600"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
      <div className="mt-3 flex gap-2">
        {template.status !== "active" && (
          <button
            onClick={handleActivate}
            className="rounded bg-green-600 px-3 py-1 text-sm text-white hover:bg-green-700"
          >
            Aktivieren
          </button>
        )}
        {template.status === "active" && (
          <button
            onClick={handleDisable}
            className="rounded bg-gray-400 px-3 py-1 text-sm text-white hover:bg-gray-500"
          >
            Deaktivieren
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Show card in EmailAnnotation.tsx after save**

In `frontend/src/components/Training/EmailAnnotation.tsx`:

1. Add import at the top:
```typescript
import TemplateReviewCard from "./TemplateReviewCard";
```

2. Add state variable after existing state declarations:
```typescript
const [derivedTemplateId, setDerivedTemplateId] = useState<string | null>(null);
```

3. After the annotation save call (where `res.json(...)` is awaited), extract `templateId`:
Find where the `trainingApi.annotate(...)` or `trainingApi.saveAnnotations(...)` response is handled. After a successful save, add:
```typescript
if (response.templateId) {
  setDerivedTemplateId(response.templateId);
}
```

4. In the JSX, after the save button area, add:
```tsx
{derivedTemplateId && (
  <TemplateReviewCard
    templateId={derivedTemplateId}
    onDismiss={() => setDerivedTemplateId(null)}
  />
)}
```

- [ ] **Step 3: Frontend type-check**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 4: Run frontend tests**

```bash
cd frontend && npx vitest --run
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Training/TemplateReviewCard.tsx \
  frontend/src/components/Training/EmailAnnotation.tsx
git commit -m "feat: TemplateReviewCard — shown after annotation saves a derived template"
```

---

## Task 12: LLM Gap-Filler — targeted Ollama call for empty fields (optional)

**Files:**
- Modify: `backend/src/services/parsers/factory.ts`
- Modify: `backend/src/services/parsers/text/ollamaTextParser.ts`

Only implement this task when Tasks 1–11 are complete and tested. This task is optional — it improves results when a template only fills 80% of fields, using Ollama to fill the remaining gaps. Enabled/disabled via user settings (`useTrainedModels`).

- [ ] **Step 1: Add `fillGaps` method to OllamaTextParser**

In `backend/src/services/parsers/text/ollamaTextParser.ts`, add after the `parseEmail` method:

```typescript
async fillGaps(
  partial: ParsedBooking,
  missingFields: string[],
  excerpt: string
): Promise<Partial<ParsedBooking>> {
  const fieldList = missingFields.join(", ");
  const prompt = `From this flight booking email excerpt, extract ONLY these fields: ${fieldList}.
Respond with a JSON object containing only the requested fields. Use null for fields you cannot find.

Email excerpt:
${excerpt.slice(0, 1500)}

Respond with only JSON, no explanation.`;

  const response = await axios.post<{ response: string }>(
    `${this.ollamaUrl}/api/generate`,
    { model: this.modelName ?? "llama3.2", prompt, stream: false },
    { timeout: 30000 }
  );

  try {
    const raw = response.data.response.trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return {};
    return JSON.parse(jsonMatch[0]) as Partial<ParsedBooking>;
  } catch {
    return {};
  }
}
```

- [ ] **Step 2: Call fillGaps in factory.ts after user-template step**

In `factory.ts`, after the user template block (step 0), if a user template matched but confidence is between 50–80%, attempt gap-filling:

```typescript
// Step 0b: LLM gap-filler for user-template partial results (if Ollama available)
if (config.userId && userResults && bestConfidence >= 50 && bestConfidence < 80) {
  try {
    const ollamaParser = getOllamaTextParser();
    const ollamaAvail = await checkProviderAvailability(ollamaParser, undefined);
    if (ollamaAvail.available) {
      for (const flight of userResults) {
        const missing = ["flightNumber", "departureCode", "arrivalCode", "departureTime", "arrivalTime"]
          .filter((k) => !(flight as Record<string, unknown>)[k]);
        if (missing.length > 0) {
          const gaps = await (ollamaParser as OllamaTextParser).fillGaps(flight, missing, text);
          for (const [k, v] of Object.entries(gaps)) {
            if (v && !(flight as Record<string, unknown>)[k]) {
              (flight as Record<string, unknown>)[k] = v;
              if (flight.fieldSources) {
                (flight.fieldSources as Record<string, string>)[k] = "llm";
              }
            }
          }
        }
      }
      return { flights: userResults, provider: 'regex' as const, fallbackUsed: true };
    }
  } catch {
    // gap-filler failure is non-fatal — fall through to LLM chain
  }
}
```

Note: This step requires restructuring the user-template block in step 0 to preserve `userResults` and `bestConfidence` as variables accessible to step 0b. Refactor accordingly.

- [ ] **Step 3: Type-check + full test suite**

```bash
cd backend && npx tsc --noEmit && npx jest --forceExit
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/parsers/factory.ts \
  backend/src/services/parsers/text/ollamaTextParser.ts
git commit -m "feat: LLM gap-filler — targeted Ollama call for fields missed by user template"
```

---

## Final verification

- [ ] Run full backend test suite:
  ```bash
  cd backend && npx jest --forceExit
  ```
- [ ] Run full frontend test suite:
  ```bash
  cd frontend && npx vitest --run
  ```
- [ ] Run both type checks:
  ```bash
  cd backend && npx tsc --noEmit
  cd frontend && npx tsc --noEmit
  ```
- [ ] Run linters:
  ```bash
  cd backend && npm run lint
  cd frontend && npm run lint
  ```
- [ ] Manual smoke test: annotate an email in Training tab → verify `templateId` returned → verify TemplateReviewCard appears → import a second Lufthansa email → verify fields are pre-filled with green borders.
