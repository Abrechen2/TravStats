# Tour routing providers — Phase 3 implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A leg's geometry can come from a real road router, and the operator chooses which router — a keyed service, or their own machine — while the traveller chooses per leg.

**Architecture:** One `RouteProvider` interface with three implementations (OpenRouteService, GraphHopper, and a keyless custom base URL for a self-hosted OSRM/Valhalla). A resolver picks the configured one. The existing `source` column gains the value `routed`; nothing migrates. A provider failure falls back to the straight chord with `confidence: low` — never a fabricated number.

**Tech Stack:** Express + TypeScript, Prisma/PostgreSQL, Zod, Jest + supertest; React + Vite, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-29-tour-route-sections-design.md` §7.2 (revised 2026-08-29)

**This plan is Phase 3 only.** Phase 3b (GPX import, `TripRouteTrack`, leg adoption from a track) is an independent subsystem and gets its own plan — either can ship first. Phase 1 is complete and merged into the branch `dev/tour-routes`.

## Global Constraints

- `any` is FORBIDDEN. Use `unknown` plus type guards. Exception: `.d.ts` only.
- No `console.log`. `import logger from '../utils/logger'` — DEFAULT export.
- Zod at every system boundary; schemas in `backend/src/schemas/`.
- Prisma JSON writes cast via `as unknown as Prisma.InputJsonValue`; clear with `Prisma.DbNull`.
- Schema changes via Prisma migration tooling, additive only.
- File size: 200–400 lines ideal, **800 hard maximum**. `backend/src/routes/trips.ts` is ~1400 lines — add nothing to it.
- Frontend copy: German primary, English mirrored **in the same change**. `useTranslation` from the project wrapper, never `react-i18next`.
- `react-hooks/exhaustive-deps` is **disabled** repo-wide — every dependency array is hand-checked.
- Every new endpoint needs an OpenAPI entry or `openapi.coverage.test.ts` fails. Never add an exclusion.
- Never `git commit --amend`. Write files with a plain file write, never a heredoc that interprets escapes; verify `python -c "import io; print(io.open('<path>','rb').read().count(b'\x00'))"` → 0.
- Branch `dev/tour-routes`. Never commit to `main`.

**Test commands** (worktree root `D:/TravStats_Projekt/TravStats/.worktrees/camper-v1`):

```bash
cd backend && DATABASE_URL="postgresql://flights_dev:dev_password_change_me_123@localhost:5433/flights_tourroutes?connection_limit=5" npx jest <path> --forceExit
cd backend && npx tsc --noEmit && npm run lint
cd frontend && npx vitest --run && npx tsc --noEmit && npm run lint
```
The `?connection_limit=5` is not optional. The full backend suite needs
`NODE_OPTIONS=--max-old-space-size=8192` or it dies of heap exhaustion — and note
that a trailing pipe masks jest's exit code, so capture it explicitly.

**Known pre-existing red on this base, not yours to fix:** `lodging.test.ts` (a
40P01 deadlock in its own cleanup), `lodgingFxSource.test.ts` (cross-suite
interference only — green alone) and one case in `lodgingParseRoutes.test.ts` (a
real Ollama parse exceeding the 30 s jest timeout). All three were reproduced on
the base commit. Do not "fix" them.

---

## What exists already, measured

| Fact | Where |
|---|---|
| `source` is a column with four values; `routed`/`track` are REJECTED at the boundary by a separate `PHASE_1_SOURCES` enum | `backend/src/schemas/tour.ts` |
| `LEG_SOURCES` / `LEG_MODES` are the shared vocabulary | `backend/src/services/tour/tourDistance.ts` |
| `legDistanceKm` throws on a non-finite coordinate, falls back to the chord for a zero-length line | same file |
| Leg rows are keyed by endpoint stop pair, and a surviving pair keeps its stored geometry | `backend/src/shared/tour/legPlan.ts`, `services/tour/legRecompute.ts` |
| The leg override endpoint already writes `waypoints` + `distanceKm` + `confidence` | `backend/src/routes/trips/tourLegs.ts` |
| Key chain: `getApiKey(provider, userId?)` → user key → admin global → ENV | `backend/src/services/apiKeyResolver.ts` |
| `ApiProvider` is a closed union of 8 providers | same file |
| One `testXKey(apiKey, userId?)` per provider returning `ApiKeyTestResult` | `backend/src/services/apiKeyTester.ts` |
| Settings API: `GET /`, `PUT /`, `POST /test/<provider>` | `backend/src/routes/settings/apiKeys.ts` |
| The leg source control already offers only what the leg can do (`drawn` needs a stored line) | `frontend/src/components/Trips/TourLegList.tsx` |

## File structure

| File | Responsibility |
|---|---|
| `backend/src/services/tour/routing/types.ts` | `RouteProvider`, `RouteRequest`, `RouteResult`, profile mapping |
| `backend/src/services/tour/routing/openRouteService.ts` | ORS adapter |
| `backend/src/services/tour/routing/graphHopper.ts` | GraphHopper adapter |
| `backend/src/services/tour/routing/customOsrm.ts` | keyless custom base URL (OSRM/Valhalla shape) |
| `backend/src/services/tour/routing/resolveProvider.ts` | picks the configured provider, or `null` |
| `backend/src/services/tour/routing/routeLeg.ts` | one leg → geometry + distance, with the fallback rule |
| `backend/src/routes/trips/tourLegs.ts` | accepts `source: "routed"`; new `POST …/route-all` |
| `backend/src/schemas/tour.ts` | `routed` allowed; routing settings schema |
| `frontend/src/components/Settings/RoutingProviderSection.tsx` | operator picks the provider |
| `frontend/src/components/Trips/TourLegList.tsx` | offers `routed` only when a provider exists |

---

## Task 1: Provider interface and profile mapping (pure)

**Files:**
- Create: `backend/src/services/tour/routing/types.ts`
- Test: `backend/src/services/tour/routing/__tests__/types.test.ts`

**Interfaces:**
- Consumes: `LegMode` from `services/tour/tourDistance.ts`.
- Produces:
  ```ts
  export interface RouteRequest { from: Coord; to: Coord; mode: LegMode }
  export interface RouteResult { waypoints: Array<[number, number]>; distanceKm: number; drivingMinutes: number | null }
  export interface RouteProvider { readonly id: RoutingProviderId; route(req: RouteRequest): Promise<RouteResult | null> }
  export const ROUTING_PROVIDER_IDS = ["openrouteservice", "graphhopper", "custom"] as const;
  export type RoutingProviderId = (typeof ROUTING_PROVIDER_IDS)[number];
  export function isRoutableMode(mode: LegMode): boolean;
  ```

- [ ] **Step 1: Write the failing test**

Create `backend/src/services/tour/routing/__tests__/types.test.ts`:

```ts
import { isRoutableMode, ROUTING_PROVIDER_IDS } from "../types";

describe("isRoutableMode", () => {
  it("routes the three modes a road router understands", () => {
    expect(isRoutableMode("road")).toBe(true);
    expect(isRoutableMode("foot")).toBe(true);
    expect(isRoutableMode("bike")).toBe(true);
  });

  it("never routes a ferry or a train", () => {
    // A ferry crosses water no road router knows, and a train follows track
    // the traveller does not choose. Asking a road router for either returns
    // a plausible road detour — a wrong number that looks right.
    expect(isRoutableMode("ferry")).toBe(false);
    expect(isRoutableMode("rail")).toBe(false);
  });
});

describe("ROUTING_PROVIDER_IDS", () => {
  it("lists exactly the three shipped providers", () => {
    expect([...ROUTING_PROVIDER_IDS]).toEqual(["openrouteservice", "graphhopper", "custom"]);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd backend && npx jest src/services/tour/routing/__tests__/types.test.ts --forceExit
```
Expected: FAIL — `Cannot find module '../types'`.

- [ ] **Step 3: Implement**

Create `backend/src/services/tour/routing/types.ts` with the interfaces from the
Interfaces block. `isRoutableMode` returns true only for `road`, `foot` and
`bike`, with a comment giving the reason above. Add a `PROFILE_BY_MODE` map for
adapters to translate into their own vocabulary — note that a motorhome is not a
car, so the road profile is the heavy-vehicle one where a provider offers it.

- [ ] **Step 4: Run the tests, then commit**

```bash
cd backend && npx jest src/services/tour/routing/__tests__/types.test.ts --forceExit
git add backend/src/services/tour/routing && git commit -m "feat(tours): routing provider interface and profile mapping"
```

---

## Task 2: The three adapters

**Files:**
- Create: `backend/src/services/tour/routing/openRouteService.ts`, `graphHopper.ts`, `customOsrm.ts`
- Test: `backend/src/services/tour/routing/__tests__/adapters.test.ts`

**Interfaces:**
- Produces: `createOpenRouteService(apiKey: string, fetchImpl?: typeof fetch): RouteProvider`, and the same shape for `createGraphHopper(apiKey, fetchImpl?)` and `createCustomOsrm(baseUrl, fetchImpl?)`.

**Why the injected `fetchImpl`:** these tests must never touch the network. Inject
a stub; do not mock the global.

- [ ] **Step 1: Write the failing test**

Cover, for EACH adapter:
1. a successful response is decoded into `{waypoints, distanceKm, drivingMinutes}` with `[lon, lat]` order preserved;
2. a non-200 response returns `null` (never throws, never a partial result);
3. a 200 with a malformed body returns `null` — parse with a type guard, do not trust the shape;
4. the request URL and body contain the mapped profile for the leg's mode.

Write real fixture bodies. For ORS use its GeoJSON directions shape
(`features[0].geometry.coordinates`, `features[0].properties.summary.distance` in
metres and `.duration` in seconds); for GraphHopper its `paths[0].points`
(encoded polyline unless `points_encoded=false` — request `false` so no decoder is
needed) with `distance`/`time`; for OSRM `routes[0].geometry.coordinates` with
`distance`/`duration`. Verify each against the provider's current docs before
writing the fixture — if a shape has changed, follow the docs and say so in your
report.

- [ ] **Step 2: Run and see it fail**
- [ ] **Step 3: Implement all three**

Each adapter: build the URL, call `fetchImpl`, guard the JSON with an explicit
type guard (no `any`, no cast), convert metres → km and seconds → minutes, and
return `null` on any failure. Log a warning with the provider id and the HTTP
status; never log the key.

- [ ] **Step 4: Run the tests, tsc, lint, commit**

---

## Task 3: Settings — columns, key chain, tester

**Files:**
- Modify: `backend/prisma/schema.prisma` (+ migration), `backend/src/services/apiKeyResolver.ts`, `backend/src/services/apiKeyTester.ts`, `backend/src/routes/settings/apiKeys.ts`, `backend/src/schemas/tour.ts`
- Test: `backend/src/routes/__tests__/routingSettings.test.ts`

**Interfaces:**
- Produces: `ApiProvider` gains `'openrouteservice' | 'graphhopper'`; `admin_settings` gains `routing_provider` (nullable text) and `routing_custom_url` (nullable text); user and admin settings gain the two key columns following the existing naming (`openrouteserviceApiKey` / `globalOpenrouteserviceApiKey`, same for graphhopper).

- [ ] **Step 1: Confirm the migration history is clean**

```bash
cd backend && ./node_modules/.bin/prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --script
```
Expected: an empty migration. If not, STOP and report.

- [ ] **Step 2: Add the columns and generate the migration**

Use `./node_modules/.bin/prisma` — `npx prisma` resolves a wrong major version
here. If `migrate dev` cannot run non-interactively, generate the SQL with
`migrate diff --script` against an explicit shadow database and apply it with
`migrate deploy`, then prove equivalence by re-running the Step-1 diff and getting
an empty result. The migration must be additive only: no `DROP`, no `UPDATE`.

- [ ] **Step 3: Extend the key chain and the tester**

Add the two providers to the `ApiProvider` union and to every `select` in
`getApiKey`. Add `testOpenRouteServiceKey` and `testGraphHopperKey` to
`apiKeyTester.ts` following the shape of the existing ones (a cheap real request,
a clear message on failure), and the matching `POST /test/openrouteservice` and
`POST /test/graphhopper` routes in `settings/apiKeys.ts`.

The **custom** provider has no key: it is a URL on `admin_settings` only, and it
must NOT go through the key chain. Validate it with Zod as an http/https URL.
Deliberately place **no** egress restriction on it — a self-hosted router lives on
the LAN, exactly as `normalizeImmichBaseUrl` documents for Immich. Copy that
reasoning into a comment so nobody "hardens" it into uselessness.

- [ ] **Step 4: Test**

Cover: the resolver returns a user key over a global one; the custom URL is
rejected when malformed; a private-IP custom URL is ACCEPTED (that is the point);
and the admin settings round-trip through `GET`/`PUT`.

- [ ] **Step 5: tsc, lint, commit**

---

## Task 4: Resolve the configured provider

**Files:**
- Create: `backend/src/services/tour/routing/resolveProvider.ts`
- Test: `backend/src/services/tour/routing/__tests__/resolveProvider.test.ts`

**Interfaces:**
- Produces: `resolveRouteProvider(userId?: string): Promise<RouteProvider | null>` and `describeRoutingAvailability(): Promise<{ configured: boolean; providerId: RoutingProviderId | null }>`.

- [ ] **Step 1: Write the failing test**

Cover: no provider configured → `null`; `routing_provider = "openrouteservice"`
with a key → an ORS provider; the same with NO key → `null` (a selected provider
without credentials is not configured); `routing_provider = "custom"` with a URL →
the custom adapter and no key lookup at all.

That third case is the one that matters: a half-configured provider must read as
unavailable, so the UI disables the option instead of offering a control that
always fails.

- [ ] **Step 2: Run and see it fail**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run, tsc, lint, commit**

---

## Task 5: Route one leg, with the fallback rule

**Files:**
- Create: `backend/src/services/tour/routing/routeLeg.ts`
- Test: `backend/src/services/tour/routing/__tests__/routeLeg.test.ts`

**Interfaces:**
- Consumes: `RouteProvider`, `legDistanceKm`, `isRoutableMode`.
- Produces:
  ```ts
  export interface RoutedLeg { waypoints: Array<[number, number]> | null; distanceKm: number; source: "routed" | "straight"; confidence: "high" | "low"; drivingMinutes: number | null }
  export async function routeLegGeometry(provider: RouteProvider | null, input: { from: Coord; to: Coord; mode: LegMode }): Promise<RoutedLeg>;
  ```

- [ ] **Step 1: Write the failing test**

Cover, and be strict about each:
1. a provider returning a route → `source: "routed"`, `confidence: "high"`, the provider's distance;
2. a provider returning `null` → `source: "straight"`, `confidence: "low"`, the chord distance — **never** a fabricated number and never a throw;
3. `provider === null` → the same straight fallback;
4. a non-routable mode (`ferry`, `rail`) → straight fallback WITHOUT calling the provider — assert the stub was not called;
5. a provider returning a line whose ends are far from the requested endpoints → rejected, straight fallback. A router that answers about a different place is worse than one that does not answer. Reuse the 1 km anchor tolerance the hand-drawn path already uses.

Case 5 is the one no provider documentation warns you about and the one that
silently draws a route through the wrong country.

- [ ] **Step 2: Run and see it fail**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run, tsc, lint, commit**

---

## Task 6: Endpoints — accept `routed`, and route a whole section

**Files:**
- Modify: `backend/src/schemas/tour.ts`, `backend/src/routes/trips/tourLegs.ts`
- Create: `backend/src/services/openapi/paths/` entry for the new route
- Test: `backend/src/routes/__tests__/tourRoutes.routed.test.ts`

**Interfaces:**
- Produces: `legOverrideSchema` accepts `source: "routed"`; `POST /trips/:id/routes/:routeId/route-all` → `{ route, legs, routedCount, skippedCount }`.

- [ ] **Step 1: Write the failing test**

Cover: a single leg set to `routed` stores the provider's geometry and distance;
with no provider configured the request is refused with **409** and a message
saying routing is not configured (not 400 — the caller's request is fine, the
instance is not equipped); `route-all` routes every routable leg and reports how
many it skipped; a ferry leg inside a road section is skipped, not routed; and a
provider failure leaves the leg as a straight chord with `confidence: low` while
still returning 200 with an honest count.

- [ ] **Step 2: Run and see it fail**
- [ ] **Step 3: Implement**

Widen `PHASE_1_SOURCES` to include `routed` — rename it, since the name will now
be a lie; `ACCEPTED_LEG_SOURCES` says what it is. Leave `track` rejected: phase 3b
owns it, and a source the server cannot produce must not be storable.

- [ ] **Step 4: OpenAPI entry, coverage guard, tsc, lint, commit**

```bash
cd backend && npx jest openapi --forceExit
```

---

## Task 7: Frontend — the operator chooses, the traveller chooses

**Files:**
- Create: `frontend/src/components/Settings/RoutingProviderSection.tsx` + test
- Modify: `frontend/src/components/Trips/TourLegList.tsx` + its test, `frontend/src/lib/api/tours.ts`, `frontend/src/types/tour.ts`
- Modify: the settings page that hosts provider cards (find it; follow its layout)

- [ ] **Step 1: Write the failing tests**

For the settings section: choosing a provider shows the field that provider needs
(a key for the two services, a URL for custom) and hides the others; the test
button reports success and failure distinctly.

For `TourLegList`: `routed` is offered when routing is available; it is **disabled
with a reason** when it is not; and a non-routable leg (`ferry`, `rail`) never
offers it at all. Assertions use raw i18n keys, not German text.

- [ ] **Step 2: Run and see them fail**
- [ ] **Step 3: Implement**

The availability flag comes from the API, not from guessing — extend the tour
endpoints' response or add a small `GET /settings/routing/availability`; pick one
and say which in your report.

- [ ] **Step 4: Run the full frontend suite, tsc, lint, `vite build`, commit**

---

## Task 8: Copy, in both languages

**Files:** `frontend/src/i18n/resources/de/*.json`, `en/*.json`

- [ ] **Step 1: Grep for the keys the code actually asks for**

```bash
cd frontend && grep -rhoE '"(trips|settings):[a-zA-Z.]*routing[a-zA-Z.]*"' src | sort -u
```
Expand any dynamic key by hand. The `trips` namespace now has a key-coverage
guard — extend it rather than writing a new one.

- [ ] **Step 2: Write German first, mirror to English**

German register: plain, concrete, no exclamation marks, no "Bitte". Keep the
vocabulary already established: a stop is a **Stopp**, a leg an **Etappe**, a
section a **Tour**, `straight` is **Luftlinie**, `drawn` is **gezogen**. The new
one: `routed` is **berechnet**.

Say plainly in the copy what a keyed provider costs the user's privacy — the
operator is deciding whether coordinates leave their machine, and the settings
text is where they learn it.

- [ ] **Step 3: Verify DE and EN hold identical key sets, check umlauts by code point, run the suites, commit**

---

## Final gate

- [ ] Backend: `npx tsc --noEmit && npm run lint`, then the full suite with
      `NODE_OPTIONS=--max-old-space-size=8192` and the exit code captured
      explicitly — expect only the three known pre-existing failures.
- [ ] Frontend: `npx tsc --noEmit && npm run lint && npx vitest --run && npx vite build`.
- [ ] **A browser check in a production build, by the controller, not a subagent.**
      Configure the custom provider against a throwaway OSRM or, if none is
      available, verify the DISABLED state and its reason — and say which you did.
      Phase 1 shipped an invisible map line past 3016 green tests; a screenshot is
      the only thing that catches this class.
- [ ] `git push forgejo dev/tour-routes`. **Do not merge to `main`** — that is the
      owner's release decision, asked as a single isolated question.

## Deliberately out of scope

GPX import and Dawarich (phase 3b, its own plan). Shipping a routing container.
Caching across sessions beyond the per-request memo. Turn-by-turn directions.
Reordering stops, deleting or renaming a section from the UI, and the dashboard
tour tab — all still owner-scope decisions from phase 1.
