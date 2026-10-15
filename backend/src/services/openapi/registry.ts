/**
 * Central OpenAPI registry.
 *
 * The registry is a singleton. Schemas register themselves via
 * `registry.register("Name", zodSchema)` so the spec stays close to the
 * code that defines the contract — no separate hand-written YAML to
 * drift out of sync.
 *
 * Routes register themselves via `registry.registerPath(...)`. Paths
 * intentionally live in their own helper file (`paths.ts`) instead of
 * being scattered through every router; that keeps the spec
 * round-trippable as a single artifact and easy to diff in PRs.
 *
 * The Bearer security scheme is registered here once. Cookie auth is
 * NOT advertised in the spec — the OpenAPI consumers we care about
 * (AI agents, scripts, third-party tools) only ever use PATs. Browser
 * sessions are an internal-only auth path and don't need to appear in
 * the public docs.
 */

import "./setup";
import { OpenAPIRegistry, OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";
import { appVersion } from "../../utils/version";
import { localDateValueSchema, timeValueSchema } from "../../shared/time/wire";
import { withVersionPreconditions } from "./syncConflicts";

const registry = new OpenAPIRegistry();

// The time model's value shapes (ADR 0002 D3) are registered FIRST. The
// generator names a component after the first schema it meets carrying that
// component's id; when a nullable wrapper (`TimeValue | null` inside an
// entity's `times`) was met before the plain registration, the TimeValue
// component itself came out `nullable: true` and every member pointing at it
// lost its own nullability (measured 2026-09-27).
registry.register("TimeValue", timeValueSchema);
registry.register("LocalDateValue", localDateValueSchema);

const bearerAuth = registry.registerComponent("securitySchemes", "BearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "ts_pat_<hex>",
  description:
    "Personal Access Token (`ts_pat_…`). Create one at /settings → API Tokens. " +
    "Send as `Authorization: Bearer ts_pat_…`.",
});

export { registry, bearerAuth };

