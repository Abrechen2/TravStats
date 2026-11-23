import "../services/openapi/paths";
import { buildOpenApiDocument } from "../services/openapi/registry";
import { TOOLS } from "../../../packages/travstats-mcp/src/core/tools";

/**
 * travstats-mcp wraps the REST API, so a route or a field that disappears from the generated
 * openapi.json would break the package silently (a tool answering null where it answered a value).
 * Every tool declares the (method, path, query, fields) it uses; this test fails on drift.
 */
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const spec = buildOpenApiDocument() as unknown as Json;

const resolve = (s: Json | undefined): Json => {
  let cur: Json = s ?? {};
  while (cur.$ref) cur = spec.components.schemas[String(cur.$ref).split("/").pop()!];
  return cur;
};

/** Variants of a schema that can carry properties: the schema itself plus allOf / oneOf / anyOf members. */
function variants(s: Json | undefined): Json[] {
  const r = resolve(s);
  const parts = [...(r.allOf ?? []), ...(r.oneOf ?? []), ...(r.anyOf ?? [])];
  return [r, ...parts.flatMap((p: Json) => variants(p))];
}

function child(s: Json | undefined, key: string): Json | undefined {
  for (const v of variants(s)) if (v.properties && key in v.properties) return v.properties[key];
  return undefined;
}

function hasField(root: Json | undefined, path: string): boolean {
  let cur = root;
  for (const seg of path.split(".")) {
    const isArr = seg.endsWith("[]");
    const key = isArr ? seg.slice(0, -2) : seg;
    cur = child(cur, key);
    if (!cur) return false;
    if (isArr) {
      const arrayVariant = variants(cur).find((v) => v.type === "array");
      if (!arrayVariant) return false;
      cur = arrayVariant.items;
    }
  }
  return true;
}

function paramNames(op: Json): string[] {
  return (op.parameters ?? []).map((p: Json) =>
    p.$ref ? String(p.$ref).split("/").pop() : p.name
  );
}

describe("travstats-mcp tools stay inside the REST contract", () => {
  it("declares nine read tools with unique names", () => {
    expect(TOOLS.map((t) => t.name).sort()).toEqual([
      "get_readiness",
      "get_routing_run",
      "get_stats",
      "get_travtrack_day",
      "get_trip_summary",
      "get_upcoming",
      "list_inbox",
      "list_trips",
      "search_entries",
    ]);
    expect(new Set(TOOLS.map((t) => t.name)).size).toBe(TOOLS.length);
  });

  for (const tool of TOOLS) {
    for (const w of tool.wraps) {
      describe(`${tool.name}: ${w.method} ${w.path}`, () => {
        const op = spec.paths[w.path]?.[w.method.toLowerCase()] as Json | undefined;

        it("is a documented operation", () => {
          expect(op).toBeDefined();
        });

        it("takes every query parameter the tool sends", () => {
          const known = paramNames(op ?? {});
          const missing = (w.query ?? []).filter((q) => !known.includes(q));
          expect(missing).toEqual([]);
        });

        it("answers with every field the tool reads", () => {
          const schema = op?.responses?.["200"]?.content?.["application/json"]?.schema;
          if (!w.fields?.length) return; // the spec has no response schema for this route
          expect(schema).toBeDefined();
          const missing = w.fields.filter((f) => !hasField(schema, f));
          expect(missing).toEqual([]);
        });
      });
    }
  }

  it("fails on drift: a field that is not in the spec is reported missing", () => {
    const schema = spec.paths["/search"].get.responses["200"].content["application/json"].schema;
    expect(hasField(schema, "data.hits[].title")).toBe(true);
    expect(hasField(schema, "data.hits[].noSuchField")).toBe(false);
  });

  it("GET /auth/me reports tokenScope (the package's start-up gate reads it)", () => {
    const schema = spec.paths["/auth/me"].get.responses["200"].content["application/json"].schema;
    expect(hasField(schema, "tokenScope")).toBe(true);
  });
});
