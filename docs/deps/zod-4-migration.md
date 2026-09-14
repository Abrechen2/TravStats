# zod 3 → 4 — state of the migration (paused 2026-09-14)

Branch: `chore/deps-2026-09-14`. **Not green. Do not merge as it stands.**

## Where it is

Backend `npx tsc --noEmit` is clean and `npm test` reports **0 failing tests**,
but **141 of 494 suites fail to LOAD**, so that zero means very little. The
frontend is genuinely green (typecheck, lint, 3691 tests) — though only one
frontend file imports zod at all, so that says little too.

Installed: `zod@4.6.5` in both trees, `@asteasolutions/zod-to-openapi@9.1.0`
in the backend (v9 is the first release whose peer range is `zod@^4`, so the
two majors have to move together).

## The open blocker

141 suites die at import with:

    TypeError: flight_1.createFlightSchema.openapi is not a function

`services/openapi/setup.ts` calls `extendZodWithOpenApi(z)`, and v9 does patch
`z.ZodType.prototype`, so creation order should not matter. Measured so far:

* Outside Jest (`tsx`), the patch lands: `typeof z.ZodType.prototype.openapi`
  goes from `undefined` to `function`.
* Inside Jest, a minimal test that requires `setup` and then `schemas/flight`
  ALSO works — `createFlightSchema.openapi` is a function, and `require("zod")`
  is the same instance as the imported `z`. There is exactly one copy of zod in
  `node_modules`, and no `moduleNameMapper` entry for it.
* Yet `apiNoStore.test.ts`, which reaches the same code through
  `src/index.ts → routes/mounts → routes/openapi → openapi/paths/index →
  openapi/paths/shared`, fails at `shared.ts:34`. Jest cache cleared; not a
  cache effect.

So the next step is to find what differs about that import graph — the
suspicion is an initialisation cycle that reaches `paths/shared` while
`services/openapi/registry` (whose first statement is `import "./setup"`) is
still half-evaluated, which would leave the prototype unpatched at exactly
that moment and at no other.

## What is already done and worth keeping

* `z.record(v)` → `z.record(z.string(), v)` at 18 call sites (v4 requires the
  key type).
* ZodError `.errors` → `.issues` (22 sites).
* `config/env.ts`: `.default()` → `.prefault()` on the six env vars that
  transform. v4 made `.default()` the OUTPUT value, so `.default('8000')` on a
  schema that transforms to a number stops typechecking — and `.default(8000)`
  would have skipped the `/^\d+$/` check and the `Number` conversion the
  default is meant to pass through. `prefault` is v4's name for v3 behaviour.
* `schemas/tour.ts`: both `errorMap`s ported to v4's `error` callback
  (`issue.input` replaces `ctx.data`/`issue.received`; returning `undefined`
  means "use zod's own message"). `invalid_union_discriminator` was folded into
  `invalid_union`. The existing test asserted only `/route/i`, which zod's
  default message could have satisfied; it now asserts the engineered text and
  was verified RED with the error map removed.

## The real defect this turned up

**`.partial()` no longer suppresses `.default()`.** Under zod 3 an absent key
short-circuited the field, so a default inside it never ran. Under zod 4 it
fires, and the route writes it. Measured on an empty body:

| schema | parsed to |
|---|---|
| `updateFlightSchema` | `{status:"scheduled", companions:[], aerodataboxQualityTags:[]}` |
| `updateCruiseSchema` | `{status:"planned"}` |
| `updateLodgingSchema` | `{type:…}` |
| `updateStaySchema` | `{status:"completed"}` |
| `updatePlaceSchema` | `{category:…, visited:…}` |

Two suites caught the empty-body half ("rejects empty updates"). Nothing would
have caught the worse half: `PATCH /flights/:id` with `{notes:"x"}` would have
ALSO reset a flown flight to `scheduled` and dropped its companions — every
value individually legitimate, so nothing looks wrong downstream.

Fixed by `schemas/partialUpdate.ts` (`partialForUpdate`), which strips
top-level defaults before `.partial()`. Stripping is deliberately shallow: a
default nested inside a field the client DID send is part of that value's own
shape. Applied at the five sites above; a regression test on the one-field
PATCH is in `schemas/__tests__/flight.test.ts`.

**This fix is worth keeping even if zod 4 is abandoned** — under zod 3 it is a
no-op, so it can be landed separately.

## Also settled on this branch

* zustand 5 is in and green (`b886065c`). It was briefly blamed for a failing
  profile-hydration test; it was not responsible — see `656c3cbb`, where that
  test turned out to have been vacuous all along because an unmocked
  `settingsApi.getProfile()` 401'd and the axios interceptor logged the user
  out mid-test.

## Still untouched

prisma 5 → 7, `@types/node` 22 → 26.
