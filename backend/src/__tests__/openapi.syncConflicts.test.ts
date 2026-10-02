import "../services/openapi/paths";
import { buildOpenApiDocument } from "../services/openapi/registry";
import { guardedOperations } from "../services/openapi/syncConflicts";

/**
 * forgejo#141, owner 2026-10-02: the 409 VERSION_CONFLICT is documented on
 * every edit and delete that can answer it, and on none that cannot. The list
 * of guarded routes is the one `routes/syncPreconditions.ts` mounts, so a
 * route added there is documented, or named here as missing, the same day.
 */
describe("OpenAPI: version preconditions on guarded edits and deletes", () => {
  const document = buildOpenApiDocument();
  const paths = document.paths as Record<string, Record<string, Record<string, unknown>>>;

  it("documents every guarded operation the routes mount", () => {
    const missing = guardedOperations()
      .filter(({ method, path }) => !paths[path]?.[method])
      .map(({ method, path }) => `${method.toUpperCase()} ${path}`);
    expect(missing).toEqual([]);
  });

  it("gives each one the If-Match header and the 409 answer", () => {
    for (const { method, path } of guardedOperations()) {
      const operation = paths[path]![method]!;
      const parameters = (operation.parameters ?? []) as Array<{ name?: string; in?: string }>;
      expect({ path, method, ifMatch: parameters.some((p) => p.name === "If-Match") }).toEqual({
        path,
        method,
        ifMatch: true,
      });
      const conflict = (operation.responses as Record<string, { content?: unknown }>)["409"];
      expect({ path, method, conflict: JSON.stringify(conflict?.content ?? null) }).toEqual({
        path,
        method,
        conflict: expect.stringContaining("#/components/schemas/VersionConflict"),
      });
    }
  });

  it("does not claim the precondition on an operation that cannot answer it", () => {
    const guarded = new Set(guardedOperations().map(({ method, path }) => `${method} ${path}`));
    const claimed = Object.entries(paths).flatMap(([path, item]) =>
      Object.entries(item)
        .filter(([, operation]) =>
          JSON.stringify((operation as { responses?: unknown }).responses ?? {}).includes(
            "#/components/schemas/VersionConflict"
          )
        )
        .map(([method]) => `${method} ${path}`)
    );
    expect(claimed.filter((operation) => !guarded.has(operation))).toEqual([]);
  });
});
