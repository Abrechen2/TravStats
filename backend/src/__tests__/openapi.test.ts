/**
 * The OpenAPI spec is a public contract — the moment a registered
 * Zod schema gets a shape that zod-to-openapi can't translate, we
 * lose API docs at runtime. This test catches that at CI time
 * instead of in production.
 */

import "../services/openapi/paths";
import { buildOpenApiDocument } from "../services/openapi/registry";

describe("openapi spec", () => {
  const doc = buildOpenApiDocument();

  it("builds without throwing", () => {
    expect(doc.openapi).toBe("3.0.3");
    expect(doc.info.title).toBe("TravStats API");
  });

  it("declares the BearerAuth security scheme", () => {
    expect(doc.components?.securitySchemes?.BearerAuth).toMatchObject({
      type: "http",
      scheme: "bearer",
    });
  });

  it("registers core flight + airport + token paths", () => {
    const paths = Object.keys(doc.paths ?? {});
    expect(paths).toEqual(
      expect.arrayContaining([
        "/flights",
        "/flights/{id}",
        "/airports",
        "/trips",
        "/stats",
        "/settings/tokens",
        "/settings/tokens/{id}",
      ])
    );
  });

  it("registers shared schemas under components", () => {
    const schemas = Object.keys(doc.components?.schemas ?? {});
    expect(schemas).toEqual(
      expect.arrayContaining([
        "Error",
        "Flight",
        "FlightCreateInput",
        "Airport",
        "ApiToken",
        "CreatedApiToken",
      ])
    );
  });

  it("flags POST /flights with the merge query parameter", () => {
    const post = doc.paths?.["/flights"]?.post;
    expect(post).toBeDefined();
    const query = post?.parameters?.find(
      (p) => "name" in p && p.name === "merge"
    );
    expect(query).toBeDefined();
  });
});
