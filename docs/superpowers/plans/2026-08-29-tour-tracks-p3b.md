# Tour tracks — GPX and Dawarich — Phase 3b implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A leg's distance can be the distance actually travelled, taken from a recorded track — uploaded as GPX, or pulled from a self-hosted Dawarich — rather than estimated.

**Architecture:** A track is stored whole, against the SECTION and a time window, never against a leg: a GPX file knows nothing about the user's stops, and forcing it into the leg structure on import loses data. A leg may then ADOPT the overlapping segment as its geometry, and only ever by an explicit action.

**Tech Stack:** Express + TypeScript, Prisma/PostgreSQL, Zod, `fast-xml-parser` (already a dependency), Jest + supertest; React + Vite, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-29-tour-route-sections-design.md` §4.4, §7.3
**Also read:** `docs/superpowers/specs/2026-07-04-dawarich-integration-concept.md` — the Dawarich architecture is settled there and this plan implements it, it does not re-decide it.

**Independent of Phase 3** (the routing providers). Either can ship first; they touch different files apart from the leg source enum, and the plan says how to handle that if 3 lands first.

## Global Constraints

- `any` is FORBIDDEN. Use `unknown` plus type guards. Exception: `.d.ts` only.
- No `console.log`. The logger is a DEFAULT export.
- Zod at every system boundary; schemas in `backend/src/schemas/`.
- Prisma JSON writes cast via `as unknown as Prisma.InputJsonValue`; clear with `Prisma.DbNull`.
- Schema changes via Prisma migration tooling, additive only. Use `./node_modules/.bin/prisma`, not `npx prisma` — the latter resolves a wrong major version here.
- File size: 200–400 ideal, **800 hard maximum**. `backend/src/routes/trips.ts` is ~1400 lines — add nothing to it.
- Frontend copy: German primary, English mirrored **in the same change**. Established vocabulary: a stop is a **Stopp**, a leg an **Etappe**, a section a **Tour**, `straight` **Luftlinie**, `drawn` **gezogen**, `routed` **berechnet**. The new one: `track` is **aus der Spur**.
- `react-hooks/exhaustive-deps` is **disabled** repo-wide — dependency arrays by hand.
- Every new endpoint needs an OpenAPI entry or the coverage guard fails. Never add an exclusion.
- Never `git commit --amend`. Write files with a plain file write, never a heredoc that interprets escapes; verify NUL count is 0.
- Branch `dev/tour-routes`. Never commit to `main`.

**Test commands** and the three known pre-existing backend failures
(`lodging.test.ts` 40P01, `lodgingFxSource.test.ts` interference, one
`lodgingParseRoutes.test.ts` Ollama timeout) are as documented in
`2026-08-29-tour-routing-providers-p3.md` — they were reproduced on the base
commit and are not yours to fix. The full backend suite needs
`NODE_OPTIONS=--max-old-space-size=8192`, and a trailing pipe masks jest's exit
code, so capture it explicitly.

## What exists already, measured

| Fact | Where |
|---|---|
| `TripRouteTrack` is designed but NOT built — phase 1 deliberately excluded it | spec §4.4 |
| `simplifyDegrees(points, toleranceDeg)` is exported and reusable | `backend/src/services/schematicRouter.ts:573` |
| `polylineDistanceKm` measures any `[[lon,lat],…]` line | `backend/src/services/cruiseDistance/polylineDistance.ts` |
| `fast-xml-parser` is already a dependency — no new package | `backend/package.json` |
| `track` is REJECTED at the boundary by the leg-source enum | `backend/src/schemas/tour.ts` |
| The Immich integration is the architectural mirror: per-user opt-in, URL + key resolved User → Admin → ENV, a version-contained read-only client, a FIXED error-kind vocabulary the frontend parses (`notConfigured\|unreachable\|auth\|notFound\|protocol\|invalidUrl`) | `backend/src/routes/immich/`, CLAUDE.md |
| A self-hosted service's URL carries **no** egress restriction on purpose — it lives on the LAN | `normalizeImmichBaseUrl`, documented in CLAUDE.md |
| A live Dawarich test instance exists | `2026-07-04-dawarich-integration-concept.md` |

---

## Task 1: `TripRouteTrack` schema and migration

**Files:** `backend/prisma/schema.prisma` + generated migration.

Add the model exactly as spec §4.4 declares it, including the doc comment
explaining why a track hangs off the SECTION and a time window rather than a leg.
Add `tracks TripRouteTrack[]` to `TripRoute` — phase 1 left the relation out
because the model did not exist.

- [ ] Confirm `migrate diff --from-migrations --to-schema-datamodel` is empty first; if not, STOP and report.
- [ ] Generate the migration. It must be additive only — one `CREATE TABLE`, its indexes and its foreign key. Any `DROP` or `UPDATE` means pre-existing drift got bundled in: STOP.
- [ ] Verify with a query that no existing row changed, and that the diff is empty again afterwards.
- [ ] Commit.

---

## Task 2: GPX parsing (pure)

**Files:**
- Create: `backend/src/services/tour/tracks/parseGpx.ts`
- Test: `backend/src/services/tour/tracks/__tests__/parseGpx.test.ts`

**Interfaces:**
```ts
export interface ParsedTrack { points: Array<[number, number]>; startedAt: Date; endedAt: Date; name: string | null }
export function parseGpx(xml: string): ParsedTrack | null;
```

Pure: string in, structure out. No file system, no database.

- [ ] **Write the failing test first.** Cover, with real GPX fixtures written into the test file:
  1. a normal `<trk>` with `<trkseg>` and timestamped `<trkpt>` → points in `[lon, lat]` order, earliest and latest timestamps;
  2. **multiple `<trkseg>` in one `<trk>`** — a recorder splits a segment when it loses signal; the points must join into one ordered list, not be truncated at the first segment;
  3. `<rte>`/`<rtept>` only, no `<trk>` → also accepted (some exporters emit routes);
  4. points with NO `<time>` → accepted, with the window falling back to… decide and state it: a track with no timestamps cannot be matched to a leg by time, so `parseGpx` returns the points and NULL-able dates, and the caller refuses to store it without a window. Say which you chose in the report.
  5. malformed XML → `null`, never a throw;
  6. an empty or single-point track → `null` (a track with one point has no geometry);
  7. a `<trkpt>` with a non-numeric or out-of-range `lat`/`lon` → that point is dropped, the rest survives.

Case 2 and case 7 are the ones real files hit and synthetic fixtures miss.

- [ ] Run it, see it fail, implement with `fast-xml-parser`, guard the parsed shape with an explicit type guard (no `any`), run again.
- [ ] Commit.

---

## Task 3: Track ingestion — simplify, measure, cap

**Files:**
- Create: `backend/src/services/tour/tracks/ingestTrack.ts`
- Test: `backend/src/services/tour/tracks/__tests__/ingestTrack.test.ts`

**Interfaces:**
```ts
export interface IngestedTrack { geometry: Array<[number, number]>; pointCount: number; distanceKm: number; startedAt: Date; endedAt: Date }
export function ingestTrack(parsed: ParsedTrack, opts?: { toleranceDeg?: number; maxPoints?: number }): IngestedTrack;
```

- [ ] **Write the failing test first.** Cover:
  1. **the distance is measured on the RAW points, before simplification.** Simplifying first and measuring after silently shortens every track — the whole reason to use a track is that its distance is measured rather than estimated. Assert that a zig-zag track's stored distance exceeds the distance of its simplified geometry.
  2. simplification reduces the point count on a dense track while keeping the endpoints exactly;
  3. a hard cap: a track above `maxPoints` is simplified more aggressively rather than stored whole — a 100 000-point recording must not become a 100 000-element JSON column. State the cap you chose and why.
  4. a track already below the cap is stored essentially as-is.

Point 1 is the one that makes this feature worth having; write it first.

- [ ] Reuse `simplifyDegrees` from `services/schematicRouter.ts` and `polylineDistanceKm` — do not reimplement either.
- [ ] Run, implement, run, commit.

---

## Task 4: Upload endpoint and track CRUD

**Files:**
- Create: `backend/src/routes/trips/tourTracks.ts`, mounted like `tourLegs.ts` (`base: '/api/v1'`, entry in `mounts.ts` after `tourLegs`)
- Modify: `backend/src/schemas/tour.ts`
- Test: `backend/src/routes/__tests__/tourTracks.test.ts`

**Endpoints:**
```
POST   /trips/:id/routes/:routeId/tracks            multipart GPX upload -> { track }
GET    /trips/:id/routes/:routeId/tracks            -> { tracks: [...] }   (metadata, NOT geometry)
DELETE /trips/:id/routes/:routeId/tracks/:trackId   -> 204
GET    /trips/:id/routes/:routeId/tracks/:trackId   -> { track } with geometry
```

**Put the middleware PER ROUTE, never `router.use()`.** A router mounted at
`/api/v1` with router-level `authenticate` swallows every later mount's requests —
that exact bug reached the branch in phase 1, 401'd the public pairing endpoints,
and was caught only by the full suite. Copy the per-route form the main trips
router uses.

- [ ] **Write the failing test first.** Cover: a valid upload stores a track and returns its metadata; a malformed GPX is refused with 400; a file above the size limit is refused; another user's route 404s; the LIST response does NOT include the geometry (a track is location history — do not ship megabytes on a list call, and do not leak it into a response that a proxy might cache); delete removes it; and a public endpoint mounted after this router is still reachable unauthenticated.

That last case is the regression test for the phase-1 mistake; include it here too.

- [ ] Follow the existing upload conventions — find how `routes/uploads.ts` handles multipart and size limits and reuse them rather than inventing a second path.
- [ ] OpenAPI entries for all four; run `npx jest openapi --forceExit`.
- [ ] Run, implement, run, commit.

---

## Task 5: Leg adoption from a track

**Files:**
- Create: `backend/src/services/tour/tracks/adoptTrack.ts`
- Modify: `backend/src/routes/trips/tourLegs.ts`, `backend/src/schemas/tour.ts`
- Test: `backend/src/services/tour/tracks/__tests__/adoptTrack.test.ts`, `backend/src/routes/__tests__/tourLegs.adopt.test.ts`

**Interfaces:**
```ts
export interface AdoptionResult { waypoints: Array<[number, number]>; distanceKm: number } 
export function adoptSegment(track: Array<[number, number]>, from: Coord, to: Coord, opts?: { maxAnchorKm?: number }): AdoptionResult | null;
```

Cut the track between the points nearest the leg's two stops and return that
segment plus its measured length.

- [ ] **Write the failing test first.** Cover:
  1. a track passing near both stops → the segment between them, in travel order;
  2. **a track whose nearest point to a stop is far away → `null`.** The track covers a different day or a different place; adopting it would draw a route the traveller never took. Reuse the 1 km anchor tolerance the hand-drawn path already enforces, and make the tolerance a parameter so the endpoint can state it.
  3. a track traversing the two stops in the OPPOSITE order → the segment is returned reversed so it runs from the leg's `from` to its `to`, not backwards;
  4. a track that passes a stop twice (a loop) → the choice is deterministic and documented; say which occurrence you take and why.
  5. the adopted distance is measured on the adopted segment, not inherited from the whole track.

Case 3 is the one that silently draws every return leg backwards.

- [ ] Widen the leg-source enum to accept `track`. If Phase 3 already landed, the
      enum is `ACCEPTED_LEG_SOURCES` — add to it. If not, rename
      `PHASE_1_SOURCES` first, since the name would be a lie.
- [ ] Endpoint: `PUT /trips/:id/routes/:routeId/legs/:from/:to` accepts
      `source: "track"` plus a `trackId`. Adoption is **explicit** — never automatic
      on upload. Store `source: "track"`, `confidence: "high"`. If `adoptSegment`
      returns `null`, refuse with **409** and a message saying the track does not
      cover this leg; do NOT silently fall back, because the user asked for this
      specific track.
- [ ] Run, implement, run, OpenAPI, commit.

---

## Task 6: Dawarich — settings and the read-only client

**Files:**
- Create: `backend/src/services/dawarich/dawarichClient.ts`, `backend/src/services/dawarich/errors.ts`
- Modify: schema + migration (settings columns), `apiKeyResolver.ts`, settings routes
- Test: `backend/src/services/dawarich/__tests__/dawarichClient.test.ts`, `backend/src/routes/__tests__/dawarichSettings.test.ts`

Implement exactly the architecture the concept doc settles: **optional, per-user
opt-in**, base URL + API key resolved **User → Admin → ENV**, a **read-only,
version-contained** client, the key **encrypted at rest** and **never sent to the
frontend**. Direction is pull-only; TravStats never writes to Dawarich.

- [ ] Mirror Immich's **fixed error-kind vocabulary** —
      `notConfigured | unreachable | auth | notFound | protocol | invalidUrl` — and
      keep `invalidUrl` (the user's own typo) distinct from `protocol` (Dawarich
      answered but the payload was unexpected), so a typo does not send someone
      debugging their server version. Prose in `{error: …}` degrades to a generic
      toast and is a defect.
- [ ] **No egress restriction on the base URL**, and a comment saying why: a
      self-hosted Dawarich lives on the LAN, so a private-IP block would break the
      primary use case. Instances exposing this to untrusted users restrict it at
      the deployment layer. This mirrors `normalizeImmichBaseUrl` and is deliberate.
- [ ] Inject `fetch` so tests never touch the network. Cover each error kind, plus
      a successful points fetch decoded through an explicit type guard.
- [ ] A connection test endpoint, following `apiKeyTester`'s shape.
- [ ] Run, implement, run, commit.

---

## Task 7: Pull a Dawarich window into a track

**Files:**
- Modify: `backend/src/routes/trips/tourTracks.ts`
- Test: `backend/src/routes/__tests__/tourTracks.dawarich.test.ts`

**Endpoint:** `POST /trips/:id/routes/:routeId/tracks/dawarich` with a time window
→ fetches the points, runs them through `ingestTrack`, stores one track with
`source: "dawarich"`.

- [ ] **Write the failing test first.** Cover: a successful pull stores a track
      whose window matches what was requested; no connection configured → **409**
      with `notConfigured`; Dawarich unreachable → 409 with `unreachable`, and
      nothing is stored; an empty window → 409 with a message saying so rather than
      storing a zero-point track; and the user's key never appears in any response
      body or log line.

That last assertion is the one worth writing carefully: grep the response and the
captured logs for the key value.

- [ ] Default the window to the section's own date span so the common case is one
      click, but let the caller override it.
- [ ] OpenAPI entry; run the coverage guard.
- [ ] Run, implement, run, commit.

---

## Task 8: Frontend and copy

**Files:**
- Create: `frontend/src/components/Trips/TourTrackList.tsx` + test
- Modify: `frontend/src/pages/TripRouteEditorPage.tsx`, `frontend/src/components/Trips/TourLegList.tsx` + tests, `frontend/src/lib/api/tours.ts`, `frontend/src/types/tour.ts`, the settings page, and both i18n files

- [ ] Upload a GPX; list the section's tracks with their window, point count and
      measured distance; delete one. Pull from Dawarich when a connection exists.
- [ ] `track` is offered on a leg **only when a track covers it**, otherwise
      disabled with the reason shown. A control whose only outcome is an error was a
      real phase-1 finding and is not repeated.
- [ ] Draw an adopted leg at full strength — it is the most trustworthy geometry in
      the product, measured rather than estimated. Phase 1 shipped a chord so faint
      it was invisible past 3016 green tests; check the contrast in a real bundle,
      not in a unit test.
- [ ] Three distinct states everywhere (loading, empty, error) and **never a zero
      over a failed load**.
- [ ] Tests assert raw i18n KEYS, not German text.
- [ ] German copy first, English mirrored in the same change. Extend the existing
      `trips` key-coverage guard rather than writing a new one; verify DE and EN hold
      identical key sets and check umlauts by code point, not by printing to a
      console that mangles them.

---

## Final gate

- [ ] Backend `tsc` + lint + the full suite with the raised heap and the exit code
      captured explicitly — expect only the three known pre-existing failures.
- [ ] Frontend `tsc` + lint + `vitest --run` + `vite build`.
- [ ] **A browser check in a production build, by the controller.** Upload a real
      GPX file — not a fixture — adopt a leg from it, and confirm the line is drawn,
      the distance is the measured one, and the console is clean. If no Dawarich
      instance is reachable, verify the DISABLED state and its reason instead, and
      say which you did.
- [ ] `git push forgejo dev/tour-routes`. **Do not merge to `main`** — the owner's
      release decision, asked as a single isolated question.

## Deliberately out of scope

Writing anything back to Dawarich. Automatic adoption on upload — a track may
cover a different day, so the user decides. Photo-derived tracks. Reordering
stops, deleting or renaming a section from the UI, and the dashboard tour tab —
still owner-scope decisions from phase 1.
