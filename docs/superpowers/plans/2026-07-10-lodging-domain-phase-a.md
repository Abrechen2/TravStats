# Lodging Domain (Hotels) — Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the core Lodging (Hotels) domain — models, CRUD, manual entry, chains, memberships, trip-timeline, map pins, achievements, stats, base-currency + historical FX, and turn the domain on — mirroring the cruise domain end-to-end.

**Architecture:** New multi-domain domain `lodging`. A `Lodging` (the place) is reused across many `LodgingStay` events (standalone or trip-linked, via a direct `Trip.lodgingStays` FK like `Trip.cruises`). `LodgingChain` + `LodgingMembership` are reference/loyalty tables. Spend is stored in the stay's original currency plus a **snapshot** conversion to the user's `baseCurrency` at the check-in-day ECB rate (Frankfurter.app). Backend is Express/Prisma; frontend is React/Vite mirroring the cruise dashboard tab + detail pages.

**Tech Stack:** TypeScript (strict), Express, Prisma/PostgreSQL, Zod, Pino, Jest (backend), React + Vite + Zustand + react-i18next, Vitest, deck.gl + MapLibre (`MapboxOverlay` pattern).

**Source spec:** `docs/superpowers/specs/2026-07-04-lodging-domain-design.md` (§7.1 is the FX design). Mockup: `docs/design/lodging-mockup.html`.

## Global Constraints

- **TS `strict: true`; `any` is FORBIDDEN** — use `unknown` + type guards (exception: `.d.ts`).
- **Pino logger only** — `import logger from '../utils/logger'`; no `console.log`.
- **Zod at every boundary** — schemas live in `backend/src/schemas/`.
- **Immutability** — spread `{...obj, field}`, never mutate in place.
- **Async** — always `async/await`, never `.then()`.
- **File size** — 200–400 lines ideal, **800 hard max**; split when a file grows unwieldy.
- **Prisma JSON** — cast via `as unknown as Prisma.InputJsonValue`.
- **Auth cookie** — JWT is an HttpOnly cookie; frontend Axios uses `withCredentials: true`.
- **React hooks** — `useTranslation` from `'../hooks/useTranslation'` (project wrapper), NOT `react-i18next`.
- **Domain gating** — shared code iterates `AVAILABLE_DOMAINS`; register BOTH `backend/src/shared/domains.ts` and `frontend/src/shared/domains.ts`; frontend features check `useEnabledDomains()`.
- **i18n** — user-facing copy DE primary + EN secondary, always update `de` and `en` together.
- **Code / comments / commits — English.** UI copy — German + English.
- **NEVER touch `backend/VERSION` or `CHANGELOG.md`** on this dev branch (owned by `/deploy`).
- **NEVER run `taskkill`** — if a port/DLL is locked, ask the user to stop the process.
- **Migration** — drift is already fixed and checked by `npm run check:drift` in the pre-deploy gate (it is NOT in CI — forgejo#60; this line claimed otherwise until 2026-09-04); generate with `npx prisma migrate dev` and keep the check green.
- **deck.gl + MapLibre** — `MapboxOverlay` + `useControl`, never `<DeckGL>`.
- **GitNexus** — run `gitnexus_impact` before editing a shared symbol; `gitnexus_detect_changes` before committing.

---

## File Structure

**Backend — create:**
- `backend/src/services/fx/frankfurter.ts` — historical ECB FX (getRate / convertToBase), cached.
- `backend/src/services/geo/nominatim.ts` — OSM geocoding (address→coords), throttled + cached.
- `backend/src/schemas/lodging.ts` — Zod schemas for lodging, stay, chain, membership, query.
- `backend/src/routes/lodging.ts` — Lodging CRUD + nested stays (+ receipt upload).
- `backend/src/routes/lodgingChains.ts` — chain search + user-add.
- `backend/src/routes/lodgingMemberships.ts` — membership CRUD.
- `backend/src/utils/lodgingStats.ts` — `calculateLodgingStats` (pure).
- `backend/src/data/achievementSeeds/partD.ts` — lodging + cross-domain achievements.
- `backend/src/seedLodgingChainsFromCSV.ts` — idempotent chain seed.
- `backend/src/seedData/lodging_chains.csv` — seed rows.

**Backend — modify:**
- `backend/prisma/schema.prisma` — 4 new models + `Trip.lodgingStays` + `UserSettings.baseCurrency`.
- `backend/src/shared/domains.ts` — rename `hotel` → `lodging` (enable it).
- `backend/src/data/achievements.ts` — extend `domain` union with `'lodging'`.
- `backend/src/utils/achievementChecks.ts` — lodging requirement-type cases.
- `backend/src/utils/achievementStats.ts` — lodging fields into `UserStats` + cross-domain union.
- `backend/src/routes/stats.ts` — `GET /stats/lodging`.
- `backend/src/routes/settings/*` (or `appSettings.ts`) — read/write `baseCurrency`.
- `backend/src/index.ts` — mount the new routers + call the chain seed at boot.

**Frontend — create:**
- `frontend/src/types/lodging.ts` — DTO types.
- `frontend/src/lib/api/lodging.ts` — API client.
- `frontend/src/components/Dashboard/tabs/LodgingTab.tsx` — dashboard tab.
- `frontend/src/components/layers/lodgingPinsLayer.ts` — deck.gl pin layer builder.
- `frontend/src/pages/LodgingListPage.tsx`, `frontend/src/pages/LodgingDetailPage.tsx`.
- `frontend/src/components/lodging/StayEditor.tsx`, `ChainPicker.tsx`, `MembershipManager.tsx`.

**Frontend — modify:**
- `frontend/src/shared/domains.ts` — mirror the rename.
- `frontend/src/types/dashboard.ts` — add `lodging` tab + `LODGING_MODES` + registry entry.
- `frontend/src/components/.../DomainTabStrip.tsx`, `frontend/src/pages/DashboardPage.tsx` — wire the tab.
- `frontend/src/components/.../MapContainer3D.tsx` — lodging pin override prop.
- Settings page — base-currency selector.
- `frontend/src/i18n/locales/de/*` + `en/*` — lodging strings.
- App router — register `/lodging` list + detail routes.

**Sequencing:** Tasks 1–12 (backend) are independently testable and should land first. Tasks 13–20 (frontend) depend on the API shape from tasks 4–10. FX (Task 3) is consumed by Task 5. Geocoding (Task 5b) extends Task 5's routes and must land after it.

---

## Task 1: Domain registration (rename `hotel` → `lodging`)

**Files:**
- Modify: `backend/src/shared/domains.ts`
- Modify: `frontend/src/shared/domains.ts`
- Test: `backend/src/shared/__tests__/domains.test.ts` (create if absent)

**Interfaces:**
- Produces: domain key `'lodging'` present in `DOMAIN_KEYS` / `AVAILABLE_DOMAINS`; `DOMAINS.lodging` with `{ key:'lodging', available:true, i18nKey:'domain.lodging', icon:'🏨', routePrefix:'/lodging', color:'#d4778f' }`.

- [ ] **Step 1: Run impact analysis**

Run: `gitnexus_impact({target: "DOMAIN_KEYS", direction: "upstream"})` and skim callers. Expect shared iteration sites (domain gating). Report risk to the user if HIGH/CRITICAL.

- [ ] **Step 2: Write the failing test**

`backend/src/shared/__tests__/domains.test.ts`:
```typescript
import { DOMAIN_KEYS, DOMAINS, AVAILABLE_DOMAINS } from "../domains";

describe("lodging domain registration", () => {
  it("replaces the hotel stub with an enabled lodging domain", () => {
    expect(DOMAIN_KEYS).toContain("lodging");
    expect(DOMAIN_KEYS).not.toContain("hotel");
    expect(DOMAINS.lodging.available).toBe(true);
    expect(DOMAINS.lodging.routePrefix).toBe("/lodging");
    expect(AVAILABLE_DOMAINS).toContain("lodging"); // AVAILABLE_DOMAINS is DomainKey[], not descriptors
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && npx jest src/shared/__tests__/domains.test.ts`
Expected: FAIL — `DOMAIN_KEYS` still contains `hotel`, not `lodging`.

- [ ] **Step 4: Rename the entry in `backend/src/shared/domains.ts`**

In `DOMAIN_KEYS` change `'hotel'` → `'lodging'`. Replace the `hotel:` block in `DOMAINS` with:
```typescript
  lodging: {
    key: "lodging",
    i18nKey: "domain.lodging",
    icon: "🏨",
    color: "#d4778f",
    available: true,
    routePrefix: "/lodging",
    // parserSupported stays false until Phase B adds the lodging parser.
  },
```
Keep the exact shape of the sibling entries (copy the `cruise` entry's fields). Do NOT add `'lodging'` to `PARSER_SUPPORTED_DOMAINS` yet (Phase B).

- [ ] **Step 5: Mirror in `frontend/src/shared/domains.ts`**

Apply the identical rename/shape change to the frontend mirror so both files agree.

- [ ] **Step 6: Run tests + typecheck**

Run: `cd backend && npx jest src/shared/__tests__/domains.test.ts && npx tsc --noEmit`
Expected: PASS. If `tsc` flags a now-dangling `'hotel'` literal elsewhere, note it — later tasks (dashboard) handle the frontend tab; fix any backend reference to `'hotel'` to `'lodging'` here.

- [ ] **Step 7: Commit**
```bash
git add backend/src/shared/domains.ts frontend/src/shared/domains.ts backend/src/shared/__tests__/domains.test.ts
git commit -m "feat(lodging): register lodging domain (rename hotel stub)"
```

---

## Task 2: Prisma models + migration

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Modify: `backend/src/data/achievements.ts` (domain union — needed so the schema-adjacent types compile with lodging)
- Migration: generated `backend/prisma/migrations/<ts>_lodging_domain/`

**Interfaces:**
- Produces: Prisma models `Lodging`, `LodgingStay`, `LodgingChain`, `LodgingMembership`; `Trip.lodgingStays`; `UserSettings.baseCurrency`. Column naming mirrors existing models (camelCase prop + snake_case `@map`).

- [ ] **Step 1: Stop any running dev backend**

The Windows Prisma DLL lock (`EPERM ... query_engine-windows.dll.node`) triggers if a backend holds the old client. Ask the user to stop the backend on port 8000/8001 before generating (do NOT `taskkill` yourself).

- [ ] **Step 2: Add the models to `schema.prisma`**

Append (place near `Cruise`; keep the file's existing style — `@map`, `@@index`, `@@map`):
```prisma
model Lodging {
  id            String   @id @default(uuid())
  userId        String   @map("user_id")
  type          String   @default("hotel") // hotel | campsite
  name          String
  chainId       Int?     @map("chain_id")
  address       String?
  city          String?
  country       String?
  lat           Float?
  lon           Float?
  stars         Int?     // official 1–5
  amenities     String[] @default([])
  notes         String?
  dataSource    String?  @map("data_source") // parser | manual | enriched
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  user  User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  chain LodgingChain? @relation(fields: [chainId], references: [id], onDelete: SetNull)
  stays LodgingStay[]

  @@index([userId])
  @@index([userId, type])
  @@map("lodgings")
}

model LodgingStay {
  id               String    @id @default(uuid())
  lodgingId        String    @map("lodging_id")
  userId           String    @map("user_id")
  tripId           String?   @map("trip_id")
  bookingId        String?   @map("booking_id")
  checkIn          DateTime  @map("check_in")  // hotel-local, do not normalize to UTC
  checkOut         DateTime  @map("check_out")
  status           String    @default("completed") // scheduled | completed | cancelled
  roomNumber       String?   @map("room_number")
  roomCategory     String?   @map("room_category")
  board            String?   // none | breakfast | half | full | all_inclusive
  pricePerNight    Float?    @map("price_per_night")
  currency         String?   @default("EUR")
  totalPrice       Float?    @map("total_price")
  totalPriceBase   Float?    @map("total_price_base")   // FX snapshot (§7.1)
  fxRate           Float?    @map("fx_rate")
  fxRateDate       DateTime? @map("fx_rate_date")
  fxBaseCurrency   String?   @map("fx_base_currency")
  isAwardStay      Boolean   @default(false) @map("is_award_stay")
  ratingRoom       Float?    @map("rating_room")
  ratingBreakfast  Float?    @map("rating_breakfast")
  ratingService    Float?    @map("rating_service")
  ratingOverall    Float?    @map("rating_overall")
  roomAmenities    String[]  @default([]) @map("room_amenities")
  bookingReference String?   @map("booking_reference")
  membershipId     String?   @map("membership_id")
  receiptUrl       String?   @map("receipt_url")
  companions       String[]  @default([])
  notes            String?
  parserTemplate   String?   @map("parser_template")
  parserConfidence Int?      @map("parser_confidence")
  dataSource       String?   @map("data_source")
  createdAt        DateTime  @default(now()) @map("created_at")
  updatedAt        DateTime  @updatedAt @map("updated_at")

  lodging    Lodging            @relation(fields: [lodgingId], references: [id], onDelete: Cascade)
  user       User               @relation(fields: [userId], references: [id], onDelete: Cascade)
  trip       Trip?              @relation(fields: [tripId], references: [id], onDelete: SetNull)
  booking    Booking?           @relation(fields: [bookingId], references: [id], onDelete: SetNull)
  membership LodgingMembership? @relation(fields: [membershipId], references: [id], onDelete: SetNull)

  @@index([userId])
  @@index([lodgingId])
  @@index([userId, checkIn])
  @@index([status])
  @@index([tripId])
  @@index([bookingId])
  @@map("lodging_stays")
}

model LodgingChain {
  id             Int      @id @default(autoincrement())
  name           String
  brandColor     String?  @map("brand_color")
  loyaltyProgram String?  @map("loyalty_program")
  isUserAdded    Boolean  @default(false) @map("is_user_added")
  createdAt      DateTime @default(now()) @map("created_at")

  lodgings    Lodging[]
  memberships LodgingMembership[]

  @@index([name])
  @@map("lodging_chains")
}

model LodgingMembership {
  id               String   @id @default(uuid())
  userId           String   @map("user_id")
  programName      String   @map("program_name")
  chainId          Int?     @map("chain_id")
  membershipNumber String?  @map("membership_number")
  tier             String?
  createdAt        DateTime @default(now()) @map("created_at")
  updatedAt        DateTime @updatedAt @map("updated_at")

  user  User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  chain LodgingChain? @relation(fields: [chainId], references: [id], onDelete: SetNull)
  stays LodgingStay[]

  @@index([userId])
  @@map("lodging_memberships")
}
```

- [ ] **Step 3: Add the back-relations + settings column**

On `model User { ... }` add: `lodgings Lodging[]`, `lodgingStays LodgingStay[]`, `lodgingMemberships LodgingMembership[]`.
On `model Trip { ... }` add: `lodgingStays LodgingStay[]`.
On `model Booking { ... }` add: `lodgingStays LodgingStay[]`.
On `model UserSettings { ... }` add: `baseCurrency String? @default("EUR") @map("base_currency")`.

- [ ] **Step 4: Generate the migration**

Run: `cd backend && DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_dev" npx prisma migrate dev --name lodging_domain`
Expected: creates `prisma/migrations/<ts>_lodging_domain/migration.sql` with ONLY the new tables/columns/indexes (no unrelated drift statements — drift is already reconciled). If it bundles unrelated `ALTER`s, STOP and report: the drift baseline is off; do not commit.

- [ ] **Step 5: Verify drift is clean**

Run: `cd backend && DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_dev" npm run check:drift`
Expected: `OK — DB state and schema.prisma agree.`

- [ ] **Step 6: Typecheck (client regenerated)**

Run: `cd backend && npx tsc --noEmit`
Expected: PASS. Prisma client now exports `Lodging`, `LodgingStay`, etc.

- [ ] **Step 7: Commit**
```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(lodging): add Lodging/LodgingStay/LodgingChain/LodgingMembership models + baseCurrency"
```

---

## Task 2b: Schema hardening (from the cold data-model review)

> Two independent cold reviews (Codex `gpt-5.5`, Gemini) of the Task-2 schema converged on
> the same defects. Owner decisions 2026-07-11 are folded in below. This lands as a **second
> generated migration** on top of `20260711061740_lodging_domain` — the tables are new and
> empty, so every change here is free now and expensive later.

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Migration: generated `backend/prisma/migrations/<ts>_lodging_hardening/`
- Test: `backend/src/__tests__/lodgingSchema.test.ts` (create — proves the constraints exist)

**Interfaces:**
- Produces: the same four models, with the constraint/index/nullability fixes below.

### The changes (exactly these — nothing else)

1. **FK indexes** (Postgres does NOT auto-index foreign keys; both `SET NULL` deletes would otherwise full-table-scan `lodging_stays`):
   - `Lodging` → add `@@index([chainId])`
   - `LodgingMembership` → add `@@index([chainId])` — **superseded by change 4; skip it, the column is going away**
   - `LodgingStay` → add `@@index([membershipId])`
2. **Drop the redundant index** on `LodgingStay`: `@@index([userId])` is a strict prefix of `@@index([userId, checkIn])`, so it only costs write throughput. Remove it, keep the composite.
3. **`LodgingChain.name` becomes `@unique`** — the CSV seed (Task 7) must be idempotent. With a unique constraint the seed is a clean `upsert` keyed on `name`; without it, a re-seed on every container boot can duplicate every chain. (This also simplifies Task 7: use `upsert`, not `findFirst`-then-create. User-added rows still survive because they are matched by the same unique name.)
4. **Loyalty is program-based** (owner decision): several chains share one program (Sheraton/Westin/Ritz-Carlton → Marriott Bonvoy), so a membership must NOT be pinned to a single chain.
   - `LodgingMembership` → **remove** the `chainId` field AND the `chain` relation.
   - `LodgingChain` → **remove** the now-dangling `memberships LodgingMembership[]` back-relation.
   - `LodgingMembership` → add `@@unique([userId, programName])` (a user has one membership per program).
   - The chain already carries `loyaltyProgram`, so stay → program attribution resolves through `Lodging.chain.loyaltyProgram`. `LodgingStay.membershipId` stays as it is.
5. **Nullable-with-default columns become NOT NULL** (a default on a nullable column is a trap: an explicit `null` write bypasses the default and the TS code carries `string | null` forever):
   - `UserSettings.baseCurrency` → `String @default("EUR") @map("base_currency")`
   - `LodgingStay.currency` → `String @default("EUR")`
   - The generated migration must backfill before the NOT NULL flip. `base_currency` was added with `DEFAULT 'EUR'` in the previous migration, so existing rows already hold `'EUR'` — but **verify the generated SQL contains the backfill/`SET DEFAULT` before `SET NOT NULL`**, and if Prisma emits a bare `SET NOT NULL`, hand-add `UPDATE "user_settings" SET "base_currency" = 'EUR' WHERE "base_currency" IS NULL;` ahead of it. `lodging_stays` is empty, so it needs no backfill.

### Explicitly NOT doing (reviewed and rejected — do not "fix" these)

- **Money stays `Float`.** Codex argued for `Decimal`. Every pre-existing money column in this schema (`Flight.ticketPrice`, `Cruise.price`, `Booking.price`) is `Float?`; a Decimal island in one domain would break cross-domain spend aggregation and change the Prisma JS API for this domain only. House style wins.
- **No CHECK constraint requiring the FX fields when `totalPrice` is set.** That would contradict the core FX rule: a failed rate lookup must still save the stay, with `totalPriceBase = NULL` (see Task 5's "saves the stay even when FX fails" test).
- **No composite `(id, user_id)` FKs** to prevent cross-user references. Ownership is enforced in the routes (`findFirst({ where: { id, userId } })`) throughout this codebase; adding DB-level composite FKs here only would be inconsistent.
- **No `@@unique` on `Lodging`** (e.g. `[userId, name, city]`). Hotel dedup on import is Phase B's `lodgingEntityResolver` job, and a hard constraint would wrongly reject two genuinely different places with the same name and a null city.
- **`onDelete: Cascade` from `Lodging` to its stays stays as-is** (owner decision): deleting a hotel deletes its stays. The safety net is a UI confirmation showing the stay count, added in the frontend tasks — not a DB `Restrict`.

- [ ] **Step 1: Write the failing test**

`backend/src/__tests__/lodgingSchema.test.ts` — assert the constraints via the DB, not by reading the schema file (a test that greps `schema.prisma` proves nothing about the database):
```typescript
import prisma from "../db";

describe("lodging schema constraints", () => {
  afterEach(async () => {
    await prisma.lodgingMembership.deleteMany({ where: { programName: { startsWith: "TEST_" } } });
    await prisma.lodgingChain.deleteMany({ where: { name: { startsWith: "TEST_" } } });
  });

  it("rejects a duplicate chain name", async () => {
    await prisma.lodgingChain.create({ data: { name: "TEST_Chain" } });
    await expect(prisma.lodgingChain.create({ data: { name: "TEST_Chain" } })).rejects.toThrow();
  });

  it("rejects a second membership for the same user + program", async () => {
    const user = await prisma.user.findFirstOrThrow();
    await prisma.lodgingMembership.create({ data: { userId: user.id, programName: "TEST_Bonvoy" } });
    await expect(
      prisma.lodgingMembership.create({ data: { userId: user.id, programName: "TEST_Bonvoy" } }),
    ).rejects.toThrow();
  });

  it("defaults baseCurrency to EUR and never stores NULL", async () => {
    const user = await prisma.user.findFirstOrThrow();
    const settings = await prisma.userSettings.findUnique({ where: { userId: user.id } });
    expect(settings === null || typeof settings.baseCurrency === "string").toBe(true);
  });
});
```

- [ ] **Step 2: Run → fail** (`cd backend && npm test -- src/__tests__/lodgingSchema.test.ts --forceExit`). The duplicate-chain and duplicate-membership creates currently SUCCEED, so those two tests fail.

- [ ] **Step 3: Apply the schema changes** listed above.

- [ ] **Step 4: Generate the migration**

Run: `cd backend && npx prisma migrate dev --name lodging_hardening`
(The worktree's `backend/.env` already points `DATABASE_URL` at the isolated `flights_hotels` DB — do NOT point anything at `flights_dev`, it carries other branches' migrations and Prisma would offer to reset it.)
**Read the generated SQL**: it must touch only the lodging tables + the `user_settings.base_currency` NOT NULL flip. Verify the NOT NULL flip is preceded by a backfill (see change 5). Anything else → STOP, report BLOCKED.

- [ ] **Step 5: Run → pass. Then `npm run check:drift` (must pass `DATABASE_URL` explicitly — the script does not read `.env`) and `npx tsc --noEmit`.**

- [ ] **Step 6: Commit**
```bash
git add backend/prisma/schema.prisma backend/prisma/migrations backend/src/__tests__/lodgingSchema.test.ts
git commit -m "feat(lodging): harden schema — FK indexes, unique chain name, program-based memberships, NOT NULL currencies"
```

---

## Task 3: FX service (Frankfurter / ECB, historical, cached)

**Files:**
- Create: `backend/src/services/fx/frankfurter.ts`
- Test: `backend/src/services/fx/__tests__/frankfurter.test.ts`

**Interfaces:**
- Produces:
  - `getRate(from: string, to: string, date: string): Promise<number | null>` — `date` is `YYYY-MM-DD`; returns units of `to` per 1 `from`, or `null` on any failure.
  - `convertToBase(amount: number, from: string, base: string, date: Date): Promise<{ baseAmount: number; rate: number; rateDate: string } | null>` — returns `null` on failure; when `from === base` returns `{ baseAmount: amount, rate: 1, rateDate }` without a network call.

- [ ] **Step 1: Write the failing test**

`backend/src/services/fx/__tests__/frankfurter.test.ts` (mock `global.fetch`):
```typescript
import { getRate, convertToBase } from "../frankfurter";

describe("frankfurter FX", () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  it("returns the ECB rate for a historical date", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ amount: 1, base: "CHF", date: "2024-05-10", rates: { EUR: 1.0106 } }),
    }) as unknown as typeof fetch;
    const rate = await getRate("CHF", "EUR", "2024-05-13");
    expect(rate).toBeCloseTo(1.0106, 4);
  });

  it("short-circuits same-currency conversion with no network call", async () => {
    global.fetch = jest.fn() as unknown as typeof fetch;
    const out = await convertToBase(200, "EUR", "EUR", new Date("2024-05-13"));
    expect(out).toEqual({ baseAmount: 200, rate: 1, rateDate: "2024-05-13" });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns null (never throws) when the API fails", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("network")) as unknown as typeof fetch;
    expect(await getRate("CHF", "EUR", "2024-05-13")).toBeNull();
    expect(await convertToBase(420, "CHF", "EUR", new Date("2024-05-13"))).toBeNull();
  });

  it("rounds the converted base amount to 2 decimals", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ rates: { EUR: 1.0106 } }),
    }) as unknown as typeof fetch;
    const out = await convertToBase(420, "CHF", "EUR", new Date("2024-05-13"));
    expect(out?.baseAmount).toBe(424.45); // 420 * 1.0106 = 424.452
    expect(out?.rate).toBeCloseTo(1.0106, 4);
    expect(out?.rateDate).toBe("2024-05-13");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/services/fx/__tests__/frankfurter.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `frankfurter.ts`**
```typescript
import logger from "../../utils/logger";

const BASE_URL = "https://api.frankfurter.app";
// Cache one rate per (from,to,date) for the process lifetime. Historical ECB
// rates never change, so an unbounded map keyed by the tuple is safe and small.
const rateCache = new Map<string, number>();

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Units of `to` per 1 `from` on `date` (YYYY-MM-DD). null on any failure. */
export async function getRate(from: string, to: string, date: string): Promise<number | null> {
  if (from === to) return 1;
  const key = `${date}:${from}:${to}`;
  const cached = rateCache.get(key);
  if (cached !== undefined) return cached;
  try {
    const url = `${BASE_URL}/${date}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const res = await fetch(url);
    if (!res.ok) {
      logger.warn({ from, to, date, status: res.status }, "FX rate lookup non-OK");
      return null;
    }
    const body = (await res.json()) as { rates?: Record<string, number> };
    const rate = body.rates?.[to];
    if (typeof rate !== "number" || !Number.isFinite(rate)) {
      logger.warn({ from, to, date }, "FX rate missing in response");
      return null;
    }
    rateCache.set(key, rate);
    return rate;
  } catch (error) {
    logger.warn({ error, from, to, date }, "FX rate lookup failed");
    return null;
  }
}

export interface FxConversion {
  baseAmount: number;
  rate: number;
  rateDate: string;
}

/** Convert `amount` from `from` to `base` at the ECB rate for `date`. null on failure. */
export async function convertToBase(
  amount: number,
  from: string,
  base: string,
  date: Date,
): Promise<FxConversion | null> {
  const rateDate = toIsoDate(date);
  if (from === base) return { baseAmount: amount, rate: 1, rateDate };
  const rate = await getRate(from, base, rateDate);
  if (rate === null) return null;
  return { baseAmount: Math.round(amount * rate * 100) / 100, rate, rateDate };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/services/fx/__tests__/frankfurter.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**
```bash
git add backend/src/services/fx
git commit -m "feat(lodging): add historical ECB FX service (Frankfurter, cached, never throws)"
```

---

## Task 4: Zod schemas (`schemas/lodging.ts`)

**Files:**
- Create: `backend/src/schemas/lodging.ts`
- Test: `backend/src/schemas/__tests__/lodging.test.ts`

**Interfaces:**
- Consumes: nothing (self-contained).
- Produces: `createLodgingSchema`, `updateLodgingSchema`, `createStaySchema`, `updateStaySchema`, `lodgingQuerySchema`, `createMembershipSchema`, `updateMembershipSchema`; enums `BOARD_TYPES`, `LODGING_TYPES`, `STAY_STATUSES`, `CURRENCIES`. Types `LodgingInput`, `StayInput`, `LodgingQueryInput`, `MembershipInput`.

- [ ] **Step 1: Write the failing test**

`backend/src/schemas/__tests__/lodging.test.ts`:
```typescript
import {
  createLodgingSchema, createStaySchema, lodgingQuerySchema,
} from "../lodging";

describe("lodging schemas", () => {
  it("accepts a minimal valid lodging", () => {
    const r = createLodgingSchema.safeParse({ name: "NH Ludwigsburg", type: "hotel" });
    expect(r.success).toBe(true);
  });

  it("rejects an out-of-range star rating", () => {
    const r = createLodgingSchema.safeParse({ name: "X", stars: 7 });
    expect(r.success).toBe(false);
  });

  it("rejects checkOut before checkIn", () => {
    const r = createStaySchema.safeParse({
      checkIn: "2024-05-16T15:00:00.000Z",
      checkOut: "2024-05-14T11:00:00.000Z",
    });
    expect(r.success).toBe(false);
  });

  it("accepts a half-star rating", () => {
    const r = createStaySchema.safeParse({
      checkIn: "2024-05-14T15:00:00.000Z",
      checkOut: "2024-05-16T11:00:00.000Z",
      ratingOverall: 4.5,
    });
    expect(r.success).toBe(true);
  });

  it("coerces query year/limit from strings", () => {
    const r = lodgingQuerySchema.safeParse({ year: "2024", limit: "50" });
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ year: 2024, limit: 50 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/schemas/__tests__/lodging.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `schemas/lodging.ts`**

Mirror the conventions in `schemas/cruise.ts` (the `isoDateTime` preprocessor, `emptyToUndefined`, `.refine` date order, query `z.coerce`). Full file:
```typescript
import { z } from "zod";

export const LODGING_TYPES = ["hotel", "campsite"] as const;
export const BOARD_TYPES = ["none", "breakfast", "half", "full", "all_inclusive"] as const;
export const STAY_STATUSES = ["scheduled", "completed", "cancelled"] as const;
export const CURRENCIES = ["EUR", "USD", "GBP", "CHF"] as const;

const emptyToUndefined = z.string().optional().transform((v) => (v === "" ? undefined : v));

const isoDateTime = z.preprocess((v) => {
  if (typeof v !== "string" || v === "") return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toISOString();
}, z.string().datetime().nullable().optional());

const isoDateTimeRequired = z.preprocess((v) => {
  if (typeof v !== "string" || v === "") return v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toISOString();
}, z.string().datetime());

const rating = z.number().min(1).max(5).optional();

const baseLodgingSchema = z.object({
  type: z.enum(LODGING_TYPES).default("hotel"),
  name: z.string().trim().min(1).max(200),
  chainId: z.number().int().positive().nullable().optional(),
  address: z.string().max(300).optional(),
  city: z.string().max(120).optional(),
  country: z.string().max(120).optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lon: z.number().min(-180).max(180).nullable().optional(),
  stars: z.number().int().min(1).max(5).nullable().optional(),
  amenities: z.array(z.string().max(60)).max(50).optional(),
  notes: z.string().transform((v) => v.replace(/<[^>]*>/g, "")).optional(),
  dataSource: emptyToUndefined,
});

export const createLodgingSchema = baseLodgingSchema;
export const updateLodgingSchema = baseLodgingSchema.partial().refine(
  (d) => Object.keys(d).length > 0,
  { message: "At least one field must be provided for update" },
);

const baseStaySchema = z.object({
  checkIn: isoDateTimeRequired,
  checkOut: isoDateTimeRequired,
  status: z.enum(STAY_STATUSES).default("completed"),
  tripId: z.string().uuid().nullable().optional(),
  bookingId: z.string().uuid().nullable().optional(),
  roomNumber: z.string().max(20).optional(),
  roomCategory: z.string().max(120).optional(),
  board: z.enum(BOARD_TYPES).optional(),
  pricePerNight: z.number().min(0).optional(),
  currency: z.enum(CURRENCIES).optional(),
  totalPrice: z.number().min(0).optional(),
  isAwardStay: z.boolean().optional(),
  ratingRoom: rating,
  ratingBreakfast: rating,
  ratingService: rating,
  ratingOverall: rating,
  roomAmenities: z.array(z.string().max(60)).max(50).optional(),
  bookingReference: z.string().max(40).optional(),
  membershipId: z.string().uuid().nullable().optional(),
  companions: z.array(z.string().max(100)).max(50).optional(),
  notes: z.string().transform((v) => v.replace(/<[^>]*>/g, "")).optional(),
});

export const createStaySchema = baseStaySchema.refine(
  (d) => new Date(d.checkOut).getTime() >= new Date(d.checkIn).getTime(),
  { message: "checkOut must not precede checkIn", path: ["checkOut"] },
);
export const updateStaySchema = baseStaySchema.partial().refine(
  (d) => {
    if (!d.checkIn || !d.checkOut) return true;
    return new Date(d.checkOut).getTime() >= new Date(d.checkIn).getTime();
  },
  { message: "checkOut must not precede checkIn", path: ["checkOut"] },
);

export const lodgingQuerySchema = z.object({
  type: z.enum(LODGING_TYPES).optional(),
  chainId: z.coerce.number().int().positive().optional(),
  tripId: z.string().uuid().optional(),
  year: z.coerce.number().int().min(1900).max(2200).optional(),
  country: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  sort: z.enum(["nights", "rating", "spend", "name", "checkIn"]).optional(),
});

// Memberships are program-based, NOT chain-based (Task 2b): several chains share one
// program (Sheraton/Westin/Ritz-Carlton -> Marriott Bonvoy). There is no chainId here.
const baseMembershipSchema = z.object({
  programName: z.string().trim().min(1).max(120),
  membershipNumber: z.string().max(60).optional(),
  tier: z.string().max(40).optional(),
});
export const createMembershipSchema = baseMembershipSchema;
export const updateMembershipSchema = baseMembershipSchema.partial().refine(
  (d) => Object.keys(d).length > 0,
  { message: "At least one field must be provided for update" },
);

export type LodgingInput = z.infer<typeof baseLodgingSchema>;
export type StayInput = z.infer<typeof baseStaySchema>;
export type LodgingQueryInput = z.infer<typeof lodgingQuerySchema>;
export type MembershipInput = z.infer<typeof baseMembershipSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/schemas/__tests__/lodging.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**
```bash
git add backend/src/schemas/lodging.ts backend/src/schemas/__tests__/lodging.test.ts
git commit -m "feat(lodging): add Zod schemas for lodging, stay, membership, query"
```

---

## Task 5: Lodging + Stay CRUD routes (with FX on write)

**Files:**
- Create: `backend/src/routes/lodging.ts`
- Modify: `backend/src/index.ts` (mount router at `/api/v1/lodging`)
- Test: `backend/src/routes/__tests__/lodging.test.ts` (Jest + supertest; requires Postgres)

**Interfaces:**
- Consumes: schemas from Task 4; `convertToBase` from Task 3; `prisma` singleton (`backend/src/db.ts`); auth middleware (`authenticate`, `requireWriteScope`) — copy the exact imports from `routes/cruises.ts`.
- Produces: REST endpoints (all under `authenticate`):
  - `GET /` (query via `lodgingQuerySchema`, paginated, each lodging with derived `overallRating` + `nights`/`stays` counts)
  - `GET /:id` (lodging + its stays + derived overall rating)
  - `POST /` , `PATCH /:id`, `DELETE /:id`
  - `POST /:id/stays`, `PATCH /:id/stays/:stayId`, `DELETE /:id/stays/:stayId`
- Produces helper (exported for tests): `applyFxSnapshot(stay, baseCurrency): Promise<Partial<LodgingStay>>` — computes `totalPriceBase/fxRate/fxRateDate/fxBaseCurrency` (or clears them if no `totalPrice`).

- [ ] **Step 1: Read the cruise blueprint**

Read `backend/src/routes/cruises.ts` end-to-end. Copy its exact patterns: `router.use(authenticate)`, `requireWriteScope` on writes, ownership via `prisma.cruise.findFirst({ where: { id, userId } })`, `$transaction` for parent+child writes, fire-and-forget `checkAndUpdateAchievements(userId).catch(...)`, error passing via `next(error)`. Also note the receipt-upload middleware import for the later receipt sub-route.

- [ ] **Step 2: Write the failing test (FX snapshot on stay create)**

`backend/src/routes/__tests__/lodging.test.ts` — model it on `routes/__tests__/cruises.test.ts` (same auth-cookie test helper, same DB setup/teardown). Core FX assertion:
```typescript
// ... after creating a lodging and authenticating as its owner (baseCurrency=EUR):
it("snapshots a CHF stay into EUR base on create", async () => {
  jest.spyOn(fx, "convertToBase").mockResolvedValue({ baseAmount: 424.45, rate: 1.0106, rateDate: "2024-05-13" });
  const res = await agent.post(`/api/v1/lodging/${lodgingId}/stays`).send({
    checkIn: "2024-05-13T15:00:00.000Z", checkOut: "2024-05-15T11:00:00.000Z",
    totalPrice: 420, currency: "CHF",
  });
  expect(res.status).toBe(201);
  expect(res.body.data.totalPriceBase).toBe(424.45);
  expect(res.body.data.fxRate).toBeCloseTo(1.0106, 4);
  expect(res.body.data.fxBaseCurrency).toBe("EUR");
});

it("sets base = original for a same-currency stay", async () => {
  const res = await agent.post(`/api/v1/lodging/${lodgingId}/stays`).send({
    checkIn: "2024-06-01T15:00:00.000Z", checkOut: "2024-06-02T11:00:00.000Z",
    totalPrice: 150, currency: "EUR",
  });
  expect(res.body.data.totalPriceBase).toBe(150);
  expect(res.body.data.fxRate).toBe(1);
});

it("saves the stay even when FX fails (no base value)", async () => {
  jest.spyOn(fx, "convertToBase").mockResolvedValue(null);
  const res = await agent.post(`/api/v1/lodging/${lodgingId}/stays`).send({
    checkIn: "2024-07-01T15:00:00.000Z", checkOut: "2024-07-02T11:00:00.000Z",
    totalPrice: 200, currency: "USD",
  });
  expect(res.status).toBe(201);
  expect(res.body.data.totalPriceBase).toBeNull();
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && npm test -- src/routes/__tests__/lodging.test.ts --forceExit`
Expected: FAIL — router not mounted / 404.

- [ ] **Step 4: Implement `routes/lodging.ts`**

Structure (keep < 400 lines; if it grows past 400 split stays into `routes/lodgingStays.ts` and mount nested):
```typescript
import { Router, Response, NextFunction } from "express";
import prisma from "../db";
import logger from "../utils/logger";
import { authenticate, requireWriteScope, AuthRequest } from "../middleware/auth"; // match cruises.ts imports exactly
import { convertToBase } from "../services/fx/frankfurter";
import { checkAndUpdateAchievements } from "../services/achievementService"; // match cruises.ts
import {
  createLodgingSchema, updateLodgingSchema,
  createStaySchema, updateStaySchema, lodgingQuerySchema,
} from "../schemas/lodging";
import type { LodgingStay } from "@prisma/client";

const router = Router();
router.use(authenticate);

// Derived overall rating: average of stays' ratingOverall (nulls ignored). null when none.
function deriveOverallRating(stays: Array<{ ratingOverall: number | null }>): number | null {
  const vals = stays.map((s) => s.ratingOverall).filter((v): v is number => v !== null);
  if (vals.length === 0) return null;
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
}

// FX snapshot for a stay write. Returns the four fx_* fields (nulled when no total).
export async function applyFxSnapshot(
  input: { totalPrice?: number | null; currency?: string | null; checkIn: string | Date },
  baseCurrency: string,
): Promise<Pick<LodgingStay, "totalPriceBase" | "fxRate" | "fxRateDate" | "fxBaseCurrency">> {
  const cleared = { totalPriceBase: null, fxRate: null, fxRateDate: null, fxBaseCurrency: null };
  if (input.totalPrice == null) return cleared;
  const currency = input.currency ?? "EUR";
  const conv = await convertToBase(input.totalPrice, currency, baseCurrency, new Date(input.checkIn));
  if (conv === null) return cleared;
  return {
    totalPriceBase: conv.baseAmount,
    fxRate: conv.rate,
    fxRateDate: new Date(conv.rateDate),
    fxBaseCurrency: baseCurrency,
  };
}

async function getBaseCurrency(userId: string): Promise<string> {
  const s = await prisma.userSettings.findUnique({ where: { userId }, select: { baseCurrency: true } });
  return s?.baseCurrency ?? "EUR";
}

// GET / — list lodgings (paginated) with derived aggregates.
router.get("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const q = lodgingQuerySchema.parse(req.query);
    const where = {
      userId: req.user!.id,
      ...(q.type ? { type: q.type } : {}),
      ...(q.chainId ? { chainId: q.chainId } : {}),
      ...(q.country ? { country: q.country } : {}),
    };
    const lodgings = await prisma.lodging.findMany({
      where,
      include: { stays: true, chain: true },
      take: q.limit ?? 200,
      skip: q.offset ?? 0,
      orderBy: { createdAt: "desc" },
    });
    const data = lodgings.map((l) => ({
      ...l,
      overallRating: deriveOverallRating(l.stays),
      stayCount: l.stays.length,
      nights: l.stays.reduce((n, s) => n + nightsBetween(s.checkIn, s.checkOut), 0),
    }));
    res.json({ success: true, data });
  } catch (error) { next(error); }
});

function nightsBetween(checkIn: Date, checkOut: Date): number {
  const ms = checkOut.getTime() - checkIn.getTime();
  return Math.max(0, Math.round(ms / (24 * 60 * 60 * 1000)));
}

// GET /:id
router.get("/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const lodging = await prisma.lodging.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
      include: { stays: { orderBy: { checkIn: "desc" } }, chain: true },
    });
    if (!lodging) { res.status(404).json({ success: false, error: "Lodging not found" }); return; }
    res.json({ success: true, data: { ...lodging, overallRating: deriveOverallRating(lodging.stays) } });
  } catch (error) { next(error); }
});

// POST / — create lodging
router.post("/", requireWriteScope, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const input = createLodgingSchema.parse(req.body);
    const lodging = await prisma.lodging.create({ data: { ...input, userId: req.user!.id } });
    res.status(201).json({ success: true, data: lodging });
  } catch (error) { next(error); }
});

// PATCH /:id
router.patch("/:id", requireWriteScope, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const input = updateLodgingSchema.parse(req.body);
    const existing = await prisma.lodging.findFirst({ where: { id: req.params.id, userId: req.user!.id } });
    if (!existing) { res.status(404).json({ success: false, error: "Lodging not found" }); return; }
    const lodging = await prisma.lodging.update({ where: { id: existing.id }, data: input });
    res.json({ success: true, data: lodging });
  } catch (error) { next(error); }
});

// DELETE /:id (cascades to stays via schema)
router.delete("/:id", requireWriteScope, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.lodging.findFirst({ where: { id: req.params.id, userId: req.user!.id } });
    if (!existing) { res.status(404).json({ success: false, error: "Lodging not found" }); return; }
    await prisma.lodging.delete({ where: { id: existing.id } });
    checkAndUpdateAchievements(req.user!.id).catch((error) => logger.error({ error }, "achievement recheck failed"));
    res.json({ success: true });
  } catch (error) { next(error); }
});

// POST /:id/stays
router.post("/:id/stays", requireWriteScope, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const lodging = await prisma.lodging.findFirst({ where: { id: req.params.id, userId: req.user!.id } });
    if (!lodging) { res.status(404).json({ success: false, error: "Lodging not found" }); return; }
    const input = createStaySchema.parse(req.body);
    const base = await getBaseCurrency(req.user!.id);
    const fx = await applyFxSnapshot(input, base);
    const stay = await prisma.lodgingStay.create({
      data: { ...input, ...fx, lodgingId: lodging.id, userId: req.user!.id },
    });
    checkAndUpdateAchievements(req.user!.id).catch((error) => logger.error({ error }, "achievement recheck failed"));
    res.status(201).json({ success: true, data: stay });
  } catch (error) { next(error); }
});

// PATCH /:id/stays/:stayId — re-run FX when price/currency/checkIn change
router.patch("/:id/stays/:stayId", requireWriteScope, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const stay = await prisma.lodgingStay.findFirst({
      where: { id: req.params.stayId, lodgingId: req.params.id, userId: req.user!.id },
    });
    if (!stay) { res.status(404).json({ success: false, error: "Stay not found" }); return; }
    const input = updateStaySchema.parse(req.body);
    const merged = {
      totalPrice: input.totalPrice ?? stay.totalPrice,
      currency: input.currency ?? stay.currency,
      checkIn: input.checkIn ?? stay.checkIn,
    };
    const base = await getBaseCurrency(req.user!.id);
    const fx = await applyFxSnapshot(merged, base);
    const updated = await prisma.lodgingStay.update({ where: { id: stay.id }, data: { ...input, ...fx } });
    checkAndUpdateAchievements(req.user!.id).catch((error) => logger.error({ error }, "achievement recheck failed"));
    res.json({ success: true, data: updated });
  } catch (error) { next(error); }
});

// DELETE /:id/stays/:stayId
router.delete("/:id/stays/:stayId", requireWriteScope, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const stay = await prisma.lodgingStay.findFirst({
      where: { id: req.params.stayId, lodgingId: req.params.id, userId: req.user!.id },
    });
    if (!stay) { res.status(404).json({ success: false, error: "Stay not found" }); return; }
    await prisma.lodgingStay.delete({ where: { id: stay.id } });
    checkAndUpdateAchievements(req.user!.id).catch((error) => logger.error({ error }, "achievement recheck failed"));
    res.json({ success: true });
  } catch (error) { next(error); }
});

export default router;
```
> Verify the exact middleware import paths/names against `routes/cruises.ts` — if this repo names them differently (e.g. `AuthRequest` vs `AuthenticatedRequest`, `requireWriteScope` location), use the cruise file's names verbatim.

- [ ] **Step 5: Mount the router in `index.ts`**

Next to the cruises mount, add: `app.use("/api/v1/lodging", lodgingRouter);` with `import lodgingRouter from "./routes/lodging";`.

- [ ] **Step 6: Run tests + typecheck**

Run: `cd backend && npm test -- src/routes/__tests__/lodging.test.ts --forceExit && npx tsc --noEmit`
Expected: PASS. If `deriveOverallRating`/`nightsBetween` need reuse later, they can move to `utils/lodgingStats.ts` in Task 9 — leave here for now.

- [ ] **Step 7: Commit**
```bash
git add backend/src/routes/lodging.ts backend/src/routes/__tests__/lodging.test.ts backend/src/index.ts
git commit -m "feat(lodging): lodging + stay CRUD routes with historical FX snapshot on write"
```

---

## Task 5b: Geocoding service (OSM Nominatim) + geocode-on-save

> Owner decision 2026-07-11: address→coords lands in **Phase A** (spec §7), not Phase C.
> Mirrors the FX service exactly: keyless, cached, **never blocks a save**.

**Files:**
- Create: `backend/src/services/geo/nominatim.ts`
- Test: `backend/src/services/geo/__tests__/nominatim.test.ts`
- Modify: `backend/src/routes/lodging.ts` (geocode on POST / PATCH)
- Test: extend `backend/src/routes/__tests__/lodging.test.ts`

**Interfaces:**
- Produces:
  - `geocodeAddress(parts: { address?: string | null; city?: string | null; country?: string | null }): Promise<{ lat: number; lon: number } | null>` — `null` on any failure, empty input, or no result. **Never throws.**
  - `resolveCoordinates(input, existing?): Promise<{ lat: number; lon: number } | null>` — the route-facing helper: returns `null` (= leave coords untouched) when the caller supplied explicit coords or when there is no address to geocode; otherwise geocodes.
- Nominatim usage policy (hard requirements): descriptive `User-Agent` (`TravStats/1.0 (self-hosted travel logbook)`), **max 1 request/second** (serialize + throttle in-process), results cached per normalized query for the process lifetime.

- [ ] **Step 1: Write the failing test**

`backend/src/services/geo/__tests__/nominatim.test.ts` (mock `global.fetch`):
```typescript
import { geocodeAddress, resolveCoordinates } from "../nominatim";

const okResponse = (rows: unknown) =>
  ({ ok: true, json: async () => rows }) as unknown as Response;

describe("nominatim geocoder", () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  it("returns coordinates for an address", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      okResponse([{ lat: "47.3769", lon: "8.5417" }]),
    ) as unknown as typeof fetch;
    const out = await geocodeAddress({ address: "Bahnhofstrasse 1", city: "Zürich", country: "CH" });
    expect(out).toEqual({ lat: 47.3769, lon: 8.5417 });
  });

  it("sends a descriptive User-Agent (Nominatim usage policy)", async () => {
    const fetchMock = jest.fn().mockResolvedValue(okResponse([{ lat: "1", lon: "2" }]));
    global.fetch = fetchMock as unknown as typeof fetch;
    await geocodeAddress({ city: "Berlin" });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)["User-Agent"]).toMatch(/TravStats/);
  });

  it("returns null on empty input without any network call", async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    expect(await geocodeAddress({ address: "", city: null, country: null })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null (never throws) when the API fails or finds nothing", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("network")) as unknown as typeof fetch;
    expect(await geocodeAddress({ city: "Nowhere" })).toBeNull();
    global.fetch = jest.fn().mockResolvedValue(okResponse([])) as unknown as typeof fetch;
    expect(await geocodeAddress({ city: "Nowhere" })).toBeNull();
  });

  it("caches a repeated query (one network call)", async () => {
    const fetchMock = jest.fn().mockResolvedValue(okResponse([{ lat: "52.52", lon: "13.405" }]));
    global.fetch = fetchMock as unknown as typeof fetch;
    await geocodeAddress({ city: "Berlin", country: "DE" });
    await geocodeAddress({ city: "Berlin", country: "DE" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never geocodes when the caller supplied coordinates", async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    expect(await resolveCoordinates({ lat: 1, lon: 2, city: "Berlin" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/services/geo/__tests__/nominatim.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `services/geo/nominatim.ts`**

Structure (mirror `services/fx/frankfurter.ts` — module-level cache, `logger.warn` + `null` on every failure path, no throws):
```typescript
import logger from "../../utils/logger";

const BASE_URL = "https://nominatim.openstreetmap.org/search";
// Nominatim's usage policy demands a descriptive UA and at most 1 req/s.
const USER_AGENT = "TravStats/1.0 (self-hosted travel logbook)";
const MIN_INTERVAL_MS = 1000;
const REQUEST_TIMEOUT_MS = 5000;

export interface Coordinates {
  lat: number;
  lon: number;
}

// Geocoding results for an address are stable; cache for the process lifetime.
const cache = new Map<string, Coordinates | null>();
// Serializes requests so concurrent saves cannot exceed 1 req/s.
let queue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

function buildQuery(parts: {
  address?: string | null;
  city?: string | null;
  country?: string | null;
}): string {
  return [parts.address, parts.city, parts.country]
    .map((p) => p?.trim())
    .filter((p): p is string => !!p)
    .join(", ");
}

async function throttle(): Promise<void> {
  const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastRequestAt));
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestAt = Date.now();
}
```
Then `geocodeAddress`: build the query → return `null` if empty → cache hit? return it → chain onto `queue` (so calls serialize), `await throttle()`, `fetch(`${BASE_URL}?q=…&format=json&limit=1`, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })` → non-OK / empty array / unparseable lat-lon → cache + return `null` → else parse `Number(row.lat)` / `Number(row.lon)`, reject non-finite, cache, return. Every catch logs `logger.warn({ error, query }, "geocoding failed")` and returns `null`.

Then `resolveCoordinates(input: { lat?: number | null; lon?: number | null; address?: string | null; city?: string | null; country?: string | null }): Promise<Coordinates | null>`:
- If `input.lat != null && input.lon != null` → return `null` (caller's explicit coords win; nothing to fill).
- Else → `return geocodeAddress(input)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/services/geo/__tests__/nominatim.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Wire into `routes/lodging.ts` (POST + PATCH)**

In `POST /` — after `createLodgingSchema.parse`, before `prisma.lodging.create`:
```typescript
const coords = await resolveCoordinates(input);
const lodging = await prisma.lodging.create({
  data: { ...input, ...(coords ?? {}), userId: req.user!.id },
});
```
In `PATCH /:id` — only geocode when the address actually changed and the caller did not send coords:
```typescript
const addressChanged =
  (input.address !== undefined && input.address !== existing.address) ||
  (input.city !== undefined && input.city !== existing.city) ||
  (input.country !== undefined && input.country !== existing.country);
const coords = addressChanged
  ? await resolveCoordinates({
      lat: input.lat ?? null,
      lon: input.lon ?? null,
      address: input.address ?? existing.address,
      city: input.city ?? existing.city,
      country: input.country ?? existing.country,
    })
  : null;
const lodging = await prisma.lodging.update({
  where: { id: existing.id },
  data: { ...input, ...(coords ?? {}) },
});
```
A `null` from `resolveCoordinates` means "don't touch coords" — a failed geocode must never null out coordinates the user already had, and must never fail the request.

- [ ] **Step 6: Extend the route test** (`routes/__tests__/lodging.test.ts`)
```typescript
it("geocodes an address-only lodging on create", async () => {
  jest.spyOn(geo, "resolveCoordinates").mockResolvedValue({ lat: 47.3769, lon: 8.5417 });
  const res = await agent.post("/api/v1/lodging").send({ name: "Hotel Zürich", city: "Zürich" });
  expect(res.status).toBe(201);
  expect(res.body.data.lat).toBeCloseTo(47.3769, 4);
});

it("still saves the lodging when geocoding fails", async () => {
  jest.spyOn(geo, "resolveCoordinates").mockResolvedValue(null);
  const res = await agent.post("/api/v1/lodging").send({ name: "Hotel Nowhere", city: "Nowhere" });
  expect(res.status).toBe(201);
  expect(res.body.data.lat).toBeNull();
});

it("keeps explicit coordinates and does not geocode", async () => {
  const spy = jest.spyOn(geo, "resolveCoordinates");
  const res = await agent.post("/api/v1/lodging").send({ name: "Pinned", city: "Berlin", lat: 1.5, lon: 2.5 });
  expect(res.body.data.lat).toBe(1.5);
  expect(await spy.mock.results[0].value).toBeNull(); // resolveCoordinates short-circuits
});
```

- [ ] **Step 7: Run tests + typecheck**

Run: `cd backend && npm test -- src/services/geo src/routes/__tests__/lodging.test.ts --forceExit && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 8: Commit**
```bash
git add backend/src/services/geo backend/src/routes/lodging.ts backend/src/routes/__tests__/lodging.test.ts
git commit -m "feat(lodging): OSM Nominatim geocode-on-save (throttled, cached, never blocks a save)"
```

---

## Task 6: Chains + Memberships routes

**Files:**
- Create: `backend/src/routes/lodgingChains.ts`, `backend/src/routes/lodgingMemberships.ts`
- Modify: `backend/src/index.ts`
- Test: `backend/src/routes/__tests__/lodgingChains.test.ts`, `backend/src/routes/__tests__/lodgingMemberships.test.ts`

**Interfaces:**
- Consumes: schemas from Task 4; `prisma`; auth middleware.
- Produces:
  - Chains: `GET /` (optional `?search=`, returns catalog + user-added), `POST /` (create `isUserAdded:true`).
  - Memberships: `GET /`, `POST /`, `PATCH /:id`, `DELETE /:id` (all user-scoped).

- [ ] **Step 1: Write the failing tests**

`lodgingChains.test.ts`:
```typescript
it("searches chains case-insensitively", async () => {
  const res = await agent.get("/api/v1/lodging-chains?search=marr");
  expect(res.status).toBe(200);
  expect(res.body.data.some((c: { name: string }) => /marriott/i.test(c.name))).toBe(true);
});
it("adds a user chain flagged isUserAdded", async () => {
  const res = await agent.post("/api/v1/lodging-chains").send({ name: "My Boutique Group" });
  expect(res.status).toBe(201);
  expect(res.body.data.isUserAdded).toBe(true);
});
```
`lodgingMemberships.test.ts`:
```typescript
it("creates and lists a membership for the owner only", async () => {
  const create = await agent.post("/api/v1/lodging-memberships").send({ programName: "Marriott Bonvoy", tier: "Gold" });
  expect(create.status).toBe(201);
  const list = await agent.get("/api/v1/lodging-memberships");
  expect(list.body.data).toHaveLength(1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npm test -- src/routes/__tests__/lodgingChains.test.ts src/routes/__tests__/lodgingMemberships.test.ts --forceExit`
Expected: FAIL — 404.

- [ ] **Step 3: Implement both routers**

`lodgingChains.ts` (public read for authenticated users; write flags `isUserAdded`):
```typescript
import { Router, Response, NextFunction } from "express";
import prisma from "../db";
import { authenticate, requireWriteScope, AuthRequest } from "../middleware/auth";
import { createMembershipSchema } from "../schemas/lodging"; // not used here; keep chains minimal
import { z } from "zod";

const router = Router();
router.use(authenticate);
const chainCreate = z.object({ name: z.string().trim().min(1).max(120), loyaltyProgram: z.string().max(120).optional(), brandColor: z.string().regex(/^#?[0-9a-fA-F]{6}$/).optional() });

router.get("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    const chains = await prisma.lodgingChain.findMany({
      where: search ? { name: { contains: search, mode: "insensitive" } } : undefined,
      orderBy: { name: "asc" }, take: 100,
    });
    res.json({ success: true, data: chains });
  } catch (error) { next(error); }
});

router.post("/", requireWriteScope, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const input = chainCreate.parse(req.body);
    const chain = await prisma.lodgingChain.create({ data: { ...input, isUserAdded: true } });
    res.status(201).json({ success: true, data: chain });
  } catch (error) { next(error); }
});
export default router;
```
`lodgingMemberships.ts` — standard user-scoped CRUD using `createMembershipSchema`/`updateMembershipSchema`, ownership via `findFirst({ where: { id, userId } })`. Follow the exact shape of Task 5's lodging CRUD (auth, requireWriteScope, `{success,data}` envelope).

- [ ] **Step 4: Mount + run**

Add to `index.ts`: `app.use("/api/v1/lodging-chains", lodgingChainsRouter);` and `app.use("/api/v1/lodging-memberships", lodgingMembershipsRouter);`.
Run: `cd backend && npm test -- src/routes/__tests__/lodgingChains.test.ts src/routes/__tests__/lodgingMemberships.test.ts --forceExit`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add backend/src/routes/lodgingChains.ts backend/src/routes/lodgingMemberships.ts backend/src/routes/__tests__/lodgingChains.test.ts backend/src/routes/__tests__/lodgingMemberships.test.ts backend/src/index.ts
git commit -m "feat(lodging): chain search/add + membership CRUD routes"
```

---

## Task 7: Seed lodging chains (idempotent CSV)

**Files:**
- Create: `backend/src/seedLodgingChainsFromCSV.ts`, `backend/src/seedData/lodging_chains.csv`
- Modify: `backend/src/index.ts` (call at boot, like `seedShipsFromCSV`)
- Test: `backend/src/__tests__/seedLodgingChains.test.ts`

**Interfaces:**
- Consumes: `prisma`. Mirror `seedShipsFromCSV.ts` (idempotent; never overwrite `isUserAdded:true`). **`LodgingChain.name` is `@unique` since Task 2b**, so dedupe with a real `upsert` keyed on `name` — do NOT hand-roll `findFirst`-then-create (that races and was the original duplicate-chain risk the cold review flagged).
- Produces: `seedLodgingChainsFromCSV(): Promise<void>`.

- [ ] **Step 1: Read `seedShipsFromCSV.ts`** to copy its CSV parse + idempotent-upsert structure and its test's wipe/reseed convention (`beforeEach` wipes, `afterAll` reseeds — per CLAUDE.md seed-test convention).

- [ ] **Step 2: Create the CSV** `seedData/lodging_chains.csv`:
```csv
name,loyaltyProgram,brandColor
Marriott,Marriott Bonvoy,#a4123f
Hilton,Hilton Honors,#004990
IHG,IHG One Rewards,#611f69
Accor,ALL - Accor Live Limitless,#1a1a2e
Wyndham,Wyndham Rewards,#003da5
NH Hotels,NH Rewards,#e2001a
Radisson,Radisson Rewards,#d3172e
Best Western,Best Western Rewards,#e21e26
Meliá,MeliáRewards,#c8102e
Scandic,Scandic Friends,#00205b
```

- [ ] **Step 3: Write the failing test**
```typescript
it("seeds chains idempotently and preserves user-added rows", async () => {
  await seedLodgingChainsFromCSV();
  const first = await prisma.lodgingChain.count();
  await prisma.lodgingChain.create({ data: { name: "User Group", isUserAdded: true } });
  await seedLodgingChainsFromCSV(); // second run
  expect(await prisma.lodgingChain.count()).toBe(first + 1);
  expect(await prisma.lodgingChain.findFirst({ where: { name: "User Group" } })).not.toBeNull();
});
```

- [ ] **Step 4: Run → fail; implement `seedLodgingChainsFromCSV.ts`; run → pass.**

Run: `cd backend && npm test -- src/__tests__/seedLodgingChains.test.ts --forceExit`

- [ ] **Step 5: Call at boot** in `index.ts` next to `seedShipsFromCSV()` (same await/try-catch style). **Commit.**
```bash
git add backend/src/seedLodgingChainsFromCSV.ts backend/src/seedData/lodging_chains.csv backend/src/__tests__/seedLodgingChains.test.ts backend/src/index.ts
git commit -m "feat(lodging): idempotent lodging-chain CSV seed"
```

---

## Task 8: `baseCurrency` settings wiring

**Files:**
- Modify: the user-settings route (find it: `grep -rn "enabledDomains" backend/src/routes` → the GET/PATCH that reads/writes `UserSettings`) + its Zod schema.
- Test: add to that route's existing test file.

**Interfaces:**
- Consumes: `UserSettings.baseCurrency` column (Task 2).
- Produces: settings GET returns `baseCurrency`; PATCH accepts `baseCurrency` (enum `CURRENCIES`).

- [ ] **Step 1: Locate the settings route + schema.** Read it. Identify where `enabledDomains` is validated/returned.

- [ ] **Step 2: Write the failing test** — PATCH `{ baseCurrency: "CHF" }` then GET returns `baseCurrency: "CHF"`; PATCH `{ baseCurrency: "XXX" }` → 400.

- [ ] **Step 3: Run → fail. Add `baseCurrency: z.enum(["EUR","USD","GBP","CHF"]).optional()` to the settings Zod schema; include it in the select/return + update payload.**

- [ ] **Step 4: Run → pass. Typecheck. Commit.**
```bash
git commit -am "feat(lodging): expose baseCurrency in user settings"
```

---

## Task 9: `calculateLodgingStats` (pure)

**Files:**
- Create: `backend/src/utils/lodgingStats.ts`
- Test: `backend/src/utils/__tests__/lodgingStats.test.ts`

**Interfaces:**
- Consumes: nothing (pure). Input shape defined here.
- Produces:
```typescript
export interface LodgingStayData {
  lodgingId: string; type: string; country: string | null; city: string | null;
  chainId: number | null; checkIn: Date; checkOut: Date; status: string;
  totalPriceBase: number | null; currency: string | null; totalPrice: number | null;
  isAwardStay: boolean; ratingOverall: number | null;
}
export interface LodgingStats {
  lodgingsCount: number; staysCount: number; totalNights: number;
  nightsByYear: Record<string, number>;      // nights allocated to the correct year
  nightsByMonth: Record<string, number>;     // "YYYY-MM"
  longestStayNights: number; chainsUnique: number; citiesUnique: number;
  countries: Set<string>; countriesCount: number;
  spendBaseTotal: number;                    // sum of totalPriceBase (base currency)
  spendByCurrency: Record<string, number>;   // original amounts per currency
  awardNights: number; hotelNights: number; campsiteNights: number;
  avgRatingOverall: number | null;
  chainLoyaltyMax: number;                   // max stays at one chain
  sameHotelRepeatMax: number;                // max stays at one lodging
}
export function calculateLodgingStats(stays: LodgingStayData[]): LodgingStats;
```
- **Cancelled stays are excluded** (`status !== "cancelled"`). Nights across a year/month boundary are **allocated per night to the correct year/month** (a 30.12→02.01 stay adds 1 night to Dec and 2 to Jan-ish — count each night by the date it starts).

- [ ] **Step 1: Write the failing test**
```typescript
import { calculateLodgingStats, LodgingStayData } from "../lodgingStats";
const stay = (o: Partial<LodgingStayData>): LodgingStayData => ({
  lodgingId: "l1", type: "hotel", country: "DE", city: "Berlin", chainId: 1,
  checkIn: new Date("2024-05-14T00:00:00Z"), checkOut: new Date("2024-05-16T00:00:00Z"),
  status: "completed", totalPriceBase: 190, currency: "EUR", totalPrice: 190,
  isAwardStay: false, ratingOverall: 4, ...o,
});
describe("calculateLodgingStats", () => {
  it("sums nights and base spend, excluding cancelled", () => {
    const s = calculateLodgingStats([stay({}), stay({ status: "cancelled", totalPriceBase: 999 })]);
    expect(s.totalNights).toBe(2);
    expect(s.staysCount).toBe(1);
    expect(s.spendBaseTotal).toBe(190);
  });
  it("keeps a per-currency breakdown of originals", () => {
    const s = calculateLodgingStats([
      stay({ currency: "EUR", totalPrice: 190, totalPriceBase: 190 }),
      stay({ lodgingId: "l2", currency: "CHF", totalPrice: 420, totalPriceBase: 424 }),
    ]);
    expect(s.spendByCurrency).toEqual({ EUR: 190, CHF: 420 });
    expect(s.spendBaseTotal).toBe(614);
  });
  it("allocates nights across a year boundary to each year", () => {
    const s = calculateLodgingStats([stay({
      checkIn: new Date("2023-12-30T00:00:00Z"), checkOut: new Date("2024-01-02T00:00:00Z"),
    })]);
    expect(s.totalNights).toBe(3);
    expect(s.nightsByYear["2023"]).toBe(2); // nights of Dec 30, Dec 31
    expect(s.nightsByYear["2024"]).toBe(1); // night of Jan 1
  });
});
```

- [ ] **Step 2: Run → fail. Implement `lodgingStats.ts`** — a single pass over `stays.filter(s => s.status !== "cancelled")`, walking each night (`checkIn` up to but excluding `checkOut`) to bucket `nightsByYear`/`nightsByMonth`; accumulate Sets/Maps for chains, cities, countries, per-lodging + per-chain counts. `avgRatingOverall` rounds to 1 decimal.

- [ ] **Step 3: Run → pass.**

Run: `cd backend && npx jest src/utils/__tests__/lodgingStats.test.ts`

- [ ] **Step 4: Commit.**
```bash
git add backend/src/utils/lodgingStats.ts backend/src/utils/__tests__/lodgingStats.test.ts
git commit -m "feat(lodging): calculateLodgingStats (base-currency spend + per-year night allocation)"
```

---

## Task 10: `GET /stats/lodging` + cross-domain union

**Files:**
- Modify: `backend/src/routes/stats.ts` (add `GET /lodging`)
- Modify: `backend/src/utils/achievementStats.ts` (lodging fields in `UserStats` + fill from `calculateLodgingStats`)
- Test: `backend/src/routes/__tests__/statsLodging.test.ts`

**Interfaces:**
- Consumes: `calculateLodgingStats` (Task 9); `prisma`.
- Produces: `GET /api/v1/stats/lodging` → `{ success, data: LodgingStats-as-JSON }` (Sets serialized to arrays/counts). `UserStats` gains `lodgingsCount`, `lodgingNights`, `lodgingChainsUnique`, `lodgingCountries: Set<string>`, `lodgingSpendBase`, `lodgingAwardNights`, `lodgingChainLoyaltyMax`, `lodgingSameHotelRepeatMax`, `lodgingLongestStayNights`, plus cross-domain `flyAndStay: boolean`, `grandTour: boolean`.

- [ ] **Step 1: Write the failing test** — seed a user with a lodging+stay, GET `/api/v1/stats/lodging`, assert `data.totalNights` and `data.spendBaseTotal`.

- [ ] **Step 2: Run → fail. Add the route** (mirror `GET /stats/cruise` — load the user's stays via `prisma.lodgingStay.findMany({ where: { userId }, include: { lodging: true } })`, map to `LodgingStayData`, call `calculateLodgingStats`, serialize Sets: `countries: [...stats.countries]`).

- [ ] **Step 3: Extend `achievementStats.ts`** — add the lodging fields to the `UserStats` interface + initialize them in `calculateUserStats` (like the cruise block that's "filled in by caller via spread"). Compute `countries` union with flight+cruise for the shared "countries visited" number. `flyAndStay` = any trip has ≥1 flight and ≥1 stay; `grandTour` = a trip with flight + cruise + stay.

- [ ] **Step 4: Run → pass. Typecheck. Commit.**
```bash
git commit -am "feat(lodging): /stats/lodging + lodging fields in cross-domain UserStats"
```

---

## Task 11: Achievements — seeds + checks + domain union

**Files:**
- Create: `backend/src/data/achievementSeeds/partD.ts`
- Modify: `backend/src/data/achievements.ts` (domain union already touched in Task 2 — confirm `'lodging'` present), wire `seedsPartD` into wherever `seedsPartC` is aggregated (grep `seedsPartC`).
- Modify: `backend/src/utils/achievementChecks.ts` (lodging requirement-type cases)
- Test: `backend/src/utils/__tests__/achievementChecks.lodging.test.ts`

**Interfaces:**
- Consumes: `UserStats` lodging fields (Task 10); `AchievementDefinition` type.
- Produces: `seedsPartD: AchievementDefinition[]` (~40–50 items, `domain: 'lodging'` + shared); new `case` branches in the `achievementChecks.ts` switch for each new `requirementType`.

- [ ] **Step 1: Confirm the domain union** in `achievements.ts` reads `domain: 'flight' | 'cruise' | 'lodging' | 'shared';`. If Task 2 didn't add it, add it now.

- [ ] **Step 2: Write the failing test** (checker maps new types):
```typescript
import { checkRequirement } from "../achievementChecks"; // use the actual exported name
it("evaluates lodging_nights against UserStats.lodgingNights", () => {
  const stats = { lodgingNights: 12 } as unknown as UserStats;
  expect(checkRequirement({ requirementType: "lodging_nights", requirement: 10 } as AchievementDefinition, stats)).toBe(true);
  expect(checkRequirement({ requirementType: "lodging_nights", requirement: 50 } as AchievementDefinition, stats)).toBe(false);
});
```
> First read `achievementChecks.ts` to copy the exact signature (it's a `switch (achievement.requirementType)` returning a number or boolean — match how `flights_count` is handled).

- [ ] **Step 3: Run → fail. Add the `case`s** for each requirement type used by `partD.ts`: `lodgings_count`, `lodging_stays_count`, `lodging_nights`, `lodging_chains_unique`, `lodging_countries`, `lodging_chain_loyalty`, `lodging_award_nights`, `lodging_same_hotel_repeat`, `lodging_longest_stay`, `fly_and_stay`, `grand_tour`. Each returns the matching `UserStats` field (booleans for `fly_and_stay`/`grand_tour`).

- [ ] **Step 4: Create `partD.ts`** — follow `partC.ts` shape exactly (`code`, `name` DE, `description` DE, `category`, `domain:'lodging'`, `icon`, `tier`, `requirement`, `requirementType`, `points`). Cover the §9.2 catalog: First Check-in; Hotel Collector 5/10/25/50/100; Frequent Guest 10/25/50/100; Night Owl 10/50/100/365/1000; Long Stay 7/14/30; Chain Explorer 3/5/10/20; Brand Loyalty 5/10/25; Border Crosser 3/5/10/25; Points Pro (award nights); Returner (same hotel); plus shared Fly & Stay, Grand Tour. Aim 40–50.

- [ ] **Step 5: Wire `seedsPartD`** into the seed aggregator (grep where `seedsPartC` is imported/spread; add `...seedsPartD`).

- [ ] **Step 6: Run → pass. Typecheck. Commit.**
```bash
git add backend/src/data/achievementSeeds/partD.ts backend/src/data/achievements.ts backend/src/utils/achievementChecks.ts backend/src/utils/__tests__/achievementChecks.lodging.test.ts
git commit -m "feat(lodging): ~45 lodging + cross-domain achievements with requirement checks"
```

---

## Task 12: Backend integration smoke + full suite

- [ ] **Step 1: Run the full backend gate**

Run: `cd backend && npx tsc --noEmit && npm run lint && npm test -- --forceExit && DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_dev" npm run check:drift`
Expected: PASS + drift OK. (Two pre-existing flaky suites — cruise achievements teardown + parser live-LLM timeout — are known non-blockers per project memory; confirm no NEW failures.)

- [ ] **Step 2: Re-seed the dev admin** (the full jest run against `flights_dev` wipes `admin:admin123`):

Run: `cd backend && DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_dev" npm run seed:dev-admin`

- [ ] **Step 3: Commit any lint fixups.**

---

## Task 13: Frontend domain mirror + dashboard registry

**Files:**
- Modify: `frontend/src/types/dashboard.ts`
- Test: `frontend/src/types/__tests__/dashboard.test.ts` (create)

**Interfaces:**
- Consumes: Task 1's frontend `domains.ts` rename.
- Produces: `DASHBOARD_TABS` includes `"lodging"`; `LODGING_MODES = ["map","nights","chains"] as const`; `TAB_MODE_REGISTRY.lodging = { modes: LODGING_MODES, default: "map" }`; `DashboardMode` union includes `LodgingMode`.

- [ ] **Step 1: Write the failing test**
```typescript
import { DASHBOARD_TABS, TAB_MODE_REGISTRY, defaultModeForTab } from "../dashboard";
it("registers the lodging tab", () => {
  expect(DASHBOARD_TABS).toContain("lodging");
  expect(TAB_MODE_REGISTRY.lodging.modes).toContain("map");
  expect(defaultModeForTab("lodging")).toBe("map");
});
```

- [ ] **Step 2: Run → fail.** Run: `cd frontend && npx vitest --run src/types/__tests__/dashboard.test.ts`

- [ ] **Step 3: Edit `dashboard.ts`** — add `"lodging"` to `DASHBOARD_TABS`; add `LODGING_MODES`/`LodgingMode`; add to `DashboardMode` union; add the registry entry. The `satisfies Record<DashboardTab, ...>` constraint forces the entry — tsc fails until it's added.

- [ ] **Step 4: Run → pass. Typecheck.** `cd frontend && npx tsc --noEmit` **Commit.**
```bash
git add frontend/src/types/dashboard.ts frontend/src/types/__tests__/dashboard.test.ts
git commit -m "feat(lodging): register lodging dashboard tab + modes"
```

---

## Task 14: Frontend types + API client

**Files:**
- Create: `frontend/src/types/lodging.ts`, `frontend/src/lib/api/lodging.ts`
- Test: `frontend/src/lib/api/__tests__/lodging.test.ts` (mock the axios instance)

**Interfaces:**
- Consumes: the REST shapes from Tasks 5–6.
- Produces: `Lodging`, `LodgingStay`, `LodgingChain`, `LodgingMembership` TS types (mirror the Prisma models; dates as ISO strings; add derived `overallRating`, `stayCount`, `nights`). API client fns: `listLodgings(params)`, `getLodging(id)`, `createLodging`, `updateLodging`, `deleteLodging`, `createStay`, `updateStay`, `deleteStay`, `listChains(search)`, `createChain`, membership CRUD, `getLodgingStats()`.

- [ ] **Step 1: Read an existing client** (`frontend/src/lib/api/cruise.ts` or similar) to copy the axios instance import + `withCredentials` convention + `{success,data}` unwrap.

- [ ] **Step 2: Write a failing test** — mock the axios instance, assert `listLodgings` GETs `/lodging` with params and returns `data`.

- [ ] **Step 3: Run → fail. Implement `types/lodging.ts` + `lib/api/lodging.ts`. Run → pass. Typecheck. Commit.**
```bash
git commit -am "feat(lodging): frontend types + API client"
```

---

## Task 15: Lodging map pin layer + `MapContainer3D` override

**Files:**
- Create: `frontend/src/components/layers/lodgingPinsLayer.ts`
- Modify: `frontend/src/components/.../MapContainer3D.tsx` (add a `lodgingsOverride` prop + a lodging pin layer, mirroring `cruisesOverride`)
- Test: `frontend/src/components/layers/__tests__/lodgingPinsLayer.test.ts`

**Interfaces:**
- Consumes: `Lodging` type (with `lat`/`lon`).
- Produces: `buildLodgingPins(lodgings: Lodging[]): ScatterplotLayer|IconLayer` (only lodgings with non-null coords); a `MapContainer3D` `lodgingsOverride?: Lodging[]` prop rendering the layer in `map` mode.

- [ ] **Step 1: Read `cruiseArcsLayer.ts` + how `MapContainer3D` consumes `cruisesOverride`.** Copy the deck.gl layer-builder pattern (this repo uses `MapboxOverlay` — do NOT add a `<DeckGL>` component).

- [ ] **Step 2: Write a failing test** — `buildLodgingPins` drops coord-less lodgings and produces one datum per located lodging.

- [ ] **Step 3: Run → fail. Implement the layer + wire the override prop. Run → pass. Typecheck. Commit.**
```bash
git commit -am "feat(lodging): map pin layer + MapContainer3D lodging override"
```

---

## Task 16: LodgingTab (dashboard)

**Files:**
- Create: `frontend/src/components/Dashboard/tabs/LodgingTab.tsx`
- Modify: `DashboardPage.tsx` + `DomainTabStrip.tsx` (render the tab, gated by `useEnabledDomains().isEnabled('lodging')`)
- Test: `frontend/src/components/Dashboard/tabs/__tests__/LodgingTab.test.tsx`

**Interfaces:**
- Consumes: `listLodgings`, `getLodgingStats` (Task 14); `MapContainer3D` `lodgingsOverride` (Task 15); dashboard modes (Task 13).
- Produces: a tab with a stat strip (hotels / stays / nights / chains / base-currency spend / avg rating) + the map (`map` mode) + list; modes `map | nights | chains`.

- [ ] **Step 1: Read `CruisesTab.tsx`** — copy its structure (data fetch via react-query/hook, mode switch, `MapContainer3D` usage, stat strip). The lodging tab is the cruise tab with lodging data + the mockup's screen-①/⑥ stat strip.

- [ ] **Step 2: Write a failing test** — render `LodgingTab` with a mocked `listLodgings` returning 1 lodging; assert the hotel name + "nights" stat render.

- [ ] **Step 3: Run → fail. Implement `LodgingTab.tsx`; gate + render it in `DashboardPage`/`DomainTabStrip`. Run → pass. Commit.**
```bash
git commit -am "feat(lodging): dashboard LodgingTab (map/nights/chains) gated by enabled domains"
```

---

## Task 17: Lodging list + detail pages

**Files:**
- Create: `frontend/src/pages/LodgingListPage.tsx`, `frontend/src/pages/LodgingDetailPage.tsx`
- Modify: the app router (register `/lodging` + `/lodging/:id`, gated by enabled domain)
- Test: `frontend/src/pages/__tests__/LodgingDetailPage.test.tsx`

**Interfaces:**
- Consumes: Task 14 API client. Detail shows the hotel (address/stars/amenities/chain/map mini) + its stays (dates, nights, room, ratings, price + **FX readout** `840 CHF → 883 € · EZB 0,9895 · 12.05.24`) + derived overall rating. List: search + filters (type/year/country) + sort (nights/rating/spend/name).
- **Delete confirmation (owner decision, Task 2b):** deleting a lodging cascades to its stays in the DB. The detail page's delete action MUST therefore show a confirmation naming the stay count — DE: „Dieses Hotel hat {{count}} Übernachtungen. Beim Löschen gehen sie mit verloren." / EN: "This hotel has {{count}} stays. Deleting it removes them too." — before calling `deleteLodging`. This confirmation is the only safety net; there is deliberately no DB-level `Restrict`.

- [ ] **Step 1: Read the cruise list/detail pages** as templates. Reproduce the mockup screens ① (list) and ② (detail).

- [ ] **Step 2: Write a failing test** — detail page renders the FX readout line when a stay has `fxRate` + `totalPriceBase`.

- [ ] **Step 3: Run → fail. Implement both pages + routes. Run → pass. Commit.**
```bash
git commit -am "feat(lodging): lodging list + detail pages with FX readouts"
```

---

## Task 18: Stay editor + chain picker + membership manager

**Files:**
- Create: `frontend/src/components/lodging/StayEditor.tsx`, `ChainPicker.tsx`, `MembershipManager.tsx`
- Test: `frontend/src/components/lodging/__tests__/StayEditor.test.tsx`

**Interfaces:**
- Consumes: Task 14 API client; `CURRENCIES`/`BOARD_TYPES`/`STAY_STATUSES`.
- **`isAwardStay` MUST be settable here** (a toggle: "Prämienübernachtung" / "Award stay"). Task 11 shipped four `POINTS_PRO_*` achievements that count award nights — without a UI path to set the flag they are permanently unreachable.
- Produces: modal editor (dates, room, board segmented control, 1–5 half-star pickers for room/breakfast/service/overall, price + currency, room-amenity chips, booking ref, membership select, trip link, receipt upload) + a live **FX readout** (shows `X CUR → Y BASE · rate · date` once price+currency+checkIn set and currency ≠ base). `ChainPicker` = searchable select over `listChains` + add-new. `MembershipManager` = CRUD list.

- [ ] **Step 1: Read the cruise editor modal** (star pickers, segmented control, receipt upload) as the template. Reproduce mockup screen ③.

- [ ] **Step 2: Write a failing test** — entering `totalPrice=420, currency=CHF` with base EUR shows an FX readout element (mock the rate or compute client-side preview via a small helper; the authoritative snapshot is server-side on save).

- [ ] **Step 3: Run → fail. Implement the three components. Run → pass. Commit.**
```bash
git commit -am "feat(lodging): stay editor (star pickers + FX readout), chain picker, membership manager"
```

---

## Task 19: Base-currency setting UI + spend-by-currency

**Files:**
- Modify: the settings page (add a base-currency `<select>`, mockup screen ⑥ top row)
- Modify: `LodgingTab.tsx` (spend-by-currency breakdown card, mockup screen ⑥)
- Test: settings page test — changing the select PATCHes `baseCurrency`.

**Interfaces:**
- Consumes: Task 8 settings API (`baseCurrency`), Task 10 `/stats/lodging` (`spendByCurrency`, `spendBaseTotal`).

- [ ] **Step 1: Read the settings page** to find the API-key/settings card pattern.

- [ ] **Step 2: Write a failing test → implement the selector + breakdown card → pass. Commit.**
```bash
git commit -am "feat(lodging): base-currency setting + spend-by-currency breakdown"
```

---

## Task 20: i18n (DE + EN) + final gate

**Files:**
- Modify: `frontend/src/i18n/locales/de/*` + `en/*` (domain.lodging, dashboard tab label, lodging namespace: list/detail/editor/membership/FX strings)
- Test: i18n key-parity test if the repo has one; else eyeball both files.

**Interfaces:**
- Consumes: all frontend tasks' `t()` keys.

- [ ] **Step 0: Add the `lodging` filter to `frontend/src/pages/AchievementsPage.tsx`.** Task 11 seeded 41 lodging + cross-domain achievements and they unlock correctly, but the achievements page has no `lodging` domain filter — so they are earned yet not browsable. Mirror how the page filters `flight`/`cruise`.

- [ ] **Step 1: Add every `t()` key** used in Tasks 16–19 to BOTH `de` and `en` (DE primary). Include `domain.lodging` = "Unterkünfte" / "Lodging"; board/status/type enum labels; FX strings ("In Basiswährung", "EZB-Kurs", "Basiswährung").

- [ ] **Step 2: Run the full frontend gate**

Run: `cd frontend && npx tsc --noEmit && npm run lint && npx vitest --run`
Expected: PASS. No raw i18n keys rendered (grep components for any `t("...")` whose key is missing).

- [ ] **Step 3: Manual smoke** (per CLAUDE.local.md dev-server recipe): start backend+frontend, enable the lodging domain, create a hotel + a CHF stay, confirm the FX snapshot renders in list/detail/editor and the map pin appears.

- [ ] **Step 4: Commit + re-index.**
```bash
git add frontend/src/i18n
git commit -m "feat(lodging): DE+EN i18n for the lodging domain"
```
Then `npx gitnexus analyze` to refresh the index.

---

## Self-Review Notes (author checklist — done)

- **Spec coverage:** §3 models → T2; §4 registration → T1/T13; §5 routes/services → T5/T5b/T6/T7/T8/T10/T11; §7 geocoding → **T5b** (owner decision 2026-07-11: OSM geocode-on-save is Phase A; the spec's §1 phasing was updated to match — Phase C is keyed enrichers only); §7.1 FX → T3/T5/T8/T9/T10/T19; §8 trip timeline → the `Trip.lodgingStays` FK (T2) + detail rendering (T17); §9 stats/achievements → T9/T10/T11; §14 surface area → all tasks. No open gaps.
- **Placeholder scan:** none — every code step carries real code or a named template file to copy with explicit adaptations.
- **Type consistency:** `applyFxSnapshot`, `convertToBase`, `calculateLodgingStats`, `LodgingStayData`, `LODGING_MODES`, `deriveOverallRating` names are used identically across tasks.
- **Verify-before-code hooks:** middleware import names (T5), settings route location (T8), achievement checker signature (T11), seed aggregator location (T11), API-client axios convention (T14) are each gated by a "read the blueprint first" step because exact names may differ in the merged tree.
