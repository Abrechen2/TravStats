/**
 * The project's zod entry point. Every schema module imports `z` from HERE,
 * never from "zod" directly — `schemas/__tests__/openapiExtension.test.ts`
 * fails when one does.
 *
 * Why this file exists: zod 4 changed how a schema instance gets its methods.
 * `$constructor` copies the prototype's methods onto each instance at
 * CONSTRUCTION time, and the instance does not inherit from
 * `ZodType.prototype` afterwards. `extendZodWithOpenApi` patches that
 * prototype, so under zod 4 the patch only reaches schemas built after it
 * ran — under zod 3 it reached every schema, past and future, which is why
 * import order never mattered before.
 *
 * Measured on 2026-09-15: with the call sitting in `services/openapi/setup`,
 * 141 of 494 suites died at import with
 * `createFlightSchema.openapi is not a function`, because the route graph
 * reached `schemas/flight` before it reached the registry. Anchoring the
 * extension to the module that hands out `z` makes the order unobservable
 * instead of merely correct today.
 */

import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

extendZodWithOpenApi(z);

export { z };
