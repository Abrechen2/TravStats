import type { OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";

import { RECORDED_ONLY_PREFIXES } from "../provenance/recordedOnly";

/**
 * The `?onlyRecorded=true` query ("nur belegte", forgejo#437), declared once as the shared
 * parameter component `onlyRecorded` and referenced by every GET operation the
 * `recordedOnlyScope` middleware actually honours. The list is derived from
 * `RECORDED_ONLY_PREFIXES` (the middleware's own mount list), so the spec and the middleware
 * cannot drift; `openapi.onlyRecorded.test.ts` pins that.
 */

type OpenApiDocument = ReturnType<OpenApiGeneratorV3["generateDocument"]>;
type Operation = Record<string, unknown> & { parameters?: unknown[] };

export const ONLY_RECORDED_COMPONENT = "onlyRecorded";
const REF = { $ref: `#/components/parameters/${ONLY_RECORDED_COMPONENT}` };
const SERVER_ROOT = "/api/v1";

const ONLY_RECORDED_PARAMETER = {
  name: "onlyRecorded",
  in: "query",
  required: false,
  description:
    "When `true`, entries typed in from memory (provenance `remembered`) are left out of every " +
    "list, count and statistic in the response. Entries with unknown provenance stay in. " +
    "Any other value behaves like `false`.",
  schema: { type: "boolean", default: false },
};

/** Whether the middleware opens its scope for a GET of this spec path (relative to `/api/v1`). */
export function isRecordedOnlyPath(specPath: string): boolean {
  const full = SERVER_ROOT + specPath;
  return RECORDED_ONLY_PREFIXES.some((prefix) => full === prefix || full.startsWith(prefix + "/"));
}

/** Returns a copy of the document with the parameter declared and referenced. */
export function withOnlyRecordedParameter(document: OpenApiDocument): OpenApiDocument {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const [path, item] of Object.entries(document.paths ?? {})) {
    const operations = { ...(item as Record<string, unknown>) };
    if (isRecordedOnlyPath(path) && operations.get) {
      const op = operations.get as Operation;
      operations.get = { ...op, parameters: [...(op.parameters ?? []), REF] };
    }
    paths[path] = operations;
  }
  return {
    ...document,
    paths,
    components: {
      ...document.components,
      parameters: {
        ...document.components?.parameters,
        [ONLY_RECORDED_COMPONENT]: ONLY_RECORDED_PARAMETER,
      },
    },
  } as OpenApiDocument;
}
