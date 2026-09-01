# Tour route sections — Phase 1 implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A trip can hold named, ordered route sections whose legs are derived between consecutive stops and measured, drawn on the trip map and editable on their own sub-route — without changing a single existing kilometre.

**Architecture:** Two nullable columns on `TripStop` make a stop a route vertex; `TripRoute` is the section and `TripRouteLeg` the derived leg, keyed by endpoint stop pair rather than ordinal. One atomic endpoint owns stop assignment and ordering and recomputes legs in the same transaction. Geometry source (`straight` / `drawn`) is a column, so phases 3 and 4 add values rather than migrations.

**Tech Stack:** Express + TypeScript, Prisma/PostgreSQL, Zod, Jest + supertest (backend); React + Vite, Zustand, deck.gl `PathLayer` over MapLibre, react-i18next, Vitest (frontend).

**Spec:** `docs/superpowers/specs/2026-08-29-tour-route-sections-design.md`

**Phases 2–4 (vehicle catalog and fuel, GPX + external router, Dawarich) get their own plans.** This plan is Phase 1 only and produces working, shippable software on its own.

## Global Constraints

- `any` is FORBIDDEN. Use `unknown` plus type guards. Exception: `.d.ts` only.
- No `console.log`. `import logger from '../utils/logger'` — the logger is a **default** export.
- Prisma JSON writes cast via `as unknown as Prisma.InputJsonValue`, never directly from `Record<string, unknown>`.
- Schema changes only via `npx prisma migrate dev`, never hand-written.
- All user input validated by Zod, schemas in `backend/src/schemas/`.
- File size: 200–400 lines ideal, **800 hard maximum**. `backend/src/routes/trips.ts` is already **1380 lines** — add nothing to it.
- `useTranslation` is imported from `'../hooks/useTranslation'` (project wrapper), never from `react-i18next`.
- deck.gl uses the `MapboxOverlay` + `useControl` pattern, never the `<DeckGL>` component.
- Frontend user-facing copy: **German primary, English mirrored in the same change.** Code, comments and commits: English.
- Every new endpoint needs an OpenAPI entry or `openapi.coverage.test.ts` fails.
- Backend tests need `?connection_limit=5` on `DATABASE_URL` or Prisma exhausts the pool on a 32-core machine.
- Branch: `dev/tour-routes`. Never commit to `main`; merging is the owner's release decision.

**Test commands** (run from the worktree root, `D:/TravStats_Projekt/TravStats/.worktrees/camper-v1`):

```bash
# Backend — one file
cd backend && DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_dev?connection_limit=5" npx jest src/path/to/file.test.ts --forceExit

# Backend — gates
cd backend && npx tsc --noEmit && npm run lint

# Frontend
cd frontend && npx vitest --run src/path/to/file.test.ts
cd frontend && npx tsc --noEmit && npm run lint
```

---

## File structure

| File | Responsibility |
|---|---|
| `backend/prisma/schema.prisma` | `TripRoute`, `TripRouteLeg`, two `TripStop` columns |
| `backend/src/shared/tour/legPlan.ts` | Pure: ordered stop ids + existing legs → keep / create / delete. No DB, no I/O. |
| `backend/src/services/tour/tourDistance.ts` | Pure: distance per leg by source; driven vs. travelled |
| `backend/src/schemas/tour.ts` | Zod for every tour endpoint |
| `backend/src/routes/trips/tourRoutes.ts` | All tour endpoints, mounted at the `/trips` prefix |
| `backend/src/services/openapi/paths/tours.ts` | Spec entries for those endpoints |
| `frontend/src/types/tour.ts` | Mirrored types |
| `frontend/src/lib/api/tours.ts` | API client |
| `frontend/src/components/trips/TourSectionList.tsx` | The Touren tab body on the trip page |
| `frontend/src/pages/TripRouteEditorPage.tsx` | `/trips/:id/route/:routeId` |
| `frontend/src/components/trips/TourStopAssigner.tsx` | Stop list with the route-membership switch |
| `frontend/src/components/layers/tourPathsLayer.ts` | Builds the deck.gl `PathLayer` data |

`backend/src/routes/trips.ts` and `frontend/src/pages/TripDetailPage.tsx` are modified only where noted, and never grown by more than a few lines.

---

## Task 1: Schema and migration

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<generated>/migration.sql` (by the CLI)

**Interfaces:**
- Consumes: nothing.
- Produces: Prisma models `TripRoute`, `TripRouteLeg`; `TripStop.routeId: string | null`, `TripStop.routeOrderIdx: number | null`.

- [ ] **Step 1: Confirm the migration history is clean before touching it**

```bash
cd backend && npx prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma --script
```

Expected: an empty migration. If it is not empty, STOP and report — a pre-existing drift would get bundled into this migration.

- [ ] **Step 2: Add the two columns to `TripStop`**

In `model TripStop`, after the `notes` field:

```prisma
  /// Route membership. NULL means what every stop is today: a timeline
  /// point that produces no kilometres. Set means it is a vertex of that
  /// route section. Nothing derives this — see the migration note.
  routeId       String? @map("route_id")
  /// Position WITHIN the route, 0-based and contiguous. Written only by
  /// PUT /trips/:id/routes/:routeId/stops, never by a client.
  routeOrderIdx Int?    @map("route_order_idx")
```

and in its relation block:

```prisma
  route     TripRoute?     @relation(fields: [routeId], references: [id], onDelete: SetNull)
  legsFrom  TripRouteLeg[] @relation("LegFrom")
  legsTo    TripRouteLeg[] @relation("LegTo")
```

and in its index block:

```prisma
  @@unique([routeId, routeOrderIdx])
  @@index([routeId])
```

- [ ] **Step 3: Add the two new models**

Place directly after `model TripStop`:

```prisma
/// A named, ordered route section inside a trip: "Norwegen mit dem
/// Wohnmobil", "Besseggen-Wanderung", "Fähre nach Hirtshals".
///
/// A trip may hold several. A section may be a LOOP — its first and last
/// stop may be the same place — which is what makes a day hike from a base
/// camp expressible. The vehicle link arrives with phase 2.
model TripRoute {
  id       String  @id @default(uuid())
  tripId   String  @map("trip_id")
  name     String
  /// Default mode for legs created in this section:
  /// road | ferry | rail | foot | bike
  mode     String
  orderIdx Int     @default(0) @map("order_idx")
  color    String?
  notes    String?

  /// Odometer at section start and end. Deliberately NOT reconciled with
  /// the sum of the legs: the difference is the finding.
  startOdometerKm Int? @map("start_odometer_km")
  endOdometerKm   Int? @map("end_odometer_km")

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  trip  Trip           @relation(fields: [tripId], references: [id], onDelete: Cascade)
  stops TripStop[]
  legs  TripRouteLeg[]

  @@index([tripId])
  @@map("trip_routes")
}

/// One leg of one section.
///
/// Keyed by its two ENDPOINT STOPS, never by an ordinal — the lesson
/// `CruiseLegRoute` records: keying by position means inserting a stop
/// shifts every stored line one leg along, and the map then looks like the
/// router broke. With endpoint keying an inserted stop leaves its
/// neighbours' stored geometry untouched.
model TripRouteLeg {
  id         String @id @default(uuid())
  routeId    String @map("route_id")
  fromStopId String @map("from_stop_id")
  toStopId   String @map("to_stop_id")

  distanceKm Float  @map("distance_km")
  /// straight | drawn (phase 1). routed | track arrive in phase 3.
  source     String
  /// road | ferry | rail | foot | bike. Per LEG, not per section: a road
  /// tour with one ferry crossing must not count it as motorway km.
  mode       String
  /// low | medium | high, mirroring CruiseLeg.
  confidence String @default("medium")

  /// `[[lon, lat], …]` in GeoJSON order. Null when source is `straight`.
  waypoints      Json?
  drivingMinutes Int?    @map("driving_minutes")
  tollCost       Float?  @map("toll_cost")
  currency       String?

  computedAt DateTime @default(now()) @map("computed_at")
  updatedAt  DateTime @updatedAt @map("updated_at")

  route    TripRoute @relation(fields: [routeId], references: [id], onDelete: Cascade)
  fromStop TripStop  @relation("LegFrom", fields: [fromStopId], references: [id], onDelete: Cascade)
  toStop   TripStop  @relation("LegTo",   fields: [toStopId],   references: [id], onDelete: Cascade)

  @@unique([routeId, fromStopId, toStopId])
  @@index([routeId])
  @@map("trip_route_legs")
}
```

Also add to `model Trip`, in its relation block:

```prisma
  routes TripRoute[]
```

- [ ] **Step 4: Generate the migration**

```bash
cd backend && DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_dev" \
  npx prisma migrate dev --name tour_route_sections
```

Expected: a new folder under `prisma/migrations/`, and the generated SQL contains only `ALTER TABLE "trip_stops" ADD COLUMN`, two `CREATE TABLE`, and index/FK statements. **No `UPDATE` and no `DROP`.** If a `DROP` appears, STOP and report.

- [ ] **Step 5: Verify no existing row was touched**

```bash
cd backend && DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_dev" \
  npx prisma db execute --stdin <<'SQL'
SELECT count(*) FILTER (WHERE route_id IS NOT NULL) AS assigned, count(*) AS total FROM trip_stops;
SQL
```

Expected: `assigned` is 0.

- [ ] **Step 6: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(tours): schema for route sections and derived legs"
```

---

## Task 2: Leg planning (pure)

**Files:**
- Create: `backend/src/shared/tour/legPlan.ts`
- Test: `backend/src/shared/tour/__tests__/legPlan.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export interface ExistingLeg { id: string; fromStopId: string; toStopId: string }
  export interface LegPair { fromStopId: string; toStopId: string }
  export interface LegPlan { keep: ExistingLeg[]; create: LegPair[]; deleteIds: string[] }
  export function planLegs(orderedStopIds: readonly string[], existing: readonly ExistingLeg[]): LegPlan
  ```

- [ ] **Step 1: Write the failing test**

Create `backend/src/shared/tour/__tests__/legPlan.test.ts`:

```ts
import { planLegs, type ExistingLeg } from "../legPlan";

const leg = (id: string, from: string, to: string): ExistingLeg => ({
  id,
  fromStopId: from,
  toStopId: to,
});

describe("planLegs", () => {
  it("creates one leg per consecutive pair when nothing exists yet", () => {
    const plan = planLegs(["a", "b", "c"], []);
    expect(plan.create).toEqual([
      { fromStopId: "a", toStopId: "b" },
      { fromStopId: "b", toStopId: "c" },
    ]);
    expect(plan.keep).toEqual([]);
    expect(plan.deleteIds).toEqual([]);
  });

  it("keeps untouched pairs when a stop is inserted in the middle", () => {
    // This is the endpoint-keying promise: inserting X between b and c
    // must NOT disturb the stored a→b line.
    const existing = [leg("l1", "a", "b"), leg("l2", "b", "c")];
    const plan = planLegs(["a", "b", "x", "c"], existing);

    expect(plan.keep.map((l) => l.id)).toEqual(["l1"]);
    expect(plan.deleteIds).toEqual(["l2"]);
    expect(plan.create).toEqual([
      { fromStopId: "b", toStopId: "x" },
      { fromStopId: "x", toStopId: "c" },
    ]);
  });

  it("keeps the joined pair's neighbours and creates the join when a stop is removed", () => {
    const existing = [leg("l1", "a", "b"), leg("l2", "b", "c"), leg("l3", "c", "d")];
    const plan = planLegs(["a", "c", "d"], existing);

    expect(plan.keep.map((l) => l.id)).toEqual(["l3"]);
    expect(plan.deleteIds.sort()).toEqual(["l1", "l2"]);
    expect(plan.create).toEqual([{ fromStopId: "a", toStopId: "c" }]);
  });

  it("supports a loop whose first and last stop are the same place", () => {
    const plan = planLegs(["a", "b", "c", "a"], []);
    expect(plan.create).toHaveLength(3);
    expect(plan.create[2]).toEqual({ fromStopId: "c", toStopId: "a" });
  });

  it("plans nothing for a route with fewer than two stops", () => {
    expect(planLegs([], [])).toEqual({ keep: [], create: [], deleteIds: [] });
    expect(planLegs(["a"], [])).toEqual({ keep: [], create: [], deleteIds: [] });
  });

  it("deletes every existing leg when the route is emptied", () => {
    const plan = planLegs([], [leg("l1", "a", "b")]);
    expect(plan.deleteIds).toEqual(["l1"]);
    expect(plan.create).toEqual([]);
  });

  it("treats a repeated pair as one leg", () => {
    // An out-and-back a→b→a→b would otherwise plan the same unique key twice
    // and violate @@unique([routeId, fromStopId, toStopId]) on insert.
    const plan = planLegs(["a", "b", "a", "b"], []);
    expect(plan.create).toEqual([
      { fromStopId: "a", toStopId: "b" },
      { fromStopId: "b", toStopId: "a" },
    ]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd backend && npx jest src/shared/tour/__tests__/legPlan.test.ts --forceExit
```

Expected: FAIL — `Cannot find module '../legPlan'`.

- [ ] **Step 3: Implement**

Create `backend/src/shared/tour/legPlan.ts`:

```ts
/**
 * Which legs a route section should have, given the order of its stops.
 *
 * Pure and DB-free so the rule can be tested without a database, and so the
 * frontend can preview a reorder before saving it.
 *
 * Legs are identified by their ENDPOINT PAIR, never by position. That is
 * what lets a stop be inserted without disturbing the hand-drawn geometry
 * of every leg after it — the same reasoning `CruiseLegRoute` records.
 *
 * A pair that occurs twice in one section (an out-and-back) yields ONE leg:
 * the storage key is `(routeId, fromStopId, toStopId)`, so a second row for
 * the same pair could not be written. Both occurrences therefore render the
 * same line, which is almost always what the user meant.
 */

export interface ExistingLeg {
  id: string;
  fromStopId: string;
  toStopId: string;
}

export interface LegPair {
  fromStopId: string;
  toStopId: string;
}

export interface LegPlan {
  /** Rows to leave exactly as they are, geometry included. */
  keep: ExistingLeg[];
  /** Pairs with no row yet. */
  create: LegPair[];
  /** Ids of rows whose pair no longer occurs. */
  deleteIds: string[];
}

const keyOf = (from: string, to: string): string => `${from}\u0000${to}`;

export function planLegs(
  orderedStopIds: readonly string[],
  existing: readonly ExistingLeg[],
): LegPlan {
  const wanted = new Map<string, LegPair>();
  for (let i = 1; i < orderedStopIds.length; i++) {
    const from = orderedStopIds[i - 1];
    const to = orderedStopIds[i];
    const k = keyOf(from, to);
    if (!wanted.has(k)) wanted.set(k, { fromStopId: from, toStopId: to });
  }

  const keep: ExistingLeg[] = [];
  const deleteIds: string[] = [];
  const covered = new Set<string>();

  for (const leg of existing) {
    const k = keyOf(leg.fromStopId, leg.toStopId);
    if (wanted.has(k) && !covered.has(k)) {
      keep.push(leg);
      covered.add(k);
    } else {
      deleteIds.push(leg.id);
    }
  }

  const create: LegPair[] = [];
  for (const [k, pair] of wanted) {
    if (!covered.has(k)) create.push(pair);
  }

  return { keep, create, deleteIds };
}
```

- [ ] **Step 4: Run the tests**

```bash
cd backend && npx jest src/shared/tour/__tests__/legPlan.test.ts --forceExit
```

Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/src/shared/tour
git commit -m "feat(tours): plan legs from stop order, keyed by endpoint pair"
```

---

## Task 3: Distance (pure)

**Files:**
- Create: `backend/src/services/tour/tourDistance.ts`
- Test: `backend/src/services/tour/__tests__/tourDistance.test.ts`

**Interfaces:**
- Consumes: `haversineKm` from `backend/src/shared/geo/haversine.ts`; `polylineDistanceKm` from `backend/src/services/cruiseDistance/polylineDistance.ts`.
- Produces:
  ```ts
  export const LEG_MODES = ["road", "ferry", "rail", "foot", "bike"] as const;
  export type LegMode = (typeof LEG_MODES)[number];
  export const LEG_SOURCES = ["straight", "drawn", "routed", "track"] as const;
  export type LegSource = (typeof LEG_SOURCES)[number];
  export interface Coord { lat: number; lon: number }
  export function legDistanceKm(input: {
    source: LegSource; from: Coord; to: Coord; waypoints?: Array<[number, number]> | null;
  }): number;
  export function drivenKm(legs: readonly { mode: string; distanceKm: number }[]): number;
  export function travelledKm(legs: readonly { distanceKm: number }[]): number;
  ```

- [ ] **Step 1: Write the failing test**

Create `backend/src/services/tour/__tests__/tourDistance.test.ts`:

```ts
import { legDistanceKm, drivenKm, travelledKm } from "../tourDistance";

const OSLO = { lat: 59.91, lon: 10.75 };
const GOTHENBURG = { lat: 57.71, lon: 11.97 };

describe("legDistanceKm", () => {
  it("uses the great-circle chord for a straight leg", () => {
    const km = legDistanceKm({ source: "straight", from: OSLO, to: GOTHENBURG });
    // Oslo–Gothenburg is roughly 260 km as the crow flies.
    expect(km).toBeGreaterThan(240);
    expect(km).toBeLessThan(280);
  });

  it("measures the drawn line, not the chord", () => {
    const detour: Array<[number, number]> = [
      [OSLO.lon, OSLO.lat],
      [13.5, 58.8],
      [GOTHENBURG.lon, GOTHENBURG.lat],
    ];
    const straight = legDistanceKm({ source: "straight", from: OSLO, to: GOTHENBURG });
    const drawn = legDistanceKm({ source: "drawn", from: OSLO, to: GOTHENBURG, waypoints: detour });
    expect(drawn).toBeGreaterThan(straight);
  });

  it("falls back to the chord when a drawn leg has no usable line", () => {
    const straight = legDistanceKm({ source: "straight", from: OSLO, to: GOTHENBURG });
    expect(legDistanceKm({ source: "drawn", from: OSLO, to: GOTHENBURG, waypoints: null }))
      .toBeCloseTo(straight, 6);
    expect(legDistanceKm({ source: "drawn", from: OSLO, to: GOTHENBURG, waypoints: [[10.75, 59.91]] }))
      .toBeCloseTo(straight, 6);
  });

  it("is zero for a leg that starts and ends at the same point", () => {
    expect(legDistanceKm({ source: "straight", from: OSLO, to: OSLO })).toBeCloseTo(0, 6);
  });
});

describe("driven vs travelled", () => {
  const legs = [
    { mode: "road", distanceKm: 600 },
    { mode: "ferry", distanceKm: 140 },
    { mode: "foot", distanceKm: 14 },
    { mode: "rail", distanceKm: 90 },
  ];

  it("counts only road kilometres as driven", () => {
    // A van on a ferry is travelling, not driving; a hike is neither; on a
    // train you are a passenger. Mixing these into a vehicle's mileage makes
    // the consumption figure wrong.
    expect(drivenKm(legs)).toBe(600);
  });

  it("counts every leg as travelled", () => {
    expect(travelledKm(legs)).toBe(844);
  });

  it("ignores an unknown mode rather than guessing", () => {
    expect(drivenKm([{ mode: "hovercraft", distanceKm: 10 }])).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd backend && npx jest src/services/tour/__tests__/tourDistance.test.ts --forceExit
```

Expected: FAIL — `Cannot find module '../tourDistance'`.

- [ ] **Step 3: Implement**

Create `backend/src/services/tour/tourDistance.ts`:

```ts
import { haversineKm } from "../../shared/geo/haversine";
import { polylineDistanceKm } from "../cruiseDistance/polylineDistance";

/**
 * How long a leg is, and which of those kilometres a vehicle actually rolled.
 *
 * Deliberately pure: the same rules have to hold for a leg being previewed
 * in the editor and one being persisted by the assignment endpoint.
 */

export const LEG_MODES = ["road", "ferry", "rail", "foot", "bike"] as const;
export type LegMode = (typeof LEG_MODES)[number];

export const LEG_SOURCES = ["straight", "drawn", "routed", "track"] as const;
export type LegSource = (typeof LEG_SOURCES)[number];

/**
 * Modes a vehicle's odometer sees. Ferry and rail carry the vehicle or the
 * traveller; foot and bike are self-powered. Keeping this a allow-list
 * rather than a deny-list means a mode added later is excluded until
 * someone decides otherwise — the safe direction for a mileage figure.
 */
const DRIVEN_MODES: ReadonlySet<string> = new Set<string>(["road"]);

export interface Coord {
  lat: number;
  lon: number;
}

export interface LegDistanceInput {
  source: LegSource;
  from: Coord;
  to: Coord;
  /** `[[lon, lat], …]` in GeoJSON order, as stored. */
  waypoints?: Array<[number, number]> | null;
}

export function legDistanceKm(input: LegDistanceInput): number {
  const chord = haversineKm(input.from, input.to);
  if (input.source === "straight") return chord;

  const line = input.waypoints;
  // A line needs two points to have a length. Anything shorter is not a
  // shorter route, it is a missing one — fall back to the chord rather than
  // reporting zero kilometres for a leg that was certainly travelled.
  if (!line || line.length < 2) return chord;
  return polylineDistanceKm(line);
}

export function drivenKm(legs: readonly { mode: string; distanceKm: number }[]): number {
  return legs.reduce((sum, l) => (DRIVEN_MODES.has(l.mode) ? sum + l.distanceKm : sum), 0);
}

export function travelledKm(legs: readonly { distanceKm: number }[]): number {
  return legs.reduce((sum, l) => sum + l.distanceKm, 0);
}
```

- [ ] **Step 4: Check the haversine signature before running**

```bash
cd backend && grep -n "export function haversineKm" src/shared/geo/haversine.ts
```

Expected: it takes two `{lat, lon}` objects. If it takes four numbers instead, adapt the two call sites in `tourDistance.ts` — do not change the shared helper.

- [ ] **Step 5: Run the tests**

```bash
cd backend && npx jest src/services/tour/__tests__/tourDistance.test.ts --forceExit
```

Expected: 7 passed.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/tour
git commit -m "feat(tours): leg distance by source, driven vs travelled kilometres"
```

---

## Task 4: Zod schemas

**Files:**
- Create: `backend/src/schemas/tour.ts`
- Test: `backend/src/__tests__/tourSchema.test.ts`

**Interfaces:**
- Consumes: `LEG_MODES`, `LEG_SOURCES` from `services/tour/tourDistance.ts`.
- Produces: `createRouteSchema`, `updateRouteSchema`, `assignStopsSchema`, `legOverrideSchema`, and the inferred input types.

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/tourSchema.test.ts`:

```ts
import {
  createRouteSchema,
  updateRouteSchema,
  assignStopsSchema,
  legOverrideSchema,
} from "../schemas/tour";

describe("createRouteSchema", () => {
  it("accepts a minimal section", () => {
    expect(createRouteSchema.parse({ name: "Südnorwegen", mode: "road" })).toMatchObject({
      name: "Südnorwegen",
      mode: "road",
    });
  });

  it("rejects a mode that is not a transport mode", () => {
    expect(() => createRouteSchema.parse({ name: "X", mode: "hotel" })).toThrow();
  });

  it("rejects an empty name", () => {
    expect(() => createRouteSchema.parse({ name: "", mode: "road" })).toThrow();
  });
});

describe("assignStopsSchema", () => {
  it("accepts an ordered id list, including a repeated stop for a loop", () => {
    const parsed = assignStopsSchema.parse({ stopIds: ["a", "b", "a"] });
    expect(parsed.stopIds).toEqual(["a", "b", "a"]);
  });

  it("accepts an empty list — that releases every stop", () => {
    expect(assignStopsSchema.parse({ stopIds: [] }).stopIds).toEqual([]);
  });

  it("rejects a list longer than the cap", () => {
    expect(() => assignStopsSchema.parse({ stopIds: Array(513).fill("a") })).toThrow();
  });
});

describe("legOverrideSchema", () => {
  const line: Array<[number, number]> = [
    [10.75, 59.91],
    [11.97, 57.71],
  ];

  it("accepts a drawn line", () => {
    expect(legOverrideSchema.parse({ source: "drawn", waypoints: line }).source).toBe("drawn");
  });

  it("requires at least two points for a drawn line", () => {
    expect(() => legOverrideSchema.parse({ source: "drawn", waypoints: [[10.75, 59.91]] })).toThrow();
  });

  it("rejects coordinates outside the world", () => {
    expect(() =>
      legOverrideSchema.parse({ source: "drawn", waypoints: [[200, 59.91], [11.97, 57.71]] }),
    ).toThrow();
  });

  it("rejects waypoints on a straight leg — a straight leg has no line", () => {
    expect(() => legOverrideSchema.parse({ source: "straight", waypoints: line })).toThrow();
  });

  it("accepts a straight leg with no waypoints", () => {
    expect(legOverrideSchema.parse({ source: "straight" }).source).toBe("straight");
  });
});

describe("updateRouteSchema", () => {
  it("allows clearing the odometer readings", () => {
    expect(updateRouteSchema.parse({ startOdometerKm: null }).startOdometerKm).toBeNull();
  });

  it("rejects a negative odometer reading", () => {
    expect(() => updateRouteSchema.parse({ startOdometerKm: -1 })).toThrow();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd backend && npx jest src/__tests__/tourSchema.test.ts --forceExit
```

Expected: FAIL — `Cannot find module '../schemas/tour'`.

- [ ] **Step 3: Implement**

Create `backend/src/schemas/tour.ts`:

```ts
import { z } from "zod";

import { LEG_MODES, LEG_SOURCES } from "../services/tour/tourDistance";

/**
 * Validation for the tour endpoints.
 *
 * Phase 1 accepts only `straight` and `drawn` as a leg source; `routed` and
 * `track` are in the shared enum already so that phase 3 adds a value here
 * rather than a migration. A source the server cannot yet produce is
 * rejected at the boundary instead of being stored and rendered as a lie.
 */

const PHASE_1_SOURCES = ["straight", "drawn"] as const;

const coordinate = z
  .tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])
  .describe("[lon, lat] in GeoJSON order");

export const createRouteSchema = z.object({
  name: z.string().min(1).max(200),
  mode: z.enum(LEG_MODES),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  notes: z.string().max(20000).optional(),
  startOdometerKm: z.number().int().min(0).max(10_000_000).optional(),
  endOdometerKm: z.number().int().min(0).max(10_000_000).optional(),
});

export const updateRouteSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  mode: z.enum(LEG_MODES).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  notes: z.string().max(20000).nullable().optional(),
  orderIdx: z.number().int().min(0).max(10000).optional(),
  startOdometerKm: z.number().int().min(0).max(10_000_000).nullable().optional(),
  endOdometerKm: z.number().int().min(0).max(10_000_000).nullable().optional(),
});

/**
 * The complete ordered stop list of one section, replacing whatever was
 * there. An id may repeat — that is a loop, not a mistake. The cap is a
 * denial-of-service bound, not a product limit.
 */
export const assignStopsSchema = z.object({
  stopIds: z.array(z.string().uuid()).max(512),
});

export const legOverrideSchema = z
  .object({
    source: z.enum(PHASE_1_SOURCES),
    mode: z.enum(LEG_MODES).optional(),
    waypoints: z.array(coordinate).min(2).max(256).optional(),
    drivingMinutes: z.number().int().min(0).max(100_000).nullable().optional(),
    tollCost: z.number().min(0).max(1_000_000).nullable().optional(),
    currency: z.string().length(3).nullable().optional(),
  })
  .refine((v) => v.source !== "drawn" || (v.waypoints !== undefined && v.waypoints.length >= 2), {
    message: "A drawn leg needs at least two waypoints",
    path: ["waypoints"],
  })
  .refine((v) => v.source !== "straight" || v.waypoints === undefined, {
    message: "A straight leg has no waypoints",
    path: ["waypoints"],
  });

export type CreateRouteInput = z.infer<typeof createRouteSchema>;
export type UpdateRouteInput = z.infer<typeof updateRouteSchema>;
export type AssignStopsInput = z.infer<typeof assignStopsSchema>;
export type LegOverrideInput = z.infer<typeof legOverrideSchema>;
export type { LegMode, LegSource } from "../services/tour/tourDistance";
```

Note: `LEG_SOURCES` is imported for the re-export of `LegSource`; if lint flags it as unused, change the import to `import type { LegMode, LegSource } from "../services/tour/tourDistance";` alongside the value import of `LEG_MODES`.

- [ ] **Step 4: Run the tests**

```bash
cd backend && npx jest src/__tests__/tourSchema.test.ts --forceExit
```

Expected: 12 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/src/schemas/tour.ts backend/src/__tests__/tourSchema.test.ts
git commit -m "feat(tours): zod schemas for route sections, stop assignment and leg overrides"
```

---

## Task 5: Section CRUD endpoints

**Files:**
- Create: `backend/src/routes/trips/tourRoutes.ts`
- Modify: `backend/src/routes/mounts.ts`
- Test: `backend/src/routes/__tests__/tourRoutes.crud.test.ts`

**Interfaces:**
- Consumes: `resolveTrip` (exported from `backend/src/routes/trips.ts`), the schemas from Task 4.
- Produces: `GET|POST /trips/:id/routes`, `PATCH|DELETE /trips/:id/routes/:routeId`. Response shape `{ route: TourRouteDto }` and `{ routes: TourRouteDto[] }` where
  ```ts
  interface TourRouteDto {
    id: string; tripId: string; name: string; mode: string; orderIdx: number;
    color: string | null; notes: string | null;
    startOdometerKm: number | null; endOdometerKm: number | null;
    stopCount: number; legCount: number; distanceKm: number; drivenKm: number;
  }
  ```

- [ ] **Step 1: Write the failing test**

Create `backend/src/routes/__tests__/tourRoutes.crud.test.ts`:

```ts
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

describe("Tour route sections — CRUD", () => {
  let cookie: string;
  let otherCookie: string;
  let tripId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["tourcrud", "tourcrudother"] } } });

    const u = await prisma.user.create({
      data: { username: "tourcrud", passwordHash: await hashPassword("password123") },
    });
    cookie = `auth_token=${generateToken(u.id)}`;

    const other = await prisma.user.create({
      data: { username: "tourcrudother", passwordHash: await hashPassword("password123") },
    });
    otherCookie = `auth_token=${generateToken(other.id)}`;

    const trip = await prisma.trip.create({ data: { userId: u.id, name: "Norwegen 2024" } });
    tripId = trip.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["tourcrud", "tourcrudother"] } } });
    await prisma.$disconnect();
  });

  it("creates a section and lists it with zero distance", async () => {
    const created = await request(app)
      .post(`/api/v1/trips/${tripId}/routes`)
      .set("Cookie", cookie)
      .send({ name: "Südnorwegen", mode: "road" });

    expect(created.status).toBe(201);
    expect(created.body.route).toMatchObject({ name: "Südnorwegen", mode: "road", stopCount: 0 });
    expect(created.body.route.distanceKm).toBe(0);

    const list = await request(app).get(`/api/v1/trips/${tripId}/routes`).set("Cookie", cookie);
    expect(list.status).toBe(200);
    expect(list.body.routes).toHaveLength(1);
  });

  it("rejects a section on someone else's trip with 404", async () => {
    const res = await request(app)
      .post(`/api/v1/trips/${tripId}/routes`)
      .set("Cookie", otherCookie)
      .send({ name: "Fremd", mode: "road" });
    expect(res.status).toBe(404);
  });

  it("rejects an invalid mode with 400", async () => {
    const res = await request(app)
      .post(`/api/v1/trips/${tripId}/routes`)
      .set("Cookie", cookie)
      .send({ name: "X", mode: "hotel" });
    expect(res.status).toBe(400);
  });

  it("renames a section", async () => {
    const created = await request(app)
      .post(`/api/v1/trips/${tripId}/routes`)
      .set("Cookie", cookie)
      .send({ name: "Alt", mode: "foot" });
    const id = created.body.route.id as string;

    const patched = await request(app)
      .patch(`/api/v1/trips/${tripId}/routes/${id}`)
      .set("Cookie", cookie)
      .send({ name: "Besseggen" });

    expect(patched.status).toBe(200);
    expect(patched.body.route.name).toBe("Besseggen");
  });

  it("deleting a section releases its stops instead of deleting them", async () => {
    const created = await request(app)
      .post(`/api/v1/trips/${tripId}/routes`)
      .set("Cookie", cookie)
      .send({ name: "Wegwerf", mode: "road" });
    const routeId = created.body.route.id as string;

    const stop = await prisma.tripStop.create({
      data: { tripId, title: "Bergen", lat: 60.39, lon: 5.32, routeId, routeOrderIdx: 0 },
    });

    const del = await request(app)
      .delete(`/api/v1/trips/${tripId}/routes/${routeId}`)
      .set("Cookie", cookie);
    expect(del.status).toBe(204);

    const survivor = await prisma.tripStop.findUnique({ where: { id: stop.id } });
    expect(survivor).not.toBeNull();
    expect(survivor?.routeId).toBeNull();
    expect(survivor?.routeOrderIdx).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd backend && DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_dev?connection_limit=5" \
  npx jest src/routes/__tests__/tourRoutes.crud.test.ts --forceExit
```

Expected: FAIL — every request returns 404 because the router is not mounted.

- [ ] **Step 3: Implement the router**

Create `backend/src/routes/trips/tourRoutes.ts`:

```ts
import { Router, Response, NextFunction } from "express";

import { prisma } from "../../db";
import { authenticate, requireWriteScope, AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { createRouteSchema, updateRouteSchema } from "../../schemas/tour";
import { drivenKm, travelledKm } from "../../services/tour/tourDistance";
import { resolveTrip } from "../trips";
import logger from "../../utils/logger";

/**
 * Tour route sections — split out of `routes/trips.ts`, which was already
 * 1380 lines against an 800-line maximum. Mounted at the SAME `/trips`
 * prefix as the main trips router, the pattern `routes/cruises/routeOverride.ts`
 * uses alongside `routes/cruises.ts`.
 */

const router = Router();
router.use(authenticate);
router.use(requireWriteScope);

interface LegRow {
  mode: string;
  distanceKm: number;
}

function toDto(
  route: {
    id: string;
    tripId: string;
    name: string;
    mode: string;
    orderIdx: number;
    color: string | null;
    notes: string | null;
    startOdometerKm: number | null;
    endOdometerKm: number | null;
    legs: LegRow[];
    _count: { stops: number };
  },
): Record<string, unknown> {
  return {
    id: route.id,
    tripId: route.tripId,
    name: route.name,
    mode: route.mode,
    orderIdx: route.orderIdx,
    color: route.color,
    notes: route.notes,
    startOdometerKm: route.startOdometerKm,
    endOdometerKm: route.endOdometerKm,
    stopCount: route._count.stops,
    legCount: route.legs.length,
    distanceKm: travelledKm(route.legs),
    drivenKm: drivenKm(route.legs),
  };
}

const ROUTE_SELECT = {
  legs: { select: { mode: true, distanceKm: true } },
  _count: { select: { stops: true } },
} as const;

/** Section must exist AND belong to a trip this user owns. */
async function resolveRoute(userId: string, tripId: string, routeId: string): Promise<string> {
  await resolveTrip(userId, tripId);
  const route = await prisma.tripRoute.findFirst({
    where: { id: routeId, tripId },
    select: { id: true },
  });
  if (!route) throw new AppError("Route not found", 404);
  return route.id;
}

/** GET /trips/:id/routes */
router.get(
  "/trips/:id/routes",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const trip = await resolveTrip(userId, req.params.id);
      const routes = await prisma.tripRoute.findMany({
        where: { tripId: trip.id },
        orderBy: [{ orderIdx: "asc" }, { createdAt: "asc" }],
        include: ROUTE_SELECT,
      });
      res.json({ routes: routes.map(toDto) });
    } catch (error) {
      next(error);
    }
  },
);

/** POST /trips/:id/routes */
router.post(
  "/trips/:id/routes",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const trip = await resolveTrip(userId, req.params.id);
      const body = createRouteSchema.parse(req.body);

      const last = await prisma.tripRoute.findFirst({
        where: { tripId: trip.id },
        orderBy: { orderIdx: "desc" },
        select: { orderIdx: true },
      });

      const route = await prisma.tripRoute.create({
        data: {
          tripId: trip.id,
          name: body.name,
          mode: body.mode,
          color: body.color,
          notes: body.notes,
          startOdometerKm: body.startOdometerKm,
          endOdometerKm: body.endOdometerKm,
          orderIdx: last ? last.orderIdx + 1 : 0,
        },
        include: ROUTE_SELECT,
      });

      logger.info({ operation: "tour.route.create", routeId: route.id, tripId: trip.id });
      res.status(201).json({ route: toDto(route) });
    } catch (error) {
      next(error);
    }
  },
);

/** PATCH /trips/:id/routes/:routeId */
router.patch(
  "/trips/:id/routes/:routeId",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const routeId = await resolveRoute(userId, req.params.id, req.params.routeId);
      const body = updateRouteSchema.parse(req.body);

      const route = await prisma.tripRoute.update({
        where: { id: routeId },
        data: body,
        include: ROUTE_SELECT,
      });
      res.json({ route: toDto(route) });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * DELETE /trips/:id/routes/:routeId
 *
 * Deletes the section and its legs. Its stops are RELEASED, not deleted —
 * `TripStop.routeId` is `onDelete: SetNull`. A tour is scaffolding over the
 * timeline; removing the scaffolding must not remove the timeline.
 */
router.delete(
  "/trips/:id/routes/:routeId",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const routeId = await resolveRoute(userId, req.params.id, req.params.routeId);

      await prisma.$transaction(async (tx) => {
        await tx.tripStop.updateMany({
          where: { routeId },
          data: { routeId: null, routeOrderIdx: null },
        });
        await tx.tripRoute.delete({ where: { id: routeId } });
      });

      logger.info({ operation: "tour.route.delete", routeId });
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);

export default router;
```

- [ ] **Step 4: Mount it**

In `backend/src/routes/mounts.ts`, add the import next to the other trip imports:

```ts
import tourRouteRoutes from './trips/tourRoutes';
```

and add an entry to the mount table **immediately after** the existing `trips` entry, at the same `/api/v1` base path the trips router uses. Copy the shape of the neighbouring entries exactly (they carry an `id`, the router, and a path); give it `id: 'tourRoutes'`.

Order matters: it must come after `trips` so that `/trips/:id` still resolves to the main router.

- [ ] **Step 5: Run the tests**

```bash
cd backend && DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_dev?connection_limit=5" \
  npx jest src/routes/__tests__/tourRoutes.crud.test.ts --forceExit
```

Expected: 5 passed.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/trips backend/src/routes/mounts.ts backend/src/routes/__tests__/tourRoutes.crud.test.ts
git commit -m "feat(tours): create, list, rename and delete route sections"
```

---

## Task 6: Atomic stop assignment and leg recompute

**Files:**
- Modify: `backend/src/routes/trips/tourRoutes.ts`
- Test: `backend/src/routes/__tests__/tourRoutes.stops.test.ts`

**Interfaces:**
- Consumes: `planLegs` (Task 2), `legDistanceKm` (Task 3), `assignStopsSchema` (Task 4).
- Produces: `PUT /trips/:id/routes/:routeId/stops` returning `{ route: TourRouteDto, stops: TourStopDto[], legs: TourLegDto[] }` where
  ```ts
  interface TourStopDto { id: string; title: string; lat: number | null; lon: number | null; routeOrderIdx: number | null }
  interface TourLegDto {
    id: string; fromStopId: string; toStopId: string; distanceKm: number;
    source: string; mode: string; confidence: string; waypoints: Array<[number, number]> | null;
  }
  ```

- [ ] **Step 1: Write the failing test**

Create `backend/src/routes/__tests__/tourRoutes.stops.test.ts`:

```ts
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

describe("Tour route sections — stop assignment", () => {
  let cookie: string;
  let userId: string;
  let tripId: string;
  let routeId: string;
  const stopIds: Record<string, string> = {};

  const put = (ids: string[]) =>
    request(app)
      .put(`/api/v1/trips/${tripId}/routes/${routeId}/stops`)
      .set("Cookie", cookie)
      .send({ stopIds: ids });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tourstops" } });
    const u = await prisma.user.create({
      data: { username: "tourstops", passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    cookie = `auth_token=${generateToken(u.id)}`;
  });

  beforeEach(async () => {
    await prisma.trip.deleteMany({ where: { userId } });
    const trip = await prisma.trip.create({ data: { userId, name: "Norwegen" } });
    tripId = trip.id;

    const route = await prisma.tripRoute.create({
      data: { tripId, name: "Südnorwegen", mode: "road" },
    });
    routeId = route.id;

    const places: Array<[string, number, number]> = [
      ["kristiansand", 58.15, 8.0],
      ["bergen", 60.39, 5.32],
      ["lom", 61.84, 8.57],
      ["oslo", 59.91, 10.75],
    ];
    for (const [key, lat, lon] of places) {
      const s = await prisma.tripStop.create({ data: { tripId, title: key, lat, lon } });
      stopIds[key] = s.id;
    }
    const noCoords = await prisma.tripStop.create({ data: { tripId, title: "restaurant" } });
    stopIds.restaurant = noCoords.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tourstops" } });
    await prisma.$disconnect();
  });

  it("assigns stops, renumbers from zero and derives one leg per pair", async () => {
    const res = await put([stopIds.kristiansand, stopIds.bergen, stopIds.oslo]);

    expect(res.status).toBe(200);
    expect(res.body.stops.map((s: { routeOrderIdx: number }) => s.routeOrderIdx)).toEqual([0, 1, 2]);
    expect(res.body.legs).toHaveLength(2);
    expect(res.body.route.distanceKm).toBeGreaterThan(0);
    for (const leg of res.body.legs) {
      expect(leg.source).toBe("straight");
      expect(leg.mode).toBe("road");
    }
  });

  it("refuses a stop without coordinates", async () => {
    const res = await put([stopIds.kristiansand, stopIds.restaurant]);
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/coordinate/i);

    const stop = await prisma.tripStop.findUnique({ where: { id: stopIds.restaurant } });
    expect(stop?.routeId).toBeNull();
  });

  it("refuses a stop that belongs to a different trip", async () => {
    const otherTrip = await prisma.trip.create({ data: { userId, name: "Andere" } });
    const foreign = await prisma.tripStop.create({
      data: { tripId: otherTrip.id, title: "fremd", lat: 1, lon: 1 },
    });
    const res = await put([stopIds.kristiansand, foreign.id]);
    expect(res.status).toBe(400);
  });

  it("keeps a hand-drawn line when an unrelated stop is inserted", async () => {
    await put([stopIds.kristiansand, stopIds.bergen, stopIds.oslo]);

    const line: Array<[number, number]> = [
      [8.0, 58.15],
      [7.0, 59.2],
      [5.32, 60.39],
    ];
    const override = await request(app)
      .put(`/api/v1/trips/${tripId}/routes/${routeId}/legs/${stopIds.kristiansand}/${stopIds.bergen}`)
      .set("Cookie", cookie)
      .send({ source: "drawn", waypoints: line });
    expect(override.status).toBe(200);
    const drawnKm = override.body.leg.distanceKm as number;

    // Insert Lom between Bergen and Oslo — the Kristiansand→Bergen line must
    // survive untouched. This is the endpoint-keying promise.
    const after = await put([stopIds.kristiansand, stopIds.bergen, stopIds.lom, stopIds.oslo]);
    const survivor = after.body.legs.find(
      (l: { fromStopId: string }) => l.fromStopId === stopIds.kristiansand,
    );
    expect(survivor.source).toBe("drawn");
    expect(survivor.distanceKm).toBeCloseTo(drawnKm, 6);
    expect(after.body.legs).toHaveLength(3);
  });

  it("releases a removed stop without deleting it", async () => {
    await put([stopIds.kristiansand, stopIds.bergen, stopIds.oslo]);
    const res = await put([stopIds.kristiansand, stopIds.oslo]);

    expect(res.body.legs).toHaveLength(1);
    const released = await prisma.tripStop.findUnique({ where: { id: stopIds.bergen } });
    expect(released).not.toBeNull();
    expect(released?.routeId).toBeNull();
    expect(released?.routeOrderIdx).toBeNull();
  });

  it("accepts an empty list and clears the section", async () => {
    await put([stopIds.kristiansand, stopIds.bergen]);
    const res = await put([]);
    expect(res.status).toBe(200);
    expect(res.body.legs).toEqual([]);
    expect(res.body.route.distanceKm).toBe(0);
    expect(await prisma.tripStop.count({ where: { tripId } })).toBe(5);
  });

  it("supports a loop that returns to its first stop", async () => {
    const res = await put([stopIds.lom, stopIds.bergen, stopIds.lom]);
    expect(res.status).toBe(200);
    expect(res.body.legs).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd backend && DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_dev?connection_limit=5" \
  npx jest src/routes/__tests__/tourRoutes.stops.test.ts --forceExit
```

Expected: FAIL — 404 on the PUT.

- [ ] **Step 3: Add the shared recompute helper**

Append to `backend/src/routes/trips/tourRoutes.ts`, above the router definitions:

```ts
import { Prisma } from "@prisma/client";

import { planLegs } from "../../shared/tour/legPlan";
import { legDistanceKm, type LegSource } from "../../services/tour/tourDistance";
import { assignStopsSchema, legOverrideSchema } from "../../schemas/tour";

type Tx = Prisma.TransactionClient;

interface StopCoords {
  id: string;
  lat: number | null;
  lon: number | null;
}

/**
 * Bring a section's legs in line with its stop order, inside an existing
 * transaction.
 *
 * Legs whose endpoint pair survives keep their row — geometry, source and
 * manual costs included. Pairs that vanished are deleted; new pairs start
 * as `straight`. Nothing here consults the previous ORDER, only the pairs,
 * which is what makes an insertion cheap.
 */
async function recomputeLegs(
  tx: Tx,
  routeId: string,
  defaultMode: string,
  orderedStops: readonly StopCoords[],
): Promise<void> {
  const existing = await tx.tripRouteLeg.findMany({
    where: { routeId },
    select: { id: true, fromStopId: true, toStopId: true },
  });

  const plan = planLegs(
    orderedStops.map((s) => s.id),
    existing,
  );

  if (plan.deleteIds.length > 0) {
    await tx.tripRouteLeg.deleteMany({ where: { id: { in: plan.deleteIds } } });
  }

  const byId = new Map(orderedStops.map((s) => [s.id, s]));
  for (const pair of plan.create) {
    const from = byId.get(pair.fromStopId);
    const to = byId.get(pair.toStopId);
    // Guarded by the caller, which rejects coordinate-less stops before
    // reaching here; the check keeps the invariant local and typed.
    if (!from || !to || from.lat === null || from.lon === null || to.lat === null || to.lon === null) {
      throw new AppError("Every route stop needs a coordinate", 400);
    }
    await tx.tripRouteLeg.create({
      data: {
        routeId,
        fromStopId: pair.fromStopId,
        toStopId: pair.toStopId,
        source: "straight" satisfies LegSource,
        mode: defaultMode,
        confidence: "low",
        distanceKm: legDistanceKm({
          source: "straight",
          from: { lat: from.lat, lon: from.lon },
          to: { lat: to.lat, lon: to.lon },
        }),
      },
    });
  }
}
```

A new `straight` leg is `confidence: "low"` on purpose: a chord is a placeholder for a real route, and the map should be able to say so.

- [ ] **Step 4: Add the endpoint**

Append to the same file, before `export default router`:

```ts
/**
 * PUT /trips/:id/routes/:routeId/stops
 *
 * The complete ordered stop list of one section, replacing whatever was
 * there. This is the ONLY writer of `routeOrderIdx`, which is why the
 * broken global `TripStop.orderIdx` (never sent by any client, therefore
 * always 0) does not affect route ordering.
 *
 * Everything happens in one transaction: release, assign, renumber,
 * recompute. A half-applied assignment would leave legs pointing at stops
 * that are no longer in the section.
 */
router.put(
  "/trips/:id/routes/:routeId/stops",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const trip = await resolveTrip(userId, req.params.id);
      const routeId = await resolveRoute(userId, trip.id, req.params.routeId);
      const { stopIds } = assignStopsSchema.parse(req.body);

      const unique = [...new Set(stopIds)];
      const stops = await prisma.tripStop.findMany({
        where: { id: { in: unique }, tripId: trip.id },
        select: { id: true, lat: true, lon: true, title: true },
      });

      if (stops.length !== unique.length) {
        throw new AppError("Every stop must belong to this trip", 400);
      }
      const missing = stops.find((s) => s.lat === null || s.lon === null);
      if (missing) {
        throw new AppError(
          `Every route stop needs a coordinate — "${missing.title}" has none`,
          400,
        );
      }

      const byId = new Map(stops.map((s) => [s.id, s]));
      const ordered = stopIds.map((id) => byId.get(id)!);

      await prisma.$transaction(async (tx) => {
        // Release first: `@@unique([routeId, routeOrderIdx])` would collide
        // with the old numbering otherwise.
        await tx.tripStop.updateMany({
          where: { routeId },
          data: { routeId: null, routeOrderIdx: null },
        });
        // A repeated id (a loop) must be numbered once — by its FIRST
        // occurrence, so the section still starts where the user said.
        const firstIdx = new Map<string, number>();
        stopIds.forEach((id, i) => {
          if (!firstIdx.has(id)) firstIdx.set(id, i);
        });
        for (const [id, idx] of firstIdx) {
          await tx.tripStop.update({
            where: { id },
            data: { routeId, routeOrderIdx: idx },
          });
        }
        const route = await tx.tripRoute.findUniqueOrThrow({
          where: { id: routeId },
          select: { mode: true },
        });
        await recomputeLegs(tx, routeId, route.mode, ordered);
      });

      const [route, legs, savedStops] = await Promise.all([
        prisma.tripRoute.findUniqueOrThrow({ where: { id: routeId }, include: ROUTE_SELECT }),
        prisma.tripRouteLeg.findMany({ where: { routeId } }),
        prisma.tripStop.findMany({
          where: { routeId },
          orderBy: { routeOrderIdx: "asc" },
          select: { id: true, title: true, lat: true, lon: true, routeOrderIdx: true },
        }),
      ]);

      logger.info({ operation: "tour.stops.assign", routeId, stopCount: unique.length });
      res.json({ route: toDto(route), stops: savedStops, legs: legs.map(toLegDto) });
    } catch (error) {
      next(error);
    }
  },
);
```

and add the leg serialiser next to `toDto`:

```ts
function toLegDto(leg: {
  id: string;
  fromStopId: string;
  toStopId: string;
  distanceKm: number;
  source: string;
  mode: string;
  confidence: string;
  waypoints: Prisma.JsonValue | null;
  drivingMinutes: number | null;
  tollCost: number | null;
  currency: string | null;
}): Record<string, unknown> {
  return {
    id: leg.id,
    fromStopId: leg.fromStopId,
    toStopId: leg.toStopId,
    distanceKm: leg.distanceKm,
    source: leg.source,
    mode: leg.mode,
    confidence: leg.confidence,
    waypoints: leg.waypoints ?? null,
    drivingMinutes: leg.drivingMinutes,
    tollCost: leg.tollCost,
    currency: leg.currency,
  };
}
```

- [ ] **Step 5: Run the tests**

The drawn-line case also needs Task 7's endpoint. Run only the cases that stand alone first:

```bash
cd backend && DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_dev?connection_limit=5" \
  npx jest src/routes/__tests__/tourRoutes.stops.test.ts --forceExit -t "renumbers"
```

Expected: PASS. The "keeps a hand-drawn line" case stays red until Task 7 — that is expected and it is the reason Task 7 follows immediately.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/trips/tourRoutes.ts backend/src/routes/__tests__/tourRoutes.stops.test.ts
git commit -m "feat(tours): atomic stop assignment with derived legs"
```

---

## Task 7: Leg override

**Files:**
- Modify: `backend/src/routes/trips/tourRoutes.ts`
- Test: `backend/src/routes/__tests__/tourRoutes.legs.test.ts`

**Interfaces:**
- Consumes: `legOverrideSchema` (Task 4), `legDistanceKm` (Task 3).
- Produces: `PUT|DELETE /trips/:id/routes/:routeId/legs/:fromStopId/:toStopId`, response `{ leg: TourLegDto }` for PUT, 204 for DELETE.

- [ ] **Step 1: Write the failing test**

Create `backend/src/routes/__tests__/tourRoutes.legs.test.ts`:

```ts
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

describe("Tour route sections — leg overrides", () => {
  let cookie: string;
  let userId: string;
  let tripId: string;
  let routeId: string;
  let fromId: string;
  let toId: string;

  const LINE: Array<[number, number]> = [
    [8.0, 58.15],
    [7.0, 59.2],
    [5.32, 60.39],
  ];

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tourlegs" } });
    const u = await prisma.user.create({
      data: { username: "tourlegs", passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    cookie = `auth_token=${generateToken(u.id)}`;
  });

  beforeEach(async () => {
    await prisma.trip.deleteMany({ where: { userId } });
    const trip = await prisma.trip.create({ data: { userId, name: "T" } });
    tripId = trip.id;
    const route = await prisma.tripRoute.create({ data: { tripId, name: "S", mode: "road" } });
    routeId = route.id;

    const a = await prisma.tripStop.create({
      data: { tripId, title: "Kristiansand", lat: 58.15, lon: 8.0 },
    });
    const b = await prisma.tripStop.create({
      data: { tripId, title: "Bergen", lat: 60.39, lon: 5.32 },
    });
    fromId = a.id;
    toId = b.id;

    await request(app)
      .put(`/api/v1/trips/${tripId}/routes/${routeId}/stops`)
      .set("Cookie", cookie)
      .send({ stopIds: [fromId, toId] });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tourlegs" } });
    await prisma.$disconnect();
  });

  const url = (f = fromId, t = toId) =>
    `/api/v1/trips/${tripId}/routes/${routeId}/legs/${f}/${t}`;

  it("stores a drawn line and measures it", async () => {
    const before = await prisma.tripRouteLeg.findFirstOrThrow({ where: { routeId } });

    const res = await request(app)
      .put(url())
      .set("Cookie", cookie)
      .send({ source: "drawn", waypoints: LINE });

    expect(res.status).toBe(200);
    expect(res.body.leg.source).toBe("drawn");
    expect(res.body.leg.confidence).toBe("high");
    expect(res.body.leg.distanceKm).toBeGreaterThan(before.distanceKm);
  });

  it("rejects a line that does not start at the leg's first stop", async () => {
    const wrong: Array<[number, number]> = [
      [0, 0],
      [5.32, 60.39],
    ];
    const res = await request(app)
      .put(url())
      .set("Cookie", cookie)
      .send({ source: "drawn", waypoints: wrong });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/anchor|endpoint/i);
  });

  it("rejects a leg that is not part of this section", async () => {
    const stray = await prisma.tripStop.create({
      data: { tripId, title: "Stray", lat: 1, lon: 1 },
    });
    const res = await request(app)
      .put(url(fromId, stray.id))
      .set("Cookie", cookie)
      .send({ source: "drawn", waypoints: LINE });
    expect(res.status).toBe(404);
  });

  it("changes the transport mode of one leg", async () => {
    const res = await request(app)
      .put(url())
      .set("Cookie", cookie)
      .send({ source: "straight", mode: "ferry" });
    expect(res.status).toBe(200);
    expect(res.body.leg.mode).toBe("ferry");
  });

  it("DELETE drops the override and returns the leg to a straight chord", async () => {
    const straight = await prisma.tripRouteLeg.findFirstOrThrow({ where: { routeId } });
    await request(app).put(url()).set("Cookie", cookie).send({ source: "drawn", waypoints: LINE });

    const del = await request(app).delete(url()).set("Cookie", cookie);
    expect(del.status).toBe(204);

    const after = await prisma.tripRouteLeg.findFirstOrThrow({ where: { routeId } });
    expect(after.source).toBe("straight");
    expect(after.waypoints).toBeNull();
    expect(after.distanceKm).toBeCloseTo(straight.distanceKm, 6);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd backend && DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_dev?connection_limit=5" \
  npx jest src/routes/__tests__/tourRoutes.legs.test.ts --forceExit
```

Expected: FAIL — 404 on the PUT.

- [ ] **Step 3: Implement**

Append to `backend/src/routes/trips/tourRoutes.ts`, before `export default router`. Add `import { haversineKm } from "../../shared/geo/haversine";` at the top.

```ts
/** How far a drawn line may start or end from its leg's stop, in km. */
const ANCHOR_TOLERANCE_KM = 1;

/**
 * PUT /trips/:id/routes/:routeId/legs/:fromStopId/:toStopId
 *
 * The leg must already exist — a line for a leg that is not in the
 * itinerary could never match anything on read, so the user would see a
 * silent no-op instead of an error. Same reasoning as the cruise route
 * override.
 *
 * The anchor check lives here rather than in Zod because it needs the
 * stops' coordinates from the database, which a schema cannot see.
 */
router.put(
  "/trips/:id/routes/:routeId/legs/:fromStopId/:toStopId",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const trip = await resolveTrip(userId, req.params.id);
      const routeId = await resolveRoute(userId, trip.id, req.params.routeId);
      const body = legOverrideSchema.parse(req.body);

      const leg = await prisma.tripRouteLeg.findUnique({
        where: {
          routeId_fromStopId_toStopId: {
            routeId,
            fromStopId: req.params.fromStopId,
            toStopId: req.params.toStopId,
          },
        },
        include: {
          fromStop: { select: { lat: true, lon: true } },
          toStop: { select: { lat: true, lon: true } },
        },
      });
      if (!leg) throw new AppError("Leg not found", 404);

      const from = leg.fromStop;
      const to = leg.toStop;
      if (from.lat === null || from.lon === null || to.lat === null || to.lon === null) {
        throw new AppError("Leg endpoints lost their coordinates", 409);
      }
      const fromCoord = { lat: from.lat, lon: from.lon };
      const toCoord = { lat: to.lat, lon: to.lon };

      const waypoints = body.waypoints ?? null;
      if (waypoints) {
        const head = { lat: waypoints[0][1], lon: waypoints[0][0] };
        const tail = {
          lat: waypoints[waypoints.length - 1][1],
          lon: waypoints[waypoints.length - 1][0],
        };
        if (
          haversineKm(head, fromCoord) > ANCHOR_TOLERANCE_KM ||
          haversineKm(tail, toCoord) > ANCHOR_TOLERANCE_KM
        ) {
          throw new AppError(
            "The line must start and end at the leg's stops (anchor tolerance 1 km)",
            400,
          );
        }
      }

      const updated = await prisma.tripRouteLeg.update({
        where: { id: leg.id },
        data: {
          source: body.source,
          mode: body.mode ?? leg.mode,
          // A line the user drew is the best information available; a chord
          // is a placeholder.
          confidence: body.source === "drawn" ? "high" : "low",
          waypoints: waypoints === null
            ? Prisma.DbNull
            : (waypoints as unknown as Prisma.InputJsonValue),
          drivingMinutes: body.drivingMinutes ?? leg.drivingMinutes,
          tollCost: body.tollCost ?? leg.tollCost,
          currency: body.currency ?? leg.currency,
          distanceKm: legDistanceKm({
            source: body.source,
            from: fromCoord,
            to: toCoord,
            waypoints,
          }),
        },
      });

      logger.info({ operation: "tour.leg.override", legId: updated.id, source: updated.source });
      res.json({ leg: toLegDto(updated) });
    } catch (error) {
      next(error);
    }
  },
);

/** DELETE the override — back to a straight chord. */
router.delete(
  "/trips/:id/routes/:routeId/legs/:fromStopId/:toStopId",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const trip = await resolveTrip(userId, req.params.id);
      const routeId = await resolveRoute(userId, trip.id, req.params.routeId);

      const leg = await prisma.tripRouteLeg.findUnique({
        where: {
          routeId_fromStopId_toStopId: {
            routeId,
            fromStopId: req.params.fromStopId,
            toStopId: req.params.toStopId,
          },
        },
        include: {
          fromStop: { select: { lat: true, lon: true } },
          toStop: { select: { lat: true, lon: true } },
        },
      });
      if (!leg) throw new AppError("Leg not found", 404);

      const { fromStop: f, toStop: t } = leg;
      if (f.lat === null || f.lon === null || t.lat === null || t.lon === null) {
        throw new AppError("Leg endpoints lost their coordinates", 409);
      }

      await prisma.tripRouteLeg.update({
        where: { id: leg.id },
        data: {
          source: "straight",
          confidence: "low",
          waypoints: Prisma.DbNull,
          distanceKm: legDistanceKm({
            source: "straight",
            from: { lat: f.lat, lon: f.lon },
            to: { lat: t.lat, lon: t.lon },
          }),
        },
      });

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);
```

- [ ] **Step 4: Run both route test files**

```bash
cd backend && DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_dev?connection_limit=5" \
  npx jest src/routes/__tests__/tourRoutes --forceExit
```

Expected: all three files green, including the previously-red "keeps a hand-drawn line when an unrelated stop is inserted".

- [ ] **Step 5: Check the file has not outgrown the limit**

```bash
wc -l backend/src/routes/trips/tourRoutes.ts
```

If it is above 400 lines, split the leg endpoints into `backend/src/routes/trips/tourLegs.ts`, mounted the same way — do not let it approach 800.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/trips backend/src/routes/__tests__/tourRoutes.legs.test.ts
git commit -m "feat(tours): hand-drawn leg geometry with an endpoint anchor check"
```

---

## Task 8: Geometry endpoint and OpenAPI

**Files:**
- Modify: `backend/src/routes/trips/tourRoutes.ts`
- Create: `backend/src/services/openapi/paths/tours.ts`
- Modify: `backend/src/services/openapi/paths/index.ts`
- Test: `backend/src/routes/__tests__/tourRoutes.geometry.test.ts`

**Interfaces:**
- Produces: `GET /trips/:id/routes/:routeId/geometry` returning a GeoJSON `FeatureCollection` whose features are `LineString`s with properties `{ legId, source, mode, distanceKm, confidence }`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/routes/__tests__/tourRoutes.geometry.test.ts`:

```ts
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

describe("Tour route sections — geometry", () => {
  let cookie: string;
  let tripId: string;
  let routeId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tourgeo" } });
    const u = await prisma.user.create({
      data: { username: "tourgeo", passwordHash: await hashPassword("password123") },
    });
    cookie = `auth_token=${generateToken(u.id)}`;

    const trip = await prisma.trip.create({ data: { userId: u.id, name: "T" } });
    tripId = trip.id;
    const route = await prisma.tripRoute.create({ data: { tripId, name: "S", mode: "road" } });
    routeId = route.id;

    const a = await prisma.tripStop.create({ data: { tripId, title: "A", lat: 58.15, lon: 8.0 } });
    const b = await prisma.tripStop.create({ data: { tripId, title: "B", lat: 60.39, lon: 5.32 } });
    await request(app)
      .put(`/api/v1/trips/${tripId}/routes/${routeId}/stops`)
      .set("Cookie", cookie)
      .send({ stopIds: [a.id, b.id] });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tourgeo" } });
    await prisma.$disconnect();
  });

  it("returns a LineString per leg, chord for a straight leg", async () => {
    const res = await request(app)
      .get(`/api/v1/trips/${tripId}/routes/${routeId}/geometry`)
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.type).toBe("FeatureCollection");
    expect(res.body.features).toHaveLength(1);

    const f = res.body.features[0];
    expect(f.geometry.type).toBe("LineString");
    expect(f.geometry.coordinates).toEqual([
      [8.0, 58.15],
      [5.32, 60.39],
    ]);
    expect(f.properties.source).toBe("straight");
    expect(f.properties.mode).toBe("road");
  });

  it("returns an empty collection for a section with no stops", async () => {
    const empty = await prisma.tripRoute.create({ data: { tripId, name: "Leer", mode: "foot" } });
    const res = await request(app)
      .get(`/api/v1/trips/${tripId}/routes/${empty.id}/geometry`)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.features).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd backend && DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_dev?connection_limit=5" \
  npx jest src/routes/__tests__/tourRoutes.geometry.test.ts --forceExit
```

Expected: FAIL — 404.

- [ ] **Step 3: Implement**

Append to `backend/src/routes/trips/tourRoutes.ts`, before `export default router`:

```ts
/**
 * GET /trips/:id/routes/:routeId/geometry
 *
 * One LineString per leg, so the map can colour each leg by its own mode
 * and dash the straight ones. A leg with stored waypoints emits them; a
 * straight leg emits its two endpoints, which is exactly the chord the
 * distance was computed from — the picture and the number never disagree.
 */
router.get(
  "/trips/:id/routes/:routeId/geometry",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const trip = await resolveTrip(userId, req.params.id);
      const routeId = await resolveRoute(userId, trip.id, req.params.routeId);

      const legs = await prisma.tripRouteLeg.findMany({
        where: { routeId },
        include: {
          fromStop: { select: { lat: true, lon: true, routeOrderIdx: true } },
          toStop: { select: { lat: true, lon: true } },
        },
      });

      const features = legs
        .map((leg) => {
          const stored = Array.isArray(leg.waypoints)
            ? (leg.waypoints as unknown as Array<[number, number]>)
            : null;
          const f = leg.fromStop;
          const t = leg.toStop;
          if (!stored && (f.lat === null || f.lon === null || t.lat === null || t.lon === null)) {
            return null;
          }
          const coordinates: Array<[number, number]> =
            stored && stored.length >= 2
              ? stored
              : [
                  [f.lon as number, f.lat as number],
                  [t.lon as number, t.lat as number],
                ];
          return {
            type: "Feature" as const,
            geometry: { type: "LineString" as const, coordinates },
            properties: {
              legId: leg.id,
              source: leg.source,
              mode: leg.mode,
              confidence: leg.confidence,
              distanceKm: leg.distanceKm,
              order: leg.fromStop.routeOrderIdx ?? 0,
            },
          };
        })
        .filter((f): f is NonNullable<typeof f> => f !== null)
        .sort((a, b) => (a.properties.order as number) - (b.properties.order as number));

      res.json({ type: "FeatureCollection", features });
    } catch (error) {
      next(error);
    }
  },
);
```

- [ ] **Step 4: Write the OpenAPI entries**

Open `backend/src/services/openapi/paths/trips.ts` and read the top 60 lines to copy the exact registration helper and style used there. Create `backend/src/services/openapi/paths/tours.ts` following that style, registering all eight endpoints:

- `GET /trips/{id}/routes`, `POST /trips/{id}/routes`
- `PATCH /trips/{id}/routes/{routeId}`, `DELETE /trips/{id}/routes/{routeId}`
- `PUT /trips/{id}/routes/{routeId}/stops`
- `PUT /trips/{id}/routes/{routeId}/legs/{fromStopId}/{toStopId}`, `DELETE` on the same path
- `GET /trips/{id}/routes/{routeId}/geometry`

Each needs a real summary and at least one realistic example — a generated-looking stub is what the hand-registration exists to avoid.

Then add to `backend/src/services/openapi/paths/index.ts`, after the `./trips` import:

```ts
import "./tours";
```

- [ ] **Step 5: Run the geometry test and the coverage guard**

```bash
cd backend && DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_dev?connection_limit=5" \
  npx jest src/routes/__tests__/tourRoutes.geometry.test.ts --forceExit
cd backend && npx jest openapi --forceExit
```

Expected: both green. If the coverage guard names a tour endpoint, its path string in `tours.ts` does not match the mounted path — fix the string, never the guard.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/trips backend/src/services/openapi backend/src/routes/__tests__/tourRoutes.geometry.test.ts
git commit -m "feat(tours): geometry endpoint and OpenAPI entries"
```

---

## Task 9: The two known defects

**Files:**
- Modify: `backend/src/services/tripCleanupService.ts:160-175`
- Modify: `frontend/src/lib/tripTimeline.ts:135-140`
- Test: `backend/src/services/__tests__/tripCleanup.routes.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new. Behaviour fix only.

- [ ] **Step 1: Write the failing test**

Create `backend/src/services/__tests__/tripCleanup.routes.test.ts`:

```ts
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { mergeTrips } from "../tripCleanupService";

describe("mergeTrips carries route sections", () => {
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "mergeroutes" } });
    const u = await prisma.user.create({
      data: { username: "mergeroutes", passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: "mergeroutes" } });
    await prisma.$disconnect();
  });

  it("moves a section to the target trip along with its stops", async () => {
    const target = await prisma.trip.create({ data: { userId, name: "Ziel" } });
    const source = await prisma.trip.create({ data: { userId, name: "Quelle" } });

    const route = await prisma.tripRoute.create({
      data: { tripId: source.id, name: "Südnorwegen", mode: "road" },
    });
    const stop = await prisma.tripStop.create({
      data: { tripId: source.id, title: "Bergen", lat: 60.39, lon: 5.32, routeId: route.id, routeOrderIdx: 0 },
    });

    await mergeTrips(userId, [target.id, source.id], target.id, null);

    const movedRoute = await prisma.tripRoute.findUnique({ where: { id: route.id } });
    const movedStop = await prisma.tripStop.findUnique({ where: { id: stop.id } });

    // A section left behind on a deleted trip, or pointing at a trip whose
    // stops have gone elsewhere, is the failure this guards.
    expect(movedRoute?.tripId).toBe(target.id);
    expect(movedStop?.tripId).toBe(target.id);
    expect(movedStop?.routeId).toBe(route.id);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd backend && DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_dev?connection_limit=5" \
  npx jest src/services/__tests__/tripCleanup.routes.test.ts --forceExit
```

Expected: FAIL — the route still points at the deleted source trip, or the merge throws on a foreign-key violation.

Check `mergeTrips`'s real signature first with `grep -n "export async function mergeTrips" -A 8 backend/src/services/tripCleanupService.ts` and adapt the call in the test to match it exactly.

- [ ] **Step 3: Implement**

In `backend/src/services/tripCleanupService.ts`, inside the `prisma.$transaction` block, add one line next to the other `updateMany(move)` calls:

```ts
    await tx.tripStop.updateMany(move);
    // Sections move with their stops. Without this a section stays on a trip
    // that is about to be deleted, and its stops end up on another trip —
    // a route pointing at nothing.
    await tx.tripRoute.updateMany(move);
```

- [ ] **Step 4: Fix the comment that describes something that does not happen**

In `frontend/src/lib/tripTimeline.ts`, replace the claim at line ~137 that stops arrive "in the order the backend returned them — which is `orderIdx`" with:

```ts
 *    time stay in the order the backend returned them. That order is
 *    `[orderIdx ASC, startDate ASC]`, but no client has ever SENT
 *    `orderIdx` — `routes/trips.ts` stores `body.orderIdx ?? 0` — so in
 *    practice every stop carries 0 and the date decides. Route ordering
 *    uses `routeOrderIdx` instead, which the assignment endpoint owns.
```

- [ ] **Step 5: Run the test and the neighbouring suites**

```bash
cd backend && DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_dev?connection_limit=5" \
  npx jest src/services/__tests__/tripCleanup --forceExit
cd frontend && npx vitest --run src/lib/__tests__/tripTimeline.test.ts
```

Expected: green. If no `tripTimeline` test file exists, skip that command — the change is a comment.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/tripCleanupService.ts backend/src/services/__tests__/tripCleanup.routes.test.ts frontend/src/lib/tripTimeline.ts
git commit -m "fix(trips): carry route sections through a trip merge; correct the stop-order comment"
```

---

## Task 10: The no-fabricated-history guarantee

**Files:**
- Test: `backend/src/routes/__tests__/tourRoutes.noBackfill.test.ts`

**Interfaces:**
- Consumes: the endpoints from Tasks 5–8.
- Produces: nothing. This task exists only to pin a promise made in the spec.

- [ ] **Step 1: Write the test**

Create `backend/src/routes/__tests__/tourRoutes.noBackfill.test.ts`:

```ts
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * A trip that pre-dates route sections must report ZERO kilometres and hold
 * ZERO route rows, no matter how route-like its stops look.
 *
 * This is the design's central promise: route membership is explicit, never
 * derived. A future "helpful" backfill — matching by date, by proximity, by
 * `domain === "road"` — would invent travel history the user never entered,
 * and it would land in the statistics. This test is what stops it.
 */
describe("no fabricated history", () => {
  let cookie: string;
  let tripId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "nobackfill" } });
    const u = await prisma.user.create({
      data: { username: "nobackfill", passwordHash: await hashPassword("password123") },
    });
    cookie = `auth_token=${generateToken(u.id)}`;

    const trip = await prisma.trip.create({ data: { userId: u.id, name: "Alte Reise" } });
    tripId = trip.id;

    // Deliberately route-shaped: ordered, dated, coordinate-bearing, and
    // carrying the very `domain` labels a heuristic would latch onto.
    const legacy: Array<[string, string, number, number]> = [
      ["Osnabrück", "road", 52.28, 8.05],
      ["Hamburg", "road", 53.55, 9.99],
      ["Hirtshals", "ferry", 57.59, 9.96],
      ["Bergen", "hotel", 60.39, 5.32],
    ];
    for (const [title, domain, lat, lon] of legacy) {
      await prisma.tripStop.create({ data: { tripId, title, domain, lat, lon } });
    }
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: "nobackfill" } });
    await prisma.$disconnect();
  });

  it("holds no route sections", async () => {
    const res = await request(app).get(`/api/v1/trips/${tripId}/routes`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.routes).toEqual([]);
  });

  it("leaves every stop unassigned", async () => {
    const assigned = await prisma.tripStop.count({ where: { tripId, routeId: { not: null } } });
    expect(assigned).toBe(0);
  });

  it("has no legs anywhere for this trip", async () => {
    const legs = await prisma.tripRouteLeg.count({ where: { route: { tripId } } });
    expect(legs).toBe(0);
  });
});
```

- [ ] **Step 2: Run it**

```bash
cd backend && DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_dev?connection_limit=5" \
  npx jest src/routes/__tests__/tourRoutes.noBackfill.test.ts --forceExit
```

Expected: 3 passed **immediately** — nothing implements a backfill, which is the point. If any of these fails, something is inferring route membership and must be removed.

- [ ] **Step 3: Run the backend gates**

```bash
cd backend && npx tsc --noEmit && npm run lint
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/__tests__/tourRoutes.noBackfill.test.ts
git commit -m "test(tours): pin that route membership is never inferred"
```

---

## Task 11: Frontend types and API client

**Files:**
- Create: `frontend/src/types/tour.ts`
- Create: `frontend/src/lib/api/tours.ts`
- Test: `frontend/src/lib/api/__tests__/tours.test.ts`

**Interfaces:**
- Consumes: the endpoints from Tasks 5–8.
- Produces:
  ```ts
  export interface TourRoute { id: string; tripId: string; name: string; mode: LegMode; orderIdx: number;
    color: string | null; notes: string | null; startOdometerKm: number | null; endOdometerKm: number | null;
    stopCount: number; legCount: number; distanceKm: number; drivenKm: number }
  export interface TourLeg { id: string; fromStopId: string; toStopId: string; distanceKm: number;
    source: LegSource; mode: LegMode; confidence: string; waypoints: Array<[number, number]> | null;
    drivingMinutes: number | null; tollCost: number | null; currency: string | null }
  export const toursApi: {
    list(tripId: string): Promise<TourRoute[]>;
    create(tripId: string, input: { name: string; mode: LegMode }): Promise<TourRoute>;
    update(tripId: string, routeId: string, input: Partial<{ name: string; mode: LegMode; color: string | null }>): Promise<TourRoute>;
    remove(tripId: string, routeId: string): Promise<void>;
    assignStops(tripId: string, routeId: string, stopIds: string[]): Promise<{ route: TourRoute; stops: TourStop[]; legs: TourLeg[] }>;
    setLeg(tripId: string, routeId: string, fromStopId: string, toStopId: string, input: { source: LegSource; mode?: LegMode; waypoints?: Array<[number, number]> }): Promise<TourLeg>;
    clearLeg(tripId: string, routeId: string, fromStopId: string, toStopId: string): Promise<void>;
    geometry(tripId: string, routeId: string): Promise<TourGeometry>;
  };
  ```

- [ ] **Step 1: Read the client conventions**

```bash
sed -n '1,40p' frontend/src/lib/api/trips.ts
```

Copy the axios instance import, the `withCredentials` handling and the error style exactly. The JWT is an HttpOnly cookie, so every instance needs `withCredentials: true` — do not create a new axios instance if `trips.ts` already exports or imports a shared one.

- [ ] **Step 2: Write the failing test**

Create `frontend/src/lib/api/__tests__/tours.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

import { toursApi } from "../tours";
import { apiClient } from "../client";

vi.mock("../client", () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

describe("toursApi", () => {
  beforeEach(() => vi.clearAllMocks();

  it("lists sections of one trip", async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { routes: [{ id: "r1", name: "S" }] } });
    const routes = await toursApi.list("t1");
    expect(apiClient.get).toHaveBeenCalledWith("/trips/t1/routes");
    expect(routes).toHaveLength(1);
  });

  it("sends the full ordered id list when assigning stops", async () => {
    vi.mocked(apiClient.put).mockResolvedValue({ data: { route: {}, stops: [], legs: [] } });
    await toursApi.assignStops("t1", "r1", ["a", "b"]);
    expect(apiClient.put).toHaveBeenCalledWith("/trips/t1/routes/r1/stops", { stopIds: ["a", "b"] });
  });

  it("puts a leg override on the endpoint-pair path", async () => {
    vi.mocked(apiClient.put).mockResolvedValue({ data: { leg: { id: "l1" } } });
    await toursApi.setLeg("t1", "r1", "a", "b", { source: "drawn", waypoints: [[1, 2], [3, 4]] });
    expect(apiClient.put).toHaveBeenCalledWith("/trips/t1/routes/r1/legs/a/b", {
      source: "drawn",
      waypoints: [[1, 2], [3, 4]],
    });
  });
});
```

Fix the syntax slip in `beforeEach` when you paste it: it must be `beforeEach(() => { vi.clearAllMocks(); });`.

- [ ] **Step 3: Run it and confirm it fails**

```bash
cd frontend && npx vitest --run src/lib/api/__tests__/tours.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement both files**

Write `frontend/src/types/tour.ts` with the interfaces from the Interfaces block above, plus:

```ts
export const LEG_MODES = ["road", "ferry", "rail", "foot", "bike"] as const;
export type LegMode = (typeof LEG_MODES)[number];
export const LEG_SOURCES = ["straight", "drawn", "routed", "track"] as const;
export type LegSource = (typeof LEG_SOURCES)[number];

export interface TourStop {
  id: string;
  title: string;
  lat: number | null;
  lon: number | null;
  routeOrderIdx: number | null;
}

export interface TourGeometryFeature {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: Array<[number, number]> };
  properties: {
    legId: string;
    source: LegSource;
    mode: LegMode;
    confidence: string;
    distanceKm: number;
    order: number;
  };
}

export interface TourGeometry {
  type: "FeatureCollection";
  features: TourGeometryFeature[];
}
```

Then `frontend/src/lib/api/tours.ts` implementing each method as a thin call that unwraps the documented envelope (`data.routes`, `data.route`, `data.leg`).

- [ ] **Step 5: Run the tests and the gates**

```bash
cd frontend && npx vitest --run src/lib/api/__tests__/tours.test.ts && npx tsc --noEmit
```

Expected: 3 passed, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/types/tour.ts frontend/src/lib/api/tours.ts frontend/src/lib/api/__tests__/tours.test.ts
git commit -m "feat(tours): frontend types and API client"
```

---

## Task 12: Route paths on the trip map

**Files:**
- Create: `frontend/src/components/layers/tourPathsLayer.ts`
- Create: `frontend/src/components/layers/__tests__/tourPathsLayer.test.ts`
- Modify: `frontend/src/components/trips/TripMap.tsx`

**Interfaces:**
- Consumes: `TourGeometry` from Task 11.
- Produces:
  ```ts
  export interface TourPathDatum { legId: string; path: Array<[number, number]>; color: [number, number, number]; dashed: boolean; label: string }
  export function buildTourPaths(geometries: readonly { routeId: string; geometry: TourGeometry; name: string }[]): TourPathDatum[];
  export const TOUR_MODE_RGB: Record<LegMode, [number, number, number]>;
  ```

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/layers/__tests__/tourPathsLayer.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildTourPaths, TOUR_MODE_RGB } from "../tourPathsLayer";
import type { TourGeometry } from "../../../types/tour";

const geo = (mode: "road" | "ferry", source: "straight" | "drawn"): TourGeometry => ({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "LineString", coordinates: [[8, 58], [5.3, 60.4]] },
      properties: { legId: "l1", source, mode, confidence: "low", distanceKm: 300, order: 0 },
    },
  ],
});

describe("buildTourPaths", () => {
  it("colours a leg by its own mode, not the section's", () => {
    const [road] = buildTourPaths([{ routeId: "r1", name: "S", geometry: geo("road", "drawn") }]);
    const [ferry] = buildTourPaths([{ routeId: "r1", name: "S", geometry: geo("ferry", "drawn") }]);
    expect(road.color).toEqual(TOUR_MODE_RGB.road);
    expect(ferry.color).toEqual(TOUR_MODE_RGB.ferry);
  });

  it("marks a straight leg as dashed so a placeholder looks like one", () => {
    const [straight] = buildTourPaths([{ routeId: "r1", name: "S", geometry: geo("road", "straight") }]);
    const [drawn] = buildTourPaths([{ routeId: "r1", name: "S", geometry: geo("road", "drawn") }]);
    expect(straight.dashed).toBe(true);
    expect(drawn.dashed).toBe(false);
  });

  it("drops a feature with fewer than two coordinates instead of crashing", () => {
    const broken: TourGeometry = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "LineString", coordinates: [[8, 58]] },
          properties: { legId: "l1", source: "straight", mode: "road", confidence: "low", distanceKm: 0, order: 0 },
        },
      ],
    };
    expect(buildTourPaths([{ routeId: "r1", name: "S", geometry: broken }])).toEqual([]);
  });

  it("returns nothing for an empty collection", () => {
    expect(
      buildTourPaths([{ routeId: "r1", name: "S", geometry: { type: "FeatureCollection", features: [] } }]),
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd frontend && npx vitest --run src/components/layers/__tests__/tourPathsLayer.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `frontend/src/components/layers/tourPathsLayer.ts`:

```ts
import type { LegMode, TourGeometry } from "../../types/tour";

/**
 * Turns the geometry endpoint's output into `PathLayer` data.
 *
 * Colour comes from the LEG's mode, never the section's: a road tour with
 * one ferry crossing has to show that crossing as a ferry, or the map
 * claims the van drove across the Skagerrak.
 *
 * Hex values mirror the mode palette in `tokens`; a straight leg is dashed
 * because a chord is a placeholder and should not look like a measurement.
 */
export const TOUR_MODE_RGB: Record<LegMode, [number, number, number]> = {
  road: [141, 191, 106],
  ferry: [111, 160, 214],
  rail: [168, 148, 214],
  foot: [217, 180, 92],
  bike: [176, 209, 107],
};

export interface TourPathDatum {
  legId: string;
  path: Array<[number, number]>;
  color: [number, number, number];
  dashed: boolean;
  label: string;
}

export function buildTourPaths(
  geometries: readonly { routeId: string; name: string; geometry: TourGeometry }[],
): TourPathDatum[] {
  const out: TourPathDatum[] = [];
  for (const g of geometries) {
    for (const f of g.geometry.features) {
      const path = f.geometry.coordinates;
      if (path.length < 2) continue;
      out.push({
        legId: f.properties.legId,
        path,
        color: TOUR_MODE_RGB[f.properties.mode] ?? TOUR_MODE_RGB.road,
        dashed: f.properties.source === "straight",
        label: `${g.name} · ${Math.round(f.properties.distanceKm)} km`,
      });
    }
  }
  return out;
}
```

- [ ] **Step 4: Wire it into `TripMap.tsx`**

`PathLayer` is already imported there. Add a `tourGeometries` prop of type
`readonly { routeId: string; name: string; geometry: TourGeometry }[]` defaulting to `[]`, build the data with `buildTourPaths` inside the existing `useMemo` that assembles layers, and push one `PathLayer<TourPathDatum>` with `id: "trip-tour-paths"` into the returned array **before** the stop scatterplot so pins stay on top.

Beware: `exhaustive-deps` is disabled in this project, so a stale memo is not caught by any gate. Add `tourGeometries` to that `useMemo`'s dependency array by hand and check the map redraws after adding a leg.

- [ ] **Step 5: Run the frontend gates**

```bash
cd frontend && npx vitest --run src/components/layers/__tests__/tourPathsLayer.test.ts && npx tsc --noEmit && npm run lint
```

Expected: 4 passed, clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/layers/tourPathsLayer.ts frontend/src/components/layers/__tests__ frontend/src/components/trips/TripMap.tsx
git commit -m "feat(tours): draw route sections on the trip map, coloured per leg mode"
```

---

## Task 13: Touren tab on the trip page

**Files:**
- Create: `frontend/src/components/trips/TourSectionList.tsx`
- Create: `frontend/src/components/trips/__tests__/TourSectionList.test.tsx`
- Modify: `frontend/src/pages/TripDetailPage.tsx` (add the tab and render the component — nothing else)
- Modify: `frontend/src/config/betaFeatures.ts`

**Interfaces:**
- Consumes: `toursApi` (Task 11).
- Produces: `<TourSectionList tripId={string} />`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/trips/__tests__/TourSectionList.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import TourSectionList from "../TourSectionList";
import { toursApi } from "../../../lib/api/tours";

vi.mock("../../../lib/api/tours", () => ({
  toursApi: { list: vi.fn(), create: vi.fn(), remove: vi.fn() },
}));

// Page-level tests in this project receive raw i18n KEYS, not German text.
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

describe("TourSectionList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows each section with its distance", async () => {
    vi.mocked(toursApi.list).mockResolvedValue([
      {
        id: "r1", tripId: "t1", name: "Südnorwegen", mode: "road", orderIdx: 0,
        color: null, notes: null, startOdometerKm: null, endOdometerKm: null,
        stopCount: 8, legCount: 7, distanceKm: 1284.4, drivenKm: 1284.4,
      },
    ]);

    render(<TourSectionList tripId="t1" />);

    expect(await screen.findByText("Südnorwegen")).toBeInTheDocument();
    expect(screen.getByText(/1.284/)).toBeInTheDocument();
  });

  it("shows an empty state rather than a zero when there is no section", async () => {
    vi.mocked(toursApi.list).mockResolvedValue([]);
    render(<TourSectionList tripId="t1" />);
    await waitFor(() => expect(screen.getByText("trips:tours.empty")).toBeInTheDocument());
  });

  it("shows an error instead of a plausible zero when loading fails", async () => {
    // Zeros over a failed load are a lie the user cannot detect.
    vi.mocked(toursApi.list).mockRejectedValue(new Error("boom"));
    render(<TourSectionList tripId="t1" />);
    await waitFor(() => expect(screen.getByText("trips:tours.loadError")).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd frontend && npx vitest --run src/components/trips/__tests__/TourSectionList.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `frontend/src/components/trips/TourSectionList.tsx`: a self-contained component that loads sections on mount, renders one row per section (name, mode chip, `stopCount`, `distanceKm` formatted with `toLocaleString("de-DE", { maximumFractionDigits: 0 })`), links each row to `/trips/${tripId}/route/${route.id}`, and offers a "new section" control. It must render three distinct states — loading, empty (`trips:tours.empty`), error (`trips:tours.loadError`) — and never render `0 km` when the request failed.

Keep it under 200 lines. Do not add data fetching to `TripDetailPage`.

- [ ] **Step 4: Add the tab and the beta gate**

In `frontend/src/pages/TripDetailPage.tsx`, add a `tours` entry to the existing tab list and render `<TourSectionList tripId={trip.id} />` in its panel. Add **no** other logic to this file — it is at 1576 lines against an 800 maximum.

In `frontend/src/config/betaFeatures.ts`, register the feature (follow the shape of the existing entries) and hide the tab behind `betaFeaturesEnabled` until the owner accepts it. Never persist that flag client-side.

- [ ] **Step 5: Run the tests and gates**

```bash
cd frontend && npx vitest --run src/components/trips/__tests__/TourSectionList.test.tsx && npx tsc --noEmit && npm run lint
```

Expected: 3 passed, clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/trips/TourSectionList.tsx frontend/src/components/trips/__tests__/TourSectionList.test.tsx frontend/src/pages/TripDetailPage.tsx frontend/src/config/betaFeatures.ts
git commit -m "feat(tours): Touren tab on the trip page, behind the beta flag"
```

---

## Task 14: The route editor sub-route

**Files:**
- Create: `frontend/src/pages/TripRouteEditorPage.tsx`
- Create: `frontend/src/components/trips/TourStopAssigner.tsx`
- Create: `frontend/src/components/trips/__tests__/TourStopAssigner.test.tsx`
- Modify: `frontend/src/App.tsx` (one route)

**Interfaces:**
- Consumes: `toursApi`, `buildTourPaths`.
- Produces: the page at `/trips/:id/route/:routeId`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/trips/__tests__/TourStopAssigner.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import TourStopAssigner from "../TourStopAssigner";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const STOPS = [
  { id: "a", title: "Kristiansand", lat: 58.15, lon: 8.0, routeOrderIdx: 0 },
  { id: "b", title: "Bergen", lat: 60.39, lon: 5.32, routeOrderIdx: 1 },
  { id: "c", title: "Restaurant", lat: null, lon: null, routeOrderIdx: null },
];

describe("TourStopAssigner", () => {
  it("sends the remaining ordered ids when a stop is switched off", () => {
    const onChange = vi.fn();
    render(<TourStopAssigner stops={STOPS} onChange={onChange} />);

    fireEvent.click(screen.getByRole("switch", { name: /Bergen/ }));
    expect(onChange).toHaveBeenCalledWith(["a"]);
  });

  it("disables the switch for a stop with no coordinate and says why", () => {
    render(<TourStopAssigner stops={STOPS} onChange={vi.fn()} />);
    const sw = screen.getByRole("switch", { name: /Restaurant/ });
    expect(sw).toBeDisabled();
    expect(screen.getByText("trips:tours.needsCoordinate")).toBeInTheDocument();
  });

  it("adds a stop at the end when switched on", () => {
    const onChange = vi.fn();
    const stops = [...STOPS.slice(0, 2), { ...STOPS[2], lat: 1, lon: 1 }];
    render(<TourStopAssigner stops={stops} onChange={onChange} />);

    fireEvent.click(screen.getByRole("switch", { name: /Restaurant/ }));
    expect(onChange).toHaveBeenCalledWith(["a", "b", "c"]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd frontend && npx vitest --run src/components/trips/__tests__/TourStopAssigner.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `TourStopAssigner`**

A controlled component: it takes every stop of the trip plus their current `routeOrderIdx`, renders one row each with a `role="switch"` toggle whose accessible name contains the stop title, and calls `onChange(orderedIds)` with the complete new ordered list. A stop with `lat === null || lon === null` gets a disabled switch and the text `trips:tours.needsCoordinate`.

- [ ] **Step 4: Implement the page**

`TripRouteEditorPage.tsx` reads `:id` and `:routeId`, loads the section, its stops and its geometry, renders `TourStopAssigner` plus a small map (reuse `TripMap` with `tourGeometries`), and calls `toursApi.assignStops` on every change. Show the leg list with distance, a source selector and the mode, calling `toursApi.setLeg` / `clearLeg`.

Add to `frontend/src/App.tsx`, next to the existing `path="/trips/:id"` route:

```tsx
<Route path="/trips/:id/route/:routeId" element={<TripRouteEditorPage />} />
```

Match the surrounding routes' auth wrapper exactly.

- [ ] **Step 5: Verify in a PRODUCTION build, not the dev server**

deck.gl context errors are invisible in the dev server and fatal in the bundle. This is not optional.

```bash
cd frontend && npx vite build && npx vite preview --port 4173
```

Open `http://localhost:4173`, log in, open a trip, create a section, assign three stops, and confirm the line is drawn and the distance is non-zero. Check the browser console is clean.

- [ ] **Step 6: Run the gates and commit**

```bash
cd frontend && npx vitest --run && npx tsc --noEmit && npm run lint
```

```bash
git add frontend/src/pages/TripRouteEditorPage.tsx frontend/src/components/trips/TourStopAssigner.tsx frontend/src/components/trips/__tests__/TourStopAssigner.test.tsx frontend/src/App.tsx
git commit -m "feat(tours): route editor at /trips/:id/route/:routeId"
```

---

## Task 15: Copy, in both languages

**Files:**
- Modify: `frontend/src/i18n/resources/de/trips.json`
- Modify: `frontend/src/i18n/resources/en/trips.json`
- Modify: `frontend/src/i18n/resources/de/map.json`

**Interfaces:**
- Consumes: every `t()` key used in Tasks 13 and 14.
- Produces: nothing in code.

- [ ] **Step 1: Collect every key actually used**

```bash
cd frontend && grep -rho 't("trips:tours\.[a-zA-Z.]*"' src | sort -u
```

Every key that appears must exist in **both** files. A merged component silently losing its `t()` calls has happened in this project before; the German literal in a JSX file is the tell.

- [ ] **Step 2: Add the German block**

In `de/trips.json`, add a `tours` object covering at minimum: `tabLabel` ("Touren"), `empty` ("Noch keine Tour in dieser Reise"), `loadError` ("Touren konnten nicht geladen werden"), `newSection` ("Tour hinzufügen"), `needsCoordinate` ("Ohne Koordinate kein Streckenpunkt"), `stopIsRoutePoint` ("Streckenpunkt"), plus `mode.road` ("Straße"), `mode.ferry` ("Fähre"), `mode.rail` ("Bahn"), `mode.foot` ("zu Fuß"), `mode.bike` ("Rad"), and `source.straight` ("Luftlinie"), `source.drawn` ("gezogen"), `source.routed` ("geroutet"), `source.track` ("Spur").

- [ ] **Step 3: Mirror it in English**

Same keys in `en/trips.json`: "Tours", "No tour in this trip yet", "Tours could not be loaded", "Add tour", "A stop without a coordinate cannot be part of a route", "Route point", "Road", "Ferry", "Rail", "On foot", "Bike", "Straight line", "Drawn", "Routed", "Track".

- [ ] **Step 4: Fix the pre-existing campsite inconsistency**

`de/lodging.json` calls `campsite` "Campingplatz" and `de/map.json` calls it "Zeltplatz". Change the `map.json` value to "Campingplatz" so one thing has one name.

- [ ] **Step 5: Run the i18n key guard and the full frontend suite**

```bash
cd frontend && npx vitest --run src/i18n && npx vitest --run
```

Expected: green, including any existing test that asserts DE and EN carry the same key set.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/i18n/resources
git commit -m "feat(tours): German and English copy; unify the campsite label"
```

---

## Final gate

- [ ] **Run everything**

```bash
cd backend && npx tsc --noEmit && npm run lint
cd backend && DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_dev?connection_limit=5" npm test -- --forceExit
cd frontend && npx tsc --noEmit && npm run lint && npx vitest --run
```

A red backend suite with 100+ failures is almost always the connection pool or a pending migration, not this code. Check `npx prisma migrate status` first.

- [ ] **Manual check in a production build**

`npx vite build && npx vite preview` — create a section, assign stops, draw a leg, remove a stop, confirm the numbers move and no existing trip gained kilometres.

- [ ] **Push**

```bash
git push forgejo dev/tour-routes
```

**Do not merge to `main`.** Merging is the owner's release decision and must be asked as a single, isolated question.

## Deliberately out of scope for Phase 1

`Vehicle`, `FuelEntry`, consumption and the odometer-gap panel (Phase 2). GPX import, the external router and `TripRouteTrack` (Phase 3). Dawarich (Phase 4). The tour layer on the dashboard map via `MapContainer3D`'s `extraLayers`, and the `tour` entry in `DASHBOARD_TABS` (Phase 2, once there is more than one trip's worth of data to look at). Splitting `TripDetailPage.tsx`.
