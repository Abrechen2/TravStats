/**
 * The shape guard for the OpenAPI spec.
 *
 * `openapi.coverage.test.ts` next door checks that every endpoint the app
 * serves *appears* in the spec. Appearing is not the same as being
 * documented: a path can register `responses: { 200: { description } }`
 * and satisfy coverage while telling a consumer nothing about what comes
 * back. A generated client gets `unknown`, an agent has to guess, and the
 * spec looks complete while it is not.
 *
 * So: if an operation answers 200, that response must carry a real schema
 * under `content["application/json"]`. Other status codes are out of scope
 * on purpose — 204 has no body by definition, and 4xx bodies all share the
 * one error shape.
 *
 * `openapi.responseSchema.baseline.json` lists the operations that fail
 * this today. It is a ratchet, not a config file: entries may be REMOVED
 * when an endpoint gains a schema, and nothing may be added without a
 * deliberate decision to ship a shapeless endpoint. Both directions are
 * enforced below — a new offender fails, and a fixed offender that is
 * still listed fails too. A baseline that is allowed to grow is just a
 * list of excuses.
 */

import "../services/openapi/paths";
import { buildOpenApiDocument } from "../services/openapi/registry";
import baseline from "./openapi.responseSchema.baseline.json";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * True when the 200 response of an operation carries a JSON schema.
 * The generator emits either an inline object or a `$ref`; both are
 * objects, and anything else (missing, null, a bare string) is not a
 * contract.
 */
const hasJsonResponseSchema = (operation: unknown): boolean => {
  if (!isRecord(operation)) return false;
  const responses = operation.responses;
  if (!isRecord(responses)) return false;
  const ok = responses["200"];
  if (!isRecord(ok)) return false;
  const content = ok.content;
  if (!isRecord(content)) return false;
  const json = content["application/json"];
  if (!isRecord(json)) return false;
  return isRecord(json.schema);
};

const respondsWith200 = (operation: unknown): boolean =>
  isRecord(operation) && isRecord(operation.responses) && "200" in operation.responses;

const label = (method: string, path: string) => `${method.toUpperCase()} ${path}`;

/** Every documented operation that answers 200, split by whether it typed that 200. */
const classifyOperations = (): { withSchema: Set<string>; withoutSchema: Set<string> } => {
  const doc = buildOpenApiDocument();
  const withSchema = new Set<string>();
  const withoutSchema = new Set<string>();

  for (const [path, operations] of Object.entries(doc.paths ?? {})) {
    if (!isRecord(operations)) continue;
    for (const [method, operation] of Object.entries(operations)) {
      if (!respondsWith200(operation)) continue;
      const entry = label(method, path);
      if (hasJsonResponseSchema(operation)) {
        withSchema.add(entry);
      } else {
        withoutSchema.add(entry);
      }
    }
  }

  return { withSchema, withoutSchema };
};

describe("openapi response schemas", () => {
  const { withSchema, withoutSchema } = classifyOperations();
  const allowed = new Set<string>(baseline);

  it("has no 200 response without a schema outside the baseline", () => {
    const missing = [...withoutSchema].filter((entry) => !allowed.has(entry)).sort();

    expect(missing).toEqual([]);
  });

  it("has no baseline entry that already carries a schema", () => {
    // The ratchet. Typing a response without deleting its line here fails
    // the build, so the list can only shrink.
    const fixed = [...allowed].filter((entry) => withSchema.has(entry)).sort();

    expect(fixed).toEqual([]);
  });

  it("has no baseline entry for an operation that no longer answers 200", () => {
    // Renamed or retired endpoints would otherwise leave dead lines behind
    // that quietly re-license a future path of the same name.
    const orphaned = [...allowed]
      .filter((entry) => !withSchema.has(entry) && !withoutSchema.has(entry))
      .sort();

    expect(orphaned).toEqual([]);
  });
});
