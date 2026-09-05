# ADR 0001 — Two API response shapes, one per router

Status: accepted, 2026-09-05. Decision requested in `dennis/TravStats`
forgejo#64. Guard: `backend/src/__tests__/apiResponseShape.ratchet.test.ts`
against `apiResponseShape.baseline.json`.

## Context

The global coding rules ask for one envelope on every API response:
`{success, data, error, meta}`. This API never had one. It has two shapes, and
which one a handler uses follows the year the domain was written:

| Family | Shape | Routers (2026-09-05) |
|---|---|---|
| **bare** | the resource itself: `res.json(flight)`, `res.json({ flights, total })` | flights, stats, auth, settings, admin, trips, tours, parsers, Immich, achievements — 66 files |
| **enveloped** | `{ success: true, data: … }`, errors as `{ success: false, error }` or through `AppError` | lodging, places, place lists, cruises, ports, ships, imports, photo journeys, backup — 26 files |

Measured on the day: 117 `success: true` sites across 38 files. Twelve
routers of the bare family carry a few envelopes on single endpoints
(`stats.ts` has two among 42 responses, `airports.ts` one among ten) — those
are the leaks, and they are what a stranger reading the tracker was confused
by: `/stats/lodging` answers in a different shape from `/stats/summary` next
to it.

Every frontend client reads the shape its router speaks (`response.data` for
bare, `response.data.data` for enveloped, thirty such sites), and so does
TravStatsCompanion, the phone app, which is a separate repository with its
own release cadence.

## Options

1. **Envelope everywhere.** Rewrite 66 routers, every frontend client, the
   OpenAPI response schemas and the Companion, in lockstep, for no change a
   user would see. A multi-day migration whose only failure mode is silent:
   a client reading `.data` off an envelope gets `undefined`, not an error.
2. **Bare everywhere.** The same migration in the other direction, 26 routers
   and the Companion's lodging and places clients.
3. **Both stay; a router speaks one shape.** Freeze today's families. A new
   endpoint follows its router; a new router picks a family and says so in
   the baseline. The twelve leaks may only be removed, never joined by new
   ones.

## Decision

Option 3. The value of a uniform shape is that a client can be written without
reading the handler; that value is already lost for every existing client,
and buying it back costs a coordinated three-repository migration nobody has
asked for. What can be held cheaply is the property that was actually
violated: **a router answers in one shape**, so a reader who knows one
endpoint of it knows them all.

Rules:

- A new endpoint in an existing router uses that router's family.
- A new router file must be added to the baseline under a family. The test
  fails until it is — that is the decision being asked for, once, at the
  right moment.
- A bare-family router gains no `success: true`. The frozen count for the
  twelve leaking routers may only go down; when a leak is removed, the entry
  is lowered in the same change.
- Which family a NEW router joins: the family of the domain it serves.
  A new flights or stats router is bare; a new lodging, places or cruise
  router is enveloped. A new domain picks the enveloped family, because the
  enveloped family already carries the error convention (`{success: false,
  error}` beside `AppError`) that the global rules describe.
- Migrating a family is a decision of its own, taken together with the
  Companion, and is not done by this ADR.

## Consequences

- The global rule `~/.claude/rules/common/patterns.md` ("API Response Format")
  is not followed uniformly here; CLAUDE.md records the divergence.
- The ratchet sees a bare-family router gaining an envelope. It does not see
  an enveloped router gaining a bare `res.json(resource)` — that has no
  grep-able signature. The OpenAPI response-schema ratchet is where a
  per-endpoint shape change becomes visible; an enveloped endpoint's schema
  has `success` and `data` at its top level.
- The two shapes are documented in OpenAPI per endpoint, as today. No client
  needs to change.
