/**
 * forgejo#437: `?onlyRecorded=true` was honoured by the middleware on every GET under eleven
 * prefixes but absent from the OpenAPI document, so API consumers could not discover it.
 */
import "../paths";
import { buildOpenApiDocument } from "../registry";
import { RECORDED_ONLY_PREFIXES } from "../../provenance/recordedOnly";
import { listDocumentableEndpoints } from "../coverage";
import { isRecordedOnlyPath } from "../onlyRecorded";

const REF = "#/components/parameters/onlyRecorded";
const hasRef = (op: { parameters?: Array<{ $ref?: string }> }): boolean =>
  (op.parameters ?? []).some((p) => p.$ref === REF);

describe("openapi onlyRecorded parameter", () => {
  const doc = buildOpenApiDocument();
  const getOps = Object.entries(doc.paths ?? {}).flatMap(([path, item]) => {
    const get = (item as Record<string, unknown>).get;
    return get ? [{ path, op: get as { parameters?: Array<{ $ref?: string }> } }] : [];
  });

  it("declares one shared boolean parameter component defaulting to false", () => {
    const param = doc.components?.parameters?.onlyRecorded as Record<string, unknown>;
    expect(param).toMatchObject({
      name: "onlyRecorded",
      in: "query",
      required: false,
      schema: { type: "boolean", default: false },
    });
  });

  it("references it from every GET the recordedOnly middleware honours", () => {
    // Derived from the served endpoints under the middleware's own mount list, not the spec.
    const served = listDocumentableEndpoints()
      .filter((e) => e.method === "get")
      .filter((e) =>
        RECORDED_ONLY_PREFIXES.some((p) => {
          const full = "/api/v1" + e.path;
          return full === p || full.startsWith(p + "/");
        })
      )
      .map((e) => e.path);
    expect(served.length).toBeGreaterThan(20);
    const missing = served.filter((path) => {
      const entry = getOps.find((g) => g.path === path);
      return !entry || !hasRef(entry.op);
    });
    expect(missing).toEqual([]);
  });

  it("references it nowhere the middleware does not honour", () => {
    const stray = getOps.filter((g) => hasRef(g.op) && !isRecordedOnlyPath(g.path));
    expect(stray.map((g) => g.path)).toEqual([]);
  });
});
