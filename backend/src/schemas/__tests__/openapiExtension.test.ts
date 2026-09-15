/**
 * Every schema module must reach zod through `schemas/zod`, which applies
 * `extendZodWithOpenApi` before the first schema is constructed.
 *
 * This is not style. zod 4's `$constructor` copies the prototype's methods
 * onto each instance AT CONSTRUCTION TIME, and instances do not inherit from
 * `ZodType.prototype` at all. So patching the prototype is no longer
 * retroactive the way it was under zod 3: a schema built before
 * `extendZodWithOpenApi` ran never gets `.openapi`, and the OpenAPI path
 * modules that call `createFlightSchema.openapi("FlightCreateInput")` die at
 * import with "is not a function" — which took out 141 suites at once.
 *
 * `jest.isolateModules` is what makes this test real: inside it, `zod` itself
 * is re-required fresh and therefore unpatched, so the only way a schema can
 * come out with `.openapi` is if its own import chain applied the extension.
 */

import fs from "fs";
import path from "path";

const schemaDir = path.join(__dirname, "..");

const moduleFiles = fs
  .readdirSync(schemaDir)
  .filter((f) => f.endsWith(".ts") && f !== "zod.ts")
  .sort();

const isZodSchema = (value: unknown): boolean =>
  typeof (value as { safeParse?: unknown } | null)?.safeParse === "function";

let totalChecked = 0;

describe("schema modules carry the OpenAPI extension", () => {
  it.each(moduleFiles)("%s", (file) => {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require(path.join(schemaDir, file)) as Record<string, unknown>;

      const withoutOpenApi = Object.entries(mod)
        .filter(([, value]) => isZodSchema(value))
        .map(([name, value]) => {
          totalChecked += 1;
          return { name, ok: typeof (value as { openapi?: unknown }).openapi === "function" };
        })
        .filter((entry) => !entry.ok)
        .map((entry) => entry.name);

      expect(withoutOpenApi).toEqual([]);
    });
  });

  it("actually inspected a meaningful number of schemas", () => {
    expect(totalChecked).toBeGreaterThan(50);
  });
});
