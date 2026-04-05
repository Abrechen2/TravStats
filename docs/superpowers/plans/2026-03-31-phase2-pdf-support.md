# Phase 2: PDF-Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable PDF files (booking confirmations + boarding passes) as a valid import source, extracting text server-side and routing it through the existing parser infrastructure.

**Architecture:** New backend route `POST /api/v1/parse-pdf` accepts a PDF file (multipart), extracts text via `pdf-parse`, detects if the text is BCBP-formatted (starts with `M1`/`M2`), and routes to either BCBP parsing or the existing email text parser. Frontend removes the "PDF not supported" guard in `EmailImportTab` and calls the new endpoint.

**Note on BCBP barcode scanning from images:** Already fully implemented in frontend (`barcodeExtractor.ts` + `bcbpParser.ts`). This phase adds PDF text extraction only — extracting embedded barcode *images* from PDFs is out of scope.

**Tech Stack:** `pdf-parse` (npm), Express multipart (`multer` already in project), existing `bookingParser.ts` + `regexParser.ts` for text parsing, Zod for validation.

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Add dep | `backend/package.json` | Add `pdf-parse` + `@types/pdf-parse` |
| Create | `backend/src/services/pdfParser.ts` | Extract text from PDF buffer using pdf-parse |
| Create | `backend/src/routes/pdfParse.ts` | `POST /api/v1/parse-pdf` route |
| Modify | `backend/src/middleware/rateLimit.ts` | Add `pdfParseLimiter` |
| Modify | `backend/src/config/constants.ts` | Add `PDF_MAX_SIZE` constant |
| Modify | `backend/src/utils/fileValidation.ts` | Add `validatePdfBuffer()` helper |
| Modify | `backend/src/index.ts` | Register `pdfParseRoutes` |
| Modify | `frontend/src/lib/api.ts` | Add `parseApi.parsePdf()` method |
| Modify | `frontend/src/components/import/EmailImportTab.tsx` | Accept PDF, call `parsePdf` |
| Modify | `frontend/src/i18n/de/flights.json` | Add PDF import strings |
| Modify | `frontend/src/i18n/en/flights.json` | Add PDF import strings |
| Create | `backend/src/__tests__/pdfParse.route.test.ts` | Route integration test |
| Create | `backend/src/services/__tests__/pdfParser.test.ts` | Service unit test |

---

## Task 1: Backend dependency + PDF service

**Files:**
- Modify: `backend/package.json`
- Create: `backend/src/services/pdfParser.ts`

- [ ] **Install pdf-parse**

```bash
cd /d/Projekte/TravStats/backend && npm install pdf-parse && npm install --save-dev @types/pdf-parse
```

- [ ] **Write failing service test**

Create `backend/src/services/__tests__/pdfParser.test.ts`:

```typescript
import { extractTextFromPdf } from '../pdfParser';

describe('pdfParser', () => {
  it('rejects non-PDF buffers', async () => {
    const notPdf = Buffer.from('hello world');
    await expect(extractTextFromPdf(notPdf)).rejects.toThrow('Invalid PDF');
  });

  it('extracts text from minimal valid PDF', async () => {
    // Minimal PDF with the text "Hello"
    // %PDF-1.4 header + minimal structure
    const minimalPdf = Buffer.from(
      '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]\n' +
      '/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n' +
      '4 0 obj\n<< /Length 44 >>\nstream\nBT /F1 12 Tf 72 720 Td (Hello) Tj ET\nendstream\nendobj\n' +
      '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n' +
      'xref\n0 6\n0000000000 65535 f\n' +
      '0000000009 00000 n\n0000000058 00000 n\n' +
      '0000000115 00000 n\n0000000266 00000 n\n' +
      '0000000360 00000 n\n' +
      'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n441\n%%EOF'
    );
    const text = await extractTextFromPdf(minimalPdf);
    expect(typeof text).toBe('string');
  });
});
```

- [ ] **Run test — expect FAIL**

```bash
cd /d/Projekte/TravStats/backend && npx jest src/services/__tests__/pdfParser.test.ts --forceExit
```

Expected: FAIL — `Cannot find module '../pdfParser'`

- [ ] **Implement `pdfParser.ts`**

Create `backend/src/services/pdfParser.ts`:

```typescript
import pdfParse from 'pdf-parse';
import logger from '../utils/logger';

const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46]); // %PDF

/**
 * Extracts plain text from a PDF buffer.
 * Throws if the buffer is not a valid PDF.
 */
export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  if (buffer.length < 4 || !buffer.slice(0, 4).equals(PDF_MAGIC)) {
    throw new Error('Invalid PDF: missing %PDF header');
  }

  const data = await pdfParse(buffer);
  const text = data.text ?? '';

  logger.debug({
    operation: 'pdf_text_extraction',
    pages: data.numpages,
    chars: text.length,
  }, '[PDF Parser] Extracted text');

  return text;
}

/**
 * Checks if extracted PDF text looks like an IATA BCBP string.
 * BCBP strings start with M1 or M2 followed by passenger name.
 */
export function isBcbpText(text: string): boolean {
  const trimmed = text.trim();
  return /^M[12]\d/.test(trimmed);
}
```

- [ ] **Run test — expect PASS**

```bash
cd /d/Projekte/TravStats/backend && npx jest src/services/__tests__/pdfParser.test.ts --forceExit
```

Expected: PASS (both tests green)

- [ ] **Commit**

```bash
cd /d/Projekte/TravStats && git add backend/package.json backend/package-lock.json backend/src/services/pdfParser.ts backend/src/services/__tests__/pdfParser.test.ts
git commit -m "feat: add PDF text extraction service using pdf-parse"
```

---

## Task 2: Constants + rate limiter

**Files:**
- Modify: `backend/src/config/constants.ts`
- Modify: `backend/src/middleware/rateLimit.ts`

- [ ] **Add PDF_MAX_SIZE to constants**

In `backend/src/config/constants.ts`, add to the `FILE_LIMITS` block:

```typescript
PDF_MAX_SIZE: 20 * 1024 * 1024,  // 20 MB
```

- [ ] **Add pdfParseLimiter to rateLimit.ts**

In `backend/src/middleware/rateLimit.ts`, append:

```typescript
/**
 * Rate limiter for PDF parse endpoint
 * Allows 20 requests per 15 minutes per user
 */
export const pdfParseLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many PDF parse requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});
```

- [ ] **Typecheck**

```bash
cd /d/Projekte/TravStats/backend && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Commit**

```bash
cd /d/Projekte/TravStats && git add backend/src/config/constants.ts backend/src/middleware/rateLimit.ts
git commit -m "chore: add PDF_MAX_SIZE constant and pdfParseLimiter"
```

---

## Task 3: Backend PDF parse route

**Files:**
- Create: `backend/src/routes/pdfParse.ts`
- Create: `backend/src/__tests__/pdfParse.route.test.ts`

- [ ] **Write failing route test**

Create `backend/src/__tests__/pdfParse.route.test.ts`:

```typescript
import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

// Mock auth middleware
jest.mock('../middleware/auth', () => ({
  authenticate: (req: { userId: string }, _res: unknown, next: () => void) => {
    req.userId = 'test-user-id';
    next();
  },
}));

// Mock pdfParser service
jest.mock('../services/pdfParser', () => ({
  extractTextFromPdf: jest.fn().mockResolvedValue('LH 123 FRA MUC 2026-06-01'),
  isBcbpText: jest.fn().mockReturnValue(false),
}));

// Mock bookingParser
jest.mock('../services/bookingParser', () => ({
  parseBookingText: jest.fn().mockResolvedValue({
    flights: [{ flightNumber: 'LH123', departureCode: 'FRA', arrivalCode: 'MUC', missing: [] }],
    parserUsed: 'regex',
    ollamaAvailable: false,
  }),
}));

// Mock rateLimit
jest.mock('../middleware/rateLimit', () => ({
  pdfParseLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import pdfParseRoutes from '../routes/pdfParse';

const app = express();
app.use(express.json());
app.use('/api/v1', pdfParseRoutes);

describe('POST /api/v1/parse-pdf', () => {
  it('returns 400 when no file provided', async () => {
    const res = await request(app).post('/api/v1/parse-pdf').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('returns parsed flights when PDF text is provided', async () => {
    // Send base64-encoded minimal "PDF"
    const fakePdfBase64 = Buffer.from('%PDF fake content').toString('base64');
    const res = await request(app)
      .post('/api/v1/parse-pdf')
      .send({ pdfBase64: fakePdfBase64 });
    expect(res.status).toBe(200);
    expect(res.body.flights).toBeDefined();
    expect(res.body.provider).toBeDefined();
  });
});
```

- [ ] **Run test — expect FAIL**

```bash
cd /d/Projekte/TravStats/backend && npx jest src/__tests__/pdfParse.route.test.ts --forceExit
```

Expected: FAIL — `Cannot find module '../routes/pdfParse'`

- [ ] **Implement `pdfParse.ts` route**

Create `backend/src/routes/pdfParse.ts`:

```typescript
import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { pdfParseLimiter } from '../middleware/rateLimit';
import { z } from 'zod';
import logger from '../utils/logger';
import { extractTextFromPdf, isBcbpText } from '../services/pdfParser';
import { FILE_LIMITS } from '../config/constants';

const router = Router();

const parsePdfSchema = z.object({
  pdfBase64: z
    .string()
    .min(1, 'PDF data is required')
    .max(FILE_LIMITS.PDF_MAX_SIZE * 1.4, 'PDF too large'), // base64 overhead ~1.37x
});

/**
 * POST /api/v1/parse-pdf
 * Parse a PDF file (booking confirmation or boarding pass) and extract flight data.
 *
 * Body:
 * - pdfBase64: string (required) — Base64-encoded PDF file content
 *
 * Returns:
 * - flights: ParsedBooking[]
 * - provider: string — 'regex' | 'ollama' | 'openai' | 'claude'
 * - pdfTextLength: number — number of chars extracted from PDF
 * - bcbpDetected: boolean — whether PDF contained a BCBP barcode string
 */
router.post('/parse-pdf', authenticate, pdfParseLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const { pdfBase64 } = parsePdfSchema.parse(req.body);
    const userId = req.userId!;

    const buffer = Buffer.from(pdfBase64, 'base64');

    // Extract text from PDF
    let pdfText: string;
    try {
      pdfText = await extractTextFromPdf(buffer);
    } catch (err) {
      logger.warn({ userId, error: err }, '[PDF Parse] Invalid PDF or extraction failed');
      return res.status(400).json({
        error: 'Invalid PDF',
        message: err instanceof Error ? err.message : 'Could not extract text from PDF',
      });
    }

    if (!pdfText.trim()) {
      return res.status(422).json({
        error: 'Empty PDF',
        message: 'No text could be extracted from this PDF. It may be a scanned image — use the Boarding Pass Scanner instead.',
      });
    }

    logger.info({ userId, chars: pdfText.length }, '[PDF Parse] Text extracted, parsing...');

    const bcbpDetected = isBcbpText(pdfText);

    // Route to appropriate parser
    const { parseBookingText } = await import('../services/bookingParser');
    const result = await parseBookingText(pdfText, userId);

    res.json({
      flights: result.flights,
      provider: result.parserUsed,
      pdfTextLength: pdfText.length,
      bcbpDetected,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.errors });
    }
    logger.error({ error }, '[PDF Parse] Unexpected error');
    res.status(500).json({
      error: 'PDF parsing failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
```

- [ ] **Run test — expect PASS**

```bash
cd /d/Projekte/TravStats/backend && npx jest src/__tests__/pdfParse.route.test.ts --forceExit
```

Expected: PASS

- [ ] **Typecheck**

```bash
cd /d/Projekte/TravStats/backend && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Commit**

```bash
cd /d/Projekte/TravStats && git add backend/src/routes/pdfParse.ts backend/src/__tests__/pdfParse.route.test.ts
git commit -m "feat: add POST /api/v1/parse-pdf route for PDF booking import"
```

---

## Task 4: Check `parseBookingText` export in bookingParser

**Files:**
- Modify: `backend/src/services/bookingParser.ts` (only if `parseBookingText` is not exported)

- [ ] **Check if `parseBookingText` or equivalent is exported**

```bash
grep -n "export.*parseBooking\|export.*parseText\|export.*parseEmail" /d/Projekte/TravStats/backend/src/services/bookingParser.ts | head -10
```

- [ ] **If `parseBookingText` doesn't exist, add it**

The existing `parseEmail` in `bookingParser.ts` takes `(subject, text, html?)`. For PDF we have only text (no subject/HTML). Add this minimal wrapper at the bottom of `bookingParser.ts`:

```typescript
/**
 * Parse plain text (e.g., from a PDF) as if it were an email body.
 * Subject is empty, HTML is omitted.
 */
export async function parseBookingText(text: string, userId?: string): Promise<ParseResult> {
  return parseEmail('', text, undefined, userId);
}
```

- [ ] **Typecheck**

```bash
cd /d/Projekte/TravStats/backend && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Commit (only if file was changed)**

```bash
cd /d/Projekte/TravStats && git add backend/src/services/bookingParser.ts
git commit -m "feat: export parseBookingText wrapper for non-email text parsing"
```

---

## Task 5: Register route in index.ts

**Files:**
- Modify: `backend/src/index.ts`

- [ ] **Add import and register route**

In `backend/src/index.ts`, add after the `boardingpassParseRoutes` import line:

```typescript
import pdfParseRoutes from './routes/pdfParse';
```

And in the route registration block (where `app.use('/api/v1', ...)` calls are), add:

```typescript
app.use('/api/v1', pdfParseRoutes);
```

- [ ] **Typecheck**

```bash
cd /d/Projekte/TravStats/backend && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Commit**

```bash
cd /d/Projekte/TravStats && git add backend/src/index.ts
git commit -m "chore: register pdfParse route in Express app"
```

---

## Task 6: Frontend API client

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **Write failing test**

In `frontend/src/__tests__/` (check existing test structure), add to the api tests or create `frontend/src/__tests__/api.parsePdf.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

describe('parseApi.parsePdf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends pdfBase64 and returns flights', async () => {
    mockedAxios.post = vi.fn().mockResolvedValue({
      data: {
        flights: [{ flightNumber: 'LH123', departureCode: 'FRA', arrivalCode: 'MUC', missing: [] }],
        provider: 'regex',
        pdfTextLength: 42,
        bcbpDetected: false,
      },
    });

    const { parseApi } = await import('../../lib/api');
    const result = await parseApi.parsePdf('base64encodedpdf==');

    expect(mockedAxios.post).toHaveBeenCalledWith(
      '/api/v1/parse-pdf',
      { pdfBase64: 'base64encodedpdf==' },
      expect.objectContaining({ timeout: expect.any(Number) })
    );
    expect(result.flights).toHaveLength(1);
    expect(result.provider).toBe('regex');
  });
});
```

- [ ] **Run test — expect FAIL**

```bash
cd /d/Projekte/TravStats/frontend && npx vitest run src/__tests__/api.parsePdf.test.ts
```

Expected: FAIL — `parseApi.parsePdf is not a function`

- [ ] **Add `parsePdf` to `api.ts`**

In `frontend/src/lib/api.ts`, find the `parseApi` object (near `parseBoardingpass`). Add after `parseBoardingpass`:

```typescript
parsePdf: async (pdfBase64: string): Promise<{
  flights: ParsedBooking[];
  provider: string;
  pdfTextLength: number;
  bcbpDetected: boolean;
}> => {
  const response = await axios.post(
    '/api/v1/parse-pdf',
    { pdfBase64 },
    { timeout: API_TIMEOUTS.PARSER }
  );
  return response.data;
},
```

- [ ] **Run test — expect PASS**

```bash
cd /d/Projekte/TravStats/frontend && npx vitest run src/__tests__/api.parsePdf.test.ts
```

Expected: PASS

- [ ] **Typecheck**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Commit**

```bash
cd /d/Projekte/TravStats && git add frontend/src/lib/api.ts frontend/src/__tests__/api.parsePdf.test.ts
git commit -m "feat: add parseApi.parsePdf() to frontend API client"
```

---

## Task 7: i18n strings for PDF import

**Files:**
- Modify: `frontend/src/i18n/de/flights.json`
- Modify: `frontend/src/i18n/en/flights.json`

- [ ] **Check existing structure of flights.json**

```bash
grep -n "noFlightsInEmail\|emailImport\|scanner" /d/Projekte/TravStats/frontend/src/i18n/de/flights.json | head -15
```

- [ ] **Add PDF strings to de/flights.json**

Find the section where `noFlightsInEmail` lives. Add near it (in the appropriate nested object):

```json
"pdfImport": {
  "label": "PDF",
  "dropHint": "Buchungsbestätigung oder Bordkarte als PDF hier ablegen",
  "dropHintSub": ".pdf • max. 20 MB",
  "noFlights": "Keine Flugdaten in dieser PDF gefunden.",
  "emptyPdf": "Die PDF enthält keinen lesbaren Text. Für gescannte Bordkarten nutze den Bordkarten-Scanner.",
  "parseError": "PDF konnte nicht gelesen werden."
}
```

- [ ] **Add PDF strings to en/flights.json**

Same structure:

```json
"pdfImport": {
  "label": "PDF",
  "dropHint": "Drop booking confirmation or boarding pass PDF here",
  "dropHintSub": ".pdf • max 20 MB",
  "noFlights": "No flight data found in this PDF.",
  "emptyPdf": "This PDF contains no readable text. For scanned boarding passes, use the Boarding Pass Scanner.",
  "parseError": "Could not read PDF."
}
```

- [ ] **Typecheck frontend**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Commit**

```bash
cd /d/Projekte/TravStats && git add frontend/src/i18n/de/flights.json frontend/src/i18n/en/flights.json
git commit -m "i18n: add PDF import strings for de/en"
```

---

## Task 8: Enable PDF upload in EmailImportTab

**Files:**
- Modify: `frontend/src/components/import/EmailImportTab.tsx`

- [ ] **Write failing component test**

Find the test file for EmailImportTab (check `frontend/src/__tests__/components/`) or create `frontend/src/__tests__/components/EmailImportTab.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EmailImportTab from '../../../components/import/EmailImportTab';

vi.mock('../../../lib/api', () => ({
  parseApi: {
    parsePdf: vi.fn().mockResolvedValue({
      flights: [{ flightNumber: 'LH123', departureCode: 'FRA', arrivalCode: 'MUC', missing: [] }],
      provider: 'regex',
      pdfTextLength: 100,
      bcbpDetected: false,
    }),
    parseEmailFile: vi.fn(),
    parseEmail: vi.fn(),
  },
}));

vi.mock('../../../hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'de' },
  }),
}));

describe('EmailImportTab PDF support', () => {
  it('calls parsePdf when a PDF file is dropped', async () => {
    const onResult = vi.fn();
    const onError = vi.fn();
    render(<EmailImportTab onResult={onResult} onError={onError} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const pdfFile = new File(['%PDF fake'], 'boarding.pdf', { type: 'application/pdf' });

    await userEvent.upload(input, pdfFile);

    const { parseApi } = await import('../../../lib/api');
    expect(parseApi.parsePdf).toHaveBeenCalled();
  });

  it('does NOT show "PDF not supported" error for PDF files', async () => {
    const onResult = vi.fn();
    const onError = vi.fn();
    render(<EmailImportTab onResult={onResult} onError={onError} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const pdfFile = new File(['%PDF fake'], 'booking.pdf', { type: 'application/pdf' });

    await userEvent.upload(input, pdfFile);

    expect(onError).not.toHaveBeenCalledWith(expect.stringContaining('nicht unterstützt'));
    expect(onError).not.toHaveBeenCalledWith(expect.stringContaining('not supported'));
  });
});
```

- [ ] **Run test — expect FAIL**

```bash
cd /d/Projekte/TravStats/frontend && npx vitest run src/__tests__/components/EmailImportTab.test.tsx
```

Expected: FAIL — `parsePdf is not a function` or test assertion fails

- [ ] **Modify `EmailImportTab.tsx` to handle PDFs**

In `frontend/src/components/import/EmailImportTab.tsx`, find the `handleFile` callback. Replace the PDF rejection block:

**OLD (lines ~30-37):**
```typescript
const isPdf = file.name.endsWith(".pdf");

if (isPdf) {
  onError(
    "PDF-Dateien werden direkt noch nicht unterstützt. Öffne die Email in deinem Email-Client und nutze 'Weiterleiten' oder kopiere den Text."
  );
  return;
}
```

**NEW:**
```typescript
const isPdf = file.name.toLowerCase().endsWith(".pdf");

if (isPdf) {
  setDropState("loading");
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdfBase64 = btoa(
      new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
    );
    const result = await parseApi.parsePdf(pdfBase64);
    if (result.flights.length > 0) {
      onResult(result.flights, undefined, result.provider);
    } else {
      onError(t("flights:pdfImport.noFlights"));
    }
  } catch (err) {
    logger.error("PDF parse failed", err);
    onError(t("flights:pdfImport.parseError"));
  } finally {
    setDropState("idle");
  }
  return;
}
```

Also update the `allowed` array and accept hint to include `.pdf`:

```typescript
const allowed = [".eml", ".msg", ".txt", ".pdf"];
```

- [ ] **Run test — expect PASS**

```bash
cd /d/Projekte/TravStats/frontend && npx vitest run src/__tests__/components/EmailImportTab.test.tsx
```

Expected: PASS

- [ ] **Full frontend test suite**

```bash
cd /d/Projekte/TravStats/frontend && npx vitest --run
```

Expected: All tests pass.

- [ ] **Typecheck**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Commit**

```bash
cd /d/Projekte/TravStats && git add frontend/src/components/import/EmailImportTab.tsx frontend/src/__tests__/components/EmailImportTab.test.tsx
git commit -m "feat: enable PDF upload in EmailImportTab — routes to /api/v1/parse-pdf"
```

---

## Task 9: Full build check + final verification

- [ ] **Backend: typecheck + lint + tests**

```bash
cd /d/Projekte/TravStats/backend && npx tsc --noEmit && npm run lint && npx jest --forceExit
```

Expected: All green. (Backend tests require a running PostgreSQL — skip DB tests if no DB available: `npx jest --forceExit --testPathIgnorePatterns=".prisma"`)

- [ ] **Frontend: typecheck + lint + tests**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit && npm run lint && npx vitest --run
```

Expected: All green.

- [ ] **Manual smoke test (optional, requires running dev server)**

1. Start dev server: `npm run dev` from project root
2. Log in at `http://localhost:3000`
3. Go to Import tab
4. Drag a booking confirmation PDF onto the import area
5. Verify: flights are extracted and shown in the review modal

- [ ] **Final commit if any fixes were needed**

```bash
cd /d/Projekte/TravStats && git add -p
git commit -m "fix: address issues from final build check"
```

---

## Out of Scope (Phase 3+)

- Extracting barcode *images* embedded in PDF pages (requires PDF rendering, e.g., `pdf2pic` + canvas)
- CO₂ fields, actual times, delay tracking → Phase 3
- LLM training pipeline → Phase 4
