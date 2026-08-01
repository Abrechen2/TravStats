# Companion Entity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the free-text `companions String[]` on Flight, Trip and Cruise with a per-user `Companion` entity plus explicit join tables, without changing a single API contract.

**Architecture:** The entity lives behind the existing contract. Every write path resolves incoming names to companions and writes both the join rows and the legacy array; every read path maps joins back to `string[]`. A boot backfill converts existing data. The legacy columns stay populated for one release so a rollback is an image swap.

**Tech Stack:** Prisma 5 / PostgreSQL, Express, Zod, Jest (backend), React + Vitest (frontend).

**Spec:** `docs/superpowers/specs/2026-08-01-companion-entity-design.md`

## Global Constraints

- `any` is forbidden. Use `unknown` plus type guards.
- Logger: `import logger from '../utils/logger'` (default export). No `console.log`.
- Backend files use single quotes; frontend uses double quotes (Prettier, printWidth 100).
- Async/await only, never `.then()`.
- Immutable updates: spread, no in-place mutation.
- File size: 200–400 lines ideal, 800 hard maximum.
- Every user input passes a Zod schema in `backend/src/schemas/`.
- Migrations are generated with `npx prisma migrate dev`, never hand-written.
- The API contract does not change: `companions` stays `string[]` in every request and response.
- The legacy `companions String[]` columns are NOT dropped in this plan.
- Backend tests need the dev DB: `DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_dev"`.
- The full backend suite wipes `admin:admin123`; re-seed with `npm run seed:dev-admin` afterwards.

## File Structure

**Create**
- `backend/src/utils/companionName.ts` — canonicalization, pure, no I/O
- `backend/src/services/companionService.ts` — resolve names to entities, map back
- `backend/src/routes/companions.ts` — `GET /api/v1/companions`
- `backend/src/scripts/backfillCompanions.ts` — idempotent boot backfill
- `frontend/src/lib/api/companions.ts` — API client
- `frontend/src/components/CompanionPicker.tsx` — the shared control

**Modify**
- `backend/prisma/schema.prisma` — Companion + three join models
- `backend/src/routes/{flights,flightsBatch,trips,cruises}.ts` — resolve on write, map on read
- `backend/src/utils/flightMerge.ts` — explicit companion semantics
- `backend/src/index.ts` — mount the route, run the backfill
- `backend/src/services/openapi/paths.ts` — document the new endpoint
- `frontend/src/components/FlightEditModal.tsx`, `frontend/src/components/FlightForm/FlightCompleteStep.tsx`, `frontend/src/components/Cruise/CruiseEditModal.tsx` and the trip UI — use the picker

**Deliberately NOT modified this release**

`services/tripSummaryService.ts`, `services/tripCleanupService.ts` and
`services/diagnosticsBundle.ts` read `companions` as an array. Because the legacy
columns stay dual-written, they keep working unchanged and must be left alone —
switching them to the joins now would remove the very redundancy that makes a
rollback safe. They move in 2.6.0 together with dropping the columns.

---

### Task 1: Canonicalization helper

The identity rule the whole feature rests on. Pure function, no database.

**Files:**
- Create: `backend/src/utils/companionName.ts`
- Test: `backend/src/utils/__tests__/companionName.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `canonicalizeCompanionName(raw: string): string`, `searchableCompanionName(raw: string): string`

- [ ] **Step 1: Write the failing test**

```typescript
import { canonicalizeCompanionName, searchableCompanionName } from '../companionName';

describe('canonicalizeCompanionName', () => {
  it('collapses case, padding and inner whitespace to one identity', () => {
    const forms = ['Anna Müller', 'anna müller', '  Anna   Müller  ', 'ANNA MÜLLER'];
    const canonical = forms.map(canonicalizeCompanionName);
    expect(new Set(canonical).size).toBe(1);
  });

  // The rule that must never be "optimised" away: folding accents merges real
  // people, and once rows are linked that cannot be undone.
  it('keeps accented and unaccented spellings apart', () => {
    expect(canonicalizeCompanionName('José')).not.toBe(canonicalizeCompanionName('Jose'));
  });

  it('normalises unicode so visually identical names match', () => {
    const composed = 'José';        // é as one code point
    const decomposed = 'José';     // e + combining acute
    expect(canonicalizeCompanionName(composed)).toBe(canonicalizeCompanionName(decomposed));
  });

  it('returns an empty string for blank input', () => {
    expect(canonicalizeCompanionName('   ')).toBe('');
  });
});

describe('searchableCompanionName', () => {
  it('folds accents so search finds Muller when the name is Müller', () => {
    expect(searchableCompanionName('Müller')).toBe(searchableCompanionName('Muller'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/utils/__tests__/companionName.test.ts`
Expected: FAIL — cannot find module `../companionName`.

- [ ] **Step 3: Write minimal implementation**

```typescript
/**
 * Identity and search normalisation for companion names.
 *
 * canonicalize is the IDENTITY rule: two names that canonicalize alike are the
 * same person. It deliberately does NOT fold diacritics — "José" and "Jose" are
 * different people, and merging them cannot be undone once rows are linked.
 *
 * searchable is a SEARCH aid only. It folds diacritics so typing "Muller"
 * finds "Müller". It is never unique and never decides identity.
 */

/** NFKC + trim + collapse inner whitespace + lowercase. Accents preserved. */
export function canonicalizeCompanionName(raw: string): string {
  return raw.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** The canonical form with combining marks stripped. Search only. */
export function searchableCompanionName(raw: string): string {
  return canonicalizeCompanionName(raw)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/utils/__tests__/companionName.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/utils/companionName.ts backend/src/utils/__tests__/companionName.test.ts
git commit -m "feat(companions): canonical and searchable name normalisation

Identity folds case and whitespace but deliberately NOT diacritics: merging
Jose and José is a wrong answer that cannot be undone once rows are linked.
Accent-insensitive search gets its own separate form."
```

---

### Task 2: Schema and migration

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Test: verified by `prisma migrate dev` plus Task 3's tests

**Interfaces:**
- Consumes: nothing
- Produces: Prisma models `Companion`, `FlightCompanion`, `TripCompanion`, `CruiseCompanion`

- [ ] **Step 1: Add the models**

Append to `backend/prisma/schema.prisma`:

```prisma
model Companion {
  id            String   @id @default(uuid())
  userId        String   @map("user_id")
  canonicalName String   @map("canonical_name")
  displayName   String   @map("display_name")
  searchName    String   @map("search_name")
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  user    User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  flights FlightCompanion[]
  trips   TripCompanion[]
  cruises CruiseCompanion[]

  @@unique([userId, canonicalName])
  @@index([userId, searchName])
  @@map("companions")
}

model FlightCompanion {
  flightId    String @map("flight_id")
  companionId String @map("companion_id")
  position    Int

  flight    Flight    @relation(fields: [flightId], references: [id], onDelete: Cascade)
  companion Companion @relation(fields: [companionId], references: [id], onDelete: Cascade)

  @@id([flightId, companionId])
  @@index([companionId])
  @@map("flight_companions")
}

model TripCompanion {
  tripId      String @map("trip_id")
  companionId String @map("companion_id")
  position    Int

  trip      Trip      @relation(fields: [tripId], references: [id], onDelete: Cascade)
  companion Companion @relation(fields: [companionId], references: [id], onDelete: Cascade)

  @@id([tripId, companionId])
  @@index([companionId])
  @@map("trip_companions")
}

model CruiseCompanion {
  cruiseId    String @map("cruise_id")
  companionId String @map("companion_id")
  position    Int

  cruise    Cruise    @relation(fields: [cruiseId], references: [id], onDelete: Cascade)
  companion Companion @relation(fields: [companionId], references: [id], onDelete: Cascade)

  @@id([cruiseId, companionId])
  @@index([companionId])
  @@map("cruise_companions")
}
```

- [ ] **Step 2: Add the back-relations**

In `model User` add `companions Companion[]`.
In `model Flight` add `companionLinks FlightCompanion[]`.
In `model Trip` add `companionLinks TripCompanion[]`.
In `model Cruise` add `companionLinks CruiseCompanion[]`.

The existing `companions String[]` columns stay untouched on all three.

- [ ] **Step 3: Generate the migration**

```bash
cd backend
DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_dev" \
  npx prisma migrate dev --name companion_entity
```

Expected: a new migration folder, `CREATE TABLE` for four tables, no ALTER on the existing `companions` columns. **If the generated SQL touches any column other than the new tables, stop** — that means drift reappeared; re-measure with `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --script` before continuing.

- [ ] **Step 4: Verify the client compiles**

Run: `cd backend && npx prisma generate && npx tsc --noEmit`
Expected: exit 0. (On Windows, if `prisma generate` fails with EPERM, stop the dev server first — see CLAUDE.local.md.)

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(companions): add Companion entity and three join tables

Three explicit join tables rather than one polymorphic table: Prisma does not
model polymorphic foreign keys cleanly, which would cost referential integrity
and spread type dispatch through every consumer.

position exists so export -> import -> export stays byte-stable; a join table
otherwise returns rows in planner order and churns the Excel export.

The legacy companions String[] columns are deliberately left in place."
```

---

### Task 3: Resolution service

**Files:**
- Create: `backend/src/services/companionService.ts`
- Test: `backend/src/services/__tests__/companionService.test.ts`

**Interfaces:**
- Consumes: `canonicalizeCompanionName`, `searchableCompanionName` from Task 1
- Produces:
  - `resolveCompanions(userId: string, names: string[]): Promise<{ id: string; displayName: string }[]>`
  - `linkRowsFor(companionIds: string[]): { companionId: string; position: number }[]`

- [ ] **Step 1: Write the failing test**

```typescript
import { prisma } from '../../db';
import { resolveCompanions, linkRowsFor } from '../companionService';

describe('resolveCompanions', () => {
  let userId: string;

  beforeEach(async () => {
    await prisma.companion.deleteMany();
    await prisma.user.deleteMany();
    const user = await prisma.user.create({
      data: { username: 'companion-test', passwordHash: 'x' },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.companion.deleteMany();
    await prisma.user.deleteMany();
    await prisma.$disconnect();
  });

  it('creates one companion for spellings that share an identity', async () => {
    const first = await resolveCompanions(userId, ['Anna Müller']);
    const second = await resolveCompanions(userId, ['  anna   müller ']);
    expect(second[0].id).toBe(first[0].id);
    expect(await prisma.companion.count({ where: { userId } })).toBe(1);
  });

  it('keeps the newest spelling as the display name', async () => {
    await resolveCompanions(userId, ['anna müller']);
    const again = await resolveCompanions(userId, ['Anna Müller']);
    expect(again[0].displayName).toBe('Anna Müller');
  });

  it('returns companions in input order', async () => {
    const result = await resolveCompanions(userId, ['Bea', 'Anna', 'Cem']);
    expect(result.map((c) => c.displayName)).toEqual(['Bea', 'Anna', 'Cem']);
  });

  it('drops blank entries', async () => {
    const result = await resolveCompanions(userId, ['Anna', '   ', '']);
    expect(result).toHaveLength(1);
  });

  it('does not leak companions between users', async () => {
    const other = await prisma.user.create({
      data: { username: 'companion-other', passwordHash: 'x' },
    });
    const mine = await resolveCompanions(userId, ['Anna']);
    const theirs = await resolveCompanions(other.id, ['Anna']);
    expect(theirs[0].id).not.toBe(mine[0].id);
  });
});

describe('linkRowsFor', () => {
  it('numbers positions from zero in order', () => {
    expect(linkRowsFor(['a', 'b'])).toEqual([
      { companionId: 'a', position: 0 },
      { companionId: 'b', position: 1 },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_dev" npx jest src/services/__tests__/companionService.test.ts`
Expected: FAIL — cannot find module `../companionService`.

- [ ] **Step 3: Write minimal implementation**

```typescript
import { Prisma } from '@prisma/client';

import { prisma } from '../db';
import { canonicalizeCompanionName, searchableCompanionName } from '../utils/companionName';

export interface ResolvedCompanion {
  id: string;
  displayName: string;
}

/**
 * Finds or creates the user's companions for a list of raw names and returns
 * them in input order. Blank entries are dropped. The newest spelling wins as
 * the display name; identity is the canonical form and never changes.
 */
export async function resolveCompanions(
  userId: string,
  names: string[]
): Promise<ResolvedCompanion[]> {
  const wanted = names
    .map((raw) => ({ raw: raw.trim(), canonical: canonicalizeCompanionName(raw) }))
    .filter((n) => n.canonical.length > 0);

  const resolved: ResolvedCompanion[] = [];

  for (const { raw, canonical } of wanted) {
    const data = {
      userId,
      canonicalName: canonical,
      displayName: raw,
      searchName: searchableCompanionName(raw),
    };

    try {
      const created = await prisma.companion.create({ data });
      resolved.push({ id: created.id, displayName: created.displayName });
    } catch (error) {
      // Unique violation: the companion already exists (or a parallel request
      // just created it). Update the display name to the newest spelling.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await prisma.companion.update({
          where: { userId_canonicalName: { userId, canonicalName: canonical } },
          data: { displayName: raw, searchName: data.searchName },
        });
        resolved.push({ id: existing.id, displayName: existing.displayName });
      } else {
        throw error;
      }
    }
  }

  return resolved;
}

/** Turns an ordered list of companion ids into join rows carrying their order. */
export function linkRowsFor(companionIds: string[]): { companionId: string; position: number }[] {
  return companionIds.map((companionId, position) => ({ companionId, position }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_dev" npx jest src/services/__tests__/companionService.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/companionService.ts backend/src/services/__tests__/companionService.test.ts
git commit -m "feat(companions): name resolution service

Find-or-create per user, input order preserved, blanks dropped, newest spelling
wins as display name. Creation races resolve through the unique constraint and
a P2002 retry, mirroring the airline catalogue."
```

---

### Task 4: Companions endpoint

**Files:**
- Create: `backend/src/routes/companions.ts`
- Modify: `backend/src/index.ts`
- Test: `backend/src/__tests__/companions.route.test.ts`

**Interfaces:**
- Consumes: `resolveCompanions` from Task 3
- Produces: `GET /api/v1/companions` → `{ companions: { id, name, usageCount }[] }`

- [ ] **Step 1: Write the failing test**

```typescript
import request from 'supertest';
import app from '../index';
import { prisma } from '../db';

describe('GET /api/v1/companions', () => {
  beforeEach(async () => {
    await prisma.companion.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.companion.deleteMany();
    await prisma.user.deleteMany();
    await prisma.$disconnect();
  });

  it('rejects an unauthenticated request', async () => {
    await request(app).get('/api/v1/companions').expect(401);
  });

  it('returns the caller\'s companions with usage counts', async () => {
    const registration = await request(app)
      .post('/api/v1/auth/register')
      .send({ username: 'companion-route', password: 'password123' })
      .expect(201);
    const cookie = registration.headers['set-cookie'];

    const me = await prisma.user.findUniqueOrThrow({ where: { username: 'companion-route' } });
    await prisma.companion.create({
      data: {
        userId: me.id,
        canonicalName: 'anna',
        displayName: 'Anna',
        searchName: 'anna',
      },
    });

    const response = await request(app)
      .get('/api/v1/companions')
      .set('Cookie', cookie)
      .expect(200);

    expect(response.body.companions).toHaveLength(1);
    expect(response.body.companions[0].name).toBe('Anna');
    expect(response.body.companions[0].usageCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_dev" npx jest src/__tests__/companions.route.test.ts`
Expected: FAIL — 404 instead of 401/200.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/routes/companions.ts`:

```typescript
import { Router, Response, NextFunction } from 'express';

import { prisma } from '../db';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

/**
 * The caller's companions, most used first. Feeds the companion picker in the
 * flight, trip and cruise forms.
 */
router.get('/', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const rows = await prisma.companion.findMany({
      where: { userId: req.userId },
      include: {
        _count: { select: { flights: true, trips: true, cruises: true } },
      },
      orderBy: { displayName: 'asc' },
    });

    const companions = rows
      .map((row) => ({
        id: row.id,
        name: row.displayName,
        usageCount: row._count.flights + row._count.trips + row._count.cruises,
      }))
      .sort((a, b) => b.usageCount - a.usageCount || a.name.localeCompare(b.name));

    res.json({ companions });
  } catch (error) {
    next(error);
  }
});

export default router;
```

In `backend/src/index.ts`, next to the other `app.use('/api/v1', …)` mounts:

```typescript
import companionRoutes from './routes/companions';
// …
app.use('/api/v1/companions', companionRoutes);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_dev" npx jest src/__tests__/companions.route.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Document the endpoint**

Add the `GET /companions` path to `backend/src/services/openapi/paths.ts`, following the shape of the neighbouring authenticated read endpoints: 200 returns `{ companions: [{ id, name, usageCount }] }`, 401 when unauthenticated. No request body.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/companions.ts backend/src/index.ts backend/src/services/openapi/paths.ts backend/src/__tests__/companions.route.test.ts
git commit -m "feat(companions): GET /api/v1/companions for the picker

Most-used first. Only authenticated reads; the global /api/ limiter applies,
authLimiter deliberately not (it guards credential brute force and would
throttle ordinary form opens)."
```

---

### Task 5: Flight write and read paths

**Files:**
- Modify: `backend/src/routes/flights.ts`
- Test: `backend/src/__tests__/flights.companions.test.ts`

**Interfaces:**
- Consumes: `resolveCompanions`, `linkRowsFor` from Task 3
- Produces: flights persist companion links; responses still carry `companions: string[]`

- [ ] **Step 1: Write the failing test**

```typescript
import request from 'supertest';
import app from '../index';
import { prisma } from '../db';

describe('flight companions', () => {
  let cookie: string[];

  beforeEach(async () => {
    await prisma.flightCompanion.deleteMany();
    await prisma.companion.deleteMany();
    await prisma.flight.deleteMany();
    await prisma.user.deleteMany();
    const registration = await request(app)
      .post('/api/v1/auth/register')
      .send({ username: 'flight-companions', password: 'password123' })
      .expect(201);
    cookie = registration.headers['set-cookie'];
  });

  afterAll(async () => {
    await prisma.flightCompanion.deleteMany();
    await prisma.companion.deleteMany();
    await prisma.flight.deleteMany();
    await prisma.user.deleteMany();
    await prisma.$disconnect();
  });

  const newFlight = (companions: string[]) => ({
    flightNumber: 'LH400',
    departureAirport: 'FRA',
    arrivalAirport: 'JFK',
    departureLocal: '2026-08-14T14:35',
    arrivalLocal: '2026-08-14T16:50',
    companions,
  });

  it('creates links and still answers with plain names', async () => {
    const created = await request(app)
      .post('/api/v1/flights')
      .set('Cookie', cookie)
      .send(newFlight(['Anna', 'Jonas']))
      .expect(201);

    expect(created.body.companions).toEqual(['Anna', 'Jonas']);
    expect(await prisma.flightCompanion.count()).toBe(2);
  });

  // The rollback guarantee: the old image reads this column.
  it('keeps the legacy array in agreement with the links', async () => {
    const created = await request(app)
      .post('/api/v1/flights')
      .set('Cookie', cookie)
      .send(newFlight(['Anna', 'Jonas']))
      .expect(201);

    const row = await prisma.flight.findUniqueOrThrow({
      where: { id: created.body.id },
      include: { companionLinks: { include: { companion: true }, orderBy: { position: 'asc' } } },
    });
    expect(row.companions).toEqual(['Anna', 'Jonas']);
    expect(row.companionLinks.map((l) => l.companion.displayName)).toEqual(['Anna', 'Jonas']);
  });

  it('replaces links on update rather than accumulating them', async () => {
    const created = await request(app)
      .post('/api/v1/flights')
      .set('Cookie', cookie)
      .send(newFlight(['Anna', 'Jonas']))
      .expect(200 | 201);

    await request(app)
      .put(`/api/v1/flights/${created.body.id}`)
      .set('Cookie', cookie)
      .send({ companions: ['Anna'] })
      .expect(200);

    expect(await prisma.flightCompanion.count({ where: { flightId: created.body.id } })).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_dev" npx jest src/__tests__/flights.companions.test.ts`
Expected: FAIL — `flightCompanion.count()` is 0 because nothing writes links yet.

- [ ] **Step 3: Write minimal implementation**

In the create handler (`routes/flights.ts`, around line 443 where `companions` is written), after the flight row exists and inside the same transaction:

```typescript
const companionNames = data.companions ?? [];
if (companionNames.length > 0) {
  const resolved = await resolveCompanions(userId, companionNames);
  await tx.flightCompanion.createMany({
    data: linkRowsFor(resolved.map((c) => c.id)).map((row) => ({
      ...row,
      flightId: created.id,
    })),
    skipDuplicates: true,
  });
}
```

In the update handler (around line 949), when `data.companions !== undefined`, replace rather than append:

```typescript
if (data.companions !== undefined) {
  const resolved = await resolveCompanions(userId, data.companions);
  await prisma.flightCompanion.deleteMany({ where: { flightId: existingFlight.id } });
  if (resolved.length > 0) {
    await prisma.flightCompanion.createMany({
      data: linkRowsFor(resolved.map((c) => c.id)).map((row) => ({
        ...row,
        flightId: existingFlight.id,
      })),
      skipDuplicates: true,
    });
  }
  // Dual write: the previous image still reads this column.
  updateData.companions = resolved.map((c) => c.displayName);
}
```

Add the import at the top:

```typescript
import { resolveCompanions, linkRowsFor } from '../services/companionService';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_dev" npx jest src/__tests__/flights.companions.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/flights.ts backend/src/__tests__/flights.companions.test.ts
git commit -m "feat(companions): resolve links on the flight write paths

Dual write — links plus the legacy array — so rolling back to the previous
image stays an image swap. Update replaces links instead of appending."
```

---

### Task 6: Batch import path

**Files:**
- Modify: `backend/src/routes/flightsBatch.ts:169`
- Test: `backend/src/__tests__/flightsBatch.companions.test.ts`

**Interfaces:**
- Consumes: `resolveCompanions`, `linkRowsFor`
- Produces: batch-imported flights carry links

- [ ] **Step 1: Write the failing test**

```typescript
import request from 'supertest';
import app from '../index';
import { prisma } from '../db';

describe('batch import companions', () => {
  let cookie: string[];

  beforeEach(async () => {
    await prisma.flightCompanion.deleteMany();
    await prisma.companion.deleteMany();
    await prisma.flight.deleteMany();
    await prisma.user.deleteMany();
    const registration = await request(app)
      .post('/api/v1/auth/register')
      .send({ username: 'batch-companions', password: 'password123' })
      .expect(201);
    cookie = registration.headers['set-cookie'];
  });

  afterAll(async () => {
    await prisma.flightCompanion.deleteMany();
    await prisma.companion.deleteMany();
    await prisma.flight.deleteMany();
    await prisma.user.deleteMany();
    await prisma.$disconnect();
  });

  // Excel re-import is the reason the contract stays string-based; two rows
  // naming the same person must not create two companions.
  it('reuses one companion across imported rows', async () => {
    await request(app)
      .post('/api/v1/flights/batch')
      .set('Cookie', cookie)
      .send({
        flights: [
          {
            flightNumber: 'LH400',
            departureAirport: 'FRA',
            arrivalAirport: 'JFK',
            departureLocal: '2026-08-14T14:35',
            arrivalLocal: '2026-08-14T16:50',
            companions: ['Anna'],
          },
          {
            flightNumber: 'LH401',
            departureAirport: 'JFK',
            arrivalAirport: 'FRA',
            departureLocal: '2026-08-20T18:00',
            arrivalLocal: '2026-08-21T07:30',
            companions: ['anna'],
          },
        ],
      })
      .expect(201);

    expect(await prisma.companion.count()).toBe(1);
    expect(await prisma.flightCompanion.count()).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_dev" npx jest src/__tests__/flightsBatch.companions.test.ts`
Expected: FAIL — `flightCompanion.count()` is 0.

- [ ] **Step 3: Write minimal implementation**

Add the import at the top of `flightsBatch.ts`:

```typescript
import { resolveCompanions, linkRowsFor } from '../services/companionService';
```

After each flight row is created (around line 169, where `companions` is currently written into the row), inside the same transaction:

```typescript
const companionNames = data.companions ?? [];
if (companionNames.length > 0) {
  const resolved = await resolveCompanions(userId, companionNames);
  await tx.flightCompanion.createMany({
    data: linkRowsFor(resolved.map((c) => c.id)).map((row) => ({
      ...row,
      flightId: created.id,
    })),
    skipDuplicates: true,
  });
}
```

`resolveCompanions` is find-or-create, so the second row naming the same person reuses the first row's companion. That is what makes the test's count assertion hold.

- [ ] **Step 4: Run test to verify it passes**

Run the same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/flightsBatch.ts backend/src/__tests__/flightsBatch.companions.test.ts
git commit -m "feat(companions): resolve links on batch import"
```

---

### Task 7: Trip write path

**Files:**
- Modify: `backend/src/routes/trips.ts`
- Test: `backend/src/__tests__/trips.companions.test.ts`

**Interfaces:**
- Consumes: `resolveCompanions`, `linkRowsFor`
- Produces: trips carry links; responses unchanged

- [ ] **Step 1: Write the failing test**

```typescript
import request from 'supertest';
import app from '../index';
import { prisma } from '../db';

describe('trip companions', () => {
  let cookie: string[];

  beforeEach(async () => {
    await prisma.tripCompanion.deleteMany();
    await prisma.companion.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
    const registration = await request(app)
      .post('/api/v1/auth/register')
      .send({ username: 'trip-companions', password: 'password123' })
      .expect(201);
    cookie = registration.headers['set-cookie'];
  });

  afterAll(async () => {
    await prisma.tripCompanion.deleteMany();
    await prisma.companion.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
    await prisma.$disconnect();
  });

  const newTrip = (companions: string[]) => ({
    name: 'Sommerreise',
    startDate: '2026-08-14',
    endDate: '2026-08-28',
    companions,
  });

  it('creates links and still answers with plain names', async () => {
    const created = await request(app)
      .post('/api/v1/trips')
      .set('Cookie', cookie)
      .send(newTrip(['Anna', 'Jonas']))
      .expect(201);

    expect(created.body.companions).toEqual(['Anna', 'Jonas']);
    expect(await prisma.tripCompanion.count()).toBe(2);
  });

  it('keeps the legacy array in agreement with the links', async () => {
    const created = await request(app)
      .post('/api/v1/trips')
      .set('Cookie', cookie)
      .send(newTrip(['Anna', 'Jonas']))
      .expect(201);

    const row = await prisma.trip.findUniqueOrThrow({
      where: { id: created.body.id },
      include: { companionLinks: { include: { companion: true }, orderBy: { position: 'asc' } } },
    });
    expect(row.companions).toEqual(['Anna', 'Jonas']);
    expect(row.companionLinks.map((l) => l.companion.displayName)).toEqual(['Anna', 'Jonas']);
  });
});
```

Adjust the trip payload fields to whatever `schemas/trip.ts` actually requires; the two assertions are the point.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_dev" npx jest src/__tests__/trips.companions.test.ts`
Expected: FAIL — `tripCompanion.count()` is 0.

- [ ] **Step 3: Write minimal implementation**

Add the import to `routes/trips.ts`:

```typescript
import { resolveCompanions, linkRowsFor } from '../services/companionService';
```

In the create handler, after the trip row exists and inside its transaction:

```typescript
const companionNames = data.companions ?? [];
if (companionNames.length > 0) {
  const resolved = await resolveCompanions(userId, companionNames);
  await tx.tripCompanion.createMany({
    data: linkRowsFor(resolved.map((c) => c.id)).map((row) => ({
      ...row,
      tripId: created.id,
    })),
    skipDuplicates: true,
  });
}
```

In the update handler, replace rather than append:

```typescript
if (data.companions !== undefined) {
  const resolved = await resolveCompanions(userId, data.companions);
  await prisma.tripCompanion.deleteMany({ where: { tripId: existing.id } });
  if (resolved.length > 0) {
    await prisma.tripCompanion.createMany({
      data: linkRowsFor(resolved.map((c) => c.id)).map((row) => ({
        ...row,
        tripId: existing.id,
      })),
      skipDuplicates: true,
    });
  }
  updateData.companions = resolved.map((c) => c.displayName);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run the same command. Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/trips.ts backend/src/__tests__/trips.companions.test.ts
git commit -m "feat(companions): resolve links on the trip write paths"
```

---

### Task 8: Cruise write path — the spread trap

**Files:**
- Modify: `backend/src/routes/cruises.ts:296`
- Test: `backend/src/__tests__/cruises.companions.test.ts`

**Interfaces:**
- Consumes: `resolveCompanions`, `linkRowsFor`
- Produces: cruises carry links

> **Read this before editing.** `routes/cruises.ts` never mentions `companions`.
> It persists the field through `data: { userId, ...rest }`, and
> `schemas/cruise.ts:102` is what lets it through. If you add resolution without
> destructuring `companions` out of `rest`, the spread keeps writing the array,
> the links are silently never created, and no test that only checks the
> response will notice.

- [ ] **Step 1: Write the failing test**

Assert, after `POST /api/v1/cruises` with `companions: ['Anna']`, that `prisma.cruiseCompanion.count()` is 1 and the response still returns `['Anna']`.

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — count is 0 while the response already looks correct. That asymmetry is the trap; the test exists to catch it.

- [ ] **Step 3: Write minimal implementation**

```typescript
const { companions: companionNames, ...rest } = validated;
// …
const created = await tx.cruise.create({
  data: {
    userId,
    ...rest,
    companions: companionNames ?? [],   // dual write, explicit now
    status: effectiveStatus,
    // … unchanged
  },
});

if (companionNames && companionNames.length > 0) {
  const resolved = await resolveCompanions(userId, companionNames);
  await tx.cruiseCompanion.createMany({
    data: linkRowsFor(resolved.map((c) => c.id)).map((row) => ({
      ...row,
      cruiseId: created.id,
    })),
    skipDuplicates: true,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/cruises.ts backend/src/__tests__/cruises.companions.test.ts
git commit -m "feat(companions): resolve links on the cruise write path

companions reached the database through a spread and never appeared in this
file by name. It is destructured explicitly now, so the field is visible to
anyone grepping for it."
```

---

### Task 9: Merge semantics

**Files:**
- Modify: `backend/src/utils/flightMerge.ts`
- Test: `backend/src/utils/__tests__/flightMerge.companions.test.ts`

**Interfaces:**
- Consumes: nothing new
- Produces: unchanged merge behaviour, now explicit

- [ ] **Step 1: Write the failing test**

```typescript
import { mergeFlightData } from '../flightMerge';

describe('companion merge semantics', () => {
  // Behaviour must NOT change as a side effect of the storage change.
  it('leaves existing companions alone', () => {
    const merged = mergeFlightData(
      { companions: ['Anna'] } as never,
      { companions: ['Jonas'] } as never
    );
    expect(merged.companions).toEqual(['Anna']);
  });

  it('fills companions when the target has none', () => {
    const merged = mergeFlightData(
      { companions: [] } as never,
      { companions: ['Jonas'] } as never
    );
    expect(merged.companions).toEqual(['Jonas']);
  });
});
```

Adjust the call signature to the real `flightMerge` export while keeping both assertions.

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `cd backend && npx jest src/utils/__tests__/flightMerge.companions.test.ts`
If it passes immediately, the generic `ARRAY_FIELDS` handling already gives these semantics — keep the test as the regression guard and note that in the commit. If it fails, fix the merge to match.

- [ ] **Step 3: Make companions explicit**

Remove `"companions"` from `ARRAY_FIELDS` and handle it by name, with the fill-if-empty rule spelled out and a comment explaining that joins made the implicit handling unsafe.

- [ ] **Step 4: Run the whole merge suite**

Run: `cd backend && npx jest src/utils/__tests__/`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/utils/flightMerge.ts backend/src/utils/__tests__/flightMerge.companions.test.ts
git commit -m "refactor(companions): spell out merge semantics

companions was one of ARRAY_FIELDS and merged by the generic array rule. With
join tables that implicit handling would either overwrite curated links or
union parser output into them. Behaviour is unchanged and now pinned by tests."
```

---

### Task 10: Boot backfill

**Files:**
- Create: `backend/src/scripts/backfillCompanions.ts`
- Modify: `backend/src/index.ts`
- Test: `backend/src/scripts/__tests__/backfillCompanions.test.ts`

**Interfaces:**
- Consumes: `resolveCompanions`, `linkRowsFor`
- Produces: `backfillCompanions(): Promise<number>` — number of links created

- [ ] **Step 1: Write the failing test**

```typescript
import { prisma } from '../../db';
import { backfillCompanions } from '../backfillCompanions';

describe('backfillCompanions', () => {
  let userId: string;

  beforeEach(async () => {
    await prisma.flightCompanion.deleteMany();
    await prisma.companion.deleteMany();
    await prisma.flight.deleteMany();
    await prisma.user.deleteMany();
    const user = await prisma.user.create({
      data: { username: 'backfill-companions', passwordHash: 'x' },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.flightCompanion.deleteMany();
    await prisma.companion.deleteMany();
    await prisma.flight.deleteMany();
    await prisma.user.deleteMany();
    await prisma.$disconnect();
  });

  const legacyFlight = (companions: string[]) =>
    prisma.flight.create({
      data: { userId, flightNumber: 'LH400', companions },
    });

  it('reproduces the legacy array exactly, in order', async () => {
    const flight = await legacyFlight(['Anna', 'Jonas']);
    await backfillCompanions();

    const links = await prisma.flightCompanion.findMany({
      where: { flightId: flight.id },
      include: { companion: true },
      orderBy: { position: 'asc' },
    });
    expect(links.map((l) => l.companion.displayName)).toEqual(['Anna', 'Jonas']);
  });

  it('is idempotent', async () => {
    await legacyFlight(['Anna', 'Jonas']);
    await backfillCompanions();
    const afterFirst = await prisma.flightCompanion.count();
    await backfillCompanions();
    expect(await prisma.flightCompanion.count()).toBe(afterFirst);
    expect(await prisma.companion.count()).toBe(2);
  });

  it('drops blank entries but keeps odd real ones', async () => {
    await legacyFlight(['  ', 'MUELLER/ANNA MS']);
    await backfillCompanions();
    const names = (await prisma.companion.findMany()).map((c) => c.displayName);
    expect(names).toEqual(['MUELLER/ANNA MS']);
  });

  it('collapses spellings that share an identity into one companion', async () => {
    await legacyFlight(['Anna']);
    await legacyFlight(['  anna ']);
    await backfillCompanions();
    expect(await prisma.companion.count({ where: { userId } })).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && DATABASE_URL="…" npx jest src/scripts/__tests__/backfillCompanions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Iterate users; for each, read flights, trips and cruises with a non-empty `companions` array; resolve names; `createMany({ skipDuplicates: true })` the links with `position` from the array index; return the number of links created. Log collapsed spellings at info level. Follow the shape of `backfillAirlineCodes.ts`.

- [ ] **Step 4: Run test to verify it passes**

Expected: PASS, 4 tests.

- [ ] **Step 5: Wire it into boot**

In `backend/src/index.ts`, next to the other backfills:

```typescript
try {
  const { backfillCompanions } = await import('./scripts/backfillCompanions');
  const n = await backfillCompanions();
  if (n > 0) {
    logger.info({
      operation: 'server_start_backfill_companions',
      message: `Linked ${n} companion rows`,
    });
  }
} catch (error) {
  logger.warn({
    operation: 'server_start_backfill_companions_error',
    message: 'Failed to backfill companions',
    error,
  });
}
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/scripts/backfillCompanions.ts backend/src/scripts/__tests__/backfillCompanions.test.ts backend/src/index.ts
git commit -m "feat(companions): idempotent boot backfill

Converts the legacy arrays across flights, trips and cruises into entities and
links. Blank entries are dropped; odd-but-real names like MUELLER/ANNA MS are
preserved verbatim rather than cleaned."
```

---

### Task 11: Frontend picker

**Files:**
- Create: `frontend/src/lib/api/companions.ts`
- Create: `frontend/src/components/CompanionPicker.tsx`
- Test: `frontend/src/components/__tests__/CompanionPicker.test.tsx`

**Interfaces:**
- Consumes: `GET /api/v1/companions` from Task 4
- Produces: `<CompanionPicker value={string[]} onChange={(v: string[]) => void} />`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("../../lib/api", () => ({ companionsApi: { list: mocks.list } }));

import CompanionPicker from "../CompanionPicker";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue([
    { id: "1", name: "Anna", usageCount: 12 },
    { id: "2", name: "Jonas", usageCount: 3 },
  ]);
});

describe("CompanionPicker", () => {
  it("suggests known companions", async () => {
    render(<CompanionPicker value={[]} onChange={() => {}} />);
    await waitFor(() => expect(mocks.list).toHaveBeenCalled());
    await userEvent.type(screen.getByRole("combobox"), "An");
    expect(await screen.findByText("Anna")).toBeInTheDocument();
  });

  it("still accepts a name that is not in the list", async () => {
    const onChange = vi.fn();
    render(<CompanionPicker value={[]} onChange={onChange} />);
    await userEvent.type(screen.getByRole("combobox"), "Neue Person{Enter}");
    expect(onChange).toHaveBeenCalledWith(["Neue Person"]);
  });

  it("renders the current value as removable chips", async () => {
    const onChange = vi.fn();
    render(<CompanionPicker value={["Anna"]} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /Anna entfernen/i }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  // A failed suggestion fetch must not block typing.
  it("stays usable when the suggestion list fails to load", async () => {
    mocks.list.mockRejectedValue(new Error("offline"));
    const onChange = vi.fn();
    render(<CompanionPicker value={[]} onChange={onChange} />);
    await userEvent.type(screen.getByRole("combobox"), "Anna{Enter}");
    expect(onChange).toHaveBeenCalledWith(["Anna"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest --run src/components/__tests__/CompanionPicker.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`companionsApi.list()` calls `GET /companions` and returns `response.data.companions`. `CompanionPicker` renders chips for `value`, a combobox input, and a filtered suggestion list; Enter commits the typed text; suggestion clicks commit the suggestion; a failed fetch leaves the suggestion list empty and logs a warning without disabling input.

- [ ] **Step 4: Run test to verify it passes**

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/api/companions.ts frontend/src/components/CompanionPicker.tsx frontend/src/components/__tests__/CompanionPicker.test.tsx
git commit -m "feat(companions): shared companion picker

Autocomplete over the user's known companions, free entry still allowed. A
failed suggestion fetch degrades to a plain input rather than blocking entry."
```

---

### Task 12: Use the picker in all three domains

**Files:**
- Modify: `frontend/src/components/FlightEditModal.tsx`, `frontend/src/components/FlightForm/FlightCompleteStep.tsx`, `frontend/src/components/Cruise/CruiseEditModal.tsx`, and the trip form under `frontend/src/components/Trip/`
- Test: extend each component's existing test file

**Interfaces:**
- Consumes: `CompanionPicker` from Task 11
- Produces: no API change

- [ ] **Step 1: Write the failing test**

For each of the four forms, assert that a companion picker is rendered and that submitting passes the chips through unchanged as `companions: string[]`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest --run src/components`
Expected: FAIL — the forms still render plain comma-separated text inputs.

- [ ] **Step 3: Replace the inputs**

Swap the comma-joined text input for `<CompanionPicker value={…} onChange={…} />` in each form, converting the existing comma-separated state to and from an array at the boundary.

- [ ] **Step 4: Run the full frontend suite**

Run: `cd frontend && npx vitest --run`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src
git commit -m "feat(companions): use the picker in flight, trip and cruise forms"
```

---

### Task 13: Excel round-trip regression

**Files:**
- Test: `frontend/src/lib/__tests__/xlsxRoundTrip.companions.test.ts`

**Interfaces:**
- Consumes: nothing new
- Produces: the guard that keeps the contract string-based

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, expect } from "vitest";
import { flightToRow, rowToFlight } from "../xlsxRoundTrip";

describe("companions survive the Excel round trip", () => {
  it("exports and re-imports names unchanged, including diacritics and order", () => {
    const original = { companions: ["Anna Müller", "Jonas"] } as never;
    const restored = rowToFlight(flightToRow(original));
    expect(restored.companions).toEqual(["Anna Müller", "Jonas"]);
  });
});
```

Adjust the imported helper names to the real exports in `xlsxRoundTrip.ts`.

- [ ] **Step 2: Run it**

Run: `cd frontend && npx vitest --run src/lib/__tests__/xlsxRoundTrip.companions.test.ts`
Expected: PASS immediately — nothing about the export changed. The test exists so that a future change to the contract fails here loudly.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/__tests__/xlsxRoundTrip.companions.test.ts
git commit -m "test(companions): pin the Excel round trip

The export and re-import are string-based, which is why the API contract stays
arrays of names. This test fails the moment someone changes that."
```

---

### Task 14: Full gate and verification

- [ ] **Step 1: Backend gate**

```bash
cd backend
npx tsc --noEmit
npm run lint
DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_dev" npm test -- --forceExit
```
Expected: 0 errors, suite green.

- [ ] **Step 2: Frontend gate**

```bash
cd frontend
npx tsc --noEmit
npm run lint
npx vitest --run
npx vite build
```
Expected: all green. Run `npm run lint` on its own line, not behind a pipe — a pipe swallows its exit code.

- [ ] **Step 3: Re-seed the dev admin**

```bash
cd backend
DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_dev" npm run seed:dev-admin
```

- [ ] **Step 4: Verify the rollback guarantee**

```bash
docker exec travstats-db-dev psql -U flights_dev -d flights_dev -c \
  "SELECT COUNT(*) FROM flights f WHERE cardinality(f.companions) <> (SELECT COUNT(*) FROM flight_companions fc WHERE fc.flight_id = f.id);"
```
Expected: 0. Any other number means the legacy array and the links disagree, and rolling back to the previous image would lose data.

- [ ] **Step 5: Browser verification**

Start the dev servers (`VITE_API_URL` in the shell, not only `.env.local`). Add a flight with two companions, edit it to one, add a trip with the same person spelled differently, and confirm: the picker suggests the existing person, no duplicate appears in the suggestion list, and the console stays clean.

- [ ] **Step 6: Commit any fixes and report**

Report the numbers from each gate rather than asserting success.
