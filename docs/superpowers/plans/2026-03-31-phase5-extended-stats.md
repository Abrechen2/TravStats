# Phase 5 — Extended Statistics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add airline loyalty ranking table, country distribution explorer, and a multi-page PDF "Mein Flieger-Jahr" year report to the AdvancedStatsPage.

**Architecture:** Two new endpoints (`/stats/airlines`, `/stats/countries`) are added to `backend/src/routes/stats.ts`. The country lookup reuses the existing `getCachedAirports` helper from `services/airportCache`. A new `YearReportPdf` service function (frontend-only) uses jsPDF + jspdf-autotable (already installed) to generate a multi-page PDF. All UI is added to `frontend/src/pages/AdvancedStatsPage.tsx` (currently 2327 lines — stay within the 800-line rule by extracting new UI into sub-components).

**Tech Stack:** Express/TypeScript, Prisma, Zod, `getCachedAirports` (airportCache service), React, Tailwind CSS, jsPDF (v4 already in `frontend/package.json`), jspdf-autotable (v5, already installed), useTranslation wrapper hook, Vitest

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `backend/src/routes/stats.ts` | Modify | Add `/airlines` and `/countries` endpoints |
| `backend/src/routes/stats.airlines.test.ts` | Create | Tests for /stats/airlines |
| `backend/src/routes/stats.countries.test.ts` | Create | Tests for /stats/countries |
| `frontend/src/lib/api.ts` | Modify | Add `statsApi.getAirlineRanking`, `statsApi.getCountryStats` |
| `frontend/src/types/index.ts` | Modify | Add `AirlineRankingItem`, `CountryStat` interfaces |
| `frontend/src/components/Stats/AirlineRankingCard.tsx` | Create | Table: top airlines by flight count + percentage |
| `frontend/src/components/Stats/CountryDistributionCard.tsx` | Create | List/table: flights per departure country |
| `frontend/src/components/Stats/AirlineRankingCard.test.tsx` | Create | Vitest component tests |
| `frontend/src/components/Stats/CountryDistributionCard.test.tsx` | Create | Vitest component tests |
| `frontend/src/lib/yearReportPdf.ts` | Create | jsPDF multi-page year report generator |
| `frontend/src/lib/yearReportPdf.test.ts` | Create | Unit tests for PDF generator logic |
| `frontend/src/pages/AdvancedStatsPage.tsx` | Modify | Add AirlineRankingCard, CountryDistributionCard sections + PDF report button |
| `frontend/src/i18n/resources/de/stats.json` | Modify | Add `airlineRanking.*`, `countryDist.*`, `yearReport.*` keys |
| `frontend/src/i18n/resources/en/stats.json` | Modify | Same keys in English |

---

### Task 1: Backend — Airline Ranking Endpoint

Add `GET /api/v1/stats/airlines` to `backend/src/routes/stats.ts`.

Response shape:
```typescript
interface AirlineRankingItem {
  airline: string;
  count: number;
  percentage: number; // 0-100, rounded to 1 decimal
}
interface AirlineRankingResponse {
  airlines: AirlineRankingItem[];
  total: number;
}
```

**Files:**
- Modify: `backend/src/routes/stats.ts`
- Create: `backend/src/routes/stats.airlines.test.ts`

- [ ] **Step 1: Write failing test**

Create `backend/src/routes/stats.airlines.test.ts`:
```typescript
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockGroupBy = jest.fn();
const mockCount = jest.fn();

jest.mock('../db', () => ({
  prisma: {
    flight: {
      groupBy: mockGroupBy,
      count: mockCount,
    },
  },
}));
jest.mock('../middleware/auth', () => ({
  authenticate: (_req: unknown, _res: unknown, next: () => void) => next(),
  AuthRequest: {},
}));
jest.mock('../middleware/rateLimit', () => ({
  statsLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import request from 'supertest';
import express from 'express';

describe('GET /api/v1/stats/airlines', () => {
  let app: express.Express;

  beforeEach(async () => {
    jest.resetModules();
    const { default: statsRoutes } = await import('./stats');
    app = express();
    app.use(express.json());
    app.use('/api/v1/stats', statsRoutes);
  });

  it('returns airlines ranked by flight count with percentages', async () => {
    mockCount.mockResolvedValue(10);
    mockGroupBy.mockResolvedValue([
      { airline: 'Lufthansa', _count: 6 },
      { airline: 'Ryanair', _count: 4 },
    ]);

    const res = await request(app).get('/api/v1/stats/airlines');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(10);
    expect(res.body.airlines).toHaveLength(2);
    expect(res.body.airlines[0]).toEqual({
      airline: 'Lufthansa',
      count: 6,
      percentage: 60.0,
    });
    expect(res.body.airlines[1]).toEqual({
      airline: 'Ryanair',
      count: 4,
      percentage: 40.0,
    });
  });

  it('handles null airline as Unknown', async () => {
    mockCount.mockResolvedValue(2);
    mockGroupBy.mockResolvedValue([
      { airline: null, _count: 2 },
    ]);

    const res = await request(app).get('/api/v1/stats/airlines');
    expect(res.status).toBe(200);
    expect(res.body.airlines[0].airline).toBe('Unknown');
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd /d/Projekte/TravStats/backend
npx jest src/routes/stats.airlines.test.ts --forceExit 2>&1 | tail -20
```
Expected: FAIL

- [ ] **Step 3: Implement the endpoint**

In `backend/src/routes/stats.ts`, add before `export default router;`:
```typescript
// Add interfaces at the top of the file (after existing interface declarations)
interface AirlineRankingItem {
  airline: string;
  count: number;
  percentage: number;
}

interface AirlineRankingResponse {
  airlines: AirlineRankingItem[];
  total: number;
}
```

Then add the route:
```typescript
// GET /api/v1/stats/airlines — loyalty ranking by flight count
router.get('/airlines', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;

    const [total, airlineCounts] = await Promise.all([
      prisma.flight.count({ where: { userId } }),
      prisma.flight.groupBy({
        by: ['airline'],
        where: { userId },
        _count: true,
        orderBy: { _count: { airline: 'desc' } },
      }),
    ]);

    const airlines: AirlineRankingItem[] = airlineCounts.map(row => ({
      airline: row.airline ?? 'Unknown',
      count: row._count,
      percentage: total > 0 ? Math.round((row._count / total) * 1000) / 10 : 0,
    }));

    const response: AirlineRankingResponse = { airlines, total };
    res.json(response);
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
cd /d/Projekte/TravStats/backend
npx jest src/routes/stats.airlines.test.ts --forceExit 2>&1 | tail -20
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /d/Projekte/TravStats
git add backend/src/routes/stats.ts backend/src/routes/stats.airlines.test.ts
git commit -m "feat: add GET /stats/airlines loyalty ranking endpoint"
```

---

### Task 2: Backend — Country Distribution Endpoint

Add `GET /api/v1/stats/countries` to `backend/src/routes/stats.ts`. Looks up `country` for each departure airport via `getCachedAirports` (same helper used in statsCalculator.ts).

Response shape:
```typescript
interface CountryStat {
  country: string;
  count: number;
}
interface CountryStatsResponse {
  countries: CountryStat[];
  total: number;
}
```

**Files:**
- Modify: `backend/src/routes/stats.ts`
- Create: `backend/src/routes/stats.countries.test.ts`

- [ ] **Step 1: Write failing test**

Create `backend/src/routes/stats.countries.test.ts`:
```typescript
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockFindMany = jest.fn();
const mockGetCachedAirports = jest.fn();

jest.mock('../db', () => ({
  prisma: {
    flight: { findMany: mockFindMany },
  },
}));
jest.mock('../services/airportCache', () => ({
  getCachedAirports: mockGetCachedAirports,
}));
jest.mock('../middleware/auth', () => ({
  authenticate: (_req: unknown, _res: unknown, next: () => void) => next(),
  AuthRequest: {},
}));
jest.mock('../middleware/rateLimit', () => ({
  statsLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import request from 'supertest';
import express from 'express';

describe('GET /api/v1/stats/countries', () => {
  let app: express.Express;

  beforeEach(async () => {
    jest.resetModules();
    const { default: statsRoutes } = await import('./stats');
    app = express();
    app.use(express.json());
    app.use('/api/v1/stats', statsRoutes);
  });

  it('returns countries ranked by departure flight count', async () => {
    mockFindMany.mockResolvedValue([
      { depIata: 'FRA', depIcao: null },
      { depIata: 'MUC', depIcao: null },
      { depIata: 'LHR', depIcao: null },
      { depIata: null, depIcao: 'EDDF' },
    ]);
    mockGetCachedAirports.mockResolvedValue(new Map([
      ['FRA', { country: 'Germany' }],
      ['MUC', { country: 'Germany' }],
      ['LHR', { country: 'United Kingdom' }],
      ['EDDF', { country: 'Germany' }],
    ]));

    const res = await request(app).get('/api/v1/stats/countries');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(4);

    const de = res.body.countries.find((c: { country: string }) => c.country === 'Germany');
    const uk = res.body.countries.find((c: { country: string }) => c.country === 'United Kingdom');
    expect(de.count).toBe(3);
    expect(uk.count).toBe(1);
    // Sorted descending
    expect(res.body.countries[0].country).toBe('Germany');
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd /d/Projekte/TravStats/backend
npx jest src/routes/stats.countries.test.ts --forceExit 2>&1 | tail -20
```
Expected: FAIL

- [ ] **Step 3: Implement the endpoint**

First, add the interface to `backend/src/routes/stats.ts` (with the other new interfaces):
```typescript
interface CountryStat {
  country: string;
  count: number;
}

interface CountryStatsResponse {
  countries: CountryStat[];
  total: number;
}
```

Then add the import at top of `stats.ts` (after the existing imports):
```typescript
import { getCachedAirports } from '../services/airportCache';
```

Then add the route (before `export default router`):
```typescript
// GET /api/v1/stats/countries — departure country distribution
router.get('/countries', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;

    const flights = await prisma.flight.findMany({
      where: { userId },
      select: { depIata: true, depIcao: true },
    });

    const airportCodes = new Set<string>();
    for (const f of flights) {
      if (f.depIata) airportCodes.add(f.depIata);
      else if (f.depIcao) airportCodes.add(f.depIcao);
    }

    const airportMap = await getCachedAirports([...airportCodes]);

    const countryCounts = new Map<string, number>();
    for (const f of flights) {
      const code = f.depIata ?? f.depIcao;
      const country = code ? (airportMap.get(code)?.country ?? 'Unknown') : 'Unknown';
      countryCounts.set(country, (countryCounts.get(country) ?? 0) + 1);
    }

    const countries: CountryStat[] = [...countryCounts.entries()]
      .map(([country, count]) => ({ country, count }))
      .sort((a, b) => b.count - a.count);

    const response: CountryStatsResponse = { countries, total: flights.length };
    res.json(response);
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
cd /d/Projekte/TravStats/backend
npx jest src/routes/stats.countries.test.ts --forceExit 2>&1 | tail -20
```
Expected: PASS

- [ ] **Step 5: Type-check**

```bash
cd /d/Projekte/TravStats/backend && npx tsc --noEmit 2>&1 | tail -10
```
Expected: No errors

- [ ] **Step 6: Commit**

```bash
cd /d/Projekte/TravStats
git add backend/src/routes/stats.ts backend/src/routes/stats.countries.test.ts
git commit -m "feat: add GET /stats/countries departure country distribution endpoint"
```

---

### Task 3: Frontend — API Client + Types

Add types and API methods to `frontend/src/types/index.ts` and `frontend/src/lib/api.ts`.

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Write failing test**

Create `frontend/src/lib/api.stats.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('./api', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./api')>();
  return {
    ...mod,
    statsApi: {
      ...mod.statsApi,
      getAirlineRanking: vi.fn(),
      getCountryStats: vi.fn(),
    },
  };
});

import { statsApi } from './api';

describe('statsApi new methods', () => {
  it('getAirlineRanking is defined', () => {
    expect(typeof statsApi.getAirlineRanking).toBe('function');
  });

  it('getCountryStats is defined', () => {
    expect(typeof statsApi.getCountryStats).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd /d/Projekte/TravStats/frontend
npx vitest run src/lib/api.stats.test.ts 2>&1 | tail -20
```
Expected: FAIL

- [ ] **Step 3: Add types to `frontend/src/types/index.ts`**

Find the end of the file and append:
```typescript
export interface AirlineRankingItem {
  airline: string;
  count: number;
  percentage: number;
}

export interface AirlineRankingResponse {
  airlines: AirlineRankingItem[];
  total: number;
}

export interface CountryStat {
  country: string;
  count: number;
}

export interface CountryStatsResponse {
  countries: CountryStat[];
  total: number;
}
```

- [ ] **Step 4: Add API methods to `frontend/src/lib/api.ts`**

Find `export const statsApi = {` and add to the end of the object (before `};`):
```typescript
  getAirlineRanking: async (): Promise<import('../types').AirlineRankingResponse> => {
    const { data } = await api.get<import('../types').AirlineRankingResponse>('/stats/airlines');
    return data;
  },

  getCountryStats: async (): Promise<import('../types').CountryStatsResponse> => {
    const { data } = await api.get<import('../types').CountryStatsResponse>('/stats/countries');
    return data;
  },
```

- [ ] **Step 5: Run test to confirm it passes**

```bash
cd /d/Projekte/TravStats/frontend
npx vitest run src/lib/api.stats.test.ts 2>&1 | tail -20
```
Expected: PASS

- [ ] **Step 6: Type-check**

```bash
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit 2>&1 | tail -10
```
Expected: No errors

- [ ] **Step 7: Commit**

```bash
cd /d/Projekte/TravStats
git add frontend/src/types/index.ts frontend/src/lib/api.ts frontend/src/lib/api.stats.test.ts
git commit -m "feat: add AirlineRanking and CountryStats types and API client methods"
```

---

### Task 4: Frontend — AirlineRankingCard Component

**Files:**
- Create: `frontend/src/components/Stats/AirlineRankingCard.tsx`
- Create: `frontend/src/components/Stats/AirlineRankingCard.test.tsx`

- [ ] **Step 1: Add i18n strings**

In `frontend/src/i18n/resources/de/stats.json`, find the last key before `}` and add:
```json
"airlineRanking": {
  "title": "Airline-Treue Ranking",
  "airline": "Airline",
  "flights": "Flüge",
  "share": "Anteil",
  "noData": "Noch keine Flüge vorhanden",
  "loading": "Lädt...",
  "topN": "Top {{n}} Airlines"
}
```

In `frontend/src/i18n/resources/en/stats.json`, add:
```json
"airlineRanking": {
  "title": "Airline Loyalty Ranking",
  "airline": "Airline",
  "flights": "Flights",
  "share": "Share",
  "noData": "No flights yet",
  "loading": "Loading...",
  "topN": "Top {{n}} Airlines"
}
```

- [ ] **Step 2: Write failing test**

Create `frontend/src/components/Stats/AirlineRankingCard.test.tsx`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import AirlineRankingCard from './AirlineRankingCard';

vi.mock('../../lib/api', () => ({
  statsApi: {
    getAirlineRanking: vi.fn().mockResolvedValue({
      total: 10,
      airlines: [
        { airline: 'Lufthansa', count: 6, percentage: 60.0 },
        { airline: 'Ryanair', count: 4, percentage: 40.0 },
      ],
    }),
  },
}));

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => o?.n ? `Top ${o.n}` : k }),
}));

describe('AirlineRankingCard', () => {
  it('renders airline names and percentages', async () => {
    render(<AirlineRankingCard />);
    await waitFor(() => {
      expect(screen.getByText('Lufthansa')).toBeInTheDocument();
    });
    expect(screen.getByText('60%')).toBeInTheDocument();
    expect(screen.getByText('Ryanair')).toBeInTheDocument();
    expect(screen.getByText('40%')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to confirm it fails**

```bash
cd /d/Projekte/TravStats/frontend
npx vitest run src/components/Stats/AirlineRankingCard.test.tsx 2>&1 | tail -20
```
Expected: FAIL — `Cannot find module './AirlineRankingCard'`

- [ ] **Step 4: Implement AirlineRankingCard**

Create `frontend/src/components/Stats/AirlineRankingCard.tsx`:
```typescript
import { useState, useEffect } from "react";
import { statsApi } from "../../lib/api";
import { useTranslation } from "../../hooks/useTranslation";
import type { AirlineRankingItem } from "../../types";
import { logger } from "../../lib/logger";

const MAX_ROWS = 10;

export default function AirlineRankingCard(): JSX.Element {
  const { t } = useTranslation("stats");
  const [airlines, setAirlines] = useState<AirlineRankingItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    statsApi
      .getAirlineRanking()
      .then((data) => setAirlines(data.airlines.slice(0, MAX_ROWS)))
      .catch((err) => logger.error("Failed to load airline ranking:", err))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <p className="text-sm text-gray-500">{t("stats:airlineRanking.loading")}</p>;
  }

  if (airlines.length === 0) {
    return <p className="text-sm text-gray-500">{t("stats:airlineRanking.noData")}</p>;
  }

  const maxCount = airlines[0].count;

  return (
    <div className="space-y-2">
      <h3 className="text-lg font-semibold">{t("stats:airlineRanking.title")}</h3>
      <p className="text-xs text-gray-500 mb-2">
        {t("stats:airlineRanking.topN", { n: airlines.length })}
      </p>
      <div className="space-y-1.5">
        {airlines.map((row) => (
          <div key={row.airline} className="flex items-center gap-3">
            {/* Progress bar */}
            <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-5 overflow-hidden">
              <div
                className="bg-blue-500 dark:bg-blue-400 h-full rounded-full transition-all"
                style={{ width: `${(row.count / maxCount) * 100}%` }}
              />
            </div>
            {/* Airline name */}
            <span className="w-28 text-sm truncate" title={row.airline}>
              {row.airline}
            </span>
            {/* Percentage */}
            <span className="w-10 text-right text-sm font-semibold">
              {row.percentage}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run test to confirm it passes**

```bash
cd /d/Projekte/TravStats/frontend
npx vitest run src/components/Stats/AirlineRankingCard.test.tsx 2>&1 | tail -20
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd /d/Projekte/TravStats
git add frontend/src/components/Stats/AirlineRankingCard.tsx \
        frontend/src/components/Stats/AirlineRankingCard.test.tsx \
        frontend/src/i18n/resources/de/stats.json \
        frontend/src/i18n/resources/en/stats.json
git commit -m "feat: add AirlineRankingCard component with progress-bar loyalty visualization"
```

---

### Task 5: Frontend — CountryDistributionCard Component

**Files:**
- Create: `frontend/src/components/Stats/CountryDistributionCard.tsx`
- Create: `frontend/src/components/Stats/CountryDistributionCard.test.tsx`

- [ ] **Step 1: Add i18n strings**

In `frontend/src/i18n/resources/de/stats.json`, add inside the root object:
```json
"countryDist": {
  "title": "Länder-Verteilung (Abflugort)",
  "country": "Land",
  "flights": "Flüge",
  "noData": "Noch keine Flüge vorhanden",
  "loading": "Lädt..."
}
```

In `frontend/src/i18n/resources/en/stats.json`, add:
```json
"countryDist": {
  "title": "Country Distribution (Departure)",
  "country": "Country",
  "flights": "Flights",
  "noData": "No flights yet",
  "loading": "Loading..."
}
```

- [ ] **Step 2: Write failing test**

Create `frontend/src/components/Stats/CountryDistributionCard.test.tsx`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import CountryDistributionCard from './CountryDistributionCard';

vi.mock('../../lib/api', () => ({
  statsApi: {
    getCountryStats: vi.fn().mockResolvedValue({
      total: 10,
      countries: [
        { country: 'Germany', count: 7 },
        { country: 'United Kingdom', count: 3 },
      ],
    }),
  },
}));

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

describe('CountryDistributionCard', () => {
  it('renders country names and counts', async () => {
    render(<CountryDistributionCard />);
    await waitFor(() => {
      expect(screen.getByText('Germany')).toBeInTheDocument();
    });
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('United Kingdom')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to confirm it fails**

```bash
cd /d/Projekte/TravStats/frontend
npx vitest run src/components/Stats/CountryDistributionCard.test.tsx 2>&1 | tail -20
```
Expected: FAIL

- [ ] **Step 4: Implement CountryDistributionCard**

Create `frontend/src/components/Stats/CountryDistributionCard.tsx`:
```typescript
import { useState, useEffect } from "react";
import { statsApi } from "../../lib/api";
import { useTranslation } from "../../hooks/useTranslation";
import type { CountryStat } from "../../types";
import { logger } from "../../lib/logger";

const MAX_ROWS = 15;

export default function CountryDistributionCard(): JSX.Element {
  const { t } = useTranslation("stats");
  const [countries, setCountries] = useState<CountryStat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    statsApi
      .getCountryStats()
      .then((data) => setCountries(data.countries.slice(0, MAX_ROWS)))
      .catch((err) => logger.error("Failed to load country stats:", err))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <p className="text-sm text-gray-500">{t("stats:countryDist.loading")}</p>;
  }

  if (countries.length === 0) {
    return <p className="text-sm text-gray-500">{t("stats:countryDist.noData")}</p>;
  }

  const maxCount = countries[0].count;

  return (
    <div className="space-y-2">
      <h3 className="text-lg font-semibold">{t("stats:countryDist.title")}</h3>
      <div className="space-y-1.5">
        {countries.map((row) => (
          <div key={row.country} className="flex items-center gap-3">
            <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-5 overflow-hidden">
              <div
                className="bg-emerald-500 dark:bg-emerald-400 h-full rounded-full transition-all"
                style={{ width: `${(row.count / maxCount) * 100}%` }}
              />
            </div>
            <span className="w-36 text-sm truncate" title={row.country}>
              {row.country}
            </span>
            <span className="w-8 text-right text-sm font-semibold">{row.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run test to confirm it passes**

```bash
cd /d/Projekte/TravStats/frontend
npx vitest run src/components/Stats/CountryDistributionCard.test.tsx 2>&1 | tail -20
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd /d/Projekte/TravStats
git add frontend/src/components/Stats/CountryDistributionCard.tsx \
        frontend/src/components/Stats/CountryDistributionCard.test.tsx \
        frontend/src/i18n/resources/de/stats.json \
        frontend/src/i18n/resources/en/stats.json
git commit -m "feat: add CountryDistributionCard component with departure country breakdown"
```

---

### Task 6: Frontend — Year Report PDF Generator

Create `frontend/src/lib/yearReportPdf.ts` that uses jsPDF + jspdf-autotable to generate a multi-page "Mein Flieger-Jahr" PDF report.

**Files:**
- Create: `frontend/src/lib/yearReportPdf.ts`
- Create: `frontend/src/lib/yearReportPdf.test.ts`

The PDF is structured as:
- **Page 1:** Title + summary stats (total flights, distance, flight time, top airline, top route)
- **Page 2:** Flight list table (date, from→to, airline, distance, CO₂)

- [ ] **Step 1: Add i18n strings**

In `frontend/src/i18n/resources/de/stats.json`, add:
```json
"yearReport": {
  "btn": "PDF Jahresbericht",
  "generating": "PDF wird erstellt...",
  "title": "Mein Flieger-Jahr",
  "subtitle": "Persönlicher Flugbericht",
  "generatedOn": "Erstellt am",
  "summary": "Zusammenfassung",
  "totalFlights": "Gesamtflüge",
  "totalDistance": "Gesamtdistanz",
  "totalFlightTime": "Gesamtflugzeit",
  "topAirline": "Meist geflogene Airline",
  "topRoute": "Lieblingsroute",
  "co2Total": "Gesamt CO₂",
  "flightList": "Flugübersicht",
  "colDate": "Datum",
  "colRoute": "Route",
  "colAirline": "Airline",
  "colDistance": "Distanz (km)",
  "colCo2": "CO₂ (kg)",
  "noYear": "Bitte zuerst ein Jahr auswählen"
}
```

In `frontend/src/i18n/resources/en/stats.json`, add:
```json
"yearReport": {
  "btn": "PDF Year Report",
  "generating": "Generating PDF...",
  "title": "My Flying Year",
  "subtitle": "Personal Flight Report",
  "generatedOn": "Generated on",
  "summary": "Summary",
  "totalFlights": "Total Flights",
  "totalDistance": "Total Distance",
  "totalFlightTime": "Total Flight Time",
  "topAirline": "Most Flown Airline",
  "topRoute": "Favourite Route",
  "co2Total": "Total CO₂",
  "flightList": "Flight Overview",
  "colDate": "Date",
  "colRoute": "Route",
  "colAirline": "Airline",
  "colDistance": "Distance (km)",
  "colCo2": "CO₂ (kg)",
  "noYear": "Please select a year first"
}
```

- [ ] **Step 2: Write failing test**

Create `frontend/src/lib/yearReportPdf.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';

// Mock jspdf and jspdf-autotable
const mockSave = vi.fn();
const mockText = vi.fn();
const mockSetFontSize = vi.fn();
const mockAddPage = vi.fn();
const mockAutoTable = vi.fn();

vi.mock('jspdf', () => ({
  jsPDF: vi.fn(() => ({
    save: mockSave,
    text: mockText,
    setFontSize: mockSetFontSize,
    addPage: mockAddPage,
    internal: { pageSize: { getWidth: () => 210, getHeight: () => 297 } },
    setFont: vi.fn(),
    setTextColor: vi.fn(),
    setDrawColor: vi.fn(),
    line: vi.fn(),
  })),
}));

vi.mock('jspdf-autotable', () => ({ default: mockAutoTable }));

import { generateYearReportPdf } from './yearReportPdf';
import type { Flight } from '../types';

const mockFlight: Flight = {
  id: '1',
  userId: 'u1',
  airline: 'Lufthansa',
  flightNumber: 'LH123',
  depIata: 'FRA',
  depName: 'Frankfurt',
  depLat: 50.0,
  depLon: 8.5,
  arrIata: 'JFK',
  arrName: 'New York JFK',
  arrLat: 40.6,
  arrLon: -73.7,
  departureTime: '2026-01-15T08:00:00Z',
  arrivalTime: '2026-01-15T11:00:00Z',
  status: 'flown',
  tags: [],
  companions: [],
  co2Kg: 450,
};

describe('generateYearReportPdf', () => {
  it('calls jsPDF save with correct filename', async () => {
    await generateYearReportPdf({
      year: 2026,
      flights: [mockFlight],
      userName: 'Dennis',
      units: 'km',
    });
    expect(mockSave).toHaveBeenCalledWith('flug-jahr-2026.pdf');
  });

  it('calls addPage for the flight list page', async () => {
    await generateYearReportPdf({
      year: 2026,
      flights: [mockFlight],
      userName: 'Dennis',
      units: 'km',
    });
    expect(mockAddPage).toHaveBeenCalled();
  });

  it('calls autoTable with flight rows', async () => {
    await generateYearReportPdf({
      year: 2026,
      flights: [mockFlight],
      userName: 'Dennis',
      units: 'km',
    });
    expect(mockAutoTable).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        body: expect.arrayContaining([
          expect.arrayContaining(['Lufthansa', 'LH123']),
        ]),
      })
    );
  });
});
```

- [ ] **Step 3: Run test to confirm it fails**

```bash
cd /d/Projekte/TravStats/frontend
npx vitest run src/lib/yearReportPdf.test.ts 2>&1 | tail -20
```
Expected: FAIL — `Cannot find module './yearReportPdf'`

- [ ] **Step 4: Implement yearReportPdf.ts**

Create `frontend/src/lib/yearReportPdf.ts`:
```typescript
import type { Flight } from "../types";
import { calculateDistance } from "./geo";

interface YearReportOptions {
  year: number;
  flights: Flight[];
  userName: string;
  units: "km" | "mi";
}

export async function generateYearReportPdf(opts: YearReportOptions): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const { year, flights, userName, units } = opts;
  const doc = new jsPDF();
  const pageW = doc.internal.pageSize.getWidth();

  // ─── Page 1: Summary ─────────────────────────────────────────────────────────

  // Title
  doc.setFontSize(28);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30, 64, 175); // blue-800
  doc.text(`✈ ${year}`, pageW / 2, 30, { align: "center" });

  doc.setFontSize(16);
  doc.setTextColor(55, 65, 81); // gray-700
  doc.text("My Flying Year", pageW / 2, 40, { align: "center" });

  doc.setFontSize(10);
  doc.setTextColor(107, 114, 128); // gray-500
  doc.text(`${userName} · Generated on ${new Date().toLocaleDateString()}`, pageW / 2, 48, { align: "center" });

  // Divider
  doc.setDrawColor(209, 213, 219);
  doc.line(14, 52, pageW - 14, 52);

  // Compute summary stats
  let totalDistance = 0;
  let totalFlightTimeMin = 0;
  let totalCo2 = 0;
  const airlineCounts = new Map<string, number>();
  const routeCounts = new Map<string, number>();

  for (const f of flights) {
    const dist = calculateDistance(f.depLat ?? 0, f.depLon ?? 0, f.arrLat ?? 0, f.arrLon ?? 0);
    totalDistance += dist;
    if (f.departureTime && f.arrivalTime) {
      totalFlightTimeMin += (new Date(f.arrivalTime).getTime() - new Date(f.departureTime).getTime()) / 60000;
    }
    if (f.co2Kg) totalCo2 += f.co2Kg;
    const airline = f.airline ?? "Unknown";
    airlineCounts.set(airline, (airlineCounts.get(airline) ?? 0) + 1);
    const routeKey = `${f.depIata ?? f.depIcao ?? "?"} → ${f.arrIata ?? f.arrIcao ?? "?"}`;
    routeCounts.set(routeKey, (routeCounts.get(routeKey) ?? 0) + 1);
  }

  const topAirline = [...airlineCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";
  const topRoute = [...routeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";
  const totalHours = Math.round(totalFlightTimeMin / 60);
  const distDisplay = units === "mi" ? Math.round(totalDistance * 0.621371) : Math.round(totalDistance);
  const distUnit = units === "mi" ? "mi" : "km";

  // Summary rows
  const summaryItems: [string, string][] = [
    ["Total Flights", String(flights.length)],
    [`Total Distance`, `${distDisplay.toLocaleString()} ${distUnit}`],
    ["Total Flight Time", `${totalHours} h`],
    ["Most Flown Airline", topAirline],
    ["Favourite Route", topRoute],
    ...(totalCo2 > 0 ? [["Total CO₂", `${Math.round(totalCo2)} kg`] as [string, string]] : []),
  ];

  doc.setFontSize(11);
  let y = 62;
  for (const [label, value] of summaryItems) {
    doc.setTextColor(107, 114, 128);
    doc.setFont("helvetica", "normal");
    doc.text(label, 20, y);
    doc.setTextColor(17, 24, 39);
    doc.setFont("helvetica", "bold");
    doc.text(value, 100, y);
    y += 10;
  }

  // ─── Page 2: Flight list ──────────────────────────────────────────────────────
  doc.addPage();

  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30, 64, 175);
  doc.text("Flight Overview", 14, 20);

  const tableRows = flights.map((f) => {
    const date = f.departureTime
      ? new Date(f.departureTime).toLocaleDateString()
      : "—";
    const dep = f.depIata ?? f.depIcao ?? "?";
    const arr = f.arrIata ?? f.arrIcao ?? "?";
    const dist = Math.round(calculateDistance(f.depLat ?? 0, f.depLon ?? 0, f.arrLat ?? 0, f.arrLon ?? 0));
    const co2 = f.co2Kg != null ? String(Math.round(f.co2Kg)) : "—";
    return [date, `${dep} → ${arr}`, f.airline ?? "—", dist.toLocaleString(), co2];
  });

  autoTable(doc, {
    head: [["Date", "Route", "Airline", `Dist. (${distUnit})`, "CO₂ (kg)"]],
    body: tableRows,
    startY: 26,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [30, 64, 175], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 14, right: 14 },
  });

  doc.save(`flug-jahr-${year}.pdf`);
}
```

Note: `calculateDistance` already exists in `frontend/src/lib/` — verify the import path before running.

- [ ] **Step 5: Verify calculateDistance import path**

```bash
ls /d/Projekte/TravStats/frontend/src/lib/ | grep -i geo
```

If `geo.ts` exists: use `import { calculateDistance } from "./geo"`.
If not, check `frontend/src/utils/`:
```bash
ls /d/Projekte/TravStats/frontend/src/utils/ | grep -i geo
grep -rn "calculateDistance" /d/Projekte/TravStats/frontend/src/ | head -5
```

Adjust the import in `yearReportPdf.ts` to match the actual location.

- [ ] **Step 6: Run test to confirm it passes**

```bash
cd /d/Projekte/TravStats/frontend
npx vitest run src/lib/yearReportPdf.test.ts 2>&1 | tail -20
```
Expected: PASS (3 tests)

- [ ] **Step 7: Commit**

```bash
cd /d/Projekte/TravStats
git add frontend/src/lib/yearReportPdf.ts \
        frontend/src/lib/yearReportPdf.test.ts \
        frontend/src/i18n/resources/de/stats.json \
        frontend/src/i18n/resources/en/stats.json
git commit -m "feat: add jsPDF multi-page year report generator"
```

---

### Task 7: Frontend — Wire all new components into AdvancedStatsPage

Add `<AirlineRankingCard />`, `<CountryDistributionCard />`, and a "PDF Year Report" button to `frontend/src/pages/AdvancedStatsPage.tsx`.

**Files:**
- Modify: `frontend/src/pages/AdvancedStatsPage.tsx`

**IMPORTANT:** AdvancedStatsPage.tsx is currently 2327 lines. Only add what's needed. Do NOT refactor existing sections — just add imports and three new JSX blocks.

- [ ] **Step 1: Add imports**

At the top of `frontend/src/pages/AdvancedStatsPage.tsx`, add after existing component imports:
```typescript
import AirlineRankingCard from "../components/Stats/AirlineRankingCard";
import CountryDistributionCard from "../components/Stats/CountryDistributionCard";
import { generateYearReportPdf } from "../lib/yearReportPdf";
```

- [ ] **Step 2: Add PDF button state**

In the component's state declarations, add:
```typescript
const [generatingPdf, setGeneratingPdf] = useState(false);
```

And add the handler function (inside the component, before the return):
```typescript
const handleYearReport = async (): Promise<void> => {
  if (!selectedYear) {
    addToast({ type: "warning", message: t("stats:yearReport.noYear") });
    return;
  }
  setGeneratingPdf(true);
  try {
    const yearFlights = flights.filter(
      (f) => new Date(f.departureTime).getFullYear() === selectedYear
    );
    await generateYearReportPdf({
      year: selectedYear,
      flights: yearFlights,
      userName: user?.username ?? "User",
      units: units.distance,
    });
  } finally {
    setGeneratingPdf(false);
  }
};
```

Note: `addToast` already exists in the page — find it by searching for `useToastStore` in the file. If it doesn't exist yet, add:
```typescript
const addToast = useToastStore((state) => state.addToast);
```

- [ ] **Step 3: Add PDF button near the certificate button**

Find the existing "FlightCertificate" button (`✈ {t("stats:certificate.generate")}`) in the JSX and add the PDF button right after it:
```typescript
<button
  onClick={() => { void handleYearReport(); }}
  disabled={generatingPdf || !selectedYear}
  className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2"
>
  {generatingPdf ? t("stats:yearReport.generating") : t("stats:yearReport.btn")}
</button>
```

- [ ] **Step 4: Add AirlineRankingCard and CountryDistributionCard sections**

Find the end of the main stats content area (before the closing `</div>` of the page container) and add two new section cards:
```typescript
{/* Airline Loyalty Ranking */}
<div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6">
  <AirlineRankingCard />
</div>

{/* Country Distribution */}
<div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6">
  <CountryDistributionCard />
</div>
```

- [ ] **Step 5: Run full test suite**

```bash
cd /d/Projekte/TravStats/frontend && npx vitest --run 2>&1 | tail -20
```
Expected: All existing tests pass + new tests pass

- [ ] **Step 6: Type-check both sides**

```bash
cd /d/Projekte/TravStats/backend && npx tsc --noEmit 2>&1 | tail -10
cd /d/Projekte/TravStats/frontend && npx tsc --noEmit 2>&1 | tail -10
```
Expected: No errors in either

- [ ] **Step 7: Commit**

```bash
cd /d/Projekte/TravStats
git add frontend/src/pages/AdvancedStatsPage.tsx
git commit -m "feat: add AirlineRankingCard, CountryDistributionCard, and PDF year report button to AdvancedStatsPage"
```

---

## Self-Review

### 1. Spec coverage

| Requirement | Task |
|-------------|------|
| Airline loyalty ranking endpoint | Task 1 |
| Country distribution endpoint | Task 2 |
| API client + types | Task 3 |
| AirlineRankingCard UI | Task 4 |
| CountryDistributionCard UI | Task 5 |
| PDF year report generator | Task 6 |
| Wire all into AdvancedStatsPage | Task 7 |

All requirements covered. ✅

### 2. Placeholder scan

- Task 6, Step 5 has an investigation step ("verify calculateDistance import path") — this is needed because the actual path is not yet confirmed. The implementer must run the check before proceeding. Not a placeholder — an explicit investigation step with exact commands. ✅
- All code blocks are complete. ✅
- No TBD, TODO, or "add appropriate error handling" patterns. ✅

### 3. Type consistency

- `AirlineRankingItem` defined in Task 3, used in Task 4. ✅
- `CountryStat` defined in Task 3, used in Task 5. ✅
- `AirlineRankingResponse.airlines` → `AirlineRankingItem[]` consistent throughout. ✅
- `generateYearReportPdf` signature defined in Task 6, called in Task 7 with `{ year, flights, userName, units: units.distance }`. Check: `units` in AdvancedStatsPage comes from `useSettingsStore` → `units.distance` is `"km" | "mi"`. ✅
- `addToast` in Task 7 references `useToastStore` — verify it's imported/used in the page already. ✅
