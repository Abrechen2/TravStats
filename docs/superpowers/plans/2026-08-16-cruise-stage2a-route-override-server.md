# Cruise Stage 2a — The Route Override, Server Side

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist a hand-corrected route for one cruise leg, and make both the
drawn line and the stored kilometres come from it — so that a router version
bump can never silently undo the user's work.

**Architecture:** One new table (`CruiseLegRoute`) keyed by the leg's two
endpoints, two endpoints to write and clear it, and two consumers taught to
consult it first: the geometry endpoint (the line) and `recomputeLegsForCruise`
(the distance). No UI in this plan — stage 2b builds the editor on top.

**Tech Stack:** Express + TypeScript (strict), Prisma 5 / PostgreSQL, Zod at
every boundary, Jest.

**Spec:** `docs/superpowers/specs/2026-08-16-cruise-route-editing-and-excursions-design.md`
— §4.3 (the table and why it is endpoint-keyed), §6 "The trap this must not
fall into" (line and distance from one source), §7 invariants 3, 4 and 8.

**Why the server first:** the editor is the visible half, but it has nothing to
save into until this exists, and the invariant that makes the feature
trustworthy — a version bump not wiping the user's line — is entirely server
side. Stage 2b is the map editor and follows immediately.

## Global Constraints

- `any` is **forbidden**. Use `unknown` plus type guards. Only `.d.ts` files are exempt.
- All user input validated with **Zod**, in `backend/src/schemas/`.
- No `console.log` in runtime code — `import logger from '../utils/logger'` (default export; the named exports are category loggers).
- Immutability: spread to build new objects; never mutate in place.
- Prisma JSON fields are cast via `as unknown as Prisma.InputJsonValue`, never directly from `Record<string, unknown>`.
- Schema changes go through `npx prisma migrate dev` — never hand-written SQL, never editing an already-applied migration (their checksums are frozen; `migrate deploy` refuses a changed file).
- Files: 200–400 lines ideal, **800 hard maximum**.
- Conventional commits, English.
- Do **not** touch `backend/VERSION` or `CHANGELOG.md` — owned by `/deploy` on `main`.
- Branch `dev/cruise-extension`. Do not merge to `main`, do not push.
- Never run `taskkill` or kill a process. If a port or file is locked, report it.

## Database for this worktree

**Do not run migrations against `flights_dev`.** That database is shared with
the owner's other dev stacks; `prisma migrate dev` on a shared database is the
documented way to wreck someone else's checkout. This worktree gets its own:

```bash
docker exec travstats-db-dev psql -U flights_dev -d flights_dev \
  -c "CREATE DATABASE flights_cruise OWNER flights_dev"
```

Then, for every command in this plan:

```
DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_cruise"
```

Bring it up to the branch's current schema **before** creating anything new:

```bash
cd backend
DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_cruise" \
  npx prisma migrate deploy
```

If `npx prisma generate` fails with `EPERM ... rename ... query_engine-windows.dll.node`, a
process has the DLL memory-mapped. Windows forbids overwriting it but allows
renaming: move `backend/node_modules/.prisma/client/query_engine-windows.dll.node`
aside to `.locked`, re-run `generate`, then delete the `.locked` file.

## Gate commands

```bash
cd backend && npx tsc --noEmit && npm run lint
cd backend && DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_cruise" npm test -- --forceExit
```

The backend suite is flaky in this environment for reasons unrelated to this
work — Postgres deadlocks during fixture teardown, in varying unrelated files.
`jest.config.js` is deliberately single-worker; leave it, and never pass
`--maxWorkers`. Judge your own test files, and report a failure elsewhere as an
observation rather than chasing it.

---

### Task 1: The table, and the distance along a polyline

**Files:**
- Modify: `backend/prisma/schema.prisma` — new `CruiseLegRoute` model, plus the back-relation on `Cruise`
- Create: `backend/prisma/migrations/<generated>/migration.sql` (by `migrate dev`, not by hand)
- Create: `backend/src/services/cruiseDistance/polylineDistance.ts`
- Create: `backend/src/services/cruiseDistance/__tests__/polylineDistance.test.ts`

**Interfaces:**
- Consumes: `haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number` from `backend/src/shared/geo/haversine.ts` — existing.
- Produces: `polylineDistanceKm(waypoints: Array<[number, number]>): number` exported from `backend/src/services/cruiseDistance/polylineDistance.ts`. **Input is `[lon, lat]` pairs** — GeoJSON order, the same order the geometry endpoint already emits. Getting that backwards is the classic defect here, which is why the tests below pin it with a case whose latitude and longitude differ enough to make a swap obvious.

- [ ] **Step 1: Write the failing test**

Create `backend/src/services/cruiseDistance/__tests__/polylineDistance.test.ts`:

```ts
import { polylineDistanceKm } from "../polylineDistance";

describe("polylineDistanceKm", () => {
  it("sums the great-circle length of each segment", () => {
    // Two 1° steps along the equator, ~111.19 km each.
    const km = polylineDistanceKm([
      [0, 0],
      [1, 0],
      [2, 0],
    ]);
    expect(km).toBeGreaterThan(220);
    expect(km).toBeLessThan(224);
  });

  it("reads pairs as [lon, lat], not [lat, lon]", () => {
    // Hamburg (9.99 E, 53.55 N) to Lisbon (-9.14 E, 38.72 N) is ~2200 km.
    // Read the other way round the same numbers land in the Indian Ocean and
    // the result is nowhere near that.
    const km = polylineDistanceKm([
      [9.99, 53.55],
      [-9.14, 38.72],
    ]);
    expect(km).toBeGreaterThan(2000);
    expect(km).toBeLessThan(2400);
  });

  it("returns 0 for a single point or an empty list", () => {
    expect(polylineDistanceKm([])).toBe(0);
    expect(polylineDistanceKm([[10, 50]])).toBe(0);
  });

  it("is the sum of its parts, so a split changes nothing", () => {
    const whole = polylineDistanceKm([
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
    const first = polylineDistanceKm([
      [0, 0],
      [1, 1],
    ]);
    const rest = polylineDistanceKm([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
    // This is the property the whole feature rests on: cutting a route at a
    // point must not change its total length.
    expect(whole).toBeCloseTo(first + rest, 9);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_cruise" npm test -- --forceExit src/services/cruiseDistance/__tests__/polylineDistance.test.ts`
Expected: FAIL — cannot resolve `../polylineDistance`.

- [ ] **Step 3: Implement it**

Create `backend/src/services/cruiseDistance/polylineDistance.ts`:

```ts
import { haversineKm } from "../../shared/geo/haversine";

/**
 * Length of a hand-drawn route, in kilometres.
 *
 * Input is GeoJSON order — `[lon, lat]` — because that is what
 * `CruiseLegRoute.waypoints` stores and what the geometry endpoint emits, and
 * a conversion in between would be one more place to get it backwards.
 *
 * Deliberately a plain sum of great-circle segments: the total of a route and
 * the totals of its parts must add up exactly, or splitting a leg at a landing
 * would move the cruise's distance (spec §6.2).
 */
export function polylineDistanceKm(waypoints: Array<[number, number]>): number {
  let km = 0;
  for (let i = 1; i < waypoints.length; i++) {
    const [aLon, aLat] = waypoints[i - 1];
    const [bLon, bLat] = waypoints[i];
    km += haversineKm({ lat: aLat, lon: aLon }, { lat: bLat, lon: bLon });
  }
  return km;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run the same command as step 2.
Expected: PASS, 4/4.

- [ ] **Step 5: Add the model to the schema**

In `backend/prisma/schema.prisma`, add after the `CruiseLeg` model:

```prisma
/// A hand-corrected route for one leg of one cruise.
///
/// Keyed by the leg's two ENDPOINTS, never by its ordinal: keying by position
/// means inserting a port shifts every stored line one leg along, and the map
/// then looks like the router broke. With endpoint keying an itinerary change
/// simply leaves the row unmatched and inert.
///
/// Consequence accepted on purpose: if the same directed pair occurs twice in
/// one itinerary, both occurrences render the same corrected line — which is
/// almost always what the user meant.
model CruiseLegRoute {
  id       String @id @default(uuid())
  cruiseId String @map("cruise_id")

  /// 'port' today. 'place' arrives with the private-place stage; the column
  /// exists now so that stage adds rows rather than migrating every stored line.
  fromKind String @map("from_kind")
  /// The endpoint's id as text — a Port id today.
  fromRef  String @map("from_ref")
  toKind   String @map("to_kind")
  toRef    String @map("to_ref")

  /// `[[lon, lat], ...]` in GeoJSON order, 2..64 points, first and last equal
  /// to the leg's endpoints. Validated by Zod on the way in.
  waypoints Json

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  cruise Cruise @relation(fields: [cruiseId], references: [id], onDelete: Cascade)

  @@unique([cruiseId, fromKind, fromRef, toKind, toRef])
  @@index([cruiseId])
  @@map("cruise_leg_routes")
}
```

And on the `Cruise` model, beside `legs CruiseLeg[]`, add:

```prisma
  legRoutes     CruiseLegRoute[]
```

- [ ] **Step 6: Generate the migration**

```bash
cd backend
DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_cruise" \
  npx prisma migrate dev --name cruise_leg_route
```

Then **read the generated SQL** before continuing. It must contain exactly one
`CREATE TABLE "cruise_leg_routes"`, its unique index and its foreign key —
nothing else. If it also contains ALTER statements for unrelated tables, the
schema had drifted from the migration history: stop and report that rather than
committing a migration that carries someone else's change.

- [ ] **Step 7: Run the gate and commit**

```bash
cd backend && npx tsc --noEmit && npm run lint
cd backend && DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_cruise" npm test -- --forceExit src/services/cruiseDistance
```

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations \
        backend/src/services/cruiseDistance/polylineDistance.ts \
        backend/src/services/cruiseDistance/__tests__/polylineDistance.test.ts
git commit -m "feat(cruise): a table for a route the user drew, and its length"
```

---

### Task 2: Writing and clearing an override

Two endpoints. `PUT` stores or replaces the line for one leg; `DELETE` removes
it, which is the "wieder automatisch" the editor offers.

Both must refuse a leg that does not exist in the cruise's itinerary. Without
that check the table fills with rows that can never match anything, and the
user gets no error when they save into the void.

**Files:**
- Modify: `backend/src/schemas/cruise.ts` — add the override schema
- Modify: `backend/src/routes/cruises.ts` — add both endpoints
- Create: `backend/src/routes/__tests__/cruises.routeOverride.test.ts`

**Interfaces:**
- Consumes: `buildEffectivePortSequence` (`backend/src/shared/cruise/portSequence.ts`), `polylineDistanceKm` from Task 1.
- Produces: `routeOverrideSchema` exported from `backend/src/schemas/cruise.ts`, and the two HTTP endpoints below.

**HTTP contract:**

```
PUT    /api/v1/cruises/:id/route-override
       body { fromKind: "port", fromRef: "1042", toKind: "port", toRef: "1088",
              waypoints: [[lon,lat], ...] }
       201 on create, 200 on replace, body { success: true, data: <row> }
       400  invalid payload
       404  cruise not owned by the caller, or that leg is not in the itinerary

DELETE /api/v1/cruises/:id/route-override?fromKind=port&fromRef=1042&toKind=port&toRef=1088
       200 { success: true, data: { deleted: 0 | 1 } }
       404  cruise not owned by the caller
```

Deleting an override that does not exist is **not** an error — the editor's
"automatic again" button is idempotent, and a 404 there would make the UI
apologise for success.

- [ ] **Step 1: Write the failing test**

Create `backend/src/routes/__tests__/cruises.routeOverride.test.ts`. This
follows the harness of `backend/src/routes/__tests__/cruises.test.ts` —
supertest against the app, a JWT in an `auth_token` cookie, users created and
deleted around the suite. Note the fixture uses **two distinct ports**: a cruise
whose departure and arrival are the same port has a one-element sequence and
therefore no leg at all, which would make every case here vacuous.

```ts
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

const LINE: Array<[number, number]> = [
  [9.99, 53.55],
  [4.0, 52.0],
  [-9.14, 38.72],
];

describe("Cruise route overrides", () => {
  let authCookie: string;
  let userId: string;
  let otherUserId: string;
  let cruiseId: string;
  let foreignCruiseId: string;
  let fromPortId: number;
  let toPortId: number;

  const key = (): Record<string, string> => ({
    fromKind: "port",
    fromRef: String(fromPortId),
    toKind: "port",
    toRef: String(toPortId),
  });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["routeovr", "routeovrother"] } } });

    const u = await prisma.user.create({
      data: { username: "routeovr", passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    authCookie = `auth_token=${generateToken(u.id)}`;

    const other = await prisma.user.create({
      data: { username: "routeovrother", passwordHash: await hashPassword("password123") },
    });
    otherUserId = other.id;

    const ports = await prisma.port.findMany({ where: { isUserAdded: false }, take: 2 });
    if (ports.length < 2) throw new Error("need two seeded ports — run the port seeder first");
    fromPortId = ports[0].id;
    toPortId = ports[1].id;

    const c = await prisma.cruise.create({
      data: {
        userId,
        departurePortId: fromPortId,
        arrivalPortId: toPortId,
        startDate: new Date("2026-06-01"),
        endDate: new Date("2026-06-08"),
        status: "scheduled",
      },
    });
    cruiseId = c.id;

    // A REAL cruise owned by someone else. A made-up uuid would also 404 —
    // and would prove nothing about whether ownership is checked at all.
    const foreign = await prisma.cruise.create({
      data: {
        userId: otherUserId,
        departurePortId: fromPortId,
        arrivalPortId: toPortId,
        startDate: new Date("2026-06-01"),
        endDate: new Date("2026-06-08"),
        status: "scheduled",
      },
    });
    foreignCruiseId = foreign.id;
  });

  afterAll(async () => {
    await prisma.cruise.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await prisma.$disconnect();
  });

  it("stores a line for a real leg", async () => {
    const res = await request(app)
      .put(`/api/v1/cruises/${cruiseId}/route-override`)
      .set("Cookie", authCookie)
      .send({ ...key(), waypoints: LINE });
    expect(res.status).toBe(201);

    const rows = await prisma.cruiseLegRoute.findMany({ where: { cruiseId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].waypoints).toEqual(LINE);
  });

  it("replaces the line on a second write, leaving one row", async () => {
    const shorter: Array<[number, number]> = [
      [9.99, 53.55],
      [-9.14, 38.72],
    ];
    const res = await request(app)
      .put(`/api/v1/cruises/${cruiseId}/route-override`)
      .set("Cookie", authCookie)
      .send({ ...key(), waypoints: shorter });
    expect(res.status).toBe(200);

    const rows = await prisma.cruiseLegRoute.findMany({ where: { cruiseId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].waypoints).toEqual(shorter);
  });

  it("refuses a leg that is not in the itinerary", async () => {
    const before = await prisma.cruiseLegRoute.count({ where: { cruiseId } });
    const res = await request(app)
      .put(`/api/v1/cruises/${cruiseId}/route-override`)
      .set("Cookie", authCookie)
      .send({ ...key(), fromRef: String(toPortId), toRef: String(fromPortId), waypoints: LINE });
    expect(res.status).toBe(404);
    expect(await prisma.cruiseLegRoute.count({ where: { cruiseId } })).toBe(before);
  });

  it.each([
    ["one waypoint", [[9.99, 53.55]]],
    ["a latitude of 91", [[9.99, 91], [-9.14, 38.72]]],
    ["65 waypoints", Array.from({ length: 65 }, (_, i) => [i / 10, 50])],
  ])("rejects %s", async (_label, waypoints) => {
    const res = await request(app)
      .put(`/api/v1/cruises/${cruiseId}/route-override`)
      .set("Cookie", authCookie)
      .send({ ...key(), waypoints });
    expect(res.status).toBe(400);
  });

  it("will not write into another user's cruise", async () => {
    const res = await request(app)
      .put(`/api/v1/cruises/${foreignCruiseId}/route-override`)
      .set("Cookie", authCookie)
      .send({ ...key(), waypoints: LINE });
    expect(res.status).toBe(404);
    expect(await prisma.cruiseLegRoute.count({ where: { cruiseId: foreignCruiseId } })).toBe(0);
  });

  it("clears the line, and clearing again is not an error", async () => {
    const first = await request(app)
      .delete(`/api/v1/cruises/${cruiseId}/route-override`)
      .query(key())
      .set("Cookie", authCookie);
    expect(first.status).toBe(200);
    expect(first.body.data.deleted).toBe(1);

    const second = await request(app)
      .delete(`/api/v1/cruises/${cruiseId}/route-override`)
      .query(key())
      .set("Cookie", authCookie);
    expect(second.status).toBe(200);
    expect(second.body.data.deleted).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_cruise" npm test -- --forceExit src/routes/__tests__/cruises.routeOverride.test.ts`
Expected: FAIL — 404 on every call, because the routes do not exist yet.

- [ ] **Step 3: Add the Zod schema**

In `backend/src/schemas/cruise.ts`, append:

```ts
/** One `[lon, lat]` pair, in GeoJSON order. */
const waypointSchema = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);

/**
 * A hand-corrected line for one leg.
 *
 * The endpoint refs are strings because the column is `kind` + `ref`, ready for
 * a place id (a uuid) alongside a port id (an integer) — see the model's own
 * doc comment. Today only `port` is written.
 *
 * The 64-point ceiling is a storage guard, not a UX limit: the router emits
 * 3–8 waypoints and a person correcting a line by hand adds a handful more.
 */
export const routeOverrideSchema = z.object({
  fromKind: z.literal("port"),
  fromRef: z.string().min(1).max(64),
  toKind: z.literal("port"),
  toRef: z.string().min(1).max(64),
  waypoints: z.array(waypointSchema).min(2).max(64),
});

export type RouteOverrideInput = z.infer<typeof routeOverrideSchema>;

/** Query form of the endpoint key, for DELETE. */
export const routeOverrideKeySchema = routeOverrideSchema.omit({ waypoints: true });
```

- [ ] **Step 4: Add both endpoints**

In `backend/src/routes/cruises.ts`, import the new schemas alongside the
existing ones, and add a helper plus the two routes. Place them **before** the
`router.get('/:id', ...)` handler if one exists, so `route-override` is never
matched as an `:id`.

```ts
/**
 * Is `from → to` an actual leg of this cruise's itinerary?
 *
 * Checked on every write. Without it the table accepts lines for legs that do
 * not exist, which can never match anything on read — the user would see a
 * silent no-op instead of an error.
 */
async function legExists(
  cruiseId: string,
  userId: string,
  fromRef: string,
  toRef: string,
): Promise<boolean> {
  const cruise = await prisma.cruise.findFirst({
    where: { id: cruiseId, userId },
    include: {
      departurePort: true,
      arrivalPort: true,
      stops: { where: { isAtSea: false, portId: { not: null } }, orderBy: { dayNumber: 'asc' }, include: { port: true } },
    },
  });
  if (!cruise) return false;

  const portCalls = cruise.stops
    .filter((s): s is typeof s & { port: NonNullable<typeof s.port> } => s.port !== null)
    .map((s) => s.port);
  const sequence = buildEffectivePortSequence(cruise.departurePort, portCalls, cruise.arrivalPort);

  for (let i = 1; i < sequence.length; i++) {
    if (String(sequence[i - 1].id) === fromRef && String(sequence[i].id) === toRef) return true;
  }
  return false;
}

router.put('/:id/route-override', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const parsed = routeOverrideSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);
    const { fromKind, fromRef, toKind, toRef, waypoints } = parsed.data;

    if (!(await legExists(req.params.id, userId, fromRef, toRef))) {
      throw new AppError('Cruise or leg not found', 404);
    }

    const key = { cruiseId: req.params.id, fromKind, fromRef, toKind, toRef };
    const existing = await prisma.cruiseLegRoute.findUnique({
      where: { cruiseId_fromKind_fromRef_toKind_toRef: key },
      select: { id: true },
    });

    const row = await prisma.cruiseLegRoute.upsert({
      where: { cruiseId_fromKind_fromRef_toKind_toRef: key },
      create: { ...key, waypoints: waypoints as unknown as Prisma.InputJsonValue },
      update: { waypoints: waypoints as unknown as Prisma.InputJsonValue },
    });

    await recomputeLegsForCruise(req.params.id);

    logger.info({
      operation: 'cruise_route_override_saved',
      cruiseId: req.params.id,
      userId,
      fromRef,
      toRef,
      waypoints: waypoints.length,
      replaced: existing !== null,
    });

    res.status(existing ? 200 : 201).json({ success: true, data: row });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/route-override', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const parsed = routeOverrideKeySchema.safeParse(req.query);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);

    const owned = await prisma.cruise.findFirst({
      where: { id: req.params.id, userId },
      select: { id: true },
    });
    if (!owned) throw new AppError('Cruise not found', 404);

    const { count } = await prisma.cruiseLegRoute.deleteMany({
      where: { cruiseId: req.params.id, ...parsed.data },
    });

    await recomputeLegsForCruise(req.params.id);

    logger.info({
      operation: 'cruise_route_override_cleared',
      cruiseId: req.params.id,
      userId,
      fromRef: parsed.data.fromRef,
      toRef: parsed.data.toRef,
      deleted: count,
    });

    res.json({ success: true, data: { deleted: count } });
  } catch (err) {
    next(err);
  }
});
```

Note that both handlers call `recomputeLegsForCruise` — the stored kilometres
must follow the line immediately, not at the next unrelated edit. Task 3 makes
that recompute actually read the override; until then the call is a no-op for
distance, and that is fine.

- [ ] **Step 5: Run it and watch it pass**

Run the same command as step 2.
Expected: PASS, every case.

- [ ] **Step 6: Gate and commit**

```bash
cd backend && npx tsc --noEmit && npm run lint
```

```bash
git add backend/src/schemas/cruise.ts backend/src/routes/cruises.ts \
        backend/src/routes/__tests__/cruises.routeOverride.test.ts
git commit -m "feat(cruise): store and clear a hand-corrected leg route"
```

---

### Task 3: The distance follows the line

This is the task the whole plan exists for. Geometry is not persisted; distance
is. If `recomputeLegsForCruise` does not consult the override, the next router
version bump resets the kilometres to the router's value **while the map keeps
the user's line** — and nothing fails, so nobody notices.

**Files:**
- Modify: `backend/src/services/cruiseDistance/cruiseLegService.ts`
- Create: `backend/src/services/cruiseDistance/__tests__/cruiseLegService.override.test.ts`

**Interfaces:**
- Consumes: `polylineDistanceKm` (Task 1), the `CruiseLegRoute` model (Task 1).
- Produces: no new exports. `recomputeLegsForCruise` keeps its signature `(cruiseId: string, tx?: Prisma.TransactionClient) => Promise<number>`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/services/cruiseDistance/__tests__/cruiseLegService.override.test.ts`. This talks to Prisma directly — no HTTP — so it needs no auth harness, only a user, two ports and a cruise.

```ts
import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { recomputeLegsForCruise } from "../cruiseLegService";
import { polylineDistanceKm } from "../polylineDistance";

// A deliberate detour: far longer than any sensible route between the two
// ports, so a distance that came from the router is unmistakable.
const DETOUR: Array<[number, number]> = [
  [9.99, 53.55],
  [-30.0, 50.0],
  [-30.0, 20.0],
  [-9.14, 38.72],
];

describe("recomputeLegsForCruise with a hand-drawn route", () => {
  let userId: string;
  let cruiseId: string;
  let fromPortId: number;
  let toPortId: number;

  const legRow = async () =>
    prisma.cruiseLeg.findFirst({ where: { cruiseId }, orderBy: { ordinal: "asc" } });

  const writeOverride = async (waypoints: Array<[number, number]>) =>
    prisma.cruiseLegRoute.create({
      data: {
        cruiseId,
        fromKind: "port",
        fromRef: String(fromPortId),
        toKind: "port",
        toRef: String(toPortId),
        waypoints,
      },
    });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "legoverride" } });
    const u = await prisma.user.create({
      data: { username: "legoverride", passwordHash: await hashPassword("password123") },
    });
    userId = u.id;

    const ports = await prisma.port.findMany({ where: { isUserAdded: false }, take: 2 });
    if (ports.length < 2) throw new Error("need two seeded ports — run the port seeder first");
    fromPortId = ports[0].id;
    toPortId = ports[1].id;

    const c = await prisma.cruise.create({
      data: {
        userId,
        departurePortId: fromPortId,
        arrivalPortId: toPortId,
        startDate: new Date("2026-06-01"),
        endDate: new Date("2026-06-08"),
        status: "scheduled",
      },
    });
    cruiseId = c.id;
  });

  afterEach(async () => {
    await prisma.cruiseLegRoute.deleteMany({ where: { cruiseId } });
  });

  afterAll(async () => {
    await prisma.cruise.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("uses the router when there is no override", async () => {
    await recomputeLegsForCruise(cruiseId);
    const leg = await legRow();
    expect(leg).not.toBeNull();
    expect(leg?.method).not.toBe("manual_polyline");
  });

  it("uses the drawn line's length when there is one", async () => {
    await writeOverride(DETOUR);
    await recomputeLegsForCruise(cruiseId);
    const leg = await legRow();
    expect(leg?.method).toBe("manual_polyline");
    expect(leg?.distanceKm).toBeCloseTo(polylineDistanceKm(DETOUR), 2);
  });

  it("keeps the drawn line across repeated recomputes — the version-bump invariant", async () => {
    await writeOverride(DETOUR);
    await recomputeLegsForCruise(cruiseId);
    const first = await legRow();

    // This is what a routerVersion / ORCHESTRATOR_VERSION bump does. It must
    // not quietly return the kilometres to the router's value while the map
    // still shows the user's line.
    await recomputeLegsForCruise(cruiseId);
    await recomputeLegsForCruise(cruiseId);

    const third = await legRow();
    expect(third?.distanceKm).toBeCloseTo(first?.distanceKm ?? -1, 6);
    expect(third?.method).toBe("manual_polyline");
    expect(await prisma.cruiseLegRoute.count({ where: { cruiseId } })).toBe(1);
  });

  it("returns to the router once the override is gone", async () => {
    await writeOverride(DETOUR);
    await recomputeLegsForCruise(cruiseId);
    expect((await legRow())?.method).toBe("manual_polyline");

    await prisma.cruiseLegRoute.deleteMany({ where: { cruiseId } });
    await recomputeLegsForCruise(cruiseId);
    expect((await legRow())?.method).not.toBe("manual_polyline");
  });

  it("ignores an override whose endpoints match no leg", async () => {
    await prisma.cruiseLegRoute.create({
      data: {
        cruiseId,
        fromKind: "port",
        fromRef: String(toPortId),
        toKind: "port",
        toRef: String(fromPortId),
        waypoints: DETOUR,
      },
    });
    await recomputeLegsForCruise(cruiseId);
    expect((await legRow())?.method).not.toBe("manual_polyline");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_cruise" npm test -- --forceExit src/services/cruiseDistance/__tests__/cruiseLegService.override.test.ts`
Expected: FAIL — the override case gets the router's distance, because nothing reads the table yet.

- [ ] **Step 3: Teach the recompute to look first**

In `backend/src/services/cruiseDistance/cruiseLegService.ts`, add the import:

```ts
import { polylineDistanceKm } from "./polylineDistance";
```

Load the cruise's overrides alongside the cruise and its stops — add a third
promise to the existing `Promise.all`:

```ts
    client.cruiseLegRoute.findMany({
      where: { cruiseId },
      select: { fromKind: true, fromRef: true, toKind: true, toRef: true, waypoints: true },
    }),
```

Build a lookup keyed the same way the rows are, and use it in the leg loop.
Replace the body of the `for` loop with:

```ts
  // A hand-corrected line wins over the router, and keeps winning: this lookup
  // is why a routerVersion bump cannot silently reset the user's kilometres
  // while the map still shows their line (spec §6, "The trap").
  const overrideByLeg = new Map<string, Array<[number, number]>>();
  for (const o of overrides) {
    if (!Array.isArray(o.waypoints)) continue;
    overrideByLeg.set(`${o.fromKind}:${o.fromRef}:${o.toKind}:${o.toRef}`, o.waypoints as Array<[number, number]>);
  }

  const rows: Prisma.CruiseLegCreateManyInput[] = [];
  for (let i = 1; i < sequence.length; i++) {
    const from = sequence[i - 1];
    const to = sequence[i];

    const manual = overrideByLeg.get(`port:${from.id}:port:${to.id}`);
    if (manual && manual.length >= 2) {
      rows.push({
        cruiseId,
        ordinal: i - 1,
        fromPortId: from.id,
        toPortId: to.id,
        distanceKm: polylineDistanceKm(manual),
        // A first-class method, not a faked router result: anything reading
        // cruise_legs can tell a drawn line from a computed one.
        method: "manual_polyline",
        routerVersion: ORCHESTRATOR_VERSION,
        dataVersion: null,
        confidence: "high",
        notes: null,
      });
      continue;
    }

    const computed = await computeLegDistance(from, to);
    rows.push({
      cruiseId,
      ordinal: i - 1,
      fromPortId: from.id,
      toPortId: to.id,
      distanceKm: computed.distanceKm,
      method: computed.method,
      routerVersion: computed.routerVersion,
      dataVersion: computed.dataVersion,
      confidence: computed.confidence,
      notes: computed.notes,
    });
  }
```

Change the destructuring line from

```ts
  const [cruise, stops] = await Promise.all([
```

to

```ts
  const [cruise, stops, overrides] = await Promise.all([
```

Note what is **not** here: no `deleteMany` on `cruiseLegRoute`. The existing
`deleteMany` on `cruiseLeg` stays exactly as it is — legs are derived and get
rebuilt, overrides are the user's input and are never touched by a recompute.

- [ ] **Step 4: Run it and watch it pass**

Run the same command as step 2.
Expected: PASS, every case — in particular the third-recompute one.

- [ ] **Step 5: Gate and commit**

```bash
cd backend && npx tsc --noEmit && npm run lint
```

```bash
git add backend/src/services/cruiseDistance/cruiseLegService.ts \
        backend/src/services/cruiseDistance/__tests__/cruiseLegService.override.test.ts
git commit -m "feat(cruise): a drawn route keeps its kilometres across a recompute"
```

---

### Task 4: The map draws what the user drew

The geometry endpoint currently asks the router for every leg. It must return
the stored line instead when one exists — otherwise the distance and the drawn
route come from two different places, which is the disagreement this whole
stage is built to prevent.

**Files:**
- Modify: `backend/src/routes/cruises.ts` — `buildCruiseGeometry` and the two queries that feed it
- Create: `backend/src/routes/__tests__/cruises.geometryOverride.test.ts`

**Interfaces:**
- Consumes: the `CruiseLegRoute` model.
- Produces: the geometry FeatureCollection gains no new field. An overridden leg is identified by its existing `properties.method === "manual_polyline"` and `properties.routed === false`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/routes/__tests__/cruises.geometryOverride.test.ts`, same harness as Task 2's test.

```ts
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

const LINE: Array<[number, number]> = [
  [9.99, 53.55],
  [2.5, 51.0],
  [-9.14, 38.72],
];

describe("Cruise geometry honours a stored route", () => {
  let authCookie: string;
  let userId: string;
  let cruiseId: string;
  let fromPortId: number;
  let toPortId: number;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "geomovr" } });
    const u = await prisma.user.create({
      data: { username: "geomovr", passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    authCookie = `auth_token=${generateToken(u.id)}`;

    const ports = await prisma.port.findMany({ where: { isUserAdded: false }, take: 2 });
    if (ports.length < 2) throw new Error("need two seeded ports — run the port seeder first");
    fromPortId = ports[0].id;
    toPortId = ports[1].id;

    const c = await prisma.cruise.create({
      data: {
        userId,
        departurePortId: fromPortId,
        arrivalPortId: toPortId,
        startDate: new Date("2026-06-01"),
        endDate: new Date("2026-06-08"),
        status: "scheduled",
      },
    });
    cruiseId = c.id;
  });

  afterEach(async () => {
    await prisma.cruiseLegRoute.deleteMany({ where: { cruiseId } });
  });

  afterAll(async () => {
    await prisma.cruise.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  const storeLine = async (): Promise<void> => {
    await prisma.cruiseLegRoute.create({
      data: {
        cruiseId,
        fromKind: "port",
        fromRef: String(fromPortId),
        toKind: "port",
        toRef: String(toPortId),
        waypoints: LINE,
      },
    });
  };

  it("asks the router when nothing is stored", async () => {
    const res = await request(app)
      .get(`/api/v1/cruises/${cruiseId}/geometry`)
      .set("Cookie", authCookie);
    expect(res.status).toBe(200);
    expect(res.body.data.features[0].properties.method).not.toBe("manual_polyline");
  });

  it("returns the stored line verbatim", async () => {
    await storeLine();
    const res = await request(app)
      .get(`/api/v1/cruises/${cruiseId}/geometry`)
      .set("Cookie", authCookie);
    const f = res.body.data.features[0];
    // Deep equality on purpose: a length check would pass even if the
    // coordinates came back as [lat, lon].
    expect(f.geometry.coordinates).toEqual(LINE);
    expect(f.properties.method).toBe("manual_polyline");
    expect(f.properties.routed).toBe(false);
  });

  it("returns it from the batch endpoint too", async () => {
    await storeLine();
    const res = await request(app)
      .post("/api/v1/cruises/geometry/batch")
      .set("Cookie", authCookie)
      .send({ ids: [cruiseId] });
    expect(res.status).toBe(200);
    // The batch route has its own Prisma query. An override honoured by one
    // endpoint and not the other is exactly the drift this case exists for.
    expect(res.body.data[cruiseId].features[0].geometry.coordinates).toEqual(LINE);
    expect(res.body.data[cruiseId].features[0].properties.method).toBe("manual_polyline");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_cruise" npm test -- --forceExit src/routes/__tests__/cruises.geometryOverride.test.ts`
Expected: FAIL — the coordinates come from the router, not the stored line.

- [ ] **Step 3: Feed the overrides into the builder**

In `backend/src/routes/cruises.ts`, extend the input type:

```ts
interface CruiseGeometryInput {
  stops: CruiseStopWithPort[];
  departurePort: PortRow | null;
  arrivalPort: PortRow | null;
  legRoutes?: Array<{
    fromKind: string;
    fromRef: string;
    toKind: string;
    toRef: string;
    waypoints: unknown;
  }>;
}
```

Inside `buildCruiseGeometry`, before the loop:

```ts
  // The stored line wins. It has to be the same source the distance came from
  // (services/cruiseDistance/cruiseLegService.ts), or the map and the
  // statistics would quietly disagree.
  const overrideByLeg = new Map<string, [number, number][]>();
  for (const o of cruise.legRoutes ?? []) {
    if (!Array.isArray(o.waypoints)) continue;
    overrideByLeg.set(`${o.fromKind}:${o.fromRef}:${o.toKind}:${o.toRef}`, o.waypoints as [number, number][]);
  }
```

and at the top of the loop body, before `computeSchematicRoute`:

```ts
    const manual = overrideByLeg.get(`port:${a.id}:port:${b.id}`);
    if (manual && manual.length >= 2) {
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: manual },
        properties: {
          fromPortId: a.id,
          toPortId: b.id,
          routed: false,
          protectedPrefixCount: 0,
          protectedSuffixCount: 0,
          method: 'manual_polyline',
        },
      });
      directLegs++;
      continue;
    }
```

Then widen the `method` union on `GeometryFeature` to include
`'manual_polyline'`.

Finally, add `legRoutes: true` to the `include` of **both** queries that feed
`buildCruiseGeometry` — the one in `router.get('/:id/geometry')` and the one in
`router.post('/geometry/batch')`. Missing one is the defect the batch test above
is there to catch.

- [ ] **Step 4: Run it and watch it pass**

Run the same command as step 2.
Expected: PASS, all three cases.

- [ ] **Step 5: Full gate and commit**

```bash
cd backend && npx tsc --noEmit && npm run lint
cd backend && DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_cruise" npm test -- --forceExit
```

```bash
git add backend/src/routes/cruises.ts backend/src/routes/__tests__/cruises.geometryOverride.test.ts
git commit -m "feat(cruise): the geometry endpoint returns the line the user drew"
```

---

## Done when

- [ ] A `PUT` stores a line for a real leg, a second `PUT` replaces it, and a leg that is not in the itinerary is refused with 404.
- [ ] A cruise belonging to another user cannot be written to — proven against a real second user's real cruise, not a made-up id.
- [ ] After storing an override, `GET /:id/geometry` **and** `POST /geometry/batch` both return exactly those coordinates, with `method: "manual_polyline"`.
- [ ] That leg's `cruise_legs.distanceKm` equals the polyline's length, and stays there across three consecutive recomputes — the invariant a router version bump has to respect.
- [ ] Clearing the override returns both the line and the distance to the router's, and clearing twice is not an error.
- [ ] `npx tsc --noEmit` and `npm run lint` clean; the new test files green. A failure in an unrelated backend test file is the known environment flake — report it, do not chase it.

## Not in this plan

The map editor — the "Route bearbeiten" button, the draggable handles, the
guide line, insert-on-click, undo, the keyboard affordances — is **stage 2b**
and gets its own plan, built directly on the two endpoints above. Excursions,
`CruisePlace`, the fourth stop state and the generic leg endpoints are stages 3
to 5. Do not start any of them here.
