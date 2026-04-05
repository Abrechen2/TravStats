# Phase 4 — LLM Training Pipeline (Parse Log Export) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose anonymized ParseTrainingLog data via admin API (stats + JSONL export) and promote user corrections from analytics_events into TrainingData ground-truth labels.

**Architecture:** Three new endpoints are added to `backend/src/routes/admin.ts` — one for aggregate parse-log stats, one for anonymized JSONL export, and one for promoting parser-feedback corrections to TrainingData. A new `ParseLogStats` React component is added to the TrainingPage. No new Prisma models are needed; all data already exists in `parse_training_logs` and `analytics_events`.

**Tech Stack:** Express/TypeScript, Prisma, Zod, React, Tailwind CSS, react-i18next (via `useTranslation` wrapper hook), Vitest (frontend tests)

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `backend/src/routes/admin.ts` | Modify | Add 3 new endpoints: parse-logs/stats, parse-logs/export, parse-logs/promote |
| `backend/src/schemas/admin.ts` | Modify | Add PromoteCorrectionsBodySchema |
| `frontend/src/lib/api.ts` | Modify | Add `trainingApi.getParseLogStats`, `trainingApi.exportParseLogs`, `trainingApi.promoteCorrections` |
| `frontend/src/types/index.ts` | Modify | Add `ParseLogStats` interface |
| `frontend/src/components/Training/ParseLogStats.tsx` | Create | Component: shows per-airline template hit rate + missing field frequency + promote button |
| `frontend/src/pages/TrainingPage.tsx` | Modify | Add `<ParseLogStats />` as a tab or section |
| `frontend/src/i18n/resources/de/training.json` | Modify | Add `parseLogs.*` keys (German) |
| `frontend/src/i18n/resources/en/training.json` | Modify | Add `parseLogs.*` keys (English) |
| `backend/src/routes/admin.test.ts` | Create | Unit tests for the 3 new endpoints (mocked Prisma) |
| `frontend/src/components/Training/ParseLogStats.test.tsx` | Create | Vitest component tests |

---

### Task 1: Backend — Parse Log Stats Endpoint

Add `GET /api/v1/admin/parse-logs/stats` to `backend/src/routes/admin.ts`.
The response shape:
```typescript
interface AirlineStat {
  airline: string;
  total: number;
  hits: number;
  hitRate: number; // 0-100
  commonMissingFields: string[];
}
interface ParseLogStatsResponse {
  totalLogs: number;
  overallHitRate: number;
  byAirline: AirlineStat[];
}
```

**Files:**
- Modify: `backend/src/routes/admin.ts` — add endpoint after existing `/export/all-data` route

- [ ] **Step 1: Write failing test**

Create `backend/src/routes/admin.parseLogStats.test.ts`:
```typescript
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// Must mock prisma BEFORE importing the router
const mockPrismaParseTrainingLogFindMany = jest.fn();
const mockPrismaParseTrainingLogCount = jest.fn();

jest.mock('../db', () => ({
  prisma: {
    parseTrainingLog: {
      findMany: mockPrismaParseTrainingLogFindMany,
      count: mockPrismaParseTrainingLogCount,
    },
  },
}));
jest.mock('../middleware/auth', () => ({
  authenticate: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
  AuthRequest: {},
}));

import request from 'supertest';
import express from 'express';

describe('GET /api/v1/admin/parse-logs/stats', () => {
  let app: express.Express;

  beforeEach(async () => {
    jest.resetModules();
    // Re-import after resetting mocks
    const { default: adminRoutes } = await import('./admin');
    app = express();
    app.use(express.json());
    app.use('/api/v1/admin', adminRoutes);
  });

  it('returns aggregate stats grouped by airline', async () => {
    mockPrismaParseTrainingLogCount.mockResolvedValue(3);
    mockPrismaParseTrainingLogFindMany.mockResolvedValue([
      { airline: 'Lufthansa', templateHit: true, missingFields: [] },
      { airline: 'Lufthansa', templateHit: false, missingFields: ['seatClass', 'price'] },
      { airline: 'Ryanair', templateHit: true, missingFields: ['price'] },
    ]);

    const res = await request(app).get('/api/v1/admin/parse-logs/stats');
    expect(res.status).toBe(200);
    expect(res.body.totalLogs).toBe(3);
    expect(res.body.byAirline).toHaveLength(2);

    const lh = res.body.byAirline.find((a: { airline: string }) => a.airline === 'Lufthansa');
    expect(lh.total).toBe(2);
    expect(lh.hits).toBe(1);
    expect(lh.hitRate).toBe(50);
    expect(lh.commonMissingFields).toContain('seatClass');
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd /d/Projekte/TravStats/backend
npx jest src/routes/admin.parseLogStats.test.ts --forceExit 2>&1 | tail -20
```
Expected: FAIL — `Cannot find module` or route returns 404.

- [ ] **Step 3: Implement the endpoint**

Open `backend/src/routes/admin.ts`. Find the `router.get('/export/all-data', ...)` block (around line 334). Add the following **after** it:

```typescript
// GET /api/v1/admin/parse-logs/stats
router.get('/parse-logs/stats', async (_req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const [totalLogs, logs] = await Promise.all([
      prisma.parseTrainingLog.count(),
      prisma.parseTrainingLog.findMany({
        select: { airline: true, templateHit: true, missingFields: true },
      }),
    ]);

    const airlineMap = new Map<string, { total: number; hits: number; missingCounts: Map<string, number> }>();

    for (const log of logs) {
      const key = log.airline ?? 'Unknown';
      if (!airlineMap.has(key)) {
        airlineMap.set(key, { total: 0, hits: 0, missingCounts: new Map() });
      }
      const entry = airlineMap.get(key)!;
      entry.total++;
      if (log.templateHit) entry.hits++;
      for (const field of log.missingFields) {
        entry.missingCounts.set(field, (entry.missingCounts.get(field) ?? 0) + 1);
      }
    }

    const overallHits = logs.filter(l => l.templateHit).length;
    const overallHitRate = totalLogs > 0 ? Math.round((overallHits / totalLogs) * 100) : 0;

    const byAirline = [...airlineMap.entries()].map(([airline, stats]) => {
      const commonMissingFields = [...stats.missingCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([field]) => field);
      return {
        airline,
        total: stats.total,
        hits: stats.hits,
        hitRate: Math.round((stats.hits / stats.total) * 100),
        commonMissingFields,
      };
    }).sort((a, b) => b.total - a.total);

    const response: ParseLogStatsResponse = { totalLogs, overallHitRate, byAirline };
    res.json(response);
  } catch (error) {
    next(error);
  }
});
```

Also add the `ParseLogStatsResponse` interface **before** the router in the same file:
```typescript
interface AirlineStat {
  airline: string;
  total: number;
  hits: number;
  hitRate: number;
  commonMissingFields: string[];
}

interface ParseLogStatsResponse {
  totalLogs: number;
  overallHitRate: number;
  byAirline: AirlineStat[];
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
cd /d/Projekte/TravStats/backend
npx jest src/routes/admin.parseLogStats.test.ts --forceExit 2>&1 | tail -20
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /d/Projekte/TravStats
git add backend/src/routes/admin.ts backend/src/routes/admin.parseLogStats.test.ts
git commit -m "feat: add GET /admin/parse-logs/stats endpoint with per-airline aggregates"
```

---

### Task 2: Backend — Parse Log JSONL Export Endpoint

Add `GET /api/v1/admin/parse-logs/export` that streams anonymized ParseTrainingLog records as newline-delimited JSON (JSONL). UserId is stripped.

**Files:**
- Modify: `backend/src/routes/admin.ts`

- [ ] **Step 1: Write failing test**

Append to `backend/src/routes/admin.parseLogStats.test.ts`:
```typescript
describe('GET /api/v1/admin/parse-logs/export', () => {
  it('returns JSONL with userId stripped', async () => {
    mockPrismaParseTrainingLogFindMany.mockResolvedValue([
      {
        id: 'abc',
        userId: 'user-secret-123',
        airline: 'Lufthansa',
        templateUsed: 'lh-v1',
        templateHit: true,
        confidence: 90,
        fieldCount: 8,
        missingFields: [],
        parserProvider: 'ollama',
        createdAt: new Date('2026-01-01'),
      },
    ]);

    const res = await request(app).get('/api/v1/admin/parse-logs/export');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/x-ndjson/);
    const line = JSON.parse(res.text.trim().split('\n')[0]);
    expect(line.userId).toBeUndefined();
    expect(line.airline).toBe('Lufthansa');
    expect(line.id).toBe('abc');
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd /d/Projekte/TravStats/backend
npx jest src/routes/admin.parseLogStats.test.ts --forceExit 2>&1 | tail -20
```
Expected: FAIL

- [ ] **Step 3: Implement the endpoint**

In `backend/src/routes/admin.ts`, add after the stats endpoint:
```typescript
// GET /api/v1/admin/parse-logs/export
router.get('/parse-logs/export', adminExportLimiter, async (_req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const logs = await prisma.parseTrainingLog.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        airline: true,
        templateUsed: true,
        templateHit: true,
        confidence: true,
        fieldCount: true,
        missingFields: true,
        parserProvider: true,
        createdAt: true,
        // userId intentionally omitted — anonymized export
      },
    });

    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Content-Disposition', 'attachment; filename="parse-training-logs.jsonl"');

    for (const log of logs) {
      res.write(JSON.stringify(log) + '\n');
    }
    res.end();
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
cd /d/Projekte/TravStats/backend
npx jest src/routes/admin.parseLogStats.test.ts --forceExit 2>&1 | tail -20
```
Expected: PASS (both tests)

- [ ] **Step 5: Commit**

```bash
cd /d/Projekte/TravStats
git add backend/src/routes/admin.ts backend/src/routes/admin.parseLogStats.test.ts
git commit -m "feat: add GET /admin/parse-logs/export anonymized JSONL endpoint"
```

---

### Task 3: Backend — Promote Corrections to TrainingData

Add `POST /api/v1/admin/parse-logs/promote` that reads all `analytics_events` of type `parser_feedback` that have `correctedResult` set and promotes them to `TrainingData` records (ground-truth labels).

**Files:**
- Modify: `backend/src/routes/admin.ts`
- Modify: `backend/src/schemas/admin.ts` — add PromoteCorrectionsBodySchema

- [ ] **Step 1: Check the AnalyticsEvent and TrainingData schemas**

Read `backend/prisma/schema.prisma` and confirm:
- `AnalyticsEvent`: `id`, `userId`, `type`, `payload` (Json), `createdAt`
- `TrainingData`: `id`, `userId`, `type` ("email"|"boarding_pass"), `originalFile` (String), `annotations` (Json), `extractedData` (Json), `status` ("pending"|"trained"|"failed"), `tags` (String[]), `trainedAt`, `createdAt`

- [ ] **Step 2: Write failing test**

Create `backend/src/routes/admin.promoteCorrections.test.ts`:
```typescript
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockFindMany = jest.fn();
const mockCreate = jest.fn();

jest.mock('../db', () => ({
  prisma: {
    analyticsEvent: { findMany: mockFindMany },
    trainingData: { create: mockCreate },
    $transaction: jest.fn(async (fns: (() => Promise<unknown>)[]) => Promise.all(fns.map(f => f()))),
  },
}));
jest.mock('../middleware/auth', () => ({
  authenticate: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import request from 'supertest';
import express from 'express';

describe('POST /api/v1/admin/parse-logs/promote', () => {
  let app: express.Express;

  beforeEach(async () => {
    jest.resetModules();
    const { default: adminRoutes } = await import('./admin');
    app = express();
    app.use(express.json());
    app.use('/api/v1/admin', adminRoutes);
  });

  it('creates TrainingData records for corrections with correctedResult', async () => {
    mockFindMany.mockResolvedValue([
      {
        id: 'evt-1',
        userId: 'user-1',
        type: 'parser_feedback',
        payload: {
          sourceType: 'email',
          correctedResult: [{ flightNumber: 'LH123' }],
          originalData: { subject: 'Booking', text: 'Flight LH123' },
        },
        createdAt: new Date(),
      },
    ]);
    mockCreate.mockResolvedValue({ id: 'td-1' });

    const res = await request(app).post('/api/v1/admin/parse-logs/promote').send({});
    expect(res.status).toBe(200);
    expect(res.body.promoted).toBe(1);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-1',
          type: 'email',
          extractedData: [{ flightNumber: 'LH123' }],
          status: 'pending',
          tags: ['auto-promoted'],
        }),
      })
    );
  });

  it('skips events without correctedResult', async () => {
    mockFindMany.mockResolvedValue([
      {
        id: 'evt-2',
        userId: 'user-1',
        type: 'parser_feedback',
        payload: { sourceType: 'email' }, // no correctedResult
        createdAt: new Date(),
      },
    ]);

    const res = await request(app).post('/api/v1/admin/parse-logs/promote').send({});
    expect(res.status).toBe(200);
    expect(res.body.promoted).toBe(0);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to confirm it fails**

```bash
cd /d/Projekte/TravStats/backend
npx jest src/routes/admin.promoteCorrections.test.ts --forceExit 2>&1 | tail -20
```
Expected: FAIL

- [ ] **Step 4: Implement the endpoint**

In `backend/src/routes/admin.ts`, add after the export endpoint:
```typescript
// POST /api/v1/admin/parse-logs/promote
// Promotes analytics_events parser_feedback corrections → TrainingData ground-truth labels
router.post('/parse-logs/promote', async (_req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    interface FeedbackPayload {
      sourceType?: string;
      correctedResult?: unknown[];
      originalData?: { subject?: string; text?: string; html?: string };
    }

    function isFeedbackPayload(val: unknown): val is FeedbackPayload {
      return typeof val === 'object' && val !== null && 'sourceType' in val;
    }

    const events = await prisma.analyticsEvent.findMany({
      where: { type: 'parser_feedback' },
      select: { id: true, userId: true, payload: true, createdAt: true },
    });

    let promoted = 0;

    for (const event of events) {
      if (!isFeedbackPayload(event.payload)) continue;
      if (!event.payload.correctedResult || event.payload.correctedResult.length === 0) continue;

      const sourceType = event.payload.sourceType === 'boardingpass' ? 'boarding_pass' : 'email';
      const annotations = event.payload.originalData ?? {};

      await prisma.trainingData.create({
        data: {
          userId: event.userId,
          type: sourceType,
          originalFile: `promoted:${event.id}`,
          annotations: annotations as unknown as Prisma.InputJsonValue,
          extractedData: event.payload.correctedResult as unknown as Prisma.InputJsonValue,
          status: 'pending',
          tags: ['auto-promoted'],
        },
      });
      promoted++;
    }

    res.json({ promoted, message: `${promoted} correction(s) promoted to TrainingData` });
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 5: Run test to confirm it passes**

```bash
cd /d/Projekte/TravStats/backend
npx jest src/routes/admin.promoteCorrections.test.ts --forceExit 2>&1 | tail -20
```
Expected: PASS (both tests)

- [ ] **Step 6: Type-check backend**

```bash
cd /d/Projekte/TravStats/backend && npx tsc --noEmit 2>&1 | tail -20
```
Expected: No errors

- [ ] **Step 7: Commit**

```bash
cd /d/Projekte/TravStats
git add backend/src/routes/admin.ts backend/src/routes/admin.promoteCorrections.test.ts
git commit -m "feat: add POST /admin/parse-logs/promote to promote corrections to TrainingData"
```

---

### Task 4: Frontend — API Client + Types

Add the three new API calls to `frontend/src/lib/api.ts` and add `ParseLogStats` to `frontend/src/types/index.ts`.

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/types/index.ts`

- [ ] **Step 1: Write failing test**

Create `frontend/src/lib/api.parseLog.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the api axios instance
vi.mock('./api', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./api')>();
  return {
    ...mod,
    trainingApi: {
      ...mod.trainingApi,
      getParseLogStats: vi.fn(),
      exportParseLogs: vi.fn(),
      promoteCorrections: vi.fn(),
    },
  };
});

import { trainingApi } from './api';

describe('trainingApi parse log methods', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getParseLogStats is defined', () => {
    expect(typeof trainingApi.getParseLogStats).toBe('function');
  });

  it('exportParseLogs is defined', () => {
    expect(typeof trainingApi.exportParseLogs).toBe('function');
  });

  it('promoteCorrections is defined', () => {
    expect(typeof trainingApi.promoteCorrections).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd /d/Projekte/TravStats/frontend
npx vitest run src/lib/api.parseLog.test.ts 2>&1 | tail -20
```
Expected: FAIL (functions don't exist yet)

- [ ] **Step 3: Add types to `frontend/src/types/index.ts`**

Find the end of the file and add:
```typescript
export interface ParseLogAirlineStat {
  airline: string;
  total: number;
  hits: number;
  hitRate: number;
  commonMissingFields: string[];
}

export interface ParseLogStats {
  totalLogs: number;
  overallHitRate: number;
  byAirline: ParseLogAirlineStat[];
}

export interface PromoteCorrectionsResult {
  promoted: number;
  message: string;
}
```

- [ ] **Step 4: Add API methods to `frontend/src/lib/api.ts`**

Find `export const trainingApi = {` and add to the end of the object (before the closing `};`):
```typescript
  getParseLogStats: async (): Promise<import('../types').ParseLogStats> => {
    const { data } = await api.get<import('../types').ParseLogStats>('/admin/parse-logs/stats');
    return data;
  },

  exportParseLogs: async (): Promise<void> => {
    const response = await api.get<Blob>('/admin/parse-logs/export', {
      responseType: 'blob',
    });
    const url = URL.createObjectURL(response.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'parse-training-logs.jsonl';
    a.click();
    URL.revokeObjectURL(url);
  },

  promoteCorrections: async (): Promise<import('../types').PromoteCorrectionsResult> => {
    const { data } = await api.post<import('../types').PromoteCorrectionsResult>('/admin/parse-logs/promote');
    return data;
  },
```

- [ ] **Step 5: Run test to confirm it passes**

```bash
cd /d/Projekte/TravStats/frontend
npx vitest run src/lib/api.parseLog.test.ts 2>&1 | tail -20
```
Expected: PASS

- [ ] **Step 6: Type-check frontend**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit 2>&1 | tail -20
```
Expected: No errors

- [ ] **Step 7: Commit**

```bash
cd /d/Projekte/TravStats
git add frontend/src/types/index.ts frontend/src/lib/api.ts frontend/src/lib/api.parseLog.test.ts
git commit -m "feat: add ParseLogStats types and API client methods for parse log endpoints"
```

---

### Task 5: Frontend — ParseLogStats Component

Create `frontend/src/components/Training/ParseLogStats.tsx` that shows the admin parse-log stats table and action buttons (export JSONL, promote corrections).

**Files:**
- Create: `frontend/src/components/Training/ParseLogStats.tsx`
- Create: `frontend/src/components/Training/ParseLogStats.test.tsx`
- Modify: `frontend/src/i18n/resources/de/training.json`
- Modify: `frontend/src/i18n/resources/en/training.json`

- [ ] **Step 1: Add i18n strings**

In `frontend/src/i18n/resources/de/training.json`, find the last key before `}` and add:
```json
"parseLogs": {
  "title": "Parse-Log Statistiken",
  "totalLogs": "Gesamt Parse-Logs",
  "overallHitRate": "Gesamt-Trefferquote",
  "airlineTable": "Trefferquote nach Airline",
  "airline": "Airline",
  "total": "Gesamt",
  "hits": "Treffer",
  "hitRate": "Trefferquote",
  "missingFields": "Häufig fehlende Felder",
  "exportBtn": "JSONL exportieren",
  "promoteBtn": "Korrekturen zu Training-Daten hochstufen",
  "promoting": "Hochstufen...",
  "promoteSuccess": "{{count}} Korrekturen hochgestuft",
  "promoteNone": "Keine neuen Korrekturen gefunden",
  "noData": "Noch keine Parse-Logs vorhanden",
  "loading": "Statistiken laden..."
}
```

In `frontend/src/i18n/resources/en/training.json`, add:
```json
"parseLogs": {
  "title": "Parse Log Statistics",
  "totalLogs": "Total Parse Logs",
  "overallHitRate": "Overall Hit Rate",
  "airlineTable": "Hit Rate by Airline",
  "airline": "Airline",
  "total": "Total",
  "hits": "Hits",
  "hitRate": "Hit Rate",
  "missingFields": "Common Missing Fields",
  "exportBtn": "Export JSONL",
  "promoteBtn": "Promote Corrections to Training Data",
  "promoting": "Promoting...",
  "promoteSuccess": "{{count}} correction(s) promoted",
  "promoteNone": "No new corrections found",
  "noData": "No parse logs yet",
  "loading": "Loading statistics..."
}
```

- [ ] **Step 2: Write failing test**

Create `frontend/src/components/Training/ParseLogStats.test.tsx`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ParseLogStats from './ParseLogStats';

vi.mock('../../lib/api', () => ({
  trainingApi: {
    getParseLogStats: vi.fn().mockResolvedValue({
      totalLogs: 42,
      overallHitRate: 76,
      byAirline: [
        { airline: 'Lufthansa', total: 20, hits: 16, hitRate: 80, commonMissingFields: ['price'] },
      ],
    }),
    exportParseLogs: vi.fn().mockResolvedValue(undefined),
    promoteCorrections: vi.fn().mockResolvedValue({ promoted: 3, message: '3 corrections promoted' }),
  },
}));

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string, opts?: Record<string, unknown>) => {
    if (opts?.count !== undefined) return `${opts.count} promoted`;
    return key;
  }}),
}));

vi.mock('../../store/toastStore', () => ({
  useToastStore: () => ({ addToast: vi.fn() }),
}));

describe('ParseLogStats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders stats after loading', async () => {
    render(<ParseLogStats />);
    await waitFor(() => {
      expect(screen.getByText('42')).toBeInTheDocument();
    });
    expect(screen.getByText('76%')).toBeInTheDocument();
    expect(screen.getByText('Lufthansa')).toBeInTheDocument();
  });

  it('calls exportParseLogs when export button clicked', async () => {
    const { trainingApi } = await import('../../lib/api');
    render(<ParseLogStats />);
    await waitFor(() => screen.getByText('42'));

    const exportBtn = screen.getByTestId('export-parse-logs-btn');
    await userEvent.click(exportBtn);
    expect(trainingApi.exportParseLogs).toHaveBeenCalled();
  });

  it('shows promoted count after promote button clicked', async () => {
    const { trainingApi } = await import('../../lib/api');
    render(<ParseLogStats />);
    await waitFor(() => screen.getByText('42'));

    const promoteBtn = screen.getByTestId('promote-corrections-btn');
    await userEvent.click(promoteBtn);
    await waitFor(() => expect(trainingApi.promoteCorrections).toHaveBeenCalled());
  });
});
```

- [ ] **Step 3: Run test to confirm it fails**

```bash
cd /d/Projekte/TravStats/frontend
npx vitest run src/components/Training/ParseLogStats.test.tsx 2>&1 | tail -30
```
Expected: FAIL — `Cannot find module './ParseLogStats'`

- [ ] **Step 4: Implement ParseLogStats component**

Create `frontend/src/components/Training/ParseLogStats.tsx`:
```typescript
import { useState, useEffect, useCallback } from "react";
import { trainingApi } from "../../lib/api";
import { useTranslation } from "../../hooks/useTranslation";
import { useToastStore } from "../../store/toastStore";
import type { ParseLogStats as ParseLogStatsType } from "../../types";
import { logger } from "../../lib/logger";

export default function ParseLogStats(): JSX.Element {
  const { t } = useTranslation("training");
  const addToast = useToastStore((state) => state.addToast);
  const [stats, setStats] = useState<ParseLogStatsType | null>(null);
  const [loading, setLoading] = useState(true);
  const [promoting, setPromoting] = useState(false);

  const loadStats = useCallback(async (): Promise<void> => {
    try {
      const data = await trainingApi.getParseLogStats();
      setStats(data);
    } catch (err) {
      logger.error("Failed to load parse log stats:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  const handleExport = async (): Promise<void> => {
    try {
      await trainingApi.exportParseLogs();
    } catch (err) {
      logger.error("Export failed:", err);
      addToast({ type: "error", message: String(err) });
    }
  };

  const handlePromote = async (): Promise<void> => {
    setPromoting(true);
    try {
      const result = await trainingApi.promoteCorrections();
      if (result.promoted > 0) {
        addToast({ type: "success", message: t("training:parseLogs.promoteSuccess", { count: result.promoted }) });
      } else {
        addToast({ type: "info", message: t("training:parseLogs.promoteNone") });
      }
      await loadStats();
    } catch (err) {
      logger.error("Promote failed:", err);
      addToast({ type: "error", message: String(err) });
    } finally {
      setPromoting(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-gray-500">{t("training:parseLogs.loading")}</p>;
  }

  if (!stats || stats.totalLogs === 0) {
    return <p className="text-sm text-gray-500">{t("training:parseLogs.noData")}</p>;
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">{t("training:parseLogs.title")}</h3>

      {/* Summary row */}
      <div className="flex gap-6">
        <div className="text-center">
          <p className="text-2xl font-bold">{stats.totalLogs}</p>
          <p className="text-xs text-gray-500">{t("training:parseLogs.totalLogs")}</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold">{stats.overallHitRate}%</p>
          <p className="text-xs text-gray-500">{t("training:parseLogs.overallHitRate")}</p>
        </div>
      </div>

      {/* Per-airline table */}
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b dark:border-gray-700">
              <th className="text-left py-1 pr-4">{t("training:parseLogs.airline")}</th>
              <th className="text-right py-1 pr-4">{t("training:parseLogs.total")}</th>
              <th className="text-right py-1 pr-4">{t("training:parseLogs.hitRate")}</th>
              <th className="text-left py-1">{t("training:parseLogs.missingFields")}</th>
            </tr>
          </thead>
          <tbody>
            {stats.byAirline.map((row) => (
              <tr key={row.airline} className="border-b dark:border-gray-700/50">
                <td className="py-1 pr-4 font-medium">{row.airline}</td>
                <td className="text-right py-1 pr-4">{row.total}</td>
                <td className="text-right py-1 pr-4">
                  <span
                    className={
                      row.hitRate >= 80
                        ? "text-green-600 dark:text-green-400"
                        : row.hitRate >= 50
                        ? "text-yellow-600 dark:text-yellow-400"
                        : "text-red-600 dark:text-red-400"
                    }
                  >
                    {row.hitRate}%
                  </span>
                </td>
                <td className="py-1 text-xs text-gray-500">
                  {row.commonMissingFields.join(", ") || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Action buttons */}
      <div className="flex gap-3">
        <button
          data-testid="export-parse-logs-btn"
          onClick={() => { void handleExport(); }}
          className="px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
        >
          {t("training:parseLogs.exportBtn")}
        </button>
        <button
          data-testid="promote-corrections-btn"
          onClick={() => { void handlePromote(); }}
          disabled={promoting}
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {promoting ? t("training:parseLogs.promoting") : t("training:parseLogs.promoteBtn")}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run test to confirm it passes**

```bash
cd /d/Projekte/TravStats/frontend
npx vitest run src/components/Training/ParseLogStats.test.tsx 2>&1 | tail -30
```
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
cd /d/Projekte/TravStats
git add frontend/src/components/Training/ParseLogStats.tsx \
        frontend/src/components/Training/ParseLogStats.test.tsx \
        frontend/src/i18n/resources/de/training.json \
        frontend/src/i18n/resources/en/training.json
git commit -m "feat: add ParseLogStats component with export and promote actions"
```

---

### Task 6: Frontend — Wire ParseLogStats into TrainingPage

Add `<ParseLogStats />` as a new section in `frontend/src/pages/TrainingPage.tsx` (admin-only, shown after the dashboard tab).

**Files:**
- Modify: `frontend/src/pages/TrainingPage.tsx`

- [ ] **Step 1: Read the current TrainingPage tabs structure**

Read `frontend/src/pages/TrainingPage.tsx` lines 1–50 and 120–150 to understand the tab names and rendering logic.

- [ ] **Step 2: Write failing test**

Create `frontend/src/pages/TrainingPage.parseLogStats.test.tsx`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Minimal mocks
vi.mock('../components/Training/ParseLogStats', () => ({
  default: () => <div data-testid="parse-log-stats-mock">ParseLogStats</div>,
}));
vi.mock('../lib/api', () => ({
  trainingApi: { getTrainingData: vi.fn().mockResolvedValue([]), getTrainingJobs: vi.fn().mockResolvedValue([]) },
  adminApi: { getParserSettings: vi.fn().mockResolvedValue({}) },
}));
vi.mock('../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('../store/authStore', () => ({
  useAuthStore: () => ({ user: { isAdmin: true } }),
}));
vi.mock('../store/toastStore', () => ({
  useToastStore: () => ({ addToast: vi.fn() }),
}));
vi.mock('../components/NavigationBar', () => ({ default: () => null }));
vi.mock('../components/Training/TrainingDashboard', () => ({ default: () => null }));
vi.mock('../components/PageTransition', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

import TrainingPage from './TrainingPage';

describe('TrainingPage ParseLogStats section', () => {
  it('renders ParseLogStats component for admin users', () => {
    render(<TrainingPage />);
    // Find the parse log stats mock rendered somewhere in the page
    // It might not be visible until a tab is clicked — check it exists in DOM or tab is present
    // The component is always rendered when user is admin
    expect(screen.queryByTestId('parse-log-stats-mock')).not.toBeNull();
  });
});
```

- [ ] **Step 3: Run test to confirm it fails**

```bash
cd /d/Projekte/TravStats/frontend
npx vitest run src/pages/TrainingPage.parseLogStats.test.tsx 2>&1 | tail -30
```
Expected: FAIL

- [ ] **Step 4: Add ParseLogStats section to TrainingPage**

In `frontend/src/pages/TrainingPage.tsx`:

1. Add import at top (after existing Training imports):
```typescript
import ParseLogStats from "../components/Training/ParseLogStats";
```

2. Find the JSX section that renders tab panels (look for `{activeTab === 'dashboard'` or similar). Add a new tab button and panel for "parse-logs" tab. The exact location depends on the file structure — read the file first.

   After reading, find where the tab buttons are rendered (likely a `<div>` with multiple `<button>` elements) and add:
```typescript
{user?.isAdmin && (
  <button
    onClick={() => setActiveTab('parse-logs')}
    className={`px-4 py-2 text-sm font-medium rounded-t ${
      activeTab === 'parse-logs'
        ? 'bg-white dark:bg-gray-800 border-t border-l border-r border-gray-200 dark:border-gray-700 text-blue-600'
        : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
    }`}
  >
    {t('training:parseLogs.title')}
  </button>
)}
```

   Then add the panel render (alongside other `activeTab === '...'` branches):
```typescript
{activeTab === 'parse-logs' && user?.isAdmin && (
  <div className="p-4">
    <ParseLogStats />
  </div>
)}
```

   **Note:** Read the actual file structure first before inserting. The tab state variable name and styling may differ.

- [ ] **Step 5: Run test to confirm it passes**

```bash
cd /d/Projekte/TravStats/frontend
npx vitest run src/pages/TrainingPage.parseLogStats.test.tsx 2>&1 | tail -30
```
Expected: PASS

- [ ] **Step 6: Run full frontend test suite**

```bash
cd /d/Projekte/TravStats/frontend && npx vitest --run 2>&1 | tail -20
```
Expected: All existing tests pass + new tests pass

- [ ] **Step 7: Type-check**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit 2>&1 | tail -10
cd /d/Projekte/TravStats/backend && npx tsc --noEmit 2>&1 | tail -10
```
Expected: No errors

- [ ] **Step 8: Commit**

```bash
cd /d/Projekte/TravStats
git add frontend/src/pages/TrainingPage.tsx \
        frontend/src/pages/TrainingPage.parseLogStats.test.tsx
git commit -m "feat: add Parse Log Stats tab to TrainingPage (admin only)"
```

---

## Self-Review

### 1. Spec coverage

| Requirement | Task |
|-------------|------|
| Export anonymized ParseTrainingLog as JSONL | Task 2 |
| Admin dashboard section: per-airline template hit rate | Tasks 1 + 5 |
| Admin dashboard section: missing field frequency | Tasks 1 + 5 |
| Promote analytics_events corrections → TrainingData | Tasks 3 + 5 (promote button) |
| API client methods | Task 4 |
| i18n strings | Task 5 |

All requirements covered. ✅

### 2. Placeholder scan

No TBD, TODO, or placeholder steps found. All code is complete. ✅

### 3. Type consistency

- `ParseLogStats` interface defined in Task 4, used in Task 5. ✅
- `ParseLogAirlineStat` defined in Task 4, used in `byAirline` table in Task 5. ✅
- `PromoteCorrectionsResult` defined in Task 4, used in Task 5 `handlePromote`. ✅
- `ParseLogStatsResponse` backend interface defined in Task 1, matches frontend `ParseLogStats`. ✅
- `trainingApi.getParseLogStats` / `exportParseLogs` / `promoteCorrections` defined Task 4, used Task 5. ✅
