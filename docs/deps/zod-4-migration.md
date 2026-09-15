# zod 3 → 4 — state of the migration

Branch: `chore/deps-2026-09-14`.

## The blocker, and what it actually was

141 of 494 backend suites died at import with

    TypeError: flight_1.createFlightSchema.openapi is not a function

The suspicion recorded on 2026-09-14 was an initialisation cycle. It was not.
Measured on 2026-09-15:

| | `typeof schema.openapi` |
|---|---|
| `z.ZodType.prototype` after `extendZodWithOpenApi` | `function` |
| instance constructed BEFORE that call | `undefined` |
| instance constructed AFTER that call | `function` |
| does the instance inherit from `ZodType.prototype`? | **no** |

zod 4's `$constructor` copies the prototype's methods onto each instance **at
construction time** and the instance does not sit on that prototype chain
afterwards. `extendZodWithOpenApi` patches `ZodType.prototype`, so under zod 4
the patch reaches only schemas built after it ran. Under zod 3 it reached every
schema, past and future — which is why import order had never mattered and why
the assumption "creation order should not matter" read as obviously true.

So the failing graph was simply the one that reached `schemas/flight` before it
reached `services/openapi/registry` (whose first statement is `import
"./setup"`). The minimal Jest repro loaded `setup` first, which is exactly why
it worked and proved nothing.

## The fix

`backend/src/schemas/zod.ts` applies the extension and hands out `z`. All 25
modules in `src/schemas/` import `z` from there instead of from `"zod"`. The
extension is now anchored to the module that hands out `z`, so the order is
unobservable rather than merely correct today.
`services/openapi/setup.ts` stays as the registry's statement of intent and
delegates to it.

Guarded by `backend/src/schemas/__tests__/openapiExtension.test.ts`: each schema
module is loaded inside `jest.isolateModules`, where `zod` itself is re-required
fresh and therefore unpatched — so the only way a schema can come out carrying
`.openapi` is if its own import chain applied the extension. Verified RED first
(24 of 25 modules failed); a count assertion keeps it from going vacuous if the
detection ever stops recognising schemas.

## What the migration touched

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

Installed: `zod@4.6.5` in both trees, `@asteasolutions/zod-to-openapi@9.1.0`
in the backend (v9 is the first release whose peer range is `zod@^4`, so the
two majors have to move together).

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

prisma 5 → 7, `@types/node` 22 → 26, typescript 5 → 7, express 4 → 5,
jest 29 → 30 and the rest of the major backlog.
