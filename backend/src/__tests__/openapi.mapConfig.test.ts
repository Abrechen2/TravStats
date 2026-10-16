import "../services/openapi/paths";
import { buildOpenApiDocument } from "../services/openapi/registry";

// The map-config paths were registered from the route file with a 200 that had
// no content: the response-schema ratchet imports only services/openapi/paths,
// so it never saw them, and the spec told a client nothing about the shape.
describe("map configuration in the OpenAPI spec", () => {
  const doc = buildOpenApiDocument() as unknown as {
    paths: Record<
      string,
      { get?: { responses: Record<string, { content?: Record<string, { schema?: unknown }> }> } }
    >;
    components: { schemas: Record<string, unknown> };
  };
  const resolve = (schema: unknown) => {
    const ref = (schema as { $ref?: string } | undefined)?.$ref;
    return ref ? doc.components.schemas[ref.split("/").pop()!] : schema;
  };
  it("documents the JSON configuration with its style map", () => {
    const schema = resolve(
      doc.paths["/map-config"]?.get?.responses["200"]?.content?.["application/json"]?.schema
    ) as { properties?: Record<string, unknown> } | undefined;
    expect(schema?.properties).toHaveProperty("version");
    expect(schema?.properties).toHaveProperty("styles");
  });
  it("documents the runtime bootstrap as JavaScript", () => {
    const ok = doc.paths["/map-config/runtime"]?.get?.responses["200"];
    expect(ok?.content?.["application/javascript"]?.schema).toBeDefined();
  });
});
