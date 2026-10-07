# Bus Domain — Package B1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Long-distance coach rides become an eighth domain — one row per ride, logged by hand through a list page and a form, behind the `busDomain` beta switch, with every shared surface compiling and every ratchet green.

**Architecture:** A `BusJourney` table with rail's column names for the two ends (`depStationName`, `depLat`, `depTimezone`, `depPrecision`, …) so the ride-generic helpers rail already has — the clock rules in `shared/railClock.ts`, the wall-clock conversion in `services/rail/railJourneyWrite.ts`, the `times` DTO, status derivation, trip bounds — are imported, not copied. New code is the schema, the write merge, the router, the OpenAPI module, the counting rule, the registry entries, the page, the form and the copy. Straight line only; no catalogue, no lookup, no parser.

**Tech Stack:** Express 5 + Prisma 7 (driver adapter) + Zod on the backend; React 19 + Vite + Zustand + react-i18next on the frontend; Jest (backend, needs Postgres) and Vitest (frontend).

**Spec:** `docs/superpowers/specs/2026-10-07-bus-domain-design.md` — §3 (model), §4 (times/status/counting), §11 (gating), §12 (B1 scope and measures), §13 (decisions; this plan takes every recommendation).

## Global Constraints

- Code, comments, commit messages: English. UI copy: German first, English mirrored in the same change (`localeKeyParity.test.ts` fails otherwise).
- `Prisma` / `PrismaClient` are imported from `backend/src/prisma.ts`, never from `@prisma/client`. JSON null is `Prisma.DbNull`.
- `logger` is the default export of `utils/logger`.
- `useTranslation` comes from `hooks/useTranslation`, never from `react-i18next`.
- No file over 800 lines (`npm run check:size`). No `any` on the frontend. Prettier on everything (`npm run format:check`).
- Every `/api` response is `no-store` by default; this router sets no cache header.
- A new router is **enveloped** (`{success, data, meta?}`, ADR 0001) and is listed under `enveloped` in `backend/src/__tests__/apiResponseShape.baseline.json`.
- Every mounted endpoint is documented in OpenAPI with a response schema (`openapi.coverage.test.ts`, `openapi.responseSchema.test.ts`).
- Nothing outside `shared/time/` reads the host's zone (`time/*` ESLint rules). Use `localDay`, `toInstant`, `startOfDayAt`, `formatWallClockIn`.
- Abstention: null, never 0, for a value that cannot be derived (no arrival → no duration; no delay recorded → null).
- Migrations only through `prisma migrate dev --create-only` against a scratch database, then `npm run check:drift` green. The shared dev DB on 5433 takes `migrate deploy` only.
- Branch: `dev/bus-domain` off `main`. Commit after every task. Never touch `backend/VERSION` or `CHANGELOG.md`.

## Review Focus

1. **A terminal in a zone the resolver cannot place** (open sea, a bad coordinate pair): the write must be refused with `TZ_UNRESOLVED`/field named, never stored as UTC — Task 5 test "refuses a terminal without a zone".
2. **Arrival before departure across two zones** (Seoul 11:20 → Sokcho 11:00 is wrong; Paris 10:00 → London 10:55 is right): compared as instants after both zones are known — Task 5 test "compares instants, not wall clocks".
3. **A day-only ride** ("2026-09-21" with no clock) must have no duration, no delay, and must be `completed` only when its DAY is over on the terminal's calendar — Task 5 tests "day-only ride" and Task 3 sweep test.
4. **Editing a ride and moving one terminal** must keep the wall clock the ticket printed and move the instant with the new zone — Task 5 test "a moved terminal keeps the ticket's clock".
5. **A user with the domain switched off** must still own their rides (the API answers), while the page, nav, tabs and colour row vanish — Task 11 gating test and Task 6 ownership tests.

---

## File structure

**Backend — create**
- `backend/prisma/migrations/<ts>_bus_journeys/migration.sql` — `bus_journeys`, `bus_journey_companions`, `documents.bus_journey_id`, the widened one-owner CHECK.
- `backend/src/schemas/wallClockInput.ts` — the wall-clock-or-day Zod helpers rail defined inline; bus's schema imports them.
- `backend/src/schemas/bus.ts` — write/query schemas and the vocabularies.
- `backend/src/shared/busCounting.ts` — "does a ride count, and when".
- `backend/src/services/bus/busJourneyWrite.ts` — terminal columns, merge-on-write, distance.
- `backend/src/services/bus/timesDto.ts` — `withBusTimes` (rail's DTO under the bus name).
- `backend/src/routes/bus.ts` — list, read, create, update, delete.
- `backend/src/services/openapi/paths/bus.ts` — the five endpoints.
- Tests beside each.

**Backend — modify**
- `backend/prisma/schema.prisma` — `BusJourney`, `BusJourneyCompanion`, relations on `User`, `Trip`, `Booking`, `ImportBatch`, `Companion`, `Document`.
- `backend/src/shared/domains.ts` — `bus` in `DOMAIN_KEYS` + descriptor.
- `backend/src/shared/statusDerivation.ts` — `deriveBusStatus`.
- `backend/src/services/statusSweep.ts` — bus block + clockless sweep.
- `backend/src/services/documents/documentService.ts` — `busJourney` owner.
- `backend/src/routes/companions.ts` — usage count.
- `backend/src/routes/mounts.ts`, `backend/src/middleware/rateLimit.ts`, `backend/src/config/constants.ts`.
- `backend/src/schemas/times.ts` — `busTimesSchema` (`BusTimes`).
- `backend/src/services/openapi/paths/index.ts`, `paths/misc.ts`.
- `backend/src/services/evidence/crossDomainPopulations.ts` — `loadBus` (empty, B2 fills it).
- `backend/src/services/rail/railJourneyWrite.ts` — export `sentWallClockToInstant` (one keyword).
- `backend/src/__tests__/apiResponseShape.baseline.json`, `backend/src/__tests__/shared/domains.test.ts`.

**Frontend — create**
- `frontend/src/shared/busCounting.ts` (mirror), `frontend/src/types/bus.ts`, `frontend/src/lib/api/bus.ts`, `frontend/src/hooks/useBusVisible.ts`.
- `frontend/src/i18n/resources/{de,en}/bus.json`.
- `frontend/src/components/bus/BusStationField.tsx`, `busFormModel.ts`, `BusFormModal.tsx`, `BusTableRow.tsx`.
- `frontend/src/pages/BusPage.tsx`, `frontend/src/pages/BusDetailPage.tsx`.
- Tests beside each; `frontend/src/__tests__/components/busGating.test.tsx`.

**Frontend — modify**
- `design/tokens.json` (+ regenerated `frontend/src/theme/tokens.ts`, `tokens.css`), `frontend/src/shared/domains.ts`, `frontend/src/config/betaFeatures.ts`, `frontend/src/i18n/config.ts`, `common.json`, `dashboard.json`, `trips.json`, `achievements.json` (DE + EN).
- `App.tsx`, `Nav/useNavItems.ts`, `table/LogbookTabs.tsx`, `Settings/ModuleSection.tsx`, `Setup/DomainPickerStep.tsx`, `Settings/DomainColorSection.tsx`, `Settings/ImportSection.tsx`, `Dashboard/DashboardLayout.tsx`, `Dashboard/AddDomainPicker.tsx`, `hooks/useAttachableDomains.ts`, `lib/trips/attachableEntries.ts`, `table/OperatorTile.tsx`, `lib/stats/domain-stats/types.ts`, `lib/stats/domain-stats/useDomainStats.ts`, `Stats/Overview/CrossDomainKpis.tsx`, `pages/AchievementsPage.tsx`, `pages/statsTabAccess.ts`, `theme/__tests__/domainColorsNotStatus.test.ts`, `__tests__/shared/domains.test.ts`.

---

### Task 1: Registry, colour token, beta key, labels, visibility hook

**Files:**
- Modify: `design/tokens.json:34-48`, `backend/src/shared/domains.ts:6-15,96-110`, `frontend/src/shared/domains.ts` (same places), `frontend/src/config/betaFeatures.ts:124-136`, `frontend/src/theme/__tests__/domainColorsNotStatus.test.ts:28-36`, `backend/src/__tests__/shared/domains.test.ts:16-40`, `frontend/src/__tests__/shared/domains.test.ts:6-30`
- Modify: `frontend/src/i18n/resources/de/common.json` (`domain`, `settings.modules.sub`), `en/common.json`, `de/dashboard.json` (`filter rows` block at ~195 and `addPicker`), `en/dashboard.json`, `de/trips.json:145`, `en/trips.json`, `de/achievements.json:43-44`, `en/achievements.json`
- Create: `frontend/src/hooks/useBusVisible.ts`, `frontend/src/hooks/__tests__/useBusVisible.test.ts`

**Interfaces:**
- Produces: `DomainKey` now includes `"bus"`; `DOMAINS.bus = { key: "bus", available: true, i18nKey: "domain.bus", icon: "🚌", color: "#c49a6c", routePrefix: "/bus" }`; beta key `busDomain`; `useBusVisible(): boolean`, `useBusOffered(): boolean`; CSS var `--ts-domain-bus`.

- [ ] **Step 1: Write the failing registry tests**

In `backend/src/__tests__/shared/domains.test.ts`, append `"bus"` after `"rental"` in BOTH expected arrays (lines 16-24 and 32-40). Same in `frontend/src/__tests__/shared/domains.test.ts` (both arrays). In `frontend/src/theme/__tests__/domainColorsNotStatus.test.ts` add `bus: "bus",` to `TOKEN_NAME` after `rental`.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && npx jest src/__tests__/shared/domains.test.ts` and `cd frontend && npx vitest --run src/__tests__/shared/domains.test.ts src/theme/__tests__/domainColorsNotStatus.test.ts`
Expected: FAIL — arrays differ by `"bus"`; `TOKEN_NAME.bus` has no token (`tokens.domainColor.bus` undefined → `lower(undefined)` throws).

- [ ] **Step 3: Add the token and regenerate the theme**

In `design/tokens.json`, inside `domainColor`, after the `_rentalNote` line:

```json
    "bus": "#c49a6c",
    "_busNote": "VORLÄUFIG (Owner-Review ausstehend, Spec docs/superpowers/specs/2026-10-07-bus-domain-design.md D7): Fernbus als eigene Domain. Sandstein — ein Erdton neben dem Straßen-Moos, der nach Straße aussieht, ohne es zu sein. Abstand zu warn 64, bad 78, info 136 (domainColorsNotStatus.test.ts verlangt ≥ 40). Die Domänenfarbtabelle gehört stromaufwärts dem Companion / Claude Design.",
```

Run: `cd frontend && npm run tokens`
Expected: `frontend/src/theme/tokens.ts` gains `"bus": "#c49a6c"` and `tokens.css` gains `--ts-domain-bus: #c49a6c;` and `--color-ts-domain-bus: var(--ts-domain-bus);` (the generator iterates `domainColor`).

- [ ] **Step 4: Add the descriptor to both registries**

`backend/src/shared/domains.ts` — `DOMAIN_KEYS` gains `"bus"` after `"rental"`; after the `rental` descriptor:

```ts
  // Long-distance coach rides (spec 2026-10-07-bus-domain-design). Available,
  // so shared code iterating AVAILABLE_DOMAINS sees it; the UI hides it behind
  // the `busDomain` beta gate. Not city transit (owner, 2026-10-07): a ticketed
  // ride between two terminals. The colour is PROVISIONAL (spec D7) — the
  // domain colour table belongs to the Companion / Claude Design.
  bus: {
    key: "bus",
    available: true,
    i18nKey: "domain.bus",
    icon: "🚌",
    color: "#c49a6c",
    routePrefix: "/bus",
  },
```

Same block in `frontend/src/shared/domains.ts` (shorter comment: "Long-distance coach rides (spec 2026-10-07-bus-domain-design) — mirror of the backend descriptor. Behind the `busDomain` beta gate in the UI; colour provisional (D7)."). `PARSER_SUPPORTED_DOMAINS` and `LOYALTY_DOMAINS` stay unchanged (spec §10, D6).

- [ ] **Step 5: Register the beta key**

`frontend/src/config/betaFeatures.ts`, after the `railDomain` entry:

```ts
  busDomain: Object.freeze({
    why: "Long-distance coach rides are a new domain (spec 2026-10-07-bus-domain-design), built in packages; the Companion app does not handle them yet and no release candidate has carried them.",
    returnsWhen:
      "The owner explicitly takes bus out of beta. Packages being done is not that event.",
    reason: "beta",
  }),
```

- [ ] **Step 6: Write the hook and its test**

`frontend/src/hooks/useBusVisible.ts`:

```ts
import { useBetaFeatures } from "./useBetaFeatures";
import { useEnabledDomains } from "./useEnabledDomains";

/**
 * Whether the bus domain may be shown — the one home of the rule (spec
 * docs/superpowers/specs/2026-10-07-bus-domain-design.md §11).
 *
 * TWO conditions, as rail and rental: the INSTANCE allows it (`busDomain` beta
 * gate) and THIS USER wants it (`enabledDomains`). VISIBILITY ONLY —
 * `/api/v1/bus` stays reachable, and a user's rides survive the flag or the
 * domain being switched off.
 */
export function useBusVisible(): boolean {
  const { isFeatureVisible } = useBetaFeatures();
  const { isEnabled } = useEnabledDomains();
  return isFeatureVisible("busDomain") && isEnabled("bus");
}

/**
 * The instance half alone — for the places where a user switches the domain
 * ON (settings modules, setup). Gating those on "already enabled" too would
 * make the switch unreachable.
 */
export function useBusOffered(): boolean {
  const { isFeatureVisible } = useBetaFeatures();
  return isFeatureVisible("busDomain");
}
```

`frontend/src/hooks/__tests__/useBusVisible.test.ts` — copy `useRailVisible.test.ts` with `rail` → `bus`, `railDomain` → `busDomain`, `useRailVisible` → `useBusVisible` (and `useRailOffered` → `useBusOffered`). Its three cases must hold: flag on + domain on → true; flag on + domain off → false; flag off + domain on → false, offered false.

- [ ] **Step 7: Add the labels, DE first, EN mirrored**

`de/common.json` `domain` block, after `rental_desc`:
```json
    "bus": "Bus",
    "bus_desc": "Fernbus-, Intercity- und Shuttlefahrten: Terminals, Linie, Sitzplatz, Kilometer. Kein Stadtverkehr. (Beta)"
```
`settings.modules.sub`: `"bus": "Beta: Fahrtenbuch für Busfahrten"`.
`en/common.json`: `"bus": "Bus"`, `"bus_desc": "Coach, intercity and shuttle rides: terminals, line, seat, kilometres. Not city transit. (Beta)"`, sub `"bus": "Beta: logbook for bus rides"`.
`de/dashboard.json`: in the filter-rows block that lists `"rental": "Mietwagen"` (~line 202) add `"bus": "Bus"`; in `addPicker` add `"bus": "Busfahrt"`. EN: `"bus": "Bus"`, `"bus": "Bus ride"`.
`de/trips.json` counts block (~145): `"bus": "Bus"`; EN `"bus": "Bus"`.
`de/achievements.json` filters: `"domainBus": "Bus"`; EN `"domainBus": "Bus"`.

- [ ] **Step 8: Run the tests and the type checks**

Run: `cd backend && npx jest src/__tests__/shared/domains.test.ts && npx tsc --noEmit`
Run: `cd frontend && npx vitest --run src/__tests__/shared/domains.test.ts src/theme/__tests__/domainColorsNotStatus.test.ts src/hooks/__tests__/useBusVisible.test.ts src/__tests__/config/betaFeatures.test.ts src/i18n && npx tsc --noEmit`
Expected: the named tests PASS. **`tsc` is expected to FAIL** in both trees at every `Record<DomainKey, …>` that lacks `bus` — write the list of failing files down; Task 7 fixes them. Do not fix them here.

- [ ] **Step 9: Commit**

```bash
git add design/tokens.json frontend/src/theme backend/src/shared/domains.ts frontend/src/shared/domains.ts frontend/src/config/betaFeatures.ts frontend/src/hooks/useBusVisible.ts frontend/src/hooks/__tests__/useBusVisible.test.ts frontend/src/i18n backend/src/__tests__/shared/domains.test.ts frontend/src/__tests__/shared/domains.test.ts frontend/src/theme/__tests__/domainColorsNotStatus.test.ts
git commit -m "feat(bus): register the bus domain — key, colour token, beta gate, labels"
```

---

### Task 2: Prisma model, migration, document owner, companion count

**Files:**
- Modify: `backend/prisma/schema.prisma` (after `RailJourneyCompanion`, ~line 3675; relation lines at `User:105`, `Trip:1614`, `Booking:2123`, `ImportBatch:3175`, `Companion:3222`, `Document:3464-3497`)
- Create: `backend/prisma/migrations/<timestamp>_bus_journeys/migration.sql`
- Modify: `backend/src/services/documents/documentService.ts:60-70,158-166,172-195,215-228`, `backend/src/routes/companions.ts:23-40`
- Test: `backend/src/__tests__/migration.busJourneys.test.ts`

**Interfaces:**
- Produces: `prisma.busJourney`, `prisma.busJourneyCompanion`; `Document.busJourneyId`; `EntryType` gains `"busJourney"`.

- [ ] **Step 1: Add the models**

After `model RailJourneyCompanion { … }`:

```prisma
/// A long-distance coach ride — one row per vehicle boarded at one terminal
/// and left at another (spec docs/superpowers/specs/2026-10-07-bus-domain-design.md
/// §3.1). The two ends carry RAIL's column names on purpose: `shared/railClock.ts`,
/// `services/rail/timesDto.ts` and the trip bounds are structurally typed on
/// them, so a bus row reads through the same functions without a copy.
model BusJourney {
  id     String @id @default(uuid())
  userId String @map("user_id")

  /// "FlixBus", "Kobus", "Lux Express" — free text with entry suggestions.
  operator String?
  /// What the ticket calls the service ("N17", "Premium"); apart from the
  /// operator because statistics rank operators, not lines.
  lineName String? @map("line_name")
  /// intercity | shuttle | charter | other; null when unstated (spec D1).
  rideKind String? @map("ride_kind")

  depStationName String  @map("dep_station_name")
  /// As printed — a coach stop is often an address, not a named building.
  depAddress     String? @map("dep_address")
  depLat         Float   @map("dep_lat")
  depLon         Float   @map("dep_lon")
  /// ISO 3166-1 alpha-2 from the geocoder; null when unknown, never guessed.
  depCountry     String? @map("dep_country")
  /// IANA zone, derived by the server from the coordinates — never user input.
  depTimezone    String? @map("dep_timezone")
  arrStationName String  @map("arr_station_name")
  arrAddress     String? @map("arr_address")
  arrLat         Float   @map("arr_lat")
  arrLon         Float   @map("arr_lon")
  arrCountry     String? @map("arr_country")
  arrTimezone    String? @map("arr_timezone")

  /// Real UTC instants: the client sends the terminal's wall clock, the
  /// server converts it with the terminal's zone.
  departureTime DateTime  @map("departure_time")
  arrivalTime   DateTime? @map("arrival_time")
  /// ADR 0002: minute | day | unknown. Written from the first row on.
  depPrecision  String?   @map("dep_precision")
  arrPrecision  String?   @map("arr_precision")

  /// great_circle | user | route. Great-circle understates a road by 10–40 %;
  /// the source is kept so a statistic can say which it is showing.
  distanceKm     Float?  @map("distance_km")
  distanceSource String? @map("distance_source")
  /// `[[lon, lat], ...]`, fetched once (B3, road routing) and frozen. Null =
  /// draw the chord between the terminals.
  geometry       Json?
  /// straight | road | manual. B1 writes only `straight`.
  geometrySource String  @default("straight") @map("geometry_source")

  actualDepartureTime DateTime? @map("actual_departure_time")
  actualArrivalTime   DateTime? @map("actual_arrival_time")

  /// The operator's own vocabulary ("Udeung", "Lounge"); not an enum.
  fareClass        String? @map("fare_class")
  seat             String?
  bookingReference String? @map("booking_reference")

  price          Float?
  currency       String?   @default("EUR")
  priceBase      Float?    @map("price_base")
  fxRate         Float?    @map("fx_rate")
  fxRateDate     DateTime? @map("fx_rate_date")
  fxBaseCurrency String?   @map("fx_base_currency")
  fxSource       String?   @map("fx_source")

  /// scheduled | in_progress | completed | cancelled — rail's vocabulary.
  /// A cache of `deriveBusStatus`; only `cancelled` is set by a client.
  status       String   @default("scheduled")
  /// Arrival delay as experienced. Null = not recorded, 0 = on time.
  delayMinutes Int?     @map("delay_minutes")
  notes        String?
  tags         String[] @default([])
  companions   String[] @default([])

  tripId    String? @map("trip_id")
  bookingId String? @map("booking_id")

  externalRef   String? @map("external_ref")
  importBatchId String? @map("import_batch_id")

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  user           User                  @relation(fields: [userId], references: [id], onDelete: Cascade)
  trip           Trip?                 @relation(fields: [tripId], references: [id], onDelete: SetNull)
  booking        Booking?              @relation(fields: [bookingId], references: [id], onDelete: SetNull)
  importBatch    ImportBatch?          @relation(fields: [importBatchId], references: [id], onDelete: SetNull)
  companionLinks BusJourneyCompanion[]
  documents      Document[]

  @@unique([userId, externalRef])
  @@index([userId, departureTime])
  @@index([status])
  @@index([tripId])
  @@index([bookingId])
  @@index([importBatchId])
  @@map("bus_journeys")
}

model BusJourneyCompanion {
  busJourneyId String @map("bus_journey_id")
  companionId  String @map("companion_id")
  position     Int

  busJourney BusJourney @relation(fields: [busJourneyId], references: [id], onDelete: Cascade)
  companion  Companion  @relation(fields: [companionId], references: [id], onDelete: Cascade)

  @@id([busJourneyId, companionId])
  @@index([companionId])
  @@map("bus_journey_companions")
}
```

Relation lines, each beside its rail twin: `User` → `busJourneys BusJourney[]`; `Trip` → `busJourneys BusJourney[]`; `Booking` → `busJourneys BusJourney[]`; `ImportBatch` → `bus BusJourney[]`; `Companion` → `bus BusJourneyCompanion[]`; `Document` → `busJourneyId String? @map("bus_journey_id")`, `busJourney BusJourney? @relation(fields: [busJourneyId], references: [id], onDelete: Cascade)`, `@@index([busJourneyId])`.

- [ ] **Step 2: Generate the migration against a scratch database and append the CHECK**

Run (scratch Postgres with PostGIS, e.g. the embedded one from the sandbox recipe, NEVER the shared 5433 dev DB):
```bash
cd backend && DATABASE_URL="postgresql://…scratch…" npx prisma migrate dev --create-only --name bus_journeys
```
Open the generated `migration.sql` and append:

```sql
-- The single-owner rule gains the eighth owner. Prisma cannot express a CHECK;
-- the application enforces the same rule before it writes
-- (services/documents/documentService.ts).
ALTER TABLE "documents" DROP CONSTRAINT "documents_single_owner_check";
ALTER TABLE "documents" ADD CONSTRAINT "documents_single_owner_check" CHECK (
  num_nonnulls("flight_id", "cruise_id", "lodging_stay_id", "trip_id", "place_visit_id", "rail_journey_id", "rental_booking_id", "bus_journey_id") <= 1
);
```

Run: `DATABASE_URL="…scratch…" npx prisma migrate deploy && npm run check:drift`
Expected: migration applies; drift check reports no difference.

- [ ] **Step 3: Write the migration test**

`backend/src/__tests__/migration.busJourneys.test.ts` (template: `migration.loyaltyMemberships.test.ts` for the harness):

```ts
import { prisma } from "../db";

/**
 * The one-owner CHECK on documents now names bus_journey_id: a document may
 * be filed with a bus ride, and never with a bus ride AND anything else.
 */
describe("migration: bus_journeys", () => {
  it("refuses a document owned by a bus ride and a flight at once", async () => {
    const rows = await prisma.$queryRaw<{ def: string }[]>`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conname = 'documents_single_owner_check'`;
    expect(rows[0].def).toContain("bus_journey_id");
    expect(rows[0].def).toContain("rental_booking_id");
  });
});
```

Run: `cd backend && npx jest src/__tests__/migration.busJourneys.test.ts --forceExit`
Expected: PASS once `migrate deploy` ran on the test database.

- [ ] **Step 4: Teach the document service the new owner**

`documentService.ts`: add `busJourney: "busJourneyId",` to `OWNER_COLUMN`; `busJourneyId: null,` to `NO_OWNER`; `busJourneyId: string | null;` to `OwnerColumns`; `busJourneyId: entry?.type === "busJourney" ? entry.id : null,` to `ownerData`; in `assertEntryOwned` turn the last ternary into
```ts
              : entry.type === "railJourney"
                ? await prisma.railJourney.findFirst({ where, select })
                : entry.type === "rentalBooking"
                  ? await prisma.rentalBooking.findFirst({ where, select })
                  : await prisma.busJourney.findFirst({ where, select });
```
Add `"busJourney"` to `ENTRY_TYPES` (wherever `EntryType` is declared — `grep -n "ENTRY_TYPES" backend/src/services/documents/*.ts`). The `misc.ts` OpenAPI enum at line ~175 lists the entry types: add `"bus"`/`"busJourney"` in the same form the others use there.

- [ ] **Step 5: Count bus rides in the companions usage**

`routes/companions.ts`: `select: { flights: true, trips: true, cruises: true, rail: true, rentals: true, bus: true }` and add `+ row._count.bus` to the sum.

- [ ] **Step 6: Type-check and run the document tests**

Run: `cd backend && npx prisma generate && npx tsc --noEmit && npx jest src/routes/__tests__/documents --forceExit`
Expected: tsc clean for everything touched here (other `Record<DomainKey>` errors from Task 1 remain until Task 7); document tests PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/prisma backend/src/services/documents/documentService.ts backend/src/services/openapi/paths/misc.ts backend/src/routes/companions.ts backend/src/__tests__/migration.busJourneys.test.ts
git commit -m "feat(bus): BusJourney model, companions join and document ownership"
```

---

### Task 3: Counting rule (both mirrors), status derivation, hourly sweep

**Files:**
- Create: `backend/src/shared/busCounting.ts`, `backend/src/shared/__tests__/busCounting.test.ts`, `frontend/src/shared/busCounting.ts`, `frontend/src/shared/__tests__/busCounting.test.ts`
- Modify: `backend/src/shared/statusDerivation.ts:172-195`, `backend/src/services/statusSweep.ts:156-162,236-282,331-340,356-400`
- Test: `backend/src/shared/__tests__/statusDerivation.test.ts`, `backend/src/services/__tests__/statusSweep.test.ts`

**Interfaces:**
- Produces: `COUNTABLE_BUS_STATUSES`, `countableBusWhere()`, `isCountableBus()`, `busDayKeys()`, `busYear()`, `busCountries()`; `deriveBusStatus(input)` with rail's signature.

- [ ] **Step 1: Write the counting tests (backend)**

`backend/src/shared/__tests__/busCounting.test.ts`:

```ts
import {
  busCountries,
  busDayKeys,
  busYear,
  countableBusWhere,
  isCountableBus,
} from "../busCounting";

/** The truth table `frontend/src/shared/__tests__/busCounting.test.ts` mirrors. */
describe("busCounting", () => {
  it.each([
    ["completed", true],
    ["scheduled", false],
    ["in_progress", false],
    ["cancelled", false],
  ])("%s counts: %s", (status, counts) => {
    expect(isCountableBus({ status })).toBe(counts);
  });

  it("the where fragment names only completed", () => {
    expect(countableBusWhere()).toEqual({ status: { in: ["completed"] } });
  });

  it("files a ride under the year it LEFT on the terminal's calendar", () => {
    // 31 Dec 23:30 in Seoul is 14:30 UTC the same day; 1 Jan 00:30 Seoul is 31 Dec 15:30 UTC.
    const ride = {
      departureTime: new Date("2025-12-31T15:30:00Z"),
      arrivalTime: new Date("2025-12-31T18:00:00Z"),
      depTimezone: "Asia/Seoul",
      arrTimezone: "Asia/Seoul",
    };
    expect(busYear(ride)).toBe(2026);
    expect(busDayKeys(ride)).toEqual(["2026-01-01"]);
  });

  it("an overnight ride is active on both terminals' days", () => {
    const ride = {
      departureTime: new Date("2026-03-01T21:00:00Z"), // 22:00 Berlin
      arrivalTime: new Date("2026-03-02T06:00:00Z"), // 07:00 Berlin
      depTimezone: "Europe/Berlin",
      arrTimezone: "Europe/Berlin",
    };
    expect(busDayKeys(ride)).toEqual(["2026-03-01", "2026-03-02"]);
  });

  it("a ride without an arrival is a one-day event", () => {
    expect(
      busDayKeys({
        departureTime: new Date("2026-03-01T21:00:00Z"),
        arrivalTime: null,
        depTimezone: "Europe/Berlin",
        arrTimezone: null,
      })
    ).toEqual(["2026-03-01"]);
  });

  it("proves both terminals' countries, upper-cased, never guessed", () => {
    expect(busCountries({ depCountry: "kr", arrCountry: "KR" })).toEqual(["KR"]);
    expect(busCountries({ depCountry: "DE", arrCountry: null })).toEqual(["DE"]);
    expect(busCountries({ depCountry: "Germany", arrCountry: null })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx jest src/shared/__tests__/busCounting.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the backend module**

`backend/src/shared/busCounting.ts`:

```ts
/**
 * Single source of truth for "does this bus ride count, and when".
 *
 * The sibling of `railCounting.ts` (spec 2026-10-07-bus-domain-design §4): every
 * bus figure — the statistics (B2), the cross-domain overview, the evidence
 * behind it — asks here, so no two of them can disagree about which rides are
 * counted. Written as its own module rather than an alias of rail's, so a
 * later ruling on one domain cannot change the other in silence; the tests on
 * both pin the same truth table today.
 *
 * One status means the ride happened: `completed`. A ride counts on the
 * calendar of its TERMINALS, not of the reader or of UTC — a night coach that
 * leaves Berlin at 23:30 on the 31st is a ride of the old year.
 *
 * MIRRORED in `frontend/src/shared/busCounting.ts`. Change both together.
 */

import { localDay } from "./time/instant";

export const COUNTABLE_BUS_STATUSES = ["completed"] as const;

export interface CountableBus {
  status: string;
}

/** The Prisma `where` fragment: `{ userId, ...countableBusWhere() }`. A fresh object per call. */
export function countableBusWhere(): { status: { in: string[] } } {
  return { status: { in: [...COUNTABLE_BUS_STATUSES] } };
}

export function isCountableBus(ride: CountableBus): boolean {
  return (COUNTABLE_BUS_STATUSES as readonly string[]).includes(ride.status);
}

export interface DatedBus {
  departureTime: Date;
  arrivalTime: Date | null;
  depTimezone: string | null;
  arrTimezone: string | null;
}

/** `YYYY-MM-DD` on the terminal's clock; a zone-less row (the abstention) reads as UTC. */
function terminalDayKey(instant: Date, timezone: string | null): string {
  return localDay(instant, timezone ?? "UTC");
}

/**
 * The days a ride was travelled on: the departure day at the departure
 * terminal, and the arrival day at the arrival terminal when that is another
 * day. A ride with no known arrival is a one-day event, not an invented length.
 */
export function busDayKeys(ride: DatedBus): string[] {
  const dep = terminalDayKey(ride.departureTime, ride.depTimezone);
  if (!ride.arrivalTime) return [dep];
  const arr = terminalDayKey(ride.arrivalTime, ride.arrTimezone);
  return arr === dep ? [dep] : [dep, arr];
}

/** The year a ride is filed under: the year it LEFT, on its terminal's calendar. */
export function busYear(ride: DatedBus): number {
  return Number(terminalDayKey(ride.departureTime, ride.depTimezone).slice(0, 4));
}

/** The countries a ride proves: both terminals', when known. Never guessed. */
export function busCountries(ride: {
  depCountry: string | null;
  arrCountry: string | null;
}): string[] {
  const codes = [ride.depCountry, ride.arrCountry]
    .filter((c): c is string => typeof c === "string" && /^[A-Za-z]{2}$/.test(c))
    .map((c) => c.toUpperCase());
  return [...new Set(codes)];
}
```

- [ ] **Step 4: Write the frontend mirror and its test**

`frontend/src/shared/busCounting.ts` — the same module with `DatedBus` taking `Date | string`, and `terminalDayKey` implemented exactly as `frontend/src/shared/railCounting.ts`'s `stationDayKey` does (the `Intl.DateTimeFormat("en-CA", { timeZone })` reading — that call passes the `time/no-zoneless-format` rule because it names a zone). Header comment: "MIRRORED from `backend/src/shared/busCounting.ts`. Change both together. The one difference: instants arrive as ISO strings here." `frontend/src/shared/__tests__/busCounting.test.ts` — the same five cases with ISO strings instead of `Date`.

Run: `cd backend && npx jest src/shared/__tests__/busCounting.test.ts && cd ../frontend && npx vitest --run src/shared/__tests__/busCounting.test.ts`
Expected: PASS, both.

- [ ] **Step 5: Status derivation — test, then alias**

Append to `backend/src/shared/__tests__/statusDerivation.test.ts`:

```ts
describe("deriveBusStatus", () => {
  const dep = new Date("2026-09-20T00:00:00Z");
  const arr = new Date("2026-09-20T02:20:00Z");
  it("is rail's rule under the bus name", () => {
    expect(deriveBusStatus({ departureTime: dep, arrivalTime: arr, current: "scheduled", now: new Date("2026-09-19T00:00:00Z") })).toBe("scheduled");
    expect(deriveBusStatus({ departureTime: dep, arrivalTime: arr, current: "scheduled", now: new Date("2026-09-20T01:00:00Z") })).toBe("in_progress");
    expect(deriveBusStatus({ departureTime: dep, arrivalTime: arr, current: "scheduled", now: new Date("2026-09-21T00:00:00Z") })).toBe("completed");
    expect(deriveBusStatus({ departureTime: dep, arrivalTime: arr, current: "cancelled", now: new Date("2026-09-21T00:00:00Z") })).toBe("cancelled");
  });
  it("a clockless ride is over when its DAY is (endsAt), not at the stored midnight", () => {
    expect(
      deriveBusStatus({ departureTime: dep, arrivalTime: null, current: "scheduled", now: new Date("2026-09-20T10:00:00Z"), endsAt: new Date("2026-09-20T15:00:00Z") })
    ).toBe("in_progress");
  });
});
```

In `statusDerivation.ts`, after `deriveRentalStatus`:

```ts
/**
 * Bus rides (spec 2026-10-07-bus-domain-design §4) share rail's vocabulary and
 * rail's rule to the letter — the two ends carry the same column names, so this
 * is the same function under the domain's own name, kept so a caller says
 * which domain it is deriving and a later divergence has a place to go.
 */
export const deriveBusStatus = deriveRailStatus;
```

Run: `cd backend && npx jest src/shared/__tests__/statusDerivation.test.ts`
Expected: PASS.

- [ ] **Step 6: Sweep — test, then the block**

In `backend/src/services/__tests__/statusSweep.test.ts`, beside the rail cases, add a bus row created with `prisma.busJourney.create` (operator "Test", stations Seoul/Sokcho with `depLat 37.5048, depLon 127.0046, arrLat 38.1911, arrLon 128.5918`, `depTimezone: "Asia/Seoul"`, `arrTimezone: "Asia/Seoul"`, `depPrecision: "minute"`, `arrPrecision: "minute"`, departure one hour ago, arrival one hour ahead, `status: "scheduled"`) and assert the sweep turns it `in_progress` and the returned counts carry `bus: 1`. Add a second, clockless row (`depPrecision: "day"`, departure = start of today in Seoul, no arrival) and assert it stays `in_progress`/`scheduled` until the day is over — mirror the existing rail clockless case exactly.

In `statusSweep.ts`: add `bus: number;` to the return type; after the rentals block insert a bus block that is the rail block with `prisma.railJourney` → `prisma.busJourney` and `sweepClocklessRail` → `sweepClocklessBus` (a copy of `sweepClocklessRail` on `prisma.busJourney` calling `deriveBusStatus`); `const bus = busToInProgress.count + busToCompleted.count + busToScheduled.count + busClockless;` include `bus` in the `if` sum, the log context and the return.

Run: `cd backend && npx jest src/services/__tests__/statusSweep.test.ts --forceExit && npx tsc --noEmit`
Expected: PASS; tsc shows only the Task-1 `Record<DomainKey>` errors.

- [ ] **Step 7: Commit**

```bash
git add backend/src/shared/busCounting.ts backend/src/shared/__tests__/busCounting.test.ts frontend/src/shared/busCounting.ts frontend/src/shared/__tests__/busCounting.test.ts backend/src/shared/statusDerivation.ts backend/src/shared/__tests__/statusDerivation.test.ts backend/src/services/statusSweep.ts backend/src/services/__tests__/statusSweep.test.ts
git commit -m "feat(bus): counting rule on both mirrors, status derivation and hourly sweep"
```

---

### Task 4: Zod schemas — the shared wall-clock helpers and `schemas/bus.ts`

**Files:**
- Create: `backend/src/schemas/wallClockInput.ts`, `backend/src/schemas/bus.ts`, `backend/src/schemas/__tests__/bus.test.ts`
- Modify: `backend/src/schemas/times.ts:39-42`

**Interfaces:**
- Produces: `BUS_STATUSES`, `BUS_WRITE_STATUSES`, `BUS_RIDE_KINDS`, `BUS_DISTANCE_SOURCES`, `BUS_GEOMETRY_SOURCES`, `BUS_SORT_FIELDS`; `busStationSchema`, `createBusJourneySchema`, `updateBusJourneySchema`, `busQuerySchema`; types `BusStationInput`, `CreateBusJourneyInput`, `UpdateBusJourneyInput`, `BusQueryInput`; `strayBusFoldKey(body)`; `busTimesSchema` / `BusTimes`.
- Consumes: nothing from earlier tasks.

- [ ] **Step 1: Write the failing schema test**

`backend/src/schemas/__tests__/bus.test.ts`:

```ts
import { createBusJourneySchema, updateBusJourneySchema, strayBusFoldKey } from "../bus";

const SEOUL = { name: "Seoul Express Bus Terminal", lat: 37.5048, lon: 127.0046, country: "kr" };
const SOKCHO = { name: "Sokcho Express Bus Terminal", lat: 38.1911, lon: 128.5918 };

describe("bus schemas", () => {
  it("accepts a wall clock without offset and upper-cases the country", () => {
    const r = createBusJourneySchema.safeParse({
      departureStation: SEOUL,
      arrivalStation: SOKCHO,
      departureLocal: "2026-09-20T09:00",
      arrivalLocal: "2026-09-20T11:20",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.departureStation.country).toBe("KR");
      expect(r.data.status).toBe("scheduled");
      expect(r.data.rideKind).toBeUndefined();
    }
  });

  it("refuses an offset in the wall clock — whose clock it is comes from the terminal", () => {
    const r = createBusJourneySchema.safeParse({
      departureStation: SEOUL,
      arrivalStation: SOKCHO,
      departureLocal: "2026-09-20T09:00+09:00",
    });
    expect(r.success).toBe(false);
  });

  it("accepts a day alone (an open ticket)", () => {
    const r = createBusJourneySchema.safeParse({
      departureStation: SEOUL,
      arrivalStation: SOKCHO,
      departureLocal: "2026-09-21",
    });
    expect(r.success).toBe(true);
  });

  it("refuses a station without a position", () => {
    const r = createBusJourneySchema.safeParse({
      departureStation: { name: "Somewhere" },
      arrivalStation: SOKCHO,
      departureLocal: "2026-09-20T09:00",
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].path[0]).toBe("departureStation");
  });

  it("only scheduled and cancelled may be sent", () => {
    expect(
      createBusJourneySchema.safeParse({
        departureStation: SEOUL,
        arrivalStation: SOKCHO,
        departureLocal: "2026-09-20T09:00",
        status: "completed",
      }).success
    ).toBe(false);
  });

  it("an update needs at least one field and a misspelt fold is named", () => {
    expect(updateBusJourneySchema.safeParse({}).success).toBe(false);
    expect(strayBusFoldKey({ arrivalFolds: "later" })).toBe("arrivalFolds");
    expect(strayBusFoldKey({ departureFold: "later" })).toBeNull();
  });

  it("empty strings clear optional text", () => {
    const r = updateBusJourneySchema.safeParse({ operator: "" });
    expect(r.success && r.data.operator).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx jest src/schemas/__tests__/bus.test.ts`
Expected: FAIL — cannot find module `../bus`.

- [ ] **Step 3: Lift the wall-clock helpers into a shared file**

`backend/src/schemas/wallClockInput.ts` (the three helpers rail defines inline in `schemas/rail.ts:54-100`; rail keeps its own copy for now — pointing rail at this file is a one-line follow-up outside this package):

```ts
import { z } from "./zod";

/**
 * The wall clock at a station or terminal, as a ticket prints it:
 * `YYYY-MM-DDTHH:mm`, seconds optional, NO offset. Whose clock it is comes
 * from the station's coordinates on the server; an offset here would be a
 * second answer to the same question. Shared by the domains whose two ends
 * are a departure and an arrival (rail wrote it first, bus imports it).
 */
const WALL_CLOCK = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
export const wallClock = z
  .string()
  .regex(WALL_CLOCK, "must be a local wall-clock time YYYY-MM-DDTHH:mm without an offset")
  .refine((v) => !Number.isNaN(new Date(`${v}Z`).getTime()), "is not a real date and time");

const LOCAL_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A wall clock, or — for a ticket that prints none — the calendar day alone,
 * `YYYY-MM-DD` (forgejo#132 item 17). The day is stored with precision `day`,
 * and every reader that needs a clock abstains on it (`shared/railClock.ts`).
 */
export const wallClockOrDay = z.union([
  wallClock,
  z
    .string()
    .regex(LOCAL_DAY, "must be a local wall-clock time YYYY-MM-DDTHH:mm or a day YYYY-MM-DD")
    // Zod runs a refinement even after the regex failed, so this must not
    // throw on a non-day string ("…T08:15+02:00" used to answer 500).
    .refine((v) => {
      const day = new Date(`${v}T00:00:00Z`);
      return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === v;
    }, "is not a real date"),
]);

/** True for a day-only value of `departureLocal` / `arrivalLocal`. */
export function isLocalDayInput(value: string | null | undefined): value is string {
  return typeof value === "string" && LOCAL_DAY.test(value);
}

/** "" and null both clear a text field; undefined leaves it alone. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === "" ? null : v));

export const foldField = z.enum(["earlier", "later"]).nullable().optional();
```

- [ ] **Step 4: Write `schemas/bus.ts`**

```ts
import { z } from "./zod";
import { currencyField } from "./lodging";
import { partialForUpdate } from "./partialUpdate";
import { foldField, optionalText, wallClockOrDay } from "./wallClockInput";

/**
 * Bus rides — spec docs/superpowers/specs/2026-10-07-bus-domain-design.md.
 *
 * The WRITE vocabulary is narrower than the stored one on purpose, as for
 * rail: a client may say "scheduled" (a hint, derived over) or "cancelled"
 * (kept verbatim); `in_progress` and `completed` come from the clock.
 */
export const BUS_STATUSES = ["scheduled", "in_progress", "completed", "cancelled"] as const;
export const BUS_WRITE_STATUSES = ["scheduled", "cancelled"] as const;
/** The split a statistic reader asks for (spec D1); null when unstated. */
export const BUS_RIDE_KINDS = ["intercity", "shuttle", "charter", "other"] as const;
export type BusRideKind = (typeof BUS_RIDE_KINDS)[number];
/**
 * great_circle = the straight line between the terminals (understates a road
 * by 10–40 %); user = typed from the ticket; route = the length of the line
 * routed over the road network (B3).
 */
export const BUS_DISTANCE_SOURCES = ["great_circle", "user", "route"] as const;
/** Where the map line comes from: the chord, a road-routed line (B3), or one drawn by hand. */
export const BUS_GEOMETRY_SOURCES = ["straight", "road", "manual"] as const;
export const BUS_SORT_FIELDS = ["departure", "distance", "created"] as const;

/**
 * A terminal as the client knows it. Sent whole — a name without its position
 * (or the reverse) is how a map pin ends up in the wrong city. No catalogue id:
 * a terminal comes from the geocoder or from the user's own earlier rows.
 */
export const busStationSchema = z.object({
  name: z.string().trim().min(1).max(200),
  /** As printed — a coach stop is often an address, not a named building. */
  address: optionalText(300),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  /** ISO 3166-1 alpha-2. */
  country: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/)
    .transform((v) => v.toUpperCase())
    .nullable()
    .optional(),
});

/** The fold keys a bus write understands — see `strayBusFoldKey`. */
export const BUS_FOLD_KEYS = ["departureFold", "arrivalFold"] as const;

/**
 * A `…Fold` key the schema does not know (`arrivalFolds`, `depFold`). zod
 * strips unknown keys, so a misspelt fold would be dropped without a word and
 * the ride stored at the EARLIER hour the user just said was wrong; the route
 * refuses it instead. Null when there is none.
 */
export function strayBusFoldKey(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const known: readonly string[] = BUS_FOLD_KEYS;
  return Object.keys(body).find((key) => /fold/i.test(key) && !known.includes(key)) ?? null;
}

const baseBusSchema = z.object({
  operator: optionalText(100),
  lineName: optionalText(40),
  rideKind: z.enum(BUS_RIDE_KINDS).nullable().optional(),
  departureStation: busStationSchema,
  arrivalStation: busStationSchema,
  departureLocal: wallClockOrDay,
  arrivalLocal: wallClockOrDay.nullable().optional(),
  /** Which occurrence of a terminal clock the zone shows twice (the autumn hour). */
  departureFold: foldField,
  arrivalFold: foldField,
  /** Only a distance the user read off the ticket. Absent or null means "measure it". */
  distanceKm: z.number().positive().max(20000).nullable().optional(),
  fareClass: optionalText(40),
  seat: optionalText(20),
  bookingReference: optionalText(40),
  price: z.number().min(0).nullable().optional(),
  currency: currencyField.optional(),
  status: z.enum(BUS_WRITE_STATUSES).default("scheduled"),
  /** Arrival delay in minutes; null = not recorded, 0 = on time. */
  delayMinutes: z.number().int().min(-60).max(10000).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  tags: z.array(z.string().trim().max(40)).max(30).optional(),
  companions: z.array(z.string().max(100)).max(50).optional(),
  tripId: z.string().uuid().nullable().optional(),
  bookingId: z.string().uuid().nullable().optional(),
});

/**
 * No arrival-before-departure refine here: two wall clocks in two zones do not
 * compare. The write service checks the INSTANTS, after it knows both zones.
 */
export const createBusJourneySchema = baseBusSchema;

export const updateBusJourneySchema = partialForUpdate(baseBusSchema).refine(
  (data) => Object.keys(data).length > 0,
  { message: "At least one field must be provided for update" }
);

export const busQuerySchema = z.object({
  status: z.union([z.enum(BUS_STATUSES), z.array(z.enum(BUS_STATUSES))]).optional(),
  /** Free text over operator, line, both terminal names and the booking reference. */
  q: z.string().trim().min(1).max(100).optional(),
  /** Calendar year of the departure, on the departure terminal's calendar. */
  year: z.coerce.number().int().min(1900).max(2200).optional(),
  tripId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  sort: z.enum(BUS_SORT_FIELDS).default("departure"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

export type BusStationInput = z.infer<typeof busStationSchema>;
export type CreateBusJourneyInput = z.infer<typeof createBusJourneySchema>;
export type UpdateBusJourneyInput = z.infer<typeof updateBusJourneySchema>;
export type BusQueryInput = z.infer<typeof busQuerySchema>;
```

- [ ] **Step 5: Register the times schema**

`backend/src/schemas/times.ts`, after `railTimesSchema`:

```ts
/** A bus ride's times — rail's shape under the bus name (the two ends carry rail's columns). */
export const busTimesSchema = z
  .object({ departure: time, arrival: time, actualDeparture: time, actualArrival: time })
  .openapi("BusTimes", { description: "Planned and actual times at their terminals." });
export type BusTimes = z.infer<typeof busTimesSchema>;
```
and `BusTimes: busTimesSchema,` in the exported map at the bottom.

- [ ] **Step 6: Run the test**

Run: `cd backend && npx jest src/schemas/__tests__/bus.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 7: Commit**

```bash
git add backend/src/schemas/wallClockInput.ts backend/src/schemas/bus.ts backend/src/schemas/__tests__/bus.test.ts backend/src/schemas/times.ts
git commit -m "feat(bus): write, update and query schemas; shared wall-clock input helpers"
```

---

### Task 5: Write service — terminal columns, wall clock to instant, merge, distance

**Files:**
- Create: `backend/src/services/bus/busJourneyWrite.ts`, `backend/src/services/bus/timesDto.ts`, `backend/src/services/bus/__tests__/busJourneyWrite.test.ts`
- Modify: `backend/src/services/rail/railJourneyWrite.ts:120` (`function sentWallClockToInstant` → `export function sentWallClockToInstant`)

**Interfaces:**
- Consumes: `UpdateBusJourneyInput`, `BusStationInput` (Task 4); from rail: `wallClockToInstant`, `instantToWallClock`, `greatCircleKm`, `sentWallClockToInstant`; from `shared/railClock`: `endHasClock`, `rideEndsAt`; `deriveBusStatus` (Task 3).
- Produces: `BusJourneyState`, `terminalColumns(prefix, station)`, `mergeBusJourney(existing, input, now?)`, `withBusTimes(row)`.

- [ ] **Step 1: Write the failing tests**

`backend/src/services/bus/__tests__/busJourneyWrite.test.ts`:

```ts
import { AppError } from "../../../middleware/errorHandler";
import { LocalTimeNonexistentError, TzUnresolvedError } from "../../../shared/time/errors";
import { mergeBusJourney, terminalColumns } from "../busJourneyWrite";

const SEOUL = { name: "Seoul Express Bus Terminal", address: null, lat: 37.5048, lon: 127.0046, country: "KR" };
const SOKCHO = { name: "Sokcho Express Bus Terminal", address: null, lat: 38.1911, lon: 128.5918, country: "KR" };
const BERLIN_ZOB = { name: "ZOB Berlin", address: "Masurenallee 4-6", lat: 52.5069, lon: 13.2778, country: "DE" };
const OPEN_SEA = { name: "Nowhere", address: null, lat: 0, lon: -30, country: null };

describe("terminalColumns", () => {
  it("derives the zone from the coordinates and keeps the address", () => {
    expect(terminalColumns("dep", BERLIN_ZOB)).toEqual({
      depStationName: "ZOB Berlin",
      depAddress: "Masurenallee 4-6",
      depLat: 52.5069,
      depLon: 13.2778,
      depCountry: "DE",
      depTimezone: "Europe/Berlin",
    });
  });
});

describe("mergeBusJourney", () => {
  const now = new Date("2026-10-01T00:00:00Z");

  it("reads each wall clock on its terminal's zone and measures the straight line", () => {
    const state = mergeBusJourney(
      null,
      { departureStation: SEOUL, arrivalStation: SOKCHO, departureLocal: "2026-09-20T09:00", arrivalLocal: "2026-09-20T11:20", status: "scheduled" },
      now
    );
    expect(state.departureTime.toISOString()).toBe("2026-09-20T00:00:00.000Z");
    expect(state.arrivalTime?.toISOString()).toBe("2026-09-20T02:20:00.000Z");
    expect(state.depPrecision).toBe("minute");
    expect(state.distanceSource).toBe("great_circle");
    expect(state.distanceKm).toBeGreaterThan(150);
    expect(state.distanceKm).toBeLessThan(170);
    expect(state.status).toBe("completed");
  });

  it("compares instants, not wall clocks (Paris 10:00 → London 10:55 is a real ride)", () => {
    const PARIS = { name: "Paris Bercy", address: null, lat: 48.8389, lon: 2.3829, country: "FR" };
    const LONDON = { name: "London Victoria Coach Station", address: null, lat: 51.4925, lon: -0.1481, country: "GB" };
    const state = mergeBusJourney(
      null,
      { departureStation: PARIS, arrivalStation: LONDON, departureLocal: "2026-07-01T10:00", arrivalLocal: "2026-07-01T10:55", status: "scheduled" },
      now
    );
    expect(state.arrivalTime!.getTime()).toBeGreaterThan(state.departureTime.getTime());
  });

  it("refuses an arrival before the departure as instants", () => {
    expect(() =>
      mergeBusJourney(
        null,
        { departureStation: SEOUL, arrivalStation: SOKCHO, departureLocal: "2026-09-20T11:20", arrivalLocal: "2026-09-20T11:00", status: "scheduled" },
        now
      )
    ).toThrow(expect.objectContaining({ code: "BUS_ARRIVAL_BEFORE_DEPARTURE", field: "arrivalLocal" }));
  });

  it("refuses a wall clock in a spring-forward gap", () => {
    expect(() =>
      mergeBusJourney(
        null,
        { departureStation: BERLIN_ZOB, arrivalStation: BERLIN_ZOB, departureLocal: "2027-03-28T02:30", status: "scheduled" },
        now
      )
    ).toThrow(LocalTimeNonexistentError);
  });

  it("refuses a terminal without a zone instead of reading the clock as UTC", () => {
    expect(() =>
      mergeBusJourney(
        null,
        { departureStation: OPEN_SEA, arrivalStation: SOKCHO, departureLocal: "2026-09-20T09:00", status: "scheduled" },
        now
      )
    ).toThrow(TzUnresolvedError);
  });

  it("a day-only ride is stored at the start of its day with precision day, no delay allowed", () => {
    const state = mergeBusJourney(
      null,
      { departureStation: SEOUL, arrivalStation: SOKCHO, departureLocal: "2026-09-21", status: "scheduled" },
      now
    );
    expect(state.departureTime.toISOString()).toBe("2026-09-20T15:00:00.000Z");
    expect(state.depPrecision).toBe("day");
    expect(state.arrivalTime).toBeNull();
    expect(() =>
      mergeBusJourney(
        null,
        { departureStation: SEOUL, arrivalStation: SOKCHO, departureLocal: "2026-09-21", delayMinutes: 5, status: "scheduled" },
        now
      )
    ).toThrow(AppError);
  });

  it("a moved terminal keeps the ticket's clock and moves the instant with the zone", () => {
    const existing = mergeBusJourney(
      null,
      { departureStation: SEOUL, arrivalStation: SOKCHO, departureLocal: "2026-09-20T09:00", status: "scheduled" },
      now
    );
    // Only the departure terminal changes — to Berlin, six/seven hours behind Seoul.
    const moved = mergeBusJourney(existing, { departureStation: BERLIN_ZOB }, now);
    expect(moved.depTimezone).toBe("Europe/Berlin");
    // Still 09:00 on the ticket, now Berlin's 09:00 (07:00Z in September).
    expect(moved.departureTime.toISOString()).toBe("2026-09-20T07:00:00.000Z");
  });

  it("a typed distance is kept until cleared; null measures again", () => {
    const typed = mergeBusJourney(
      null,
      { departureStation: SEOUL, arrivalStation: SOKCHO, departureLocal: "2026-09-20T09:00", distanceKm: 210, status: "scheduled" },
      now
    );
    expect(typed).toMatchObject({ distanceKm: 210, distanceSource: "user" });
    expect(mergeBusJourney(typed, { seat: "12A" }, now)).toMatchObject({ distanceKm: 210, distanceSource: "user" });
    expect(mergeBusJourney(typed, { distanceKm: null }, now).distanceSource).toBe("great_circle");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx jest src/services/bus/__tests__/busJourneyWrite.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Export rail's sent-wall-clock converter**

`backend/src/services/rail/railJourneyWrite.ts:120`: `function sentWallClockToInstant(` → `export function sentWallClockToInstant(`. Add to its doc comment: "Exported for the bus write path, whose terminals follow the same rule." Its `field` parameter type stays `"departureLocal" | "arrivalLocal"` — bus uses the same field names.

- [ ] **Step 4: Write the service**

`backend/src/services/bus/busJourneyWrite.ts`:

```ts
import { AppError } from "../../middleware/errorHandler";
import type { BusStationInput, UpdateBusJourneyInput } from "../../schemas/bus";
import { isLocalDayInput } from "../../schemas/wallClockInput";
import { deriveBusStatus } from "../../shared/statusDerivation";
import { TzUnresolvedError } from "../../shared/time/errors";
import { localDay, type Fold } from "../../shared/time/instant";
import { startOfDayAt } from "../../shared/time/legacyValues";
import { endHasClock, rideEndsAt } from "../../shared/railClock";
import { zoneOf } from "../../shared/time/zoneOf";
import {
  greatCircleKm,
  instantToWallClock,
  sentWallClockToInstant,
  wallClockToInstant,
} from "../rail/railJourneyWrite";

/**
 * The write rules of a bus ride (spec 2026-10-07-bus-domain-design §3, §4).
 *
 * Rail's rules, reached through rail's own functions: the two ends carry rail's
 * column names, so the clock helpers in `shared/railClock.ts` and the wall-clock
 * conversion in `services/rail/railJourneyWrite.ts` read a bus row as-is. What
 * is bus's own here is the terminal (no catalogue id, an address) and the
 * refusal codes, which name the domain so the form can word them.
 */

/** The row as far as these rules read it. */
export interface BusJourneyState {
  depStationName: string;
  depAddress: string | null;
  depLat: number;
  depLon: number;
  depCountry: string | null;
  depTimezone: string | null;
  arrStationName: string;
  arrAddress: string | null;
  arrLat: number;
  arrLon: number;
  arrCountry: string | null;
  arrTimezone: string | null;
  departureTime: Date;
  arrivalTime: Date | null;
  depPrecision?: string | null;
  arrPrecision?: string | null;
  distanceKm: number | null;
  distanceSource: string | null;
  status: string;
  /** Set only to clear a stored delay when the ride loses its clock. */
  delayMinutes?: number | null;
}

type TerminalColumns<P extends "dep" | "arr"> = {
  [K in `${P}StationName` | `${P}Address` | `${P}Lat` | `${P}Lon` | `${P}Country` | `${P}Timezone`]: K extends
    | `${P}Lat`
    | `${P}Lon`
    ? number
    : K extends `${P}StationName`
      ? string
      : string | null;
};

/** A terminal's columns, with its zone looked up from where it is (coordinates only — no catalogue). */
export function terminalColumns<P extends "dep" | "arr">(
  prefix: P,
  station: BusStationInput
): TerminalColumns<P> {
  return {
    [`${prefix}StationName`]: station.name,
    [`${prefix}Address`]: station.address ?? null,
    [`${prefix}Lat`]: station.lat,
    [`${prefix}Lon`]: station.lon,
    [`${prefix}Country`]: station.country ?? null,
    [`${prefix}Timezone`]: zoneOf({ catalogueZone: null, lat: station.lat, lon: station.lon }),
  } as TerminalColumns<P>;
}

function pickTerminal<P extends "dep" | "arr">(row: BusJourneyState, prefix: P): TerminalColumns<P> {
  const read = (suffix: string): unknown =>
    (row as unknown as Record<string, unknown>)[`${prefix}${suffix}`];
  return {
    [`${prefix}StationName`]: read("StationName"),
    [`${prefix}Address`]: read("Address") ?? null,
    [`${prefix}Lat`]: read("Lat"),
    [`${prefix}Lon`]: read("Lon"),
    [`${prefix}Country`]: read("Country"),
    [`${prefix}Timezone`]: read("Timezone"),
  } as TerminalColumns<P>;
}

interface EndReading {
  time: Date;
  precision: "minute" | "day";
}

/**
 * One end's instant and precision — rail's `resolveEnd` rule: a sent wall
 * clock is converted in the terminal's zone (a skipped hour refused), a bare
 * day becomes the start of that day there with precision `day`; a side not
 * sent keeps its stored instant unless its terminal moved, in which case the
 * ticket's wall clock is re-read in the new zone.
 */
function resolveEnd(args: {
  sent: string | null | undefined;
  fold: Fold | null | undefined;
  zone: string | null;
  terminalMoved: boolean;
  stored: { time: Date; zone: string | null; precision: string | null } | null;
  field: "departureLocal" | "arrivalLocal";
}): EndReading | null {
  const { sent, zone, stored, field } = args;
  if (sent === null) return null;
  if (sent !== undefined) {
    if (isLocalDayInput(sent)) {
      if (!zone) throw new TzUnresolvedError("the terminal has no zone", field);
      return { time: startOfDayAt(sent, zone), precision: "day" };
    }
    return { time: sentWallClockToInstant(sent, zone, field, args.fold), precision: "minute" };
  }
  if (!stored) return null;
  if (!endHasClock(stored.precision)) {
    if (!args.terminalMoved) return { time: stored.time, precision: "day" };
    const day = localDay(stored.time, stored.zone ?? "UTC");
    return { time: wallClockToInstant(`${day}T00:00`, zone), precision: "day" };
  }
  if (!args.terminalMoved) return { time: stored.time, precision: "minute" };
  return {
    time: wallClockToInstant(instantToWallClock(stored.time, stored.zone), zone),
    precision: "minute",
  };
}

function assertArrivalNotBefore(
  departure: EndReading,
  depZone: string | null,
  arrival: EndReading | null,
  arrZone: string | null
): void {
  if (!arrival) return;
  const bothClocked = departure.precision === "minute" && arrival.precision === "minute";
  const before = bothClocked
    ? arrival.time.getTime() < departure.time.getTime()
    : localDay(arrival.time, arrZone ?? "UTC") < localDay(departure.time, depZone ?? "UTC");
  if (before) {
    throw new AppError(
      "arrival must not precede departure",
      400,
      "BUS_ARRIVAL_BEFORE_DEPARTURE",
      "arrivalLocal"
    );
  }
}

/** A typed distance is kept until the user clears it; a measured one follows the terminals. */
function resolveDistance(
  existing: BusJourneyState | null,
  input: UpdateBusJourneyInput,
  coords: { depLat: number; depLon: number; arrLat: number; arrLon: number }
): { distanceKm: number; distanceSource: string } {
  if (typeof input.distanceKm === "number") {
    return { distanceKm: input.distanceKm, distanceSource: "user" };
  }
  if (input.distanceKm === undefined && existing?.distanceSource === "user" && existing.distanceKm) {
    return { distanceKm: existing.distanceKm, distanceSource: "user" };
  }
  return { distanceKm: greatCircleKm(coords), distanceSource: "great_circle" };
}

/**
 * Merge an update (or a create, with `existing = null`) into the final row
 * state. The wall clock NOT in the payload is read back from the stored
 * instant in the stored zone, so moving a terminal keeps "09:00 on the ticket"
 * and moves the instant with the zone.
 */
export function mergeBusJourney(
  existing: BusJourneyState | null,
  input: UpdateBusJourneyInput,
  now: Date = new Date()
): BusJourneyState {
  const dep = input.departureStation
    ? terminalColumns("dep", input.departureStation)
    : existing && pickTerminal(existing, "dep");
  const arr = input.arrivalStation
    ? terminalColumns("arr", input.arrivalStation)
    : existing && pickTerminal(existing, "arr");
  if (!dep || !arr) throw new AppError("Both terminals are required", 400, "BUS_INVALID_INPUT");

  const departure = resolveEnd({
    sent: input.departureLocal,
    fold: input.departureFold,
    zone: dep.depTimezone,
    terminalMoved: Boolean(input.departureStation),
    stored: existing && {
      time: existing.departureTime,
      zone: existing.depTimezone,
      precision: existing.depPrecision ?? null,
    },
    field: "departureLocal",
  });
  if (!departure) throw new AppError("departureLocal is required", 400, "BUS_INVALID_INPUT", "departureLocal");
  const arrival = resolveEnd({
    sent: input.arrivalLocal,
    fold: input.arrivalFold,
    zone: arr.arrTimezone,
    terminalMoved: Boolean(input.arrivalStation),
    stored:
      existing?.arrivalTime != null
        ? { time: existing.arrivalTime, zone: existing.arrTimezone, precision: existing.arrPrecision ?? null }
        : null,
    field: "arrivalLocal",
  });
  assertArrivalNotBefore(departure, dep.depTimezone, arrival, arr.arrTimezone);

  const departureTime = departure.time;
  const arrivalTime = arrival?.time ?? null;
  const clockless = departure.precision === "day" || arrival?.precision === "day";
  if (clockless && input.delayMinutes !== undefined && input.delayMinutes !== null) {
    throw new AppError("a delay needs the ride's times", 400, "BUS_INVALID_INPUT", "delayMinutes");
  }

  const { distanceKm, distanceSource } = resolveDistance(existing, input, { ...dep, ...arr });
  const depPrecision = departure.precision;
  const arrPrecision = arrival?.precision ?? null;
  const status = deriveBusStatus({
    departureTime,
    arrivalTime,
    current: input.status ?? existing?.status ?? "scheduled",
    now,
    endsAt: rideEndsAt({ departureTime, arrivalTime, depTimezone: dep.depTimezone, arrTimezone: arr.arrTimezone, depPrecision, arrPrecision }),
  });

  return {
    ...dep,
    ...arr,
    departureTime,
    arrivalTime,
    depPrecision,
    arrPrecision,
    distanceKm,
    distanceSource,
    status,
    ...(clockless && { delayMinutes: null }),
  };
}
```

`backend/src/services/bus/timesDto.ts`:

```ts
import type { BusTimes } from "../../schemas/times";
import { railTimes, type RailTimeColumns } from "../rail/timesDto";

/**
 * A bus ride's `times` (ADR 0002): rail's reader under the bus name, because
 * the two ends carry rail's columns. `BusTimes` and `RailTimes` are the same
 * shape, registered twice so each domain's OpenAPI names its own.
 */
export function withBusTimes<T extends RailTimeColumns>(ride: T): T & { times: BusTimes } {
  return { ...ride, times: railTimes(ride) };
}
```

- [ ] **Step 5: Run the tests**

Run: `cd backend && npx jest src/services/bus/__tests__/busJourneyWrite.test.ts src/services/rail/__tests__/railJourneyWrite.test.ts`
Expected: PASS — the bus suite (8 tests) and rail's unchanged.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/bus backend/src/services/rail/railJourneyWrite.ts
git commit -m "feat(bus): write rules — terminal zones, wall clock to instant, straight-line distance"
```

---

### Task 6: Router, rate limit, mount, OpenAPI, response-shape baseline, route tests

**Files:**
- Create: `backend/src/routes/bus.ts`, `backend/src/routes/__tests__/bus.test.ts`, `backend/src/services/openapi/paths/bus.ts`
- Modify: `backend/src/middleware/rateLimit.ts:319-327`, `backend/src/config/constants.ts:85-89`, `backend/src/routes/mounts.ts:90-95,320-331`, `backend/src/services/openapi/paths/index.ts:40`, `backend/src/__tests__/apiResponseShape.baseline.json:159`

**Interfaces:**
- Consumes: Task 4 schemas, Task 5 `mergeBusJourney`/`withBusTimes`, Task 2 `prisma.busJourney`, `takeDocumentIds`/`linkDocuments` with `{ type: "busJourney", id }`, `resolveCompanions`/`linkRowsFor`, `fxColumnsFor`/`getBaseCurrency`, `assertReferencesOwned`, `recomputeTripStatus`, `railListSummary`, `busYear`.
- Produces: `GET /api/v1/bus`, `GET /api/v1/bus/:id`, `POST /api/v1/bus`, `PATCH /api/v1/bus/:id`, `DELETE /api/v1/bus/:id`; envelope `{success, data, meta}`; `BUS_INCLUDE`; `buildBusWhere(query, userId)`.

- [ ] **Step 1: Write the failing route tests**

`backend/src/routes/__tests__/bus.test.ts` (harness as `rail.test.ts:1-60`):

```ts
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { busCreationLimiter } from "../../middleware/rateLimit";

const SEOUL = { name: "Seoul Express Bus Terminal", lat: 37.5048, lon: 127.0046, country: "kr" };
const SOKCHO = { name: "Sokcho Express Bus Terminal", lat: 38.1911, lon: 128.5918, country: "KR" };
const JEONJU = { name: "Jeonju Express Bus Terminal", lat: 35.8402, lon: 127.1289, country: "KR" };

describe("Bus rides API", () => {
  let cookie: string;
  let userId: string;
  let otherCookie: string;
  let otherUserId: string;

  const create = (body: Record<string, unknown>, as = cookie) =>
    request(app).post("/api/v1/bus").set("Cookie", as).send(body);

  const base = {
    operator: "Kobus",
    lineName: "Premium",
    rideKind: "intercity",
    departureStation: SEOUL,
    arrivalStation: SOKCHO,
    departureLocal: "2026-09-20T09:00",
    arrivalLocal: "2026-09-20T11:20",
    price: 23000,
    currency: "KRW",
  };

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["bustest", "busother"] } } });
    const user = await prisma.user.create({ data: { username: "bustest", passwordHash: await hashPassword("password123") } });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
    const other = await prisma.user.create({ data: { username: "busother", passwordHash: await hashPassword("password123") } });
    otherUserId = other.id;
    otherCookie = `auth_token=${generateToken(other.id)}`;
  });

  afterEach(async () => {
    await prisma.busJourney.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await busCreationLimiter.resetKey(`user:${userId}`);
    await busCreationLimiter.resetKey(`user:${otherUserId}`);
  });

  afterAll(async () => {
    await prisma.trip.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.companion.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await prisma.$disconnect();
  });

  it("creates a ride on the terminals' clocks, enveloped, with its times and a straight-line distance", async () => {
    const res = await create(base);
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    const ride = res.body.data;
    expect(ride.departureTime).toBe("2026-09-20T00:00:00.000Z");
    expect(ride.arrivalTime).toBe("2026-09-20T02:20:00.000Z");
    expect(ride.depTimezone).toBe("Asia/Seoul");
    expect(ride.depCountry).toBe("KR");
    expect(ride.times.departure.zone).toBe("Asia/Seoul");
    expect(ride.times.departure.local).toBe("2026-09-20T09:00");
    expect(ride.distanceSource).toBe("great_circle");
    expect(ride.geometrySource).toBe("straight");
    expect(ride.status).toBe("completed");
    expect(ride.rideKind).toBe("intercity");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("refuses an arrival before the departure with a stable code and field", async () => {
    const res = await create({ ...base, arrivalLocal: "2026-09-20T08:00" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("BUS_ARRIVAL_BEFORE_DEPARTURE");
    expect(res.body.field).toBe("arrivalLocal");
  });

  it("refuses a wall clock in a spring-forward gap with 422 LOCAL_TIME_NONEXISTENT", async () => {
    const ZOB = { name: "ZOB Berlin", lat: 52.5069, lon: 13.2778, country: "DE" };
    const res = await create({ ...base, departureStation: ZOB, arrivalStation: ZOB, departureLocal: "2027-03-28T02:30", arrivalLocal: null });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("LOCAL_TIME_NONEXISTENT");
    expect(res.body.field).toBe("departureLocal");
  });

  it("names the field of an invalid body", async () => {
    const res = await create({ ...base, departureStation: { name: "No position" } });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("BUS_INVALID_INPUT");
    expect(res.body.field).toBe("departureStation");
  });

  it("refuses a misspelt fold rather than dropping it", async () => {
    const res = await create({ ...base, arrivalFolds: "later" });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe("arrivalFolds");
  });

  it("stores a day-only ride at the start of its day with precision day", async () => {
    const res = await create({ ...base, departureLocal: "2026-09-21", arrivalLocal: null });
    expect(res.status).toBe(201);
    expect(res.body.data.departureTime).toBe("2026-09-20T15:00:00.000Z");
    expect(res.body.data.times.departure.precision).toBe("day");
    expect(res.body.data.times.arrival).toBeNull();
  });

  it("another user's trip is not a trip (404), and a ride is not readable by strangers", async () => {
    const trip = await prisma.trip.create({ data: { userId: otherUserId, name: "Korea", startDate: new Date("2026-09-18"), endDate: new Date("2026-09-30") } });
    const refused = await create({ ...base, tripId: trip.id });
    expect(refused.status).toBe(404);
    const mine = await create(base);
    const stranger = await request(app).get(`/api/v1/bus/${mine.body.data.id}`).set("Cookie", otherCookie);
    expect(stranger.status).toBe(404);
  });

  it("lists one page, newest departure first, with the filtered total and the summary strip", async () => {
    await create(base);
    await create({ ...base, operator: "Kumho", departureStation: JEONJU, arrivalStation: { name: "Busan Central Bus Terminal", lat: 35.2156, lon: 129.0926, country: "KR" }, departureLocal: "2026-09-25T13:00", arrivalLocal: "2026-09-25T16:40" });
    const res = await request(app).get("/api/v1/bus?limit=1").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].operator).toBe("Kumho");
    expect(res.body.meta.total).toBe(2);
    expect(res.body.meta.summary).toEqual({ journeys: 2, operators: 2, withoutOperator: 0, stations: 4 });
    const filtered = await request(app).get("/api/v1/bus?q=kobus").set("Cookie", cookie);
    expect(filtered.body.meta.total).toBe(1);
  });

  it("filters by the year on the departure terminal's calendar", async () => {
    // 1 Jan 00:30 in Seoul is 31 Dec 15:30 UTC — a 2027 ride, not a 2026 one.
    await create({ ...base, departureLocal: "2027-01-01T00:30", arrivalLocal: "2027-01-01T03:00" });
    const y2026 = await request(app).get("/api/v1/bus?year=2026").set("Cookie", cookie);
    const y2027 = await request(app).get("/api/v1/bus?year=2027").set("Cookie", cookie);
    expect(y2026.body.meta.total).toBe(0);
    expect(y2027.body.meta.total).toBe(1);
  });

  it("updates a field, keeps the ticket's clock when a terminal moves, and re-derives the trip", async () => {
    const trip = await prisma.trip.create({ data: { userId, name: "Korea", startDate: new Date("2026-09-25"), endDate: new Date("2026-09-30") } });
    const created = await create({ ...base, tripId: trip.id });
    const id = created.body.data.id;
    const patched = await request(app).patch(`/api/v1/bus/${id}`).set("Cookie", cookie).send({ seat: "12A", departureStation: JEONJU });
    expect(patched.status).toBe(200);
    expect(patched.body.data.seat).toBe("12A");
    expect(patched.body.data.depStationName).toBe(JEONJU.name);
    expect(patched.body.data.times.departure.local).toBe("2026-09-20T09:00");
    const after = await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } });
    // A ride on the 20th widens a trip that began on the 25th.
    expect(after.startDate.toISOString().slice(0, 10)).toBe("2026-09-20");
  });

  it("dual-writes companions and counts them on the companion", async () => {
    const res = await create({ ...base, companions: ["Mina"] });
    expect(res.body.data.companions).toEqual(["Mina"]);
    const links = await prisma.busJourneyCompanion.count({ where: { busJourneyId: res.body.data.id } });
    expect(links).toBe(1);
    const companions = await request(app).get("/api/v1/companions").set("Cookie", cookie);
    expect(companions.body.companions.find((c: { name: string }) => c.name === "Mina").usageCount).toBe(1);
  });

  it("snapshots the price in the base currency, dated by the departure", async () => {
    const res = await create(base);
    expect(res.body.data.currency).toBe("KRW");
    // fxColumnsFor fills the five columns when a rate exists; without network it leaves them null, never 0.
    expect(res.body.data.priceBase === null || typeof res.body.data.priceBase === "number").toBe(true);
    expect(res.body.data.priceBase).not.toBe(0);
  });

  it("deletes, then 404s", async () => {
    const res = await create(base);
    const del = await request(app).delete(`/api/v1/bus/${res.body.data.id}`).set("Cookie", cookie);
    expect(del.status).toBe(204);
    const gone = await request(app).get(`/api/v1/bus/${res.body.data.id}`).set("Cookie", cookie);
    expect(gone.status).toBe(404);
  });

  it("limits creation per user on its own bucket", async () => {
    const first = await create(base);
    expect(Number(first.headers["ratelimit-limit"])).toBe(300);
    const other = await create(base, otherCookie);
    expect(Number(other.headers["ratelimit-remaining"])).toBe(299);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx jest src/routes/__tests__/bus.test.ts --forceExit`
Expected: FAIL — 404 on every `/api/v1/bus` request (nothing mounted) and `busCreationLimiter` undefined.

- [ ] **Step 3: Rate limit constant and limiter**

`constants.ts` after `RAIL_CREATION_MAX`:
```ts
  // Bus rides take rail's budget, for rail's reason: a later import saves one
  // ride per request, and a first sitting is years of tickets.
  BUS_CREATION_MAX: 300, // rides per hour
```
`rateLimit.ts` after `railCreationLimiter`:
```ts
export const busCreationLimiter = rateLimit({
  windowMs: RATE_LIMITS.FLIGHT_CREATION_WINDOW_MS,
  max: patAwareMax(RATE_LIMITS.BUS_CREATION_MAX),
  message: "Too many bus rides saved, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
});
```

- [ ] **Step 4: Write the router**

`backend/src/routes/bus.ts` — rail's router (`routes/rail.ts`) with everything bus has no business with removed: no station resolution, no lookup/geometry, no connections, no short codes, no `source`, no loyalty filter. Written out:

```ts
import { Router, Response, NextFunction } from "express";
import type { z } from "zod";

import { prisma } from "../db";
import { Prisma } from "../prisma";
import { authenticate, requireWriteScope, AuthRequest } from "../middleware/auth";
import { busCreationLimiter } from "../middleware/rateLimit";
import { AppError } from "../middleware/errorHandler";
import {
  busQuerySchema,
  createBusJourneySchema,
  strayBusFoldKey,
  updateBusJourneySchema,
  type BusQueryInput,
  type UpdateBusJourneyInput,
} from "../schemas/bus";
import { mergeBusJourney } from "../services/bus/busJourneyWrite";
import { withBusTimes } from "../services/bus/timesDto";
import { recomputeTripStatus } from "../services/tripStatusService";
import { busYear } from "../shared/busCounting";
import { resolveCompanions, linkRowsFor } from "../services/companionService";
import { fxColumnsFor, getBaseCurrency } from "../services/fx/snapshot";
import { linkDocuments, takeDocumentIds } from "../services/documents/documentService";
import { assertReferencesOwned } from "../utils/ownedReferences";
import logger from "../utils/logger";
import { railListSummary } from "../shared/listSummary";

/**
 * Bus rides — one row per coach ride (spec
 * docs/superpowers/specs/2026-10-07-bus-domain-design.md). Enveloped family, as
 * ADR 0001 asks of a new domain. The endpoints stay reachable whatever the
 * instance beta switch says; the switch hides the UI, it is not a boundary.
 */

export const BUS_INCLUDE = {
  trip: { select: { id: true, name: true, color: true } },
} satisfies Prisma.BusJourneyInclude;

const DEFAULT_LIMIT = 100;

const SORT_COLUMN: Record<BusQueryInput["sort"], keyof Prisma.BusJourneyOrderByWithRelationInput> = {
  departure: "departureTime",
  distance: "distanceKm",
  created: "createdAt",
};

function primaryOrder(query: BusQueryInput): Prisma.BusJourneyOrderByWithRelationInput {
  const column = SORT_COLUMN[query.sort];
  return column === "distanceKm"
    ? { distanceKm: { sort: query.order, nulls: "last" } }
    : { [column]: query.order };
}

/** A ride extends its trip's span; every write re-derives the trip it was in and the trip it is in now. */
async function restatusTrips(...tripIds: Array<string | null | undefined>): Promise<void> {
  for (const id of new Set(tripIds.filter((t): t is string => Boolean(t)))) {
    await recomputeTripStatus(id);
  }
}

function refuseStrayFold(body: unknown): void {
  const key = strayBusFoldKey(body);
  if (key) throw new AppError(`Unknown field ${key}`, 400, "BUS_INVALID_INPUT", key);
}

function invalidInput(error: z.ZodError): AppError {
  const field = error.issues[0]?.path[0];
  return new AppError(error.message, 400, "BUS_INVALID_INPUT", typeof field === "string" ? field : undefined);
}

const requireUser = (req: AuthRequest): string => {
  if (!req.userId) throw new AppError("Not authenticated", 401);
  return req.userId;
};

const MAX_AHEAD_OF_UTC_MS = 14 * 60 * 60 * 1000;
const MAX_BEHIND_UTC_MS = 12 * 60 * 60 * 1000;

/** The rides that left in `year` on their departure terminal's calendar — `busYear`'s rule, per row. */
async function idsDepartingInYear(userId: string, year: number): Promise<string[]> {
  const candidates = await prisma.busJourney.findMany({
    where: {
      userId,
      departureTime: {
        gte: new Date(Date.UTC(year, 0, 1) - MAX_AHEAD_OF_UTC_MS),
        lt: new Date(Date.UTC(year + 1, 0, 1) + MAX_BEHIND_UTC_MS),
      },
    },
    select: { id: true, departureTime: true, depTimezone: true },
  });
  return candidates
    .filter((r) => busYear({ ...r, arrivalTime: null, arrTimezone: null }) === year)
    .map((r) => r.id);
}

export async function buildBusWhere(
  query: Pick<BusQueryInput, "status" | "q" | "year" | "tripId">,
  userId: string
): Promise<Prisma.BusJourneyWhereInput> {
  const statuses = query.status === undefined ? undefined : [query.status].flat();
  const q = query.q;
  return {
    userId,
    ...(statuses && { status: { in: statuses } }),
    ...(query.tripId && { tripId: query.tripId }),
    ...(query.year !== undefined && { id: { in: await idsDepartingInYear(userId, query.year) } }),
    ...(q && {
      OR: (["operator", "lineName", "depStationName", "arrStationName", "bookingReference"] as const).map(
        (field) => ({ [field]: { contains: q, mode: "insensitive" as const } })
      ),
    }),
  };
}

/** Everything but the derived columns, companions and FX, which the handlers own. */
function plainColumns(input: UpdateBusJourneyInput) {
  const {
    departureStation: _dep,
    arrivalStation: _arr,
    departureLocal: _depLocal,
    arrivalLocal: _arrLocal,
    departureFold: _depFold,
    arrivalFold: _arrFold,
    distanceKm: _distance,
    status: _status,
    companions: _companions,
    ...rest
  } = input;
  return rest;
}

const router = Router();
router.use(authenticate);
router.use(requireWriteScope);

router.get("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const parsed = busQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);
    const query = parsed.data;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const offset = query.offset ?? 0;
    const where = await buildBusWhere(query, userId);
    const [total, data, counted] = await Promise.all([
      prisma.busJourney.count({ where }),
      prisma.busJourney.findMany({
        where,
        include: BUS_INCLUDE,
        orderBy: [primaryOrder(query), { id: query.order }],
        take: limit,
        skip: offset,
      }),
      prisma.busJourney.findMany({ where, select: { operator: true, depStationName: true, arrStationName: true } }),
    ]);
    res.json({
      success: true,
      data: data.map(withBusTimes),
      // `railListSummary` reads operator and the two station names — the columns a bus row shares.
      meta: { total, limit, offset, summary: railListSummary(counted) },
    });
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const ride = await prisma.busJourney.findFirst({ where: { id: req.params.id, userId }, include: BUS_INCLUDE });
    if (!ride) throw new AppError("Bus ride not found", 404);
    res.json({ success: true, data: withBusTimes(ride) });
  } catch (err) {
    next(err);
  }
});

router.post("/", busCreationLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    refuseStrayFold(req.body);
    const parsed = createBusJourneySchema.safeParse(req.body);
    if (!parsed.success) throw invalidInput(parsed.error);
    const input = parsed.data;
    await assertReferencesOwned(userId, { tripId: input.tripId, bookingId: input.bookingId });
    const documentIds = await takeDocumentIds(userId, req.body);

    const state = mergeBusJourney(null, input);
    const companions = await resolveCompanions(userId, input.companions ?? []);
    const fxColumns = await fxColumnsFor(
      { amount: input.price, currency: input.currency, date: state.departureTime },
      await getBaseCurrency(userId)
    );

    const ride = await prisma.$transaction(async (tx) => {
      const created = await tx.busJourney.create({
        data: { ...plainColumns(input), ...state, ...fxColumns, userId, companions: companions.map((c) => c.displayName) },
      });
      if (companions.length > 0) {
        await tx.busJourneyCompanion.createMany({
          data: linkRowsFor(companions.map((c) => c.id)).map((row) => ({ ...row, busJourneyId: created.id })),
          skipDuplicates: true,
        });
      }
      return tx.busJourney.findUniqueOrThrow({ where: { id: created.id }, include: BUS_INCLUDE });
    });

    await linkDocuments(userId, documentIds, { type: "busJourney", id: ride.id });
    await restatusTrips(ride.tripId);
    logger.info({ operation: "bus_journey_create", busJourneyId: ride.id, userId });
    res.status(201).json({ success: true, data: withBusTimes(ride) });
  } catch (err) {
    next(err);
  }
});

router.patch("/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const existing = await prisma.busJourney.findFirst({ where: { id: req.params.id, userId } });
    if (!existing) throw new AppError("Bus ride not found", 404);
    refuseStrayFold(req.body);
    const parsed = updateBusJourneySchema.safeParse(req.body);
    if (!parsed.success) throw invalidInput(parsed.error);
    const input = parsed.data;
    await assertReferencesOwned(userId, { tripId: input.tripId, bookingId: input.bookingId });

    const state = mergeBusJourney(existing, input);
    const resolved = input.companions !== undefined ? await resolveCompanions(userId, input.companions) : undefined;
    const fxColumns = await fxColumnsFor(
      {
        amount: input.price !== undefined ? input.price : existing.price,
        currency: input.currency ?? existing.currency ?? undefined,
        date: state.departureTime,
      },
      await getBaseCurrency(userId)
    );

    const ride = await prisma.$transaction(async (tx) => {
      if (resolved !== undefined) {
        await tx.busJourneyCompanion.deleteMany({ where: { busJourneyId: existing.id } });
        if (resolved.length > 0) {
          await tx.busJourneyCompanion.createMany({
            data: linkRowsFor(resolved.map((c) => c.id)).map((row) => ({ ...row, busJourneyId: existing.id })),
            skipDuplicates: true,
          });
        }
      }
      await tx.busJourney.update({
        where: { id: existing.id },
        data: {
          ...plainColumns(input),
          ...state,
          ...fxColumns,
          ...(resolved !== undefined && { companions: resolved.map((c) => c.displayName) }),
        },
      });
      return tx.busJourney.findUniqueOrThrow({ where: { id: existing.id }, include: BUS_INCLUDE });
    });

    await restatusTrips(existing.tripId, ride.tripId);
    res.json({ success: true, data: withBusTimes(ride) });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const existing = await prisma.busJourney.findFirst({ where: { id: req.params.id, userId }, select: { id: true, tripId: true } });
    if (!existing) throw new AppError("Bus ride not found", 404);
    await prisma.busJourney.delete({ where: { id: existing.id } });
    await restatusTrips(existing.tripId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
```

Check two things against rail while writing: how `rail.ts`'s PATCH handles `fxColumnsFor` when the price is untouched (lines 460-540 — copy that exact handling rather than the sketch above if it differs), and that `tripStatusService.recomputeTripStatus` will only widen a trip by bus rides once Task 7 adds `busJourneys` to its select — the trip-widening assertion in the route test depends on that, so run Task 7's `tripStatusService` edit before expecting that test green.

- [ ] **Step 5: Mount it and add the baseline line**

`mounts.ts`: `import busRouter from "./bus";` beside the rental imports; in the table after the rental entries:
```ts
  // Bus rides (spec 2026-10-07-bus-domain-design). Behind the beta switch in the UI only.
  { id: "bus", base: "/api/v1/bus", router: busRouter },
```
`apiResponseShape.baseline.json`: add `"bus.ts",` to the `enveloped` list in alphabetical position (after `"auth/…"`-ish entries — keep the list sorted as it is).

- [ ] **Step 6: Document the endpoints**

`backend/src/services/openapi/paths/bus.ts` — rail's module (`paths/rail.ts:1-377`) reduced: no source, no detail-with-booking, no geometry report. Row schema:

```ts
import { z } from "zod";
import { registry } from "../registry";
import { includedRow, prismaColumns } from "../prismaColumns";
import { errorContent, timeRefused } from "./shared";
import { documentIdsBodySchema } from "../../../schemas/document";
import {
  BUS_DISTANCE_SOURCES, BUS_GEOMETRY_SOURCES, BUS_RIDE_KINDS, BUS_SORT_FIELDS, BUS_STATUSES,
  createBusJourneySchema, updateBusJourneySchema,
} from "../../../schemas/bus";
import { busTimesSchema } from "../../../schemas/times";

const busJourney = registry.register(
  "BusJourney",
  z.object({
    ...prismaColumns("BusJourney"),
    id: z.string().uuid(),
    userId: z.string().uuid(),
    rideKind: z.enum(BUS_RIDE_KINDS).nullable().describe("intercity | shuttle | charter | other; null when unstated"),
    depCountry: z.string().nullable().describe("ISO 3166-1 alpha-2; null when unknown"),
    depTimezone: z.string().nullable().describe("IANA zone, derived by the server from the terminal's coordinates"),
    arrTimezone: z.string().nullable(),
    departureTime: z.string().datetime().describe("Real UTC instant"),
    arrivalTime: z.string().datetime().nullable().describe("Real UTC instant, or unknown"),
    distanceKm: z.number().nullable(),
    distanceSource: z.enum(BUS_DISTANCE_SOURCES).nullable().describe("great_circle = straight line between the terminals, not road length; user = typed from the ticket; route = along the routed road line"),
    geometry: z.array(z.tuple([z.number(), z.number()])).nullable().describe("[lon, lat] points, frozen; null = the straight line"),
    geometrySource: z.enum(BUS_GEOMETRY_SOURCES).describe("Where the line comes from; a road-routed line may not be the road the coach took"),
    actualDepartureTime: z.string().datetime().nullable(),
    actualArrivalTime: z.string().datetime().nullable(),
    status: z.enum(BUS_STATUSES).describe("Derived from the two instants; only 'cancelled' is set by a client"),
    delayMinutes: z.number().int().nullable().describe("Arrival delay; null = not recorded, 0 = on time"),
    trip: includedRow("trip (id, name, color)").nullable().optional(),
    times: busTimesSchema,
  }).openapi("BusJourney")
);
const envelope = <T extends z.ZodTypeAny>(data: T) => z.object({ success: z.literal(true), data });
const summary = z.object({ journeys: z.number().int(), operators: z.number().int(), withoutOperator: z.number().int(), stations: z.number().int() });
```
Then five `registry.registerPath` blocks mirroring `paths/rail.ts:205-377` with `path: "/bus"` / `"/bus/{id}"`, `tags: ["Bus"]`, the query without `membershipId`, the list 200 as `{success, data: z.array(busJourney), meta: {total, summary, limit, offset}}`, the read 200 as `envelope(busJourney)`, create body `createBusJourneySchema.openapi("BusJourneyCreateInput").and(documentIdsBodySchema)` with `422: timeRefused`, `201: envelope(busJourney)`, `400`, `404`, `429`; update body `updateBusJourneySchema.openapi("BusJourneyUpdateInput")`, `200: envelope(busJourney)`; delete `204`/`404`. Create description (verbatim, it is the contract): "`departureLocal`/`arrivalLocal` are the terminal's wall clock without an offset; the server looks up each terminal's zone from its coordinates and stores the real instant. A ticket that prints no time is sent as the day alone (`YYYY-MM-DD`): stored as the start of that day at the terminal with precision `day`, it has no duration and no delay (`delayMinutes` is refused). Without `distanceKm` the great-circle distance is stored and labelled `great_circle` — a straight line, not the road."

`paths/index.ts`: `import "./bus";` after `"./rental"`.

- [ ] **Step 7: Run the route tests and the OpenAPI/ratchet tests**

Run: `cd backend && npx jest src/routes/__tests__/bus.test.ts src/__tests__/openapi.coverage.test.ts src/__tests__/openapi.responseSchema.test.ts src/__tests__/apiResponseShape.ratchet.test.ts src/__tests__/apiNoStore.test.ts --forceExit`
Expected: PASS — all 14 route tests except "updates a field … re-derives the trip", which stays red until Task 7 wires `tripStatusService`; OpenAPI coverage sees five documented endpoints; response-shape ratchet accepts `bus.ts` as enveloped.

- [ ] **Step 8: Commit**

```bash
git add backend/src/routes/bus.ts backend/src/routes/__tests__/bus.test.ts backend/src/services/openapi/paths/bus.ts backend/src/services/openapi/paths/index.ts backend/src/routes/mounts.ts backend/src/middleware/rateLimit.ts backend/src/config/constants.ts backend/src/__tests__/apiResponseShape.baseline.json
git commit -m "feat(bus): enveloped CRUD router with paging, OpenAPI and route tests"
```

---

### Task 7: Every shared surface compiles — trip bounds, explicit empty answers, the compiler's list

**Files:**
- Modify: `backend/src/services/tripStatusService.ts:46-57,65,71,97,114`, `backend/src/services/statusSweep.ts:300,317`, `backend/src/services/evidence/crossDomainPopulations.ts:526-545`
- Modify: `frontend/src/lib/stats/domain-stats/types.ts:10`, `frontend/src/lib/stats/domain-stats/useDomainStats.ts:62`, `frontend/src/components/Stats/Overview/CrossDomainKpis.tsx:90`, `frontend/src/pages/statsTabAccess.ts:58-79`, `frontend/src/pages/AchievementsPage.tsx:68-70,342`, `frontend/src/components/Settings/ImportSection.tsx:70`, `frontend/src/components/table/OperatorTile.tsx:8-13`, `frontend/src/lib/trips/attachableEntries.ts:183-221`, `frontend/src/i18n/config.ts:23,61,122,161,210`
- Test: `backend/src/routes/__tests__/busTripStatus.test.ts`

**Interfaces:**
- Consumes: `prisma.busJourney` (Task 2), `rideStatusSpan`/`RAIL_CLOCK_SELECT` (rail), `busApi.list` (Task 8 — write `attachableEntries` last, after Task 8, or stub `loadBus` to return `[]` with a pointer until then).
- Produces: a clean `npx tsc --noEmit` in both trees; a bus ride widens its trip.

- [ ] **Step 1: Write the failing trip-bounds test**

`backend/src/routes/__tests__/busTripStatus.test.ts` (harness as `railTripStatus.test.ts`): create a user and a trip with `startDate: null, endDate: null`; POST `/api/v1/bus` with `tripId`, Seoul → Sokcho on `2026-09-20T09:00`–`11:20`; assert the trip's `startDate` and `endDate` are now `2026-09-20` and the trip status is `completed` (departure in the past relative to the test clock — use dates before today). Second case: a trip dated `2026-09-25`–`2026-09-30` and a ride on the 20th → `startDate` becomes `2026-09-20`.

Run: `cd backend && npx jest src/routes/__tests__/busTripStatus.test.ts --forceExit`
Expected: FAIL — the trip's dates do not move (bus rides are not in the select).

- [ ] **Step 2: Wire bus rides into trip bounds and status**

`tripStatusService.ts`: in the first `findUnique` select add `busJourneys: { select: { departureTime: true, arrivalTime: true, depTimezone: true, arrTimezone: true, depLat: true, depLon: true, arrLat: true, arrLon: true } },` beside `railJourneys`; change both spreads to `[...trip.flights, ...trip.railJourneys, ...trip.busJourneys]` (lines 65 and 71). In `recomputeTripStatus`'s select add `busJourneys: { select: RAIL_CLOCK_SELECT },` and in `tripStatusBounds({...})` change `railJourneys: trip.railJourneys.map(rideStatusSpan)` to `railJourneys: [...trip.railJourneys, ...trip.busJourneys].map(rideStatusSpan)` with the comment `// Bus rides carry rail's clock columns and join its bounds (spec 2026-10-07 §8).` Same two edits in `statusSweep.ts` (the trip select at ~300 and the bounds call at ~317).

Run the test again. Expected: PASS. Then: `npx jest src/routes/__tests__/bus.test.ts --forceExit` — the "re-derives the trip" case from Task 6 is green now.

- [ ] **Step 3: Explicit empty answers on the backend**

`crossDomainPopulations.ts`, after `loadRental`:
```ts
/**
 * Bus rides join the cross-domain figures in B2 (spec 2026-10-07 §6, D4), the
 * way rail's loader does. Until then an empty population, not an omitted key,
 * so a domain filter that names bus is answered rather than refused.
 */
async function loadBus(_userId: string): Promise<CrossDomainPopulation> {
  return { events: [], countryRows: [] };
}
```
and `bus: loadBus,` in `LOADERS`.

Run: `cd backend && npx tsc --noEmit`
Expected: clean. If any other `Record<DomainKey, …>` complains, give it the explicit empty answer with a `// B2 (spec 2026-10-07 §…)` pointer and list the file in the commit body.

- [ ] **Step 4: Frontend — the compiler's list**

Run: `cd frontend && npx tsc --noEmit 2>&1 | grep -o "src/[^(]*" | sort -u`
Expected: the files below (plus any this list missed — treat each the same way):

- `lib/stats/domain-stats/types.ts:10` → `export type StatsDomain = Exclude<DomainKey, "rental" | "bus">;` with the comment extended: "Bus joins in B2 with its stats endpoint (spec 2026-10-07 §6)."
- `lib/stats/domain-stats/useDomainStats.ts:62` → `(d): d is StatsDomain => d !== "rental" && d !== "bus" && (d !== "rail" || railOffered)`.
- `components/Stats/Overview/CrossDomainKpis.tsx:90` → `.filter((domain): domain is StatsDomain => domain !== "rental" && domain !== "bus")`.
- `pages/statsTabAccess.ts` — wherever `rentalOffered` is threaded, bus is simply never a stats tab in B1: add `key !== "bus"` beside the `rental` condition in both functions.
- `pages/AchievementsPage.tsx:68-70` → add `bus: "achievements:filters.domainBus",`; line 342 → `.filter((d) => d !== "rental" && d !== "bus" && enabled.includes(d))` with the comment `{/* Rental and bus have no achievements yet (rental spec D3/D8; bus spec §12 B4). */}`.
- `components/Settings/ImportSection.tsx:70` → `key === "rental" || key === "bus" ? false : …` (no spreadsheet import in B1).
- `components/table/OperatorTile.tsx:8-13` → `type TileDomain = "rail" | "rental" | "bus";` and `bus: { colour: "var(--ts-domain-bus)", icon: "bus" },` (lucide `bus` exists; check `Icon`'s name union accepts it — if not, add it there).
- `lib/trips/attachableEntries.ts:219-221` → `bus: loadBus,` where
  ```ts
  async function loadBus(): Promise<AttachableEntry[]> {
    const rides = await busApi.listAll();
    return rides.map((r) => ({
      domain: "bus" as const,
      id: r.id,
      tripId: r.tripId,
      label: `${r.operator ?? "Bus"} · ${r.depStationName} → ${r.arrStationName}`,
      date: r.departureTime,
    }));
  }
  ```
  (shape as `loadRentals` at 183 — copy its exact fields) and in the attach `switch` at ~259: `case "bus": await busApi.update(entry.id, { tripId }); return;`. `ATTACHABLE_DOMAINS` gains `"bus"`.
- `i18n/config.ts` → `import enBus from "./resources/en/bus.json";` / `import deBus from "./resources/de/bus.json";`, `bus: enBus,` / `bus: deBus,` in both resource maps, `"bus"` in the namespace list at ~210. (The JSON files are written in Task 8; create them first as `{}` placeholders ONLY if you run this task before Task 8 — then fill them there.)
- Any `Record<DomainKey, …>` in `store/domainColorStore.ts`, `hooks/useDomainColors.ts`, `components/map/*` or `components/Dashboard/*`: `bus: false` / the default colour from `DOMAINS.bus.color`, each with a `// B2` pointer where the thing it gates is a B2 surface.

Run: `cd frontend && npx tsc --noEmit && npx vitest --run src/lib/stats src/pages/__tests__/AchievementsPage src/components/table`
Expected: tsc clean; the named suites PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/tripStatusService.ts backend/src/services/statusSweep.ts backend/src/services/evidence/crossDomainPopulations.ts backend/src/routes/__tests__/busTripStatus.test.ts frontend/src
git commit -m "feat(bus): rides widen their trip; every shared surface answers for the new key"
```

---

### Task 8: Frontend types, API client, copy

**Files:**
- Create: `frontend/src/types/bus.ts`, `frontend/src/lib/api/bus.ts`, `frontend/src/i18n/resources/de/bus.json`, `frontend/src/i18n/resources/en/bus.json`, `frontend/src/lib/api/__tests__/bus.test.ts`

**Interfaces:**
- Produces: `BusJourney`, `BusJourneyInput`, `BusStatus`, `BusRideKind`, `BUS_RIDE_KINDS`, `BusTimes`; `busApi.list/listAll/get/create/update/remove`, `BusListQuery`, `BusPage`, `BusListSummary`; i18n namespace `bus`.

- [ ] **Step 1: Write the API client test**

`frontend/src/lib/api/__tests__/bus.test.ts` — mock `../client` (`api.get/post/patch/delete`) and assert: `list()` unwraps `{data, meta.total, meta.summary}` into `{journeys, total, summary}`; `create()` posts to `/bus` and returns `data`; `update(id, …)` patches `/bus/<id>`; `remove(id)` deletes `/bus/<id>`. Four cases, the shape of `railLookupTimeout.test.ts`'s mocking.

Run: `cd frontend && npx vitest --run src/lib/api/__tests__/bus.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 2: Types**

`frontend/src/types/bus.ts`:

```ts
/**
 * Bus rides — one row per coach ride (spec
 * docs/superpowers/specs/2026-10-07-bus-domain-design.md). Mirrors the backend
 * row (`BusJourney`) and the write body (`schemas/bus.ts`). The two ends carry
 * rail's column names, so `lib/entityTimes.ts`'s `RailLike` readers and
 * `lib/railTime.ts` accept a bus row as-is.
 */

import type { RailTimes } from "./times";

export type BusStatus = "scheduled" | "in_progress" | "completed" | "cancelled";
export type BusRideKind = "intercity" | "shuttle" | "charter" | "other";
export type BusDistanceSource = "great_circle" | "user" | "route";
export type BusGeometrySource = "straight" | "road" | "manual";

export const BUS_RIDE_KINDS: readonly BusRideKind[] = ["intercity", "shuttle", "charter", "other"];

/** The same four members as a rail ride's times; the OpenAPI name is `BusTimes`. */
export type BusTimes = RailTimes;

export interface BusJourney {
  id: string;
  userId: string;
  operator: string | null;
  lineName: string | null;
  rideKind: BusRideKind | null;
  depStationName: string;
  depAddress: string | null;
  depLat: number;
  depLon: number;
  depCountry: string | null;
  depTimezone: string | null;
  arrStationName: string;
  arrAddress: string | null;
  arrLat: number;
  arrLon: number;
  arrCountry: string | null;
  arrTimezone: string | null;
  departureTime: string;
  arrivalTime: string | null;
  distanceKm: number | null;
  distanceSource: BusDistanceSource | null;
  geometry: [number, number][] | null;
  geometrySource: BusGeometrySource;
  actualDepartureTime: string | null;
  actualArrivalTime: string | null;
  fareClass: string | null;
  seat: string | null;
  bookingReference: string | null;
  price: number | null;
  currency: string | null;
  status: BusStatus;
  delayMinutes: number | null;
  notes: string | null;
  tags: string[];
  companions: string[];
  tripId: string | null;
  bookingId: string | null;
  externalRef?: string | null;
  trip?: { id: string; name: string; color: string } | null;
  times?: BusTimes;
  createdAt: string;
  updatedAt: string;
}

export interface BusStationInput {
  name: string;
  address: string | null;
  lat: number;
  lon: number;
  country: string | null;
}

/** The write body — every optional field SENT, null when empty (see `busFormModel.ts`). */
export interface BusJourneyInput {
  operator: string | null;
  lineName: string | null;
  rideKind: BusRideKind | null;
  departureStation: BusStationInput;
  arrivalStation: BusStationInput;
  departureLocal: string;
  arrivalLocal: string | null;
  departureFold?: "earlier" | "later" | null;
  arrivalFold?: "earlier" | "later" | null;
  distanceKm: number | null;
  fareClass: string | null;
  seat: string | null;
  delayMinutes: number | null;
  bookingReference: string | null;
  price: number | null;
  currency: string;
  status: "scheduled" | "cancelled";
  tags: string[];
  companions: string[];
  tripId: string | null;
  notes: string | null;
}
```

- [ ] **Step 3: API client**

`frontend/src/lib/api/bus.ts`:

```ts
import { api } from "./client";
import type { BusJourney, BusJourneyInput } from "../../types/bus";

/** `/api/v1/bus` — the bus logbook (spec 2026-10-07-bus-domain-design). Enveloped. */

interface Envelope<T> {
  success: boolean;
  data: T;
}

/** The summary strip's figures over the whole FILTERED list, counted by the server. */
export interface BusListSummary {
  journeys: number;
  operators: number;
  withoutOperator: number;
  stations: number;
}

export interface BusPage {
  journeys: BusJourney[];
  total: number;
  summary: BusListSummary;
}

export interface BusListQuery {
  q?: string;
  year?: number;
  status?: string;
  tripId?: string;
  sort?: "departure" | "distance" | "created";
  order?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export const busApi = {
  async list(query: BusListQuery = {}): Promise<BusPage> {
    const res = await api.get<Envelope<BusJourney[]> & { meta: { total: number; summary: BusListSummary } }>(
      "/bus",
      { params: query }
    );
    return { journeys: res.data.data, total: res.data.meta.total, summary: res.data.meta.summary };
  },

  /** Every ride matching `query`, a page of 500 (the endpoint's cap) at a time. */
  async listAll(query: Omit<BusListQuery, "limit" | "offset"> = {}): Promise<BusJourney[]> {
    const PAGE = 500;
    const rides: BusJourney[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const page = await busApi.list({ ...query, limit: PAGE, offset });
      rides.push(...page.journeys);
      if (page.journeys.length < PAGE || rides.length >= page.total) return rides;
    }
  },

  async get(id: string): Promise<BusJourney> {
    const res = await api.get<Envelope<BusJourney>>(`/bus/${encodeURIComponent(id)}`);
    return res.data.data;
  },

  async create(input: BusJourneyInput): Promise<BusJourney> {
    const res = await api.post<Envelope<BusJourney>>("/bus", input);
    return res.data.data;
  },

  async update(id: string, input: Partial<BusJourneyInput>): Promise<BusJourney> {
    const res = await api.patch<Envelope<BusJourney>>(`/bus/${encodeURIComponent(id)}`, input);
    return res.data.data;
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/bus/${encodeURIComponent(id)}`);
  },
};
```

Run the client test. Expected: PASS.

- [ ] **Step 4: Copy — DE first, EN mirrored**

`frontend/src/i18n/resources/de/bus.json`:

```json
{
  "title": "Bus",
  "subtitle": "Fernbus-, Intercity- und Shuttlefahrten — Terminal zu Terminal",
  "betaNote": "Beta: Busfahrten werden von Hand eingetragen („{{add}}"). Kein Stadtverkehr — eine Fahrt ist ein Ticket zwischen zwei Terminals.",
  "add": "Fahrt hinzufügen",
  "empty": "Noch keine Busfahrten. Die erste Fahrt kommt über „{{add}}".",
  "loadError": "Die Busfahrten konnten nicht geladen werden.",
  "search": "Betreiber, Linie, Terminal, Buchung …",
  "saved": "Busfahrt gespeichert",
  "deleted": "Busfahrt gelöscht",
  "deleteError": "Die Busfahrt konnte nicht gelöscht werden.",
  "deleteConfirm": "Diese Busfahrt löschen? Das lässt sich nicht rückgängig machen.",
  "edit": "Bearbeiten",
  "delete": "Löschen",
  "straightLine": "Luftlinie",
  "delay": "+{{minutes}} min",
  "onTime": "pünktlich",
  "status": {
    "scheduled": "Geplant",
    "in_progress": "Unterwegs",
    "completed": "Gefahren",
    "cancelled": "Storniert"
  },
  "kind": {
    "intercity": "Fernbus",
    "shuttle": "Shuttle",
    "charter": "Charter",
    "other": "Sonstige"
  },
  "list": {
    "operator": "Betreiber",
    "route": "Strecke",
    "time": "Zeit",
    "line": "Linie",
    "duration": "Dauer",
    "distance": "Entfernung",
    "status": "Status",
    "trip": "Reise",
    "actions": "Aktionen",
    "filterStatus": "Status",
    "filterYear": "Jahr",
    "all": "Alle"
  },
  "summary": {
    "journeys": "Fahrten",
    "operators": "Betreiber",
    "stations": "Terminals"
  },
  "form": {
    "titleNew": "Busfahrt hinzufügen",
    "titleEdit": "Busfahrt bearbeiten",
    "operator": "Betreiber",
    "operatorPlaceholder": "FlixBus, Kobus, Lux Express …",
    "line": "Linie",
    "linePlaceholder": "N17, Premium …",
    "kind": "Art der Fahrt",
    "kindNone": "— keine Angabe —",
    "kindHint": "Kein Stadtverkehr: eine Fahrt ist ein Ticket zwischen zwei Terminals.",
    "departureStation": "Abfahrtsterminal",
    "arrivalStation": "Ankunftsterminal",
    "stationName": "Name wie auf dem Ticket",
    "stationAddress": "Adresse (optional)",
    "departureTime": "Abfahrt (Ortszeit am Terminal)",
    "arrivalTime": "Ankunft (Ortszeit am Terminal)",
    "dayOnly": "Nur das Datum ist bekannt",
    "distance": "Entfernung (km, laut Ticket)",
    "distanceHint": "Leer lassen: die Luftlinie wird gemessen und als solche ausgewiesen.",
    "class": "Klasse",
    "classPlaceholder": "Udeung, Lounge …",
    "seatNumber": "Sitzplatz",
    "delay": "Verspätung (min)",
    "delayHint": "Leer = nicht erfasst, 0 = pünktlich.",
    "bookingReference": "Buchungsnummer",
    "price": "Preis",
    "currency": "Währung",
    "cancelled": "Storniert",
    "tags": "Tags",
    "companions": "Mitreisende",
    "trip": "Reise",
    "tripNone": "Keine Reise",
    "notes": "Notizen",
    "save": "Speichern",
    "cancel": "Abbrechen",
    "saving": "Speichern …",
    "saveError": "Die Busfahrt konnte nicht gespeichert werden.",
    "errors": {
      "arrivalBeforeDeparture": "Die Ankunft liegt vor der Abfahrt.",
      "nonexistentTime": "Diese Uhrzeit gab es an diesem Tag nicht (Zeitumstellung).",
      "noZone": "Für dieses Terminal ließ sich keine Zeitzone bestimmen. Bitte einen anderen Punkt wählen.",
      "invalidField": "Das Feld „{{field}}" ist ungültig.",
      "invalid": "Die Eingaben sind ungültig."
    }
  },
  "detail": {
    "back": "Zurück zum Logbuch",
    "departure": "Abfahrt",
    "arrival": "Ankunft",
    "duration": "Dauer",
    "distance": "Entfernung",
    "line": "Linie",
    "kind": "Art",
    "class": "Klasse",
    "seat": "Sitzplatz",
    "bookingReference": "Buchung",
    "price": "Preis",
    "companions": "Mitreisende",
    "notes": "Notizen",
    "documents": "Dokumente",
    "notFound": "Diese Busfahrt gibt es nicht (mehr)."
  }
}
```

`en/bus.json` — the same keys: "Bus", "Coach, intercity and shuttle rides — terminal to terminal", betaNote "Beta: bus rides are entered by hand (“{{add}}”). Not city transit — a ride is a ticket between two terminals.", "Add ride", "No bus rides yet. The first one starts with “{{add}}”.", "The bus rides could not be loaded.", "Operator, line, terminal, booking …", "Bus ride saved", "Bus ride deleted", "The bus ride could not be deleted.", "Delete this bus ride? This cannot be undone.", "Edit", "Delete", "straight line", "+{{minutes}} min", "on time"; status Scheduled / On the road / Completed / Cancelled; kind Coach / Shuttle / Charter / Other; list Operator / Route / Time / Line / Duration / Distance / Status / Trip / Actions / Status / Year / All; summary Rides / Operators / Terminals; form "Add bus ride" / "Edit bus ride" / Operator / "FlixBus, Kobus, Lux Express …" / Line / "N17, Premium …" / "Kind of ride" / "— not stated —" / "Not city transit: a ride is a ticket between two terminals." / "Departure terminal" / "Arrival terminal" / "Name as printed on the ticket" / "Address (optional)" / "Departure (local time at the terminal)" / "Arrival (local time at the terminal)" / "Only the date is known" / "Distance (km, from the ticket)" / "Leave empty: the straight line is measured and labelled as such." / Class / "Udeung, Lounge …" / Seat / "Delay (min)" / "Empty = not recorded, 0 = on time." / "Booking reference" / Price / Currency / Cancelled / Tags / Companions / Trip / "No trip" / Notes / Save / Cancel / "Saving …" / "The bus ride could not be saved."; errors "The arrival is before the departure." / "This time did not exist on that day (clock change)." / "No time zone could be found for this terminal. Please pick another point." / "The field “{{field}}” is invalid." / "The input is invalid."; detail "Back to the logbook" / Departure / Arrival / Duration / Distance / Line / Kind / Class / Seat / Booking / Price / Companions / Notes / Documents / "This bus ride does not exist (any more)."

Run: `cd frontend && npx vitest --run src/i18n`
Expected: `localeKeyParity` PASS with the new namespace (it reads the namespace list from the filesystem).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types/bus.ts frontend/src/lib/api/bus.ts frontend/src/lib/api/__tests__/bus.test.ts frontend/src/i18n/resources/de/bus.json frontend/src/i18n/resources/en/bus.json frontend/src/i18n/config.ts
git commit -m "feat(bus): web types, API client and DE/EN copy"
```

---

### Task 9: Form model, terminal field, form modal

**Files:**
- Create: `frontend/src/components/bus/BusStationField.tsx`, `frontend/src/components/bus/busFormModel.ts`, `frontend/src/components/bus/BusFormModal.tsx`, `frontend/src/components/bus/__tests__/busFormModel.test.ts`, `frontend/src/components/bus/__tests__/BusFormModal.test.tsx`

**Interfaces:**
- Consumes: `busApi`, `BusJourney`, `BusJourneyInput` (Task 8); shared `LocationInput`, `Modal`, `CurrencySelect`, `TagInput`, `CompanionPicker`, `useTripPreselection`, `useRecentCurrencies`, `ClockChangeNotice`, `tripsApi.getAll`, `toStationWallClock`, `railDeparture`/`railArrival` (structural — a bus row fits `RailLike`), `saveErrorKey`.
- Produces: `BusStationDraft`, `EMPTY_TERMINAL`, `BusFormDraft`, `draftFrom(ride)`, `canSubmit(draft)`, `toBusInput(draft)`, `saveErrorFrom(err)`; `<BusFormModal journey onClose onSaved />`.

- [ ] **Step 1: Write the form-model tests**

`frontend/src/components/bus/__tests__/busFormModel.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { canSubmit, draftFrom, saveErrorFrom, toBusInput } from "../busFormModel";
import { EMPTY_TERMINAL } from "../BusStationField";

const SEOUL = { name: "Seoul Express Bus Terminal", address: null, lat: 37.5048, lon: 127.0046, country: "KR" };

describe("busFormModel", () => {
  it("cannot submit without two placed terminals and a departure", () => {
    const empty = draftFrom(null);
    expect(canSubmit(empty)).toBe(false);
    expect(canSubmit({ ...empty, departure: SEOUL, arrival: SEOUL, departureLocal: "2026-09-20T09:00" })).toBe(true);
    expect(canSubmit({ ...empty, departure: SEOUL, arrival: EMPTY_TERMINAL, departureLocal: "2026-09-20T09:00" })).toBe(false);
  });

  it("sends every optional field, null when empty — blanking a field must clear it", () => {
    const input = toBusInput({ ...draftFrom(null), departure: SEOUL, arrival: SEOUL, departureLocal: "2026-09-20T09:00" });
    expect(input.operator).toBeNull();
    expect(input.arrivalLocal).toBeNull();
    expect(input.rideKind).toBeNull();
    expect(input.status).toBe("scheduled");
    expect(input.currency).toBe("EUR");
  });

  it("a typed distance with a comma is a number; a measured one is not shown in the draft", () => {
    const input = toBusInput({ ...draftFrom(null), departure: SEOUL, arrival: SEOUL, departureLocal: "2026-09-20T09:00", distanceKm: "159,5" });
    expect(input.distanceKm).toBe(159.5);
    expect(draftFrom({ ...rideFixture(), distanceKm: 159, distanceSource: "great_circle" }).distanceKm).toBe("");
    expect(draftFrom({ ...rideFixture(), distanceKm: 210, distanceSource: "user" }).distanceKm).toBe("210");
  });

  it("reads the stored ride back on each terminal's own clock", () => {
    const draft = draftFrom(rideFixture());
    expect(draft.departureLocal).toBe("2026-09-20T09:00");
    expect(draft.arrivalLocal).toBe("2026-09-20T11:20");
    expect(draft.cancelled).toBe(false);
  });

  it("maps the server's codes to copy beside the field", () => {
    const refused = (code: string, field?: string) => ({ response: { data: { code, field } } });
    expect(saveErrorFrom(refused("BUS_ARRIVAL_BEFORE_DEPARTURE", "arrivalLocal"))).toEqual({ key: "bus:form.errors.arrivalBeforeDeparture", field: "arrivalLocal" });
    expect(saveErrorFrom(refused("LOCAL_TIME_NONEXISTENT", "departureLocal"))).toEqual({ key: "bus:form.errors.nonexistentTime", field: "departureLocal" });
    expect(saveErrorFrom(refused("TZ_UNRESOLVED", "departureLocal"))).toEqual({ key: "bus:form.errors.noZone", field: "departureLocal" });
    expect(saveErrorFrom(refused("BUS_INVALID_INPUT", "seat"))).toMatchObject({ key: "bus:form.errors.invalidField", fieldLabelKey: "bus:form.seatNumber" });
  });
});

function rideFixture() {
  return {
    id: "r1", userId: "u1", operator: "Kobus", lineName: "Premium", rideKind: "intercity" as const,
    depStationName: SEOUL.name, depAddress: null, depLat: SEOUL.lat, depLon: SEOUL.lon, depCountry: "KR", depTimezone: "Asia/Seoul",
    arrStationName: "Sokcho Express Bus Terminal", arrAddress: null, arrLat: 38.1911, arrLon: 128.5918, arrCountry: "KR", arrTimezone: "Asia/Seoul",
    departureTime: "2026-09-20T00:00:00.000Z", arrivalTime: "2026-09-20T02:20:00.000Z",
    distanceKm: 159, distanceSource: "great_circle" as const, geometry: null, geometrySource: "straight" as const,
    actualDepartureTime: null, actualArrivalTime: null, fareClass: null, seat: null, bookingReference: null,
    price: 23000, currency: "KRW", status: "completed" as const, delayMinutes: null, notes: null, tags: [], companions: [],
    tripId: null, bookingId: null, createdAt: "2026-09-20T03:00:00.000Z", updatedAt: "2026-09-20T03:00:00.000Z",
    times: {
      departure: { utc: "2026-09-20T00:00:00.000Z", local: "2026-09-20T09:00", zone: "Asia/Seoul", precision: "minute" as const },
      arrival: { utc: "2026-09-20T02:20:00.000Z", local: "2026-09-20T11:20", zone: "Asia/Seoul", precision: "minute" as const },
      actualDeparture: null, actualArrival: null,
    },
  };
}
```
(Check `TimeValue`'s exact member names in `frontend/src/shared/time` before committing the fixture — `utc`/`local`/`zone`/`precision` is what `toStationWallClock` reads; match the real interface.)

Run: `cd frontend && npx vitest --run src/components/bus/__tests__/busFormModel.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 2: Terminal field**

`frontend/src/components/bus/BusStationField.tsx` — `RailStationField.tsx` with the catalogue fields gone and an address line added:

```ts
import { useCallback } from "react";
import type { JSX } from "react";
import { LocationInput, type LocationSelection } from "../location/LocationInput";
import { useTranslation } from "../../hooks/useTranslation";

/** A terminal as the form holds it; `lat`/`lon` null until one is picked. */
export interface BusStationDraft {
  name: string;
  address: string;
  lat: number | null;
  lon: number | null;
  country: string | null;
}

export const EMPTY_TERMINAL: BusStationDraft = { name: "", address: "", lat: null, lon: null, country: null };

interface Props {
  label: string;
  idPrefix: string;
  value: BusStationDraft;
  onChange: (next: BusStationDraft) => void;
  onValidityChange?: (valid: boolean) => void;
  inputClassName: string;
}

/**
 * One terminal through the shared geocoder search (`LocationInput`) for the
 * position, plus the name as the ticket prints it and an optional address —
 * there is no coach-terminal catalogue (spec §3.2). A new pick REPLACES the
 * name, because picking another point means another terminal; the name stays
 * editable afterwards ("Dong Seoul Bus Terminal" rather than what OSM says).
 */
export function BusStationField({ label, idPrefix, value, onChange, onValidityChange, inputClassName }: Props): JSX.Element {
  const { t } = useTranslation(["bus"]);
  const handlePick = useCallback(
    (selection: LocationSelection): void => {
      onChange({
        name: selection.name ?? value.name,
        address: value.address,
        lat: selection.lat,
        lon: selection.lon,
        country: selection.countryCode ? selection.countryCode.toUpperCase() : value.country,
      });
    },
    [onChange, value.name, value.address, value.country]
  );
  const position = value.lat !== null && value.lon !== null ? { lat: value.lat, lon: value.lon } : null;
  return (
    <div className="space-y-2">
      <LocationInput label={label} idPrefix={idPrefix} value={position} onChange={handlePick} onValidityChange={onValidityChange} compact />
      <input
        className={inputClassName}
        aria-label={`${label}: ${t("bus:form.stationName")}`}
        placeholder={t("bus:form.stationName")}
        value={value.name}
        onChange={(e): void => onChange({ ...value, name: e.target.value })}
      />
      <input
        className={inputClassName}
        aria-label={`${label}: ${t("bus:form.stationAddress")}`}
        placeholder={t("bus:form.stationAddress")}
        value={value.address}
        onChange={(e): void => onChange({ ...value, address: e.target.value })}
      />
    </div>
  );
}
```

- [ ] **Step 3: Form model**

`frontend/src/components/bus/busFormModel.ts` — `railFormModel.ts:19-222` and `341-415` without `trainCategory`/`trainNumber`/`coach`/`lookup`/`connection`, with `lineName`, `rideKind`, `fareClass`, `address`:

```ts
import { saveErrorKey } from "../../lib/saveErrorMessage";
import type { BusJourney, BusJourneyInput, BusRideKind } from "../../types/bus";
import { toStationWallClock } from "../../lib/railTime";
import { railArrival, railDeparture } from "../../lib/entityTimes";
import { EMPTY_TERMINAL, type BusStationDraft } from "./BusStationField";

/** The bus form's state and its translation to the write body — pure, so the rules are testable without a modal. */
export interface BusFormDraft {
  operator: string;
  lineName: string;
  rideKind: BusRideKind | "";
  departure: BusStationDraft;
  arrival: BusStationDraft;
  departureLocal: string;
  arrivalLocal: string;
  /** Only what the user typed. A measured distance is not shown here. */
  distanceKm: string;
  fareClass: string;
  seat: string;
  delayMinutes: string;
  bookingReference: string;
  price: string;
  currency: string;
  cancelled: boolean;
  tags: string[];
  companions: string[];
  tripId: string;
  notes: string;
}

export function draftFrom(ride: BusJourney | null): BusFormDraft {
  if (!ride) {
    return {
      operator: "", lineName: "", rideKind: "", departure: EMPTY_TERMINAL, arrival: EMPTY_TERMINAL,
      departureLocal: "", arrivalLocal: "", distanceKm: "", fareClass: "", seat: "", delayMinutes: "",
      bookingReference: "", price: "", currency: "EUR", cancelled: false, tags: [], companions: [], tripId: "", notes: "",
    };
  }
  return {
    operator: ride.operator ?? "",
    lineName: ride.lineName ?? "",
    rideKind: ride.rideKind ?? "",
    departure: { name: ride.depStationName, address: ride.depAddress ?? "", lat: ride.depLat, lon: ride.depLon, country: ride.depCountry },
    arrival: { name: ride.arrStationName, address: ride.arrAddress ?? "", lat: ride.arrLat, lon: ride.arrLon, country: ride.arrCountry },
    // Read back on each terminal's own clock — the time the ticket printed. A
    // bus row has rail's columns, so rail's readers accept it.
    departureLocal: toStationWallClock(railDeparture(ride)),
    arrivalLocal: toStationWallClock(railArrival(ride)),
    distanceKm: ride.distanceSource === "user" && ride.distanceKm !== null ? String(ride.distanceKm) : "",
    fareClass: ride.fareClass ?? "",
    seat: ride.seat ?? "",
    delayMinutes: ride.delayMinutes === null ? "" : String(ride.delayMinutes),
    bookingReference: ride.bookingReference ?? "",
    price: ride.price === null ? "" : String(ride.price),
    currency: ride.currency ?? "EUR",
    cancelled: ride.status === "cancelled",
    tags: [...ride.tags],
    companions: ride.companions,
    tripId: ride.tripId ?? "",
    notes: ride.notes ?? "",
  };
}

export function isTerminalComplete(station: BusStationDraft): boolean {
  return station.name.trim() !== "" && station.lat !== null && station.lon !== null;
}

export function canSubmit(draft: BusFormDraft): boolean {
  return isTerminalComplete(draft.departure) && isTerminalComplete(draft.arrival) && draft.departureLocal !== "";
}

const orNull = (value: string): string | null => (value.trim() === "" ? null : value.trim());
const numberOrNull = (value: string): number | null => {
  if (value.trim() === "") return null;
  const n = Number(value.replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

function terminalInput(station: BusStationDraft): BusJourneyInput["departureStation"] {
  if (station.lat === null || station.lon === null) throw new Error("terminal without a position");
  return { name: station.name.trim(), address: orNull(station.address), lat: station.lat, lon: station.lon, country: station.country };
}

/** The write body. Every optional field is SENT, null when empty — omitting it would keep the old value. */
export function toBusInput(draft: BusFormDraft): BusJourneyInput {
  const delay = numberOrNull(draft.delayMinutes);
  return {
    operator: orNull(draft.operator),
    lineName: orNull(draft.lineName),
    rideKind: draft.rideKind === "" ? null : draft.rideKind,
    departureStation: terminalInput(draft.departure),
    arrivalStation: terminalInput(draft.arrival),
    departureLocal: draft.departureLocal,
    arrivalLocal: draft.arrivalLocal === "" ? null : draft.arrivalLocal,
    distanceKm: numberOrNull(draft.distanceKm),
    fareClass: orNull(draft.fareClass),
    seat: orNull(draft.seat),
    delayMinutes: delay === null ? null : Math.round(delay),
    bookingReference: orNull(draft.bookingReference),
    price: numberOrNull(draft.price),
    currency: draft.currency || "EUR",
    status: draft.cancelled ? "cancelled" : "scheduled",
    tags: draft.tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0),
    companions: draft.companions,
    tripId: draft.tripId === "" ? null : draft.tripId,
    notes: orNull(draft.notes),
  };
}

export type BusFormErrorField = "departureLocal" | "arrivalLocal";

export interface BusSaveError {
  key: string;
  field: BusFormErrorField | null;
  fieldLabelKey?: string;
}

const FIELD_LABEL_KEYS: Record<string, string> = {
  operator: "bus:form.operator",
  lineName: "bus:form.line",
  rideKind: "bus:form.kind",
  departureStation: "bus:form.departureStation",
  arrivalStation: "bus:form.arrivalStation",
  departureLocal: "bus:form.departureTime",
  arrivalLocal: "bus:form.arrivalTime",
  distanceKm: "bus:form.distance",
  fareClass: "bus:form.class",
  seat: "bus:form.seatNumber",
  delayMinutes: "bus:form.delay",
  bookingReference: "bus:form.bookingReference",
  price: "bus:form.price",
  currency: "bus:form.currency",
  tags: "bus:form.tags",
  companions: "bus:form.companions",
  tripId: "bus:form.trip",
  notes: "bus:form.notes",
};
const TIME_FIELDS: readonly string[] = ["departureLocal", "arrivalLocal"];

/** A failed save, read by its stable `code` and `field`; the server's English prose is never shown. */
export function saveErrorFrom(err: unknown): BusSaveError {
  const data = (err as { response?: { data?: { code?: unknown; field?: unknown } } })?.response?.data;
  const code = typeof data?.code === "string" ? data.code : null;
  const field = typeof data?.field === "string" ? data.field : null;
  const timeField = field && TIME_FIELDS.includes(field) ? (field as BusFormErrorField) : null;
  switch (code) {
    case "BUS_ARRIVAL_BEFORE_DEPARTURE":
      return { key: "bus:form.errors.arrivalBeforeDeparture", field: "arrivalLocal" };
    case "LOCAL_TIME_NONEXISTENT":
      return { key: "bus:form.errors.nonexistentTime", field: timeField };
    case "TZ_UNRESOLVED":
      return { key: "bus:form.errors.noZone", field: timeField };
    case "BUS_INVALID_INPUT": {
      const fieldLabelKey = field ? FIELD_LABEL_KEYS[field] : undefined;
      return fieldLabelKey
        ? { key: "bus:form.errors.invalidField", field: timeField, fieldLabelKey }
        : { key: "bus:form.errors.invalid", field: null };
    }
    default:
      return { key: saveErrorKey(err, "bus:form.saveError"), field: null };
  }
}
```
(Confirm the code `TzUnresolvedError` carries on the wire — `grep -n "TZ_UNRESOLVED" backend/src/shared/time/errors.ts backend/src/middleware/errorHandler.ts` — and use that string.)

Run the model test. Expected: PASS.

- [ ] **Step 4: The modal**

`frontend/src/components/bus/BusFormModal.tsx` — `RailFormModal.tsx` with: no `connectsFrom`/`initialDraft`/`onward`/lookup panel/`StationPicker`/entry-suggestion chips/`trainLabel`; `RailStationField` → `BusStationField`; the train category + number inputs replaced by `lineName` (text) and `rideKind` (a `<select>` over `BUS_RIDE_KINDS` with the `kindNone` option and the `kindHint` caption beneath); `travelClass` select → `fareClass` text input; no `coach`; `railApi.create/update` → `busApi.create/update` (which return the row directly — no `meta.geometry`, so no `geometryNotice`); copy keys `bus:form.*`; `data-testid="bus-form"` on the form, `data-testid="bus-form-save"` on the submit button. Props:

```ts
interface Props {
  journey: BusJourney | null;
  onClose: () => void;
  onSaved: (ride: BusJourney) => void;
}
```
Keep: `useTripPreselection`, `CurrencySelect` + `useRecentCurrencies` + `minorUnits`, `TagInput`, `CompanionPicker`, `ClockChangeNotice` (with a `knownTerminalZone` copied from `knownStationZone` at `railFormModel.ts:415`, reading `railDeparture`/`railArrival`), the "only the date is known" checkbox that switches the two inputs from `datetime-local` to `date` (as rail's day-only mode does — find it by `dayOnly` in `RailFormModal.tsx`), the error rendering beside the field via `saveErrorFrom`. Keep every touch target at the size rail uses (`useCoarsePointer` is inside the shared inputs).

- [ ] **Step 5: Modal test**

`frontend/src/components/bus/__tests__/BusFormModal.test.tsx` — mock `../../lib/api/bus` and `../../lib/api` (`tripsApi.getAll` → `[]`), render `<BusFormModal journey={null} …/>` and assert: (1) the save button is disabled until both terminals are placed and a departure typed — drive `LocationInput` the way `RailFormModal.test.tsx` does; (2) a save that rejects with `{response:{data:{code:"BUS_ARRIVAL_BEFORE_DEPARTURE", field:"arrivalLocal"}}}` shows the DE sentence beside the arrival field and does NOT call `onSaved` (silent-failure class 3); (3) editing `rideFixture()` sends `rideKind: null` when the select is cleared.

Run: `cd frontend && npx vitest --run src/components/bus`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/bus
git commit -m "feat(bus): the ride form — terminals via the geocoder, terminal-clock times, labelled refusals"
```

---

### Task 10: Table row, logbook page, detail page, routes, gating wiring

**Files:**
- Create: `frontend/src/components/bus/BusTableRow.tsx`, `frontend/src/pages/BusPage.tsx`, `frontend/src/pages/BusDetailPage.tsx`, `frontend/src/pages/__tests__/BusPage.test.tsx`, `frontend/src/pages/__tests__/BusDetailPage.test.tsx`, `frontend/src/__tests__/components/busGating.test.tsx`
- Modify: `frontend/src/App.tsx:35-37,295-330`, `frontend/src/components/Nav/useNavItems.ts:88-105,206`, `frontend/src/components/table/LogbookTabs.tsx:24-38`, `frontend/src/components/Settings/ModuleSection.tsx:28-38`, `frontend/src/components/Setup/DomainPickerStep.tsx:40-50`, `frontend/src/components/Settings/DomainColorSection.tsx:36-43`, `frontend/src/hooks/useAttachableDomains.ts`, `frontend/src/components/Dashboard/DashboardLayout.tsx:157-192` (+ the modal mounts near line 375), `frontend/src/components/Dashboard/AddDomainPicker.tsx:20-21,52-53`

**Interfaces:**
- Consumes: Tasks 8–9; `useBusVisible`/`useBusOffered` (Task 1); shared `AppShell`, `Table`, `LogbookTabs`, `ListSummaryStrip`, `ListEmptyState`, `ListFilterBar`, `ColumnPicker`, `TablePagination`, `RowActionButton`, `useServerPagination`, `useSortPrefs`, `useColumnPrefs`, `SkeletonTable`, `ConfirmModal`, `ListLoadFailed`, `railSummaryFigures` (takes the summary shape bus shares), `OperatorTile` (domain `"bus"` from Task 7), `statusPillProps`, `TripPill`, `formatRailSpan`, `formatRailDuration`, `railDurationMinutes`, `DetailHeader`, `DetailKpis`, `DetailSection`, `PeopleList`, `DocumentsSection`, `useDocumentCount`, `BetaFeatureRouteGuard`, `DomainRouteGuard`.
- Produces: routes `/bus` and `/bus/:id`; `BUS_COLUMN_LAYOUT`, `BusColumnId`.

- [ ] **Step 1: Write the gating test**

`frontend/src/__tests__/components/busGating.test.tsx` — `railGating.test.tsx` with `rail` → `bus`, `railDomain` → `busDomain`, `domain.rail` → `domain.bus`, `domain-card-rail` → `domain-card-bus`. Its cases: module switch offered on a beta instance before the user has it on; hidden while the flag is off/unknown; an enabled bus stays listed after the flag goes off; the setup picker offers it only on a beta instance; the logbook tab appears only with both gates open.

Run: `cd frontend && npx vitest --run src/__tests__/components/busGating.test.tsx`
Expected: FAIL — `domain.bus` never rendered (nothing wired).

- [ ] **Step 2: Wire the gates**

Each site mirrors its `rental` line exactly:
- `useNavItems.ts`: `const busVisible = useBusVisible();`; the filter gains `: key === "bus" ? busVisible`; the `useMemo` deps gain `busVisible`.
- `LogbookTabs.tsx`: same three edits.
- `ModuleSection.tsx` and `DomainPickerStep.tsx`: `const busOffered = useBusOffered(); const enabledBus = enabledDomains.includes("bus");` (`value.includes` in the picker) and `if (key === "bus") return busOffered || enabledBus;`.
- `DomainColorSection.tsx`: `const busVisible = useBusVisible();` and `if (key === "bus") return busVisible;`.
- `useAttachableDomains.ts`: `const busVisible = useBusVisible();` and `key === "bus" ? busVisible :` in the filter, deps updated.
- `DashboardLayout.tsx`: `bus: isEnabled("bus")` in `enabledDomains`, `bus: busVisible` in `addableDomains` (with `const busVisible = useBusVisible();`); mount `<BusFormModal>` beside the rail modal mount (search `addingDomain === "rail"` and copy the block: `open={addingDomain === "bus"}`, on save close and bump the counts the way rail's does). `openableImports` stays unchanged (no bus import).
- `AddDomainPicker.tsx`: `| "bus"` in `AddableDomain`; `if (enabled.bus) options.push({ key: "bus", label: t("dashboard:addPicker.bus") });`.

Run the gating test. Expected: PASS for module switch, setup picker and logbook tabs.

- [ ] **Step 3: Table row**

`frontend/src/components/bus/BusTableRow.tsx` — `RailTableRow.tsx` for ONE ride (no connections): props `{ journey: BusJourney; columns: readonly TableColumn[]; onOpen: () => void; actions?: ReactNode }`; `BusColumnId = "operator" | "route" | "time" | "line" | "duration" | "distance" | "status" | "trip" | "actions"`; `BUS_COLUMN_LAYOUT` with rail's measured widths (`time: { min: 236, mono: true, onNarrow: "subtitle" }`, `duration: { min: 112, … }`, `distance: { min: 112, … }`) and `line: { min: 120, grow: 1, priority: 2 }`; cells: `operator: <OperatorTile name={journey.operator} domain="bus" />`, `route: `${journey.depStationName} → ${journey.arrStationName}``, `time: formatRailSpan(journey, locale)` (a bus row is `RailLike`), `line: journey.lineName ?? "—"`, `duration`: `railDurationMinutes(journey)` → `formatRailDuration(minutes, t)` or "—", `distance`: `Math.round(km)` + the caption `t("bus:straightLine")` when `distanceSource === "great_circle"`, `status`: `statusPillProps(journey.status)` with `t(`bus:status.${status}`)` and the delay caption (`bus:delay` / `bus:onTime`), `trip: <TripPill trip={journey.trip ?? null} />`, `actions` wrapped in a `stopPropagation` span; `testId={`bus-row-${journey.id}`}`.

- [ ] **Step 4: The logbook page**

`frontend/src/pages/BusPage.tsx` — `RailPage.tsx` with: `busApi.list` (no connections, no loyalty filter, no import panel/adapter), `BUS_COLUMN_IDS` as above, `BUS_ALWAYS_VISIBLE = ["operator", "route", "time", "status", "actions"]`, sort fields `departure | distance | created`, the status filter over `BusStatus`, the year filter from the loaded rides' `busYear` values (`shared/busCounting`), the summary strip through `railSummaryFigures(summary, t)` with the `bus:summary.*` labels (check `railSummaryFigures`'s label parameter — pass bus's keys), the `betaNote` under the title with `{ add: t("bus:add") }`, the empty state `bus:empty`, `BusFormModal` for add/edit, `ConfirmModal` for delete with `bus:deleteConfirm`, row click → `navigate(`/bus/${id}`)`. Keep the page under 400 lines; the rail page is 411 with connections, so this must come in shorter.

- [ ] **Step 5: The detail page**

`frontend/src/pages/BusDetailPage.tsx` — `RailDetailPage.tsx` without `RailRouteMap`, connections, short codes, the roadtrip note and the trip-photo strip (B2): `DetailHeader` (operator + line, the terminals as the title, the status pill), `DetailKpis` (departure, arrival — each `formatStationTime`, duration via `railDurationMinutes`, distance with its source caption, price via `formatAmount`), a `DetailSection` of facts (kind, class, seat, booking reference), `PeopleList` for companions, notes, `DocumentsSection` with `entry={{ type: "busJourney", id }}` (check the component's prop name against `RailDetailPage.tsx:306`) and `useDocumentCount`, the edit button opening `BusFormModal`, delete via `ConfirmModal` + `withDocumentNote`, `bus:detail.notFound` on 404 through `classifyLoadFailure`. Keep `EDIT_PARAM`/`useEditDeepLink` so `/bus/:id?edit=1` opens the form as rail's does.

- [ ] **Step 6: Routes**

`App.tsx`: `const BusPage = lazy(() => import("./pages/BusPage"));` and `BusDetailPage` beside the rail lazies; after the rental routes:

```tsx
<Route
  path="/bus"
  element={
    isAuthenticated ? (
      // Two gates, outer first: the instance beta switch (busDomain), then the user's domain choice.
      <BetaFeatureRouteGuard feature="busDomain" redirectTo="/dashboard">
        <DomainRouteGuard domain="bus">
          <BusPage />
        </DomainRouteGuard>
      </BetaFeatureRouteGuard>
    ) : (
      <Navigate to="/login" />
    )
  }
/>
<Route path="/bus/:id" element={ /* same two guards around <BusDetailPage /> */ } />
```

- [ ] **Step 7: Page tests**

`frontend/src/pages/__tests__/BusPage.test.tsx` (template `RailPage.test.tsx`): mock `busApi.list` → two rides; assert both rows render with operator, route and the status pill; the summary strip shows 2 rides; a failing `list` (reject) renders `ListLoadFailed` with `bus:loadError` and no rows (class 3); the add button opens the form (`bus-form` test id). `BusDetailPage.test.tsx`: mock `busApi.get` → the fixture; assert terminals, the two times on the terminal's clock ("09:00" and "11:20"), the duration "2 h 20 min", the distance with "Luftlinie"; a 404 shows `bus:detail.notFound`.

Run: `cd frontend && npx vitest --run src/pages/__tests__/BusPage.test.tsx src/pages/__tests__/BusDetailPage.test.tsx src/__tests__/components/busGating.test.tsx src/components/bus && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 8: Commit**

```bash
git add frontend/src
git commit -m "feat(bus): logbook page, detail page, routes and the gates on every surface"
```

---

### Task 11: The whole gate, a browser look, the spec's status

**Files:**
- Modify: `docs/superpowers/specs/2026-10-07-bus-domain-design.md` (status line + a "B1 — as built" section), `scripts/coverage-baseline.json` only via `--update` if coverage rose.

- [ ] **Step 1: Run the Build Checks list, both trees**

```bash
cd backend && npx tsc --noEmit && npm run lint && npm test -- --forceExit
cd frontend && npx tsc --noEmit && npm run lint && npx vitest --run
DATABASE_URL="postgresql://…scratch…" npm run check      # size ratchet + drift, from the root
npm run format:check
```
Expected: all green. If `check:size` complains about a bus file, split it (the page's filter bar or the form's sections into a sibling file) — never raise the baseline.

- [ ] **Step 2: Coverage ratchets**

```bash
cd frontend && npx vitest --run --coverage --coverage.reporter=json-summary && cd .. && npm run check:coverage -- frontend
cd backend && npx jest --forceExit --coverage --coverageReporters=json-summary && cd .. && npm run check:coverage -- backend
```
Expected: no fall; if it prints a rise, run with `--update` and commit the baseline.

- [ ] **Step 3: Odd-zone runs**

```bash
cd backend && TZ=Pacific/Kiritimati npx jest src/routes/__tests__/bus.test.ts src/services/bus src/shared/__tests__/busCounting.test.ts --forceExit
cd backend && TZ=America/St_Johns npx jest src/routes/__tests__/bus.test.ts src/services/bus src/shared/__tests__/busCounting.test.ts --forceExit
cd frontend && TZ=Pacific/Kiritimati npx vitest --run src/shared/__tests__/busCounting.test.ts src/components/bus
```
Expected: identical verdicts in every zone (`scripts/check-tz-ratchet.mjs` will see no new failure in CI).

- [ ] **Step 4: Browser look on an iPad viewport**

Start the stack (backend on 8000 against a seeded dev DB with the beta switch on and `bus` in the admin's `enabledDomains`; `VITE_API_URL=http://localhost:8000 npx vite --port 3000`). With the Playwright MCP tools: `browser_resize` to 1024×1366, log in as `admin`/`admin123`, open `/bus`, add Seoul → Sokcho (pick the terminals through the geocoder search, type `2026-09-20T09:00` / `11:20`), save; assert in the snapshot: the row shows "Kobus", "Seoul Express Bus Terminal → Sokcho Express Bus Terminal", "09:00 – 11:20", "2 h 20 min", a km figure with "Luftlinie", the pill "Gefahren"; open the row, assert the detail KPIs; `browser_take_screenshot` of both. Then switch the beta flag off in admin settings and assert `/bus` redirects to `/dashboard` and the nav entry is gone. Record what was seen (one paragraph) in the spec's "as built" section.

- [ ] **Step 5: Update the spec and commit**

In the spec: status line → `Status: **B1 built on `dev/bus-domain` (date); B2 next**`; append a `## B1 — as built (date)` section naming what deviated from §12 (none expected beyond "trip bounds landed in B1 because the write path already re-derives the trip").

```bash
git add docs/superpowers/specs/2026-10-07-bus-domain-design.md scripts/coverage-baseline.json
git commit -m "docs(bus): B1 as built"
git push -u origin dev/bus-domain && git push forgejo --all
```

Then report the branch to the owner and ask — as a single, isolated question — whether to merge (CLAUDE.md: merging into `main` is the owner's release decision).

---

## Packages B2–B4 — outline (each gets its own plan when the one before it has landed)

**B2 — the shared surfaces** (spec §6–§8): `/bus/stats` (`services/bus/busStats.ts` from `railStats.ts`, kilometres per source, hours with sample size, kinds instead of train categories) + `BusStatsSection.tsx` + `busStatsAdapter.ts` and `StatsDomain` gains `bus`; `crossDomainPopulations.loadBus` becomes rail's loader; passport provenance; `busPathsLayer.ts` + `BusTab.tsx` + the "Alle" chip + a filter row (`FilterDomainKey` gains `bus`, `useDashboardDomainFilter` rows/counts, dashboard counts endpoint carries `bus`); trip timeline/logistics (`timelineBus.ts`, `TRIP_BUS_SELECT` in `routes/trips.ts`, `tripsListInclude`, `TripCard` counts, `TripDeleteConfirm`), trip suggestions `loadTransport`, trip photo windows; `routes/upcoming.ts nextBus`; sync entity `bus_journey` + guarded route; Excel sheet (`lib/xlsx/busSheet.ts`) + importer spec (`services/xlsxImport/bus.ts` + `importableSpecs`) + JSON all-data export + `diagnosticExport`; demo seed (`seedDemo/seedBus.ts`, three Korea-shaped rides); `ImportSection`/`DashboardLayout.openableImports` for the spreadsheet only.

**B3 — the line and the links** (spec §5, §9): `services/bus/busGeometry.ts` on `resolveRouteProvider()` + `routeLegGeometry()` (mode `road`, car profile — D8), fetched once on save, `meta.geometry` with `ROUTE_FALLBACK_REASONS` worded in the form, re-fetch only on a moved terminal, a failed re-fetch keeps the line; connecting-coach UI through `Booking` (rail's `connectsFrom` idiom); `services/reminders/busReminders.ts`; the Transitous `BUS, COACH` measurement recorded in the spec BEFORE any lookup code; airports as a picker source if a shuttle ride turns up (D3).

**B4 — only with a corpus** (spec §10): `test-samples/Bus/` + `expectations.json`; `bus` in `PARSER_SUPPORTED_DOMAINS`, `ParseDomain`, `PARSEABLE_IMPORT_DOMAINS`, the template envelope's `TemplateDomain` (in `Abrechen2/travstats-templates`); a FlixBus template; `BusImportPreviewModal`; achievements and Wrapped (2.8).

## Self-review (done while writing)

- **Spec coverage:** §3.1 columns → Task 2; §3.2 resolution → Tasks 5 and 9; §4 → Tasks 3 and 5; §5 straight line → Task 5; §7 colour/icon/prefix → Task 1; §11 gating → Tasks 1, 10; §12 B1 measures → Tasks 6, 7, 11; §13 D1 (`rideKind`), D2 (day-only), D5 (chord — drawn in B2, stored in B1), D6 (no loyalty), D7 (colour), D9 (sync in B2) all honoured. §8 "trip bounds" moved from B2 into B1 (Task 7) because the write path already calls `recomputeTripStatus` — the spec's §12 row for B1 is amended to say so.
- **Type consistency:** `BusStationInput` has `address: string | null` on both sides; `terminalColumns` writes `depAddress`; the OpenAPI row takes `depAddress` from `prismaColumns`; `BusJourneyInput.departureFold` is optional on the web and `foldField` on the server; `withBusTimes` returns `times: BusTimes` = `RailTimes` shape; the route's `BUS_INVALID_INPUT`/`BUS_ARRIVAL_BEFORE_DEPARTURE` codes match `saveErrorFrom`.
- **Review Focus → tests:** 1 → Task 5 "refuses a terminal without a zone"; 2 → Task 5 "compares instants"; 3 → Task 5 "day-only" + Task 3 sweep; 4 → Task 5 "moved terminal"; 5 → Task 10 gating + Task 6 "stranger".
