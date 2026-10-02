import type { OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";

import { SYNC_GUARDED_ROUTES } from "../sync/guardedRoutes";

/**
 * The version-precondition half of forgejo#141, stamped onto the generated
 * document: every operation in `SYNC_GUARDED_ROUTES` gets the `If-Match`
 * header and the 409 VERSION_CONFLICT answer. Done here, after generation,
 * rather than in each path module, so the routes that check and the spec that
 * says so read the same list — the previous hand-written prose had already
 * missed two entities when it was replaced.
 */

type OpenApiDocument = ReturnType<OpenApiGeneratorV3["generateDocument"]>;
type Operation = Record<string, unknown> & {
  parameters?: unknown[];
  responses?: Record<string, unknown>;
};

const IF_MATCH = {
  name: "If-Match",
  in: "header",
  required: false,
  description:
    'The record\'s version as the sync feed handed it out, quoted (`"2026-10-02T17:00:00.000Z"`). ' +
    "Alternatively send it as `baseVersion` in the body. Without either the request is " +
    "unconditional, as it always was.",
  schema: { type: "string" },
};

const CONFLICT = {
  description:
    "VERSION_CONFLICT: the record changed after the version the request named. Nothing was " +
    "written; the answer carries the current record and the fields that moved.",
  content: {
    "application/json": { schema: { $ref: "#/components/schemas/VersionConflict" } },
  },
};

/** `/trips/:id/stops/:stopId` → `/trips/{id}/stops/{stopId}` */
export function toOpenApiPath(expressPath: string): string {
  return expressPath.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

/** Every guarded operation as `METHOD /path` in OpenAPI spelling. */
export function guardedOperations(): Array<{ method: "put" | "patch" | "delete"; path: string }> {
  return SYNC_GUARDED_ROUTES.flatMap((route) =>
    route.paths.flatMap((path) => [
      { method: route.edit, path: toOpenApiPath(path) },
      { method: "delete" as const, path: toOpenApiPath(path) },
    ])
  );
}

/**
 * Returns a copy of the document with the precondition documented. An
 * operation the spec does not carry is left out here and caught by
 * `openapi.syncConflicts.test.ts`, which names it.
 */
export function withVersionPreconditions(document: OpenApiDocument): OpenApiDocument {
  const paths = { ...(document.paths ?? {}) } as Record<string, Record<string, Operation>>;
  for (const { method, path } of guardedOperations()) {
    const item = paths[path];
    const operation = item?.[method];
    if (!item || !operation) continue;
    const parameters = operation.parameters ?? [];
    const hasIfMatch = parameters.some(
      (parameter) => (parameter as { name?: string; in?: string }).name === "If-Match"
    );
    paths[path] = {
      ...item,
      [method]: {
        ...operation,
        parameters: hasIfMatch ? parameters : [...parameters, IF_MATCH],
        responses: { ...(operation.responses ?? {}), 409: CONFLICT },
      },
    };
  }
  return { ...document, paths } as OpenApiDocument;
}
