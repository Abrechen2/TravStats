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

const registry = new OpenAPIRegistry();

const bearerAuth = registry.registerComponent("securitySchemes", "BearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "ts_pat_<hex>",
  description:
    "Personal Access Token (`ts_pat_…`). Create one at /settings → API Tokens. " +
    "Send as `Authorization: Bearer ts_pat_…`.",
});

export { registry, bearerAuth };

export function buildOpenApiDocument() {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: "3.0.3",
    info: {
      title: "TravStats API",
      version: appVersion,
      description:
        "Programmatic access to your travel log: flights, cruises, " +
        "lodging, places, trips, and the statistics derived from them.\n\n" +
        "**Scope of this spec.** Everything a normal user token can reach " +
        "is documented here, and a test fails the build when an endpoint " +
        "ships without an entry. Two areas are deliberately outside that " +
        "promise: the admin console API, which is admin-scope only and " +
        "changes between minor versions, and the first-boot setup wizard, " +
        "which is unauthenticated and single-use. Neither is an " +
        "integration surface. If you need something from either, please " +
        "open an issue rather than reverse-engineering it — the answer is " +
        "usually a stable endpoint we should have exposed.\n\n" +
        "**Authentication.** Authenticate every request with a Personal " +
        "Access Token in the `Authorization` header. Tokens are managed " +
        "via `/settings/tokens` in the web UI and respect their declared " +
        "scope (`read`, `write`, `admin`) — write endpoints reject " +
        "`read`-scoped tokens with 403.",
      license: { name: "AGPL-3.0-only" },
    },
    servers: [{ url: "/api/v1", description: "Same-origin API root" }],
    security: [{ BearerAuth: [] }],
  });
}
