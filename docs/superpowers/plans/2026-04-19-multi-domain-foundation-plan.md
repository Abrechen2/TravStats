# Multi-Domain Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the architectural primitives that turn TravStats from a flight-only tracker into a multi-domain one, without shipping a user-visible feature. This plan enables the Cruise plan (next) to drop in as a peer domain.

**Architecture:** A shared `DomainRegistry` (backend + frontend) declares which domains exist. User-level `enabledDomains` in `UserSettings` gates nav, dashboards, maps, stats, achievements, and parser entry points. `Achievement.domain` and `ParserTemplate.domain` columns let data be filtered per domain. No domain is hard-coded — flights are a peer, default-enabled for backwards compatibility only.

**Tech Stack:** Prisma + PostgreSQL, Express + TypeScript, Zod, Zustand, react-i18next, Vitest (frontend) + Jest (backend) + Playwright (E2E).

**Spec:** [`docs/superpowers/specs/2026-04-19-multi-domain-foundation-design.md`](../specs/2026-04-19-multi-domain-foundation-design.md)

**Branch:** `dev/multi-domain-v1` (local only, do not push, do not deploy until promoted).

---

## File Structure

### New files

**Backend:**
- `backend/src/shared/domains.ts` — domain registry (types, descriptors, `AVAILABLE_DOMAINS`)
- `backend/src/__tests__/shared/domains.test.ts` — registry tests
- `backend/src/scripts/migrateAchievementDomain.ts` — one-shot data migration
- `backend/prisma/migrations/<timestamp>_multi_domain_foundation/migration.sql` — generated

**Frontend:**
- `frontend/src/shared/domains.ts` — mirror of the backend registry
- `frontend/src/hooks/useEnabledDomains.ts` — hook reading from settingsStore
- `frontend/src/components/Settings/ModuleSection.tsx` — "Bereiche" UI
- `frontend/src/components/Setup/DomainPickerStep.tsx` — wizard step
- `frontend/src/components/Trip/TripTimeline.tsx` — polymorphic timeline (skeleton)
- `frontend/src/__tests__/shared/domains.test.ts` — registry tests
- `frontend/src/__tests__/components/ModuleSection.test.tsx` — component test
- `frontend/src/__tests__/hooks/useEnabledDomains.test.ts` — hook test

### Modified files

**Backend:**
- `backend/prisma/schema.prisma` — add columns
- `backend/src/routes/settings/general.ts` — expose `enabledDomains`
- `backend/src/routes/settings/types.ts` — add type
- `backend/src/routes/boardingpassParse.ts`, `emailParse.ts`, `pdfParse.ts` — accept `domain` query param, default `"flight"`
- `backend/src/seed.ts` or seed scripts — set `domain` on seeded achievements

**Frontend:**
- `frontend/src/store/settingsStore.ts` — add `enabledDomains` field + setter + remote sync
- `frontend/src/components/NavigationBar.tsx` — gate domain-specific nav items
- `frontend/src/pages/SettingsPage.tsx` — mount `ModuleSection`
- `frontend/src/pages/SetupPage.tsx` — mount `DomainPickerStep`
- `frontend/src/pages/DashboardPage.tsx` — iterate `enabledDomains` for KPI cards
- `frontend/src/pages/AchievementsPage.tsx` — filter achievements by enabled domains + `shared`
- `frontend/src/pages/AdvancedStatsPage.tsx` — domain filter
- `frontend/src/components/Map/*` (deck.gl container) — domain-layer toggle scaffolding (no new layers in Foundation)
- `frontend/src/i18n/locales/de/common.json`, `en/common.json` — new keys under `domain.*` and `setup.domains.*`
- `frontend/src/lib/api.ts` — add `enabledDomains` to settings shape

---

## Task 1: Backend domain registry

**Files:**
- Create: `backend/src/shared/domains.ts`
- Create: `backend/src/__tests__/shared/domains.test.ts`

- [ ] **Step 1: Write the failing test**

`backend/src/__tests__/shared/domains.test.ts`:

```typescript
import { describe, it, expect } from '@jest/globals';
import {
  DOMAIN_KEYS,
  DOMAINS,
  AVAILABLE_DOMAINS,
  isValidDomain,
  getDomainDescriptor,
  type DomainKey,
} from '../../shared/domains';

describe('domain registry', () => {
  it('exposes all domain keys', () => {
    expect(DOMAIN_KEYS).toEqual(['flight', 'cruise', 'hotel', 'poi']);
  });

  it('only lists available domains in AVAILABLE_DOMAINS', () => {
    expect(AVAILABLE_DOMAINS).toEqual(['flight']);
  });

  it('every descriptor has required fields', () => {
    for (const key of DOMAIN_KEYS) {
      const d = DOMAINS[key];
      expect(d.key).toBe(key);
      expect(typeof d.available).toBe('boolean');
      expect(d.i18nKey).toMatch(/^domain\./);
      expect(d.icon).toBeTruthy();
      expect(d.color).toMatch(/^#/);
      expect(d.routePrefix).toMatch(/^\//);
    }
  });

  it('isValidDomain validates strings', () => {
    expect(isValidDomain('flight')).toBe(true);
    expect(isValidDomain('xxx')).toBe(false);
    expect(isValidDomain('')).toBe(false);
  });

  it('getDomainDescriptor returns descriptor or throws on unknown', () => {
    expect(getDomainDescriptor('flight').key).toBe('flight');
    expect(() => getDomainDescriptor('unknown' as DomainKey)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/__tests__/shared/domains.test.ts --forceExit`
Expected: FAIL — `Cannot find module '../../shared/domains'`.

- [ ] **Step 3: Create the registry**

`backend/src/shared/domains.ts`:

```typescript
/**
 * Multi-domain registry — single source of truth for domain metadata.
 * See: docs/superpowers/specs/2026-04-19-multi-domain-foundation-design.md
 */

export const DOMAIN_KEYS = ['flight', 'cruise', 'hotel', 'poi'] as const;
export type DomainKey = typeof DOMAIN_KEYS[number];

export interface DomainDescriptor {
  key: DomainKey;
  available: boolean;
  i18nKey: string;
  icon: string;
  color: string;
  routePrefix: string;
}

export const DOMAINS: Record<DomainKey, DomainDescriptor> = {
  flight: {
    key: 'flight',
    available: true,
    i18nKey: 'domain.flight',
    icon: '✈',
    color: '#f472b6',
    routePrefix: '/flights',
  },
  cruise: {
    key: 'cruise',
    available: false,
    i18nKey: 'domain.cruise',
    icon: '🚢',
    color: '#38bdf8',
    routePrefix: '/cruises',
  },
  hotel: {
    key: 'hotel',
    available: false,
    i18nKey: 'domain.hotel',
    icon: '🏨',
    color: '#a855f7',
    routePrefix: '/hotels',
  },
  poi: {
    key: 'poi',
    available: false,
    i18nKey: 'domain.poi',
    icon: '📍',
    color: '#facc15',
    routePrefix: '/places',
  },
};

export const AVAILABLE_DOMAINS: DomainKey[] = DOMAIN_KEYS.filter(
  (k) => DOMAINS[k].available,
);

export function isValidDomain(value: string): value is DomainKey {
  return (DOMAIN_KEYS as readonly string[]).includes(value);
}

export function getDomainDescriptor(key: DomainKey): DomainDescriptor {
  if (!isValidDomain(key)) {
    throw new Error(`Unknown domain key: ${String(key)}`);
  }
  return DOMAINS[key];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/__tests__/shared/domains.test.ts --forceExit`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add backend/src/shared/domains.ts backend/src/__tests__/shared/domains.test.ts
git commit -m "feat(foundation): add domain registry"
```

---

## Task 2: Prisma schema — add foundation columns

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Generated: `backend/prisma/migrations/<ts>_multi_domain_foundation/migration.sql`

- [ ] **Step 1: Edit schema — add `enabledDomains` to `UserSettings`**

In `backend/prisma/schema.prisma`, inside `model UserSettings`, add immediately after `userId`:

```prisma
  enabledDomains String[] @default(["flight"]) @map("enabled_domains")
```

- [ ] **Step 2: Edit schema — add `domain` to `Achievement`**

In `backend/prisma/schema.prisma`, inside `model Achievement`, add after `category`:

```prisma
  domain String @default("flight") // 'flight' | 'cruise' | 'shared' | future domain keys
```

And add an index at the bottom of the model (before the `@@map` line):

```prisma
  @@index([domain])
```

- [ ] **Step 3: Edit schema — add `domain` to `ParserTemplate`**

In `backend/prisma/schema.prisma`, inside `model ParserTemplate`, add after `userId`:

```prisma
  domain String @default("flight")
```

And update the existing index to include domain, replacing `@@index([userId, status])` with:

```prisma
  @@index([userId, status])
  @@index([domain])
```

- [ ] **Step 4: Generate migration**

Run: `cd backend && npx prisma migrate dev --name multi_domain_foundation`
Expected: Prisma prints the generated SQL summary; new migration folder created.

- [ ] **Step 5: Verify type check still passes**

Run: `cd backend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/
git commit -m "feat(foundation): prisma migration — enabledDomains + achievement/template domain"
```

---

## Task 3: Migrate existing achievements to `shared` where appropriate

**Files:**
- Create: `backend/src/scripts/migrateAchievementDomain.ts`
- Create: `backend/src/__tests__/scripts/migrateAchievementDomain.test.ts`

- [ ] **Step 1: Write the failing test (table-driven)**

`backend/src/__tests__/scripts/migrateAchievementDomain.test.ts`:

```typescript
import { describe, it, expect } from '@jest/globals';
import { shouldBeShared, SHARED_ACHIEVEMENT_CODE_PATTERNS } from '../../scripts/migrateAchievementDomain';

describe('migrateAchievementDomain', () => {
  const cases: Array<[string, boolean]> = [
    ['COUNTRIES_10',        true],
    ['COUNTRIES_50',        true],
    ['CONTINENTS_ALL',      true],
    ['CONTINENT_EUROPE',    true],
    ['AIRCRAFT_SPOTTER',    false],
    ['AIRLINE_LOYALTY',     false],
    ['DISTANCE_1M',         false],
    ['BIRTHDAY_FLIGHT',     false],
  ];

  it.each(cases)('classifies %s correctly', (code, expected) => {
    expect(shouldBeShared(code)).toBe(expected);
  });

  it('exposes the patterns list', () => {
    expect(SHARED_ACHIEVEMENT_CODE_PATTERNS.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/__tests__/scripts/migrateAchievementDomain.test.ts --forceExit`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the script**

`backend/src/scripts/migrateAchievementDomain.ts`:

```typescript
/**
 * One-shot: upgrade country/continent-style achievements from
 * domain='flight' to domain='shared', so cruise ports contribute.
 * Safe to re-run — idempotent UPDATE.
 */
import { prisma } from '../db';
import logger from '../utils/logger';

export const SHARED_ACHIEVEMENT_CODE_PATTERNS: RegExp[] = [
  /^COUNTRY_/i,
  /^COUNTRIES_/i,
  /^CONTINENT_/i,
  /^CONTINENTS_/i,
];

export function shouldBeShared(code: string): boolean {
  return SHARED_ACHIEVEMENT_CODE_PATTERNS.some((re) => re.test(code));
}

export async function migrateAchievementDomain(): Promise<{ updated: number }> {
  const all = await prisma.achievement.findMany({ select: { id: true, code: true } });
  const sharedIds = all.filter((a) => shouldBeShared(a.code)).map((a) => a.id);
  if (sharedIds.length === 0) {
    return { updated: 0 };
  }
  const result = await prisma.achievement.updateMany({
    where: { id: { in: sharedIds } },
    data: { domain: 'shared' },
  });
  logger.info({ operation: 'migrateAchievementDomain', updated: result.count });
  return { updated: result.count };
}

if (require.main === module) {
  migrateAchievementDomain()
    .then((r) => {
      // eslint-disable-next-line no-console
      console.log(`Updated ${r.updated} achievements to domain='shared'.`);
      process.exit(0);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exit(1);
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/__tests__/scripts/migrateAchievementDomain.test.ts --forceExit`
Expected: PASS (all cases).

- [ ] **Step 5: Verify script runs (dev DB)**

Run: `cd backend && npx tsx src/scripts/migrateAchievementDomain.ts`
Expected: Output "Updated N achievements to domain='shared'." where N ≥ 3.

- [ ] **Step 6: Commit**

```bash
git add backend/src/scripts/migrateAchievementDomain.ts backend/src/__tests__/scripts/migrateAchievementDomain.test.ts
git commit -m "feat(foundation): migrate country/continent achievements to shared domain"
```

---

## Task 4: Expose `enabledDomains` in settings API

**Files:**
- Modify: `backend/src/routes/settings/general.ts`
- Modify: `backend/src/routes/settings/types.ts`
- Create: `backend/src/__tests__/routes/settings.enabledDomains.test.ts`

- [ ] **Step 1: Write the failing integration test**

`backend/src/__tests__/routes/settings.enabledDomains.test.ts`:

```typescript
import request from 'supertest';
import app from '../../index'; // or the exported Express app
import { prisma } from '../../db';

describe('settings enabledDomains', () => {
  let token: string;
  let userId: string;

  beforeAll(async () => {
    // assume test-user helper exists; adapt to project's existing auth test utils
    ({ token, userId } = await global.__createTestUser());
  });

  afterAll(async () => {
    await prisma.userSettings.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('GET /settings returns default enabledDomains for a fresh user', async () => {
    const res = await request(app).get('/api/v1/settings').set('Cookie', `token=${token}`);
    expect(res.status).toBe(200);
    expect(res.body.enabledDomains).toEqual(['flight']);
  });

  it('PUT /settings persists enabledDomains', async () => {
    const res = await request(app)
      .put('/api/v1/settings')
      .set('Cookie', `token=${token}`)
      .send({ enabledDomains: ['flight', 'cruise'] });
    expect(res.status).toBe(200);
    expect(res.body.enabledDomains).toEqual(['flight', 'cruise']);
  });

  it('PUT /settings rejects unknown domain keys', async () => {
    const res = await request(app)
      .put('/api/v1/settings')
      .set('Cookie', `token=${token}`)
      .send({ enabledDomains: ['flight', 'rockets'] });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/__tests__/routes/settings.enabledDomains.test.ts --forceExit`
Expected: FAIL — `enabledDomains` not present in response or rejected.

- [ ] **Step 3: Extend Zod schema + response builder in `settings/general.ts`**

Add near the top of `backend/src/routes/settings/general.ts`, after the other imports:

```typescript
import { DOMAIN_KEYS, AVAILABLE_DOMAINS, type DomainKey } from '../../shared/domains';
```

Inside `settingsSchema` (the big `z.object({...}).partial()`), add — alongside the other top-level keys:

```typescript
  enabledDomains: z.array(z.enum(DOMAIN_KEYS as unknown as [DomainKey, ...DomainKey[]])).optional(),
```

Update `buildSettingsResponse` to accept and include `enabledDomains`. Change the parameter type to include the column, then append to the returned object:

```typescript
function buildSettingsResponse(record: {
  data: Prisma.JsonValue;
  enabledDomains: string[];   // NEW
  autoUpdateEnabled: boolean;
  /* …existing fields… */
}): SettingsResponse {
  const baseData = /* unchanged */;
  return {
    ...baseData,
    enabledDomains: record.enabledDomains, // NEW
    autoUpdate: { /* unchanged */ },
    boardingPassParserStrategy: record.boardingPassParserStrategy,
    historicalEnrichment: { /* unchanged */ },
  };
}
```

In the GET handler `create` call (`prisma.userSettings.create`), the default from the schema fires automatically — no explicit value needed.

In the PUT handler, right after `const payload = settingsSchema.parse(req.body);`, pull the field out:

```typescript
const { enabledDomains, ...rest } = payload;
```

Use `rest` (not `payload`) for the `payloadWithoutDirectFields` destructure already present. Then add to `updateData`:

```typescript
if (enabledDomains !== undefined) {
  updateData.enabledDomains = enabledDomains;
}
```

Add `enabledDomains: enabledDomains ?? ['flight']` to the `create` fallback branch of `prisma.userSettings.upsert`.

- [ ] **Step 4: Extend `SettingsResponse` type**

In `backend/src/routes/settings/types.ts`, add to the `SettingsResponse` interface:

```typescript
enabledDomains: string[];
```

And to `UserSettingsUpdateData`:

```typescript
enabledDomains?: string[];
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npx jest src/__tests__/routes/settings.enabledDomains.test.ts --forceExit`
Expected: PASS (3/3).

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/settings/ backend/src/__tests__/routes/
git commit -m "feat(foundation): expose enabledDomains via settings API"
```

---

## Task 5: Parser pipeline — domain discriminator

**Files:**
- Modify: `backend/src/routes/boardingpassParse.ts`, `emailParse.ts`, `pdfParse.ts`

- [ ] **Step 1: Identify the Zod schema for query/body**

Open each parser route and locate the existing body/query validation. For each, add an optional `domain` field:

```typescript
const parseSchema = z.object({
  // existing fields …
  domain: z.enum(['flight']).optional().default('flight'),
});
```

Note: only `'flight'` is enumerated during Foundation; Cruise plan extends it to `['flight', 'cruise']` when it ships.

- [ ] **Step 2: Thread `domain` into the handler**

In each handler, after `const parsed = parseSchema.parse(req.body)` (or query), pass `parsed.domain` to downstream services. For Foundation, the services only accept `'flight'` — add a `throw` if a non-flight value reaches them:

```typescript
if (parsed.domain !== 'flight') {
  res.status(400).json({ success: false, error: `Domain '${parsed.domain}' not yet implemented` });
  return;
}
```

- [ ] **Step 3: Add an integration test for the rejection path**

`backend/src/__tests__/routes/parser.domain.test.ts`:

```typescript
import request from 'supertest';
import app from '../../index';

describe('parser domain param', () => {
  let token: string;
  beforeAll(async () => { ({ token } = await global.__createTestUser()); });

  it('rejects unknown domain on /emailParse', async () => {
    const res = await request(app)
      .post('/api/v1/emailParse')
      .set('Cookie', `token=${token}`)
      .send({ text: 'sample', domain: 'cruise' });
    expect(res.status).toBe(400);
  });

  it('accepts domain=flight (current default)', async () => {
    const res = await request(app)
      .post('/api/v1/emailParse')
      .set('Cookie', `token=${token}`)
      .send({ text: 'a', domain: 'flight' });
    // 200 or 4xx from downstream — key is that it's NOT a schema rejection
    expect([200, 422, 500]).toContain(res.status);
  });
});
```

- [ ] **Step 4: Run tests**

Run: `cd backend && npx jest src/__tests__/routes/parser.domain.test.ts --forceExit`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/boardingpassParse.ts backend/src/routes/emailParse.ts backend/src/routes/pdfParse.ts backend/src/__tests__/routes/parser.domain.test.ts
git commit -m "feat(foundation): parser routes accept domain discriminator"
```

---

## Task 6: Frontend domain registry

**Files:**
- Create: `frontend/src/shared/domains.ts`
- Create: `frontend/src/__tests__/shared/domains.test.ts`

- [ ] **Step 1: Write the failing test**

`frontend/src/__tests__/shared/domains.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { DOMAINS, AVAILABLE_DOMAINS, isValidDomain, DOMAIN_KEYS } from '../../shared/domains';

describe('frontend domain registry', () => {
  it('lists all keys', () => {
    expect(DOMAIN_KEYS).toEqual(['flight', 'cruise', 'hotel', 'poi']);
  });
  it('exposes AVAILABLE_DOMAINS only with available=true', () => {
    expect(AVAILABLE_DOMAINS).toEqual(['flight']);
    expect(DOMAINS.flight.available).toBe(true);
    expect(DOMAINS.cruise.available).toBe(false);
  });
  it('isValidDomain', () => {
    expect(isValidDomain('flight')).toBe(true);
    expect(isValidDomain('rockets')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/__tests__/shared/domains.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement — copy of backend registry**

`frontend/src/shared/domains.ts`:

```typescript
/**
 * Frontend mirror of backend/src/shared/domains.ts.
 * Keep in sync manually — both source files are small and stable.
 */

export const DOMAIN_KEYS = ['flight', 'cruise', 'hotel', 'poi'] as const;
export type DomainKey = typeof DOMAIN_KEYS[number];

export interface DomainDescriptor {
  key: DomainKey;
  available: boolean;
  i18nKey: string;
  icon: string;
  color: string;
  routePrefix: string;
}

export const DOMAINS: Record<DomainKey, DomainDescriptor> = {
  flight: { key: 'flight', available: true,  i18nKey: 'domain.flight', icon: '✈',  color: '#f472b6', routePrefix: '/flights' },
  cruise: { key: 'cruise', available: false, i18nKey: 'domain.cruise', icon: '🚢', color: '#38bdf8', routePrefix: '/cruises' },
  hotel:  { key: 'hotel',  available: false, i18nKey: 'domain.hotel',  icon: '🏨', color: '#a855f7', routePrefix: '/hotels'  },
  poi:    { key: 'poi',    available: false, i18nKey: 'domain.poi',    icon: '📍', color: '#facc15', routePrefix: '/places'  },
};

export const AVAILABLE_DOMAINS: DomainKey[] = DOMAIN_KEYS.filter((k) => DOMAINS[k].available);

export function isValidDomain(value: string): value is DomainKey {
  return (DOMAIN_KEYS as readonly string[]).includes(value);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/__tests__/shared/domains.test.ts`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/shared/domains.ts frontend/src/__tests__/shared/domains.test.ts
git commit -m "feat(foundation): frontend domain registry"
```

---

## Task 7: `enabledDomains` in settingsStore

**Files:**
- Modify: `frontend/src/store/settingsStore.ts`
- Modify: `frontend/src/lib/api.ts` (settings response type)
- Create: `frontend/src/hooks/useEnabledDomains.ts`
- Create: `frontend/src/__tests__/hooks/useEnabledDomains.test.ts`

- [ ] **Step 1: Extend settingsStore state**

In `frontend/src/store/settingsStore.ts`, add to the state interface (next to other top-level settings):

```typescript
enabledDomains: DomainKey[];
setEnabledDomains: (keys: DomainKey[]) => void;
```

Import at top:

```typescript
import { DOMAIN_KEYS, type DomainKey } from "../shared/domains";
```

Set default in the initial state:

```typescript
enabledDomains: ['flight'],
```

Implement the setter — mutate state, then push to server via the existing settings PUT helper:

```typescript
setEnabledDomains: (keys) => {
  set({ enabledDomains: keys });
  void settingsApi.update({ enabledDomains: keys });
},
```

In `loadRemoteSettings` (the existing function that pulls settings from the server), extract `enabledDomains` from the response and set it:

```typescript
if (Array.isArray(remote.enabledDomains)) {
  const filtered = remote.enabledDomains.filter((k): k is DomainKey =>
    (DOMAIN_KEYS as readonly string[]).includes(k));
  set({ enabledDomains: filtered });
}
```

- [ ] **Step 2: Update API shape in `lib/api.ts`**

Find the settings response type (`SettingsResponse` or similar) and add:

```typescript
enabledDomains: DomainKey[];
```

Import `DomainKey` from `../shared/domains`.

- [ ] **Step 3: Create hook**

`frontend/src/hooks/useEnabledDomains.ts`:

```typescript
import { useSettingsStore } from "../store/settingsStore";
import type { DomainKey } from "../shared/domains";

/** Returns the user's currently enabled domains + a helper checker. */
export function useEnabledDomains(): {
  enabled: DomainKey[];
  isEnabled: (key: DomainKey) => boolean;
} {
  const enabled = useSettingsStore((s) => s.enabledDomains);
  return {
    enabled,
    isEnabled: (key) => enabled.includes(key),
  };
}
```

- [ ] **Step 4: Test the hook**

`frontend/src/__tests__/hooks/useEnabledDomains.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEnabledDomains } from '../../hooks/useEnabledDomains';
import { useSettingsStore } from '../../store/settingsStore';

describe('useEnabledDomains', () => {
  beforeEach(() => {
    useSettingsStore.setState({ enabledDomains: ['flight'] });
  });

  it('returns currently enabled domains', () => {
    const { result } = renderHook(() => useEnabledDomains());
    expect(result.current.enabled).toEqual(['flight']);
    expect(result.current.isEnabled('flight')).toBe(true);
    expect(result.current.isEnabled('cruise')).toBe(false);
  });

  it('reacts to store updates', () => {
    const { result } = renderHook(() => useEnabledDomains());
    act(() => {
      useSettingsStore.setState({ enabledDomains: ['flight', 'cruise'] });
    });
    expect(result.current.isEnabled('cruise')).toBe(true);
  });
});
```

- [ ] **Step 5: Run tests**

Run: `cd frontend && npx vitest run src/__tests__/hooks/useEnabledDomains.test.ts`
Expected: PASS (2/2).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/store/settingsStore.ts frontend/src/lib/api.ts frontend/src/hooks/useEnabledDomains.ts frontend/src/__tests__/hooks/useEnabledDomains.test.ts
git commit -m "feat(foundation): enabledDomains in settingsStore + useEnabledDomains hook"
```

---

## Task 8: `ModuleSection` component (Settings → Bereiche)

**Files:**
- Create: `frontend/src/components/Settings/ModuleSection.tsx`
- Create: `frontend/src/__tests__/components/ModuleSection.test.tsx`

- [ ] **Step 1: Write the failing component test**

`frontend/src/__tests__/components/ModuleSection.test.tsx`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ModuleSection from '../../components/Settings/ModuleSection';
import { useSettingsStore } from '../../store/settingsStore';

describe('ModuleSection', () => {
  beforeEach(() => {
    useSettingsStore.setState({ enabledDomains: ['flight'] });
  });

  it('renders a row for every known domain', () => {
    render(<ModuleSection />);
    expect(screen.getByText('domain.flight')).toBeInTheDocument();
    expect(screen.getByText('domain.cruise')).toBeInTheDocument();
    expect(screen.getByText('domain.hotel')).toBeInTheDocument();
    expect(screen.getByText('domain.poi')).toBeInTheDocument();
  });

  it('disables unavailable domains', () => {
    render(<ModuleSection />);
    const cruiseToggle = screen.getByRole('switch', { name: /domain\.cruise/ });
    expect(cruiseToggle).toBeDisabled();
  });

  it('toggling an available domain updates the store', () => {
    render(<ModuleSection />);
    const flightToggle = screen.getByRole('switch', { name: /domain\.flight/ });
    fireEvent.click(flightToggle);
    expect(useSettingsStore.getState().enabledDomains).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/__tests__/components/ModuleSection.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the component**

`frontend/src/components/Settings/ModuleSection.tsx`:

```typescript
import { JSX } from "react";
import { DOMAIN_KEYS, DOMAINS, type DomainKey } from "../../shared/domains";
import { useSettingsStore } from "../../store/settingsStore";
import { useTranslation } from "../../hooks/useTranslation";

export default function ModuleSection(): JSX.Element {
  const { t } = useTranslation("common");
  const enabledDomains = useSettingsStore((s) => s.enabledDomains);
  const setEnabledDomains = useSettingsStore((s) => s.setEnabledDomains);

  const toggle = (key: DomainKey): void => {
    if (!DOMAINS[key].available) return;
    const next = enabledDomains.includes(key)
      ? enabledDomains.filter((k) => k !== key)
      : [...enabledDomains, key];
    setEnabledDomains(next);
  };

  return (
    <section aria-labelledby="modules-heading" className="settings-section">
      <h2 id="modules-heading" className="settings-section-title">
        {t("settings.modules.title")}
      </h2>
      <p className="settings-section-desc">{t("settings.modules.desc")}</p>
      <ul className="settings-modules-list">
        {DOMAIN_KEYS.map((key) => {
          const d = DOMAINS[key];
          const enabled = enabledDomains.includes(key);
          return (
            <li key={key} className="settings-module-row">
              <div
                className="settings-module-icon"
                style={{ backgroundColor: `${d.color}22` }}
                aria-hidden
              >
                {d.icon}
              </div>
              <div className="settings-module-meta">
                <div className="settings-module-title">
                  {t(d.i18nKey)}
                  {!d.available && (
                    <span className="settings-module-badge">
                      {t("settings.modules.comingSoon")}
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                aria-label={d.i18nKey}
                disabled={!d.available}
                onClick={() => toggle(key)}
                className={`settings-toggle ${enabled ? "on" : ""} ${
                  d.available ? "" : "disabled"
                }`}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/__tests__/components/ModuleSection.test.tsx`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Settings/ModuleSection.tsx frontend/src/__tests__/components/ModuleSection.test.tsx
git commit -m "feat(foundation): ModuleSection component"
```

---

## Task 9: Mount `ModuleSection` in SettingsPage

**Files:**
- Modify: `frontend/src/pages/SettingsPage.tsx`

- [ ] **Step 1: Import and mount**

Add the import at the top of `SettingsPage.tsx`:

```typescript
import ModuleSection from "../components/Settings/ModuleSection";
```

Place `<ModuleSection />` in the JSX immediately after the language/theme section and before the parser section. The exact location depends on current layout — it should be the second or third section.

- [ ] **Step 2: Manual smoke test**

Run dev server (`npm run dev`), log in, open `/settings`. Confirm the "Bereiche" section shows four rows with flight enabled, cruise/hotel/poi disabled-and-grayed.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/SettingsPage.tsx
git commit -m "feat(foundation): mount ModuleSection in SettingsPage"
```

---

## Task 10: `DomainPickerStep` for Setup wizard

**Files:**
- Create: `frontend/src/components/Setup/DomainPickerStep.tsx`
- Create: `frontend/src/__tests__/components/DomainPickerStep.test.tsx`

- [ ] **Step 1: Write the failing test**

`frontend/src/__tests__/components/DomainPickerStep.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DomainPickerStep from '../../components/Setup/DomainPickerStep';

describe('DomainPickerStep', () => {
  it('renders all domains, only available are interactive', () => {
    const onChange = vi.fn();
    render(<DomainPickerStep value={['flight']} onChange={onChange} />);
    expect(screen.getByText('domain.flight')).toBeInTheDocument();
    expect(screen.getByText('domain.cruise')).toBeInTheDocument();
  });

  it('calls onChange with new selection when a card is clicked', () => {
    const onChange = vi.fn();
    render(<DomainPickerStep value={['flight']} onChange={onChange} />);
    const flightCard = screen.getByTestId('domain-card-flight');
    fireEvent.click(flightCard);
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('locked (unavailable) cards do not trigger onChange', () => {
    const onChange = vi.fn();
    render(<DomainPickerStep value={['flight']} onChange={onChange} />);
    const hotelCard = screen.getByTestId('domain-card-hotel');
    fireEvent.click(hotelCard);
    expect(onChange).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/__tests__/components/DomainPickerStep.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

`frontend/src/components/Setup/DomainPickerStep.tsx`:

```typescript
import { JSX } from "react";
import { DOMAIN_KEYS, DOMAINS, type DomainKey } from "../../shared/domains";
import { useTranslation } from "../../hooks/useTranslation";

export interface DomainPickerStepProps {
  value: DomainKey[];
  onChange: (next: DomainKey[]) => void;
}

export default function DomainPickerStep({
  value,
  onChange,
}: DomainPickerStepProps): JSX.Element {
  const { t } = useTranslation("common");

  const toggle = (key: DomainKey): void => {
    if (!DOMAINS[key].available) return;
    const next = value.includes(key)
      ? value.filter((k) => k !== key)
      : [...value, key];
    onChange(next);
  };

  return (
    <div className="setup-domain-picker">
      <h2>{t("setup.domains.title")}</h2>
      <p className="subtitle">{t("setup.domains.desc")}</p>
      <ul className="setup-domain-cards">
        {DOMAIN_KEYS.map((key) => {
          const d = DOMAINS[key];
          const selected = value.includes(key);
          const locked = !d.available;
          return (
            <li
              key={key}
              data-testid={`domain-card-${key}`}
              onClick={() => toggle(key)}
              className={[
                "setup-domain-card",
                selected ? "selected" : "",
                locked ? "locked" : "",
              ].filter(Boolean).join(" ")}
              role="button"
              tabIndex={locked ? -1 : 0}
              aria-pressed={selected}
              aria-disabled={locked}
            >
              <div
                className="setup-domain-icon"
                style={{ backgroundColor: `${d.color}22` }}
              >
                {d.icon}
              </div>
              <div className="setup-domain-meta">
                <div className="setup-domain-title">
                  {t(d.i18nKey)}
                  {locked && (
                    <span className="setup-domain-soon">
                      {t("setup.domains.soon")}
                    </span>
                  )}
                </div>
                <div className="setup-domain-desc">
                  {t(`${d.i18nKey}_desc`)}
                </div>
              </div>
              <div className={`setup-domain-check ${selected ? "on" : ""}`} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/__tests__/components/DomainPickerStep.test.tsx`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Setup/DomainPickerStep.tsx frontend/src/__tests__/components/DomainPickerStep.test.tsx
git commit -m "feat(foundation): DomainPickerStep for setup wizard"
```

---

## Task 11: Wire `DomainPickerStep` into SetupPage

**Files:**
- Modify: `frontend/src/pages/SetupPage.tsx`

- [ ] **Step 1: Add wizard step**

Read SetupPage to see the current wizard shape. The wizard is typically a state-machine with `step: number`. Insert a new step (the exact position depends on the current flow; recommended: right before the final "seed database" step).

Add state:

```typescript
const [selectedDomains, setSelectedDomains] = useState<DomainKey[]>(['flight']);
```

Add the step in the step-switcher JSX:

```tsx
{step === DOMAIN_PICKER_STEP && (
  <DomainPickerStep
    value={selectedDomains}
    onChange={setSelectedDomains}
  />
)}
```

- [ ] **Step 2: Persist on completion**

Where the setup completes (POST to `/api/v1/setup/complete` or equivalent), include `enabledDomains` in the body:

```typescript
await setupApi.complete({
  // existing fields …
  enabledDomains: selectedDomains,
});
```

If the setup API does not currently accept `enabledDomains`, extend its schema (a one-line addition in the setup route's Zod schema + pass to `prisma.userSettings.create`).

- [ ] **Step 3: Manual smoke test**

Start dev server with a fresh DB (`npx prisma migrate reset --force` in backend), open the app, confirm the new wizard step appears and the choice persists into `UserSettings.enabledDomains`.

Run: `cd backend && npx prisma studio` and verify `enabled_domains = ['flight', ...]` as picked.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/SetupPage.tsx backend/src/routes/setup.ts
git commit -m "feat(foundation): setup wizard domain picker"
```

---

## Task 12: Navigation gating

**Files:**
- Modify: `frontend/src/components/NavigationBar.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Read NavigationBar to find the domain-specific nav items**

The nav currently has a "Flüge" / "Flights" entry pointing to `/flights`. In Foundation we do not add new nav entries (Cruise plan will), but we must wrap the flight entry so it renders only when `'flight' ∈ enabledDomains`.

In `NavigationBar.tsx`, import and use the hook:

```typescript
import { useEnabledDomains } from "../hooks/useEnabledDomains";
```

Inside the component:

```typescript
const { isEnabled } = useEnabledDomains();
```

Wrap the `<Link to="/flights">...</Link>` with a conditional:

```tsx
{isEnabled('flight') && <Link to="/flights">{/* … */}</Link>}
```

- [ ] **Step 2: Gate the route in App.tsx (defense in depth)**

In `frontend/src/App.tsx`, the `/flights` route currently renders `FlightsTablePage` when authenticated. Add a domain check:

```tsx
<Route
  path="/flights"
  element={
    isAuthenticated && isEnabled('flight')
      ? <FlightsTablePage />
      : <Navigate to={isAuthenticated ? "/" : "/login"} />
  }
/>
```

Import the hook at the top of `App.tsx`:

```typescript
import { useEnabledDomains } from "./hooks/useEnabledDomains";
```

And use it inside `AppContent`:

```typescript
const { isEnabled } = useEnabledDomains();
```

- [ ] **Step 3: Add an integration test**

`frontend/src/__tests__/components/NavigationBar.test.tsx` (extend existing or create):

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import NavigationBar from '../../components/NavigationBar';
import { useSettingsStore } from '../../store/settingsStore';

describe('NavigationBar domain gating', () => {
  beforeEach(() => {
    useSettingsStore.setState({ enabledDomains: ['flight'] });
  });

  it('shows Flights link when flight domain enabled', () => {
    render(<MemoryRouter><NavigationBar /></MemoryRouter>);
    expect(screen.getByRole('link', { name: /flights|flüge/i })).toBeInTheDocument();
  });

  it('hides Flights link when flight domain disabled', () => {
    useSettingsStore.setState({ enabledDomains: [] });
    render(<MemoryRouter><NavigationBar /></MemoryRouter>);
    expect(screen.queryByRole('link', { name: /flights|flüge/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run tests**

Run: `cd frontend && npx vitest run src/__tests__/components/NavigationBar.test.tsx`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/NavigationBar.tsx frontend/src/App.tsx frontend/src/__tests__/components/NavigationBar.test.tsx
git commit -m "feat(foundation): gate navigation + routes by enabledDomains"
```

---

## Task 13: Dashboard gating

**Files:**
- Modify: `frontend/src/pages/DashboardPage.tsx`

- [ ] **Step 1: Identify flight-specific sections**

Read `DashboardPage.tsx`. Locate the flight KPI card / widget blocks.

- [ ] **Step 2: Wrap with hook check**

Import:

```typescript
import { useEnabledDomains } from "../hooks/useEnabledDomains";
```

Inside the component:

```typescript
const { isEnabled } = useEnabledDomains();
```

Wrap each flight-specific JSX block:

```tsx
{isEnabled('flight') && (
  <FlightKpiCard />
)}
```

Add an empty-state fallback when no domains enabled:

```tsx
{!isEnabled('flight') && /* …and no other enabled domains */ (
  <div className="dashboard-empty">
    {t("dashboard.empty.noDomains")}
    <Link to="/settings#modules">{t("dashboard.empty.openSettings")}</Link>
  </div>
)}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/DashboardPage.tsx
git commit -m "feat(foundation): gate dashboard sections by enabledDomains"
```

---

## Task 14: Achievements page — domain filter

**Files:**
- Modify: `frontend/src/pages/AchievementsPage.tsx`
- Modify: `frontend/src/lib/api.ts` (Achievement type)

- [ ] **Step 1: Extend Achievement type with `domain`**

In `frontend/src/lib/api.ts`, find the `Achievement` interface and add:

```typescript
domain: 'flight' | 'cruise' | 'shared' | string; // fallback for forward compat
```

- [ ] **Step 2: Filter in the page**

In `AchievementsPage.tsx`, after fetching achievements, derive the visible set:

```typescript
const { enabled } = useEnabledDomains();
const visibleAchievements = achievements.filter((a) =>
  a.domain === 'shared' || enabled.includes(a.domain as DomainKey),
);
```

- [ ] **Step 3: Add a "show all including disabled" toggle (optional in Foundation, required later)**

Tiny state + checkbox in the page header:

```tsx
const [showAll, setShowAll] = useState(false);
// …
{showAll ? achievements : visibleAchievements}
```

- [ ] **Step 4: Test**

`frontend/src/__tests__/pages/AchievementsPage.domainFilter.test.tsx`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import AchievementsPage from '../../pages/AchievementsPage';
import { useSettingsStore } from '../../store/settingsStore';

// Mock API to return a known achievement list
vi.mock('../../lib/api', async () => ({
  ...(await vi.importActual<object>('../../lib/api')),
  achievementsApi: {
    list: vi.fn().mockResolvedValue([
      { id: '1', code: 'FIRST_FLIGHT',    name: 'First flight',  domain: 'flight' },
      { id: '2', code: 'FIRST_CRUISE',    name: 'First cruise',  domain: 'cruise' },
      { id: '3', code: 'COUNTRIES_10',    name: '10 countries',  domain: 'shared' },
    ]),
  },
}));

describe('AchievementsPage domain filter', () => {
  beforeEach(() => {
    useSettingsStore.setState({ enabledDomains: ['flight'] });
  });

  it('shows flight and shared, hides cruise', async () => {
    render(<AchievementsPage />);
    expect(await screen.findByText('First flight')).toBeInTheDocument();
    expect(screen.getByText('10 countries')).toBeInTheDocument();
    expect(screen.queryByText('First cruise')).not.toBeInTheDocument();
  });
});
```

Run: `cd frontend && npx vitest run src/__tests__/pages/AchievementsPage.domainFilter.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/AchievementsPage.tsx frontend/src/lib/api.ts frontend/src/__tests__/pages/AchievementsPage.domainFilter.test.tsx
git commit -m "feat(foundation): achievement page filters by domain"
```

---

## Task 15: `TripTimeline` polymorphic component (skeleton)

**Files:**
- Create: `frontend/src/components/Trip/TripTimeline.tsx`
- Create: `frontend/src/__tests__/components/TripTimeline.test.tsx`

- [ ] **Step 1: Define event type + test**

`frontend/src/__tests__/components/TripTimeline.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import TripTimeline, { type TimelineEvent } from '../../components/Trip/TripTimeline';

describe('TripTimeline', () => {
  const events: TimelineEvent[] = [
    { id: 'f1', domain: 'flight', date: '2026-04-15', title: 'BER → MAD', subtitle: 'LH 1234' },
    { id: 'c1', domain: 'cruise', date: '2026-04-16', title: 'AIDAnova', subtitle: 'Barcelona → Palma' },
  ];

  it('renders events in chronological order', () => {
    render(<TripTimeline events={events} />);
    const titles = screen.getAllByTestId('timeline-event-title');
    expect(titles[0]).toHaveTextContent('BER → MAD');
    expect(titles[1]).toHaveTextContent('AIDAnova');
  });

  it('badges each event with its domain icon', () => {
    render(<TripTimeline events={events} />);
    expect(screen.getAllByTestId('timeline-event-badge')).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/__tests__/components/TripTimeline.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

`frontend/src/components/Trip/TripTimeline.tsx`:

```typescript
import { JSX } from "react";
import { DOMAINS, type DomainKey } from "../../shared/domains";

export interface TimelineEvent {
  id: string;
  domain: DomainKey;
  date: string; // ISO date
  title: string;
  subtitle?: string;
  meta?: string;
}

export interface TripTimelineProps {
  events: TimelineEvent[];
}

export default function TripTimeline({ events }: TripTimelineProps): JSX.Element {
  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date));
  return (
    <ol className="trip-timeline">
      {sorted.map((ev) => {
        const d = DOMAINS[ev.domain];
        return (
          <li key={ev.id} className="trip-timeline-row">
            <div
              data-testid="timeline-event-badge"
              className="trip-timeline-badge"
              style={{ backgroundColor: `${d.color}22`, color: d.color }}
              aria-label={d.key}
            >
              {d.icon}
            </div>
            <div className="trip-timeline-body">
              <div data-testid="timeline-event-title" className="trip-timeline-title">
                {ev.title}
              </div>
              {ev.subtitle && <div className="trip-timeline-sub">{ev.subtitle}</div>}
              {ev.meta && <div className="trip-timeline-meta">{ev.meta}</div>}
            </div>
            <time className="trip-timeline-date">{ev.date}</time>
          </li>
        );
      })}
    </ol>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/__tests__/components/TripTimeline.test.tsx`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Trip/TripTimeline.tsx frontend/src/__tests__/components/TripTimeline.test.tsx
git commit -m "feat(foundation): polymorphic TripTimeline skeleton"
```

---

## Task 16: i18n keys (de + en)

**Files:**
- Modify: `frontend/src/i18n/locales/de/common.json`
- Modify: `frontend/src/i18n/locales/en/common.json`

- [ ] **Step 1: Add domain keys to German locale**

In `frontend/src/i18n/locales/de/common.json`, add at the top level (or merge into existing top-level keys):

```json
{
  "domain": {
    "flight":      "Flüge",
    "flight_desc": "Buchungen importieren, Routen auf der Karte, Airline/Airport-Achievements.",
    "cruise":      "Kreuzfahrten",
    "cruise_desc": "Schiffe, Häfen, Seetage, Reederei-Achievements.",
    "hotel":       "Hotels",
    "hotel_desc":  "Übernachtungen, Ketten-Loyalty, Länder/Städte.",
    "poi":         "POI / Besuche",
    "poi_desc":    "Sehenswürdigkeiten, Restaurants, Konzerte, beliebige Orte."
  },
  "settings": {
    "modules": {
      "title":       "Bereiche",
      "desc":        "Aktivierte Bereiche erscheinen in Navigation, Dashboard, Karte, Achievements und Statistiken. Deaktivierte Bereiche verstecken sich komplett — deine Daten bleiben erhalten.",
      "comingSoon":  "bald"
    }
  },
  "setup": {
    "domains": {
      "title":       "Was möchtest du tracken?",
      "desc":        "Du kannst Bereiche jederzeit in den Einstellungen aktivieren oder deaktivieren.",
      "soon":        "bald"
    }
  }
}
```

- [ ] **Step 2: Add English locale**

In `frontend/src/i18n/locales/en/common.json`:

```json
{
  "domain": {
    "flight":      "Flights",
    "flight_desc": "Import bookings, routes on the map, airline/airport achievements.",
    "cruise":      "Cruises",
    "cruise_desc": "Ships, ports, sea days, cruise-line achievements.",
    "hotel":       "Hotels",
    "hotel_desc":  "Overnight stays, chain loyalty, countries/cities.",
    "poi":         "Places",
    "poi_desc":    "Landmarks, restaurants, concerts, any place."
  },
  "settings": {
    "modules": {
      "title":       "Modules",
      "desc":        "Enabled modules show up in navigation, dashboards, map, achievements and stats. Disabled modules are hidden — your data is preserved.",
      "comingSoon":  "soon"
    }
  },
  "setup": {
    "domains": {
      "title":       "What do you want to track?",
      "desc":        "You can enable or disable modules anytime in Settings.",
      "soon":        "soon"
    }
  }
}
```

Merge carefully if these keys partially exist — don't overwrite other sections.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/i18n/locales/
git commit -m "feat(foundation): i18n keys for domain modules and setup"
```

---

## Task 17: Back-fill existing users (one-shot SQL)

**Files:**
- The migration in Task 2 uses `@default(["flight"])`, which applies to **new rows**. Existing rows created before the migration already have the empty-array default from Postgres for the new column. We need to explicitly back-fill.

- [ ] **Step 1: Inspect whether back-fill is needed**

Run: `cd backend && npx prisma studio`
Navigate to `user_settings` and check the `enabled_domains` column of existing rows. If they show `['flight']` (Prisma picks up the default), skip to Step 3. If empty, continue.

- [ ] **Step 2: Create data migration SQL**

Create a new Prisma migration **without schema change**:

```bash
cd backend && npx prisma migrate dev --create-only --name backfill_enabled_domains
```

Edit the generated `migration.sql`:

```sql
-- Back-fill enabled_domains for users created before multi-domain foundation
UPDATE user_settings
SET enabled_domains = ARRAY['flight']
WHERE enabled_domains = '{}' OR enabled_domains IS NULL;
```

- [ ] **Step 3: Apply migration**

Run: `cd backend && npx prisma migrate dev`
Expected: migration applied, zero or some rows updated.

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/migrations/
git commit -m "chore(foundation): backfill enabled_domains for existing users"
```

---

## Task 18: Stats page — domain filter scaffolding

**Files:**
- Modify: `frontend/src/pages/AdvancedStatsPage.tsx`

- [ ] **Step 1: Add domain filter state**

Import `useEnabledDomains` and add a simple filter chip row at the top of the page:

```typescript
const { enabled } = useEnabledDomains();
const [filter, setFilter] = useState<DomainKey | 'all'>('all');
```

Render filter chips:

```tsx
<div className="stats-domain-filter">
  <button onClick={() => setFilter('all')}   className={filter === 'all'    ? 'active' : ''}>{t('stats.filter.all')}</button>
  {enabled.map((k) => (
    <button key={k} onClick={() => setFilter(k)} className={filter === k ? 'active' : ''}>
      {t(DOMAINS[k].i18nKey)}
    </button>
  ))}
</div>
```

For Foundation, the filter is **display-only** (only flight stats exist). The Cruise plan populates actual cruise-specific stat sections.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/AdvancedStatsPage.tsx
git commit -m "feat(foundation): stats page domain-filter scaffolding"
```

---

## Task 19: Full build + type check + tests

- [ ] **Step 1: Backend type check + lint**

Run:
```bash
cd backend && npx tsc --noEmit && npm run lint
```
Expected: no errors.

- [ ] **Step 2: Backend tests**

Run: `cd backend && npm test -- --forceExit`
Expected: all tests pass (pre-existing + new ones from tasks 1, 3, 4, 5).

- [ ] **Step 3: Frontend type check + lint**

Run:
```bash
cd frontend && npx tsc --noEmit && npm run lint
```
Expected: no errors.

- [ ] **Step 4: Frontend tests**

Run: `cd frontend && npx vitest --run`
Expected: all tests pass (pre-existing + new ones from tasks 6, 7, 8, 10, 12, 14, 15).

- [ ] **Step 5: Fix any regressions**

If any pre-existing test broke due to the settings response shape change (Task 4), update fixtures to include `enabledDomains: ['flight']`.

- [ ] **Step 6: Commit any fixes**

```bash
git add -A
git commit -m "chore(foundation): fix test fixtures after enabledDomains addition"
```

---

## Task 20: Documentation — update CLAUDE.md gotchas

**Files:**
- Modify: `CLAUDE.md` (project root)

- [ ] **Step 1: Add a gotcha line**

In the "Critical Gotchas" section of `CLAUDE.md`, add:

```
- **Domain gating** — every new page/feature must check `useEnabledDomains()` on
  the frontend; every new parser-target must register in `backend/src/shared/domains.ts`
  and its frontend mirror. Shared code paths iterate `AVAILABLE_DOMAINS`, not
  `enabledDomains.includes('flight')`.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(foundation): document domain-gating gotcha"
```

---

## Completion criteria

Foundation is complete when:

1. `AVAILABLE_DOMAINS` is `['flight']` — no user-visible change in nav/UI for existing users.
2. New users in setup see the domain-picker step with flight preselected and cruise/hotel/poi as locked "soon".
3. Settings → Bereiche shows four toggle rows (flight active, others disabled-gray).
4. Toggling flight off hides the Flights nav entry (and subsequently the `/flights` route — shows Dashboard redirect).
5. Achievement page hides any achievement whose `domain` is not enabled. Achievements with `domain = 'shared'` are always shown.
6. `backend && npm test` and `frontend && npx vitest --run` both green.
7. `backend && npx tsc --noEmit` and `frontend && npx tsc --noEmit` both green.
8. All 20 tasks committed on branch `dev/multi-domain-v1`.

## Hand-off to Cruise plan

Once Foundation is merged into `dev/multi-domain-v1` and verified, the Cruise plan writer can rely on:

- `AVAILABLE_DOMAINS` being mutable in one place (add `'cruise'`).
- `settingsStore.enabledDomains` already handling cruise.
- `ModuleSection` automatically surfacing the Cruise toggle when `DOMAINS.cruise.available` flips to `true`.
- `DomainPickerStep` automatically surfacing cruise in the setup wizard.
- `Achievement.domain` column already migrated, cruise achievements just need inserts.
- `TripTimeline` component ready to receive cruise events.
- Parser route `domain` discriminator ready to accept `'cruise'`.
