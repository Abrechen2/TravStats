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
        "/flights/batch",
        "/airports/search",
        "/trips",
        "/stats/summary",
        "/parse-email",
        "/parse-boardingpass",
        "/settings/tokens",
        "/settings/tokens/{id}",
      ])
    );
  });

  it("/flights/{id} exposes get + put + delete", () => {
    const methods = Object.keys(doc.paths?.["/flights/{id}"] ?? {});
    expect(methods).toEqual(expect.arrayContaining(["get", "put", "delete"]));
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

  // Coordinator follow-up on b6829bf5, item 1: `truncated` was added to the
  // stored track row and every track-shaped API response, but neither
  // OpenAPI schema declared it — the coverage guard only checks endpoint
  // method+path, never response-field completeness, so a published
  // consumer would never learn the API can return this. Pinned here so a
  // future removal (or a description that stops explaining what the flag
  // MEANS) fails a test instead of silently understating the contract.
  it("documents TourRouteTrackMeta.truncated as a required, explained boolean", () => {
    const schema = doc.components?.schemas?.TourRouteTrackMeta as any;
    expect(schema).toBeDefined();
    expect(schema.properties?.truncated).toMatchObject({ type: "boolean" });
    expect(schema.required).toContain("truncated");
    // A consumer reading the spec should learn the same thing the
    // TourTrackList badge tells a user — not just that it's a boolean.
    const description: string = schema.properties.truncated.description ?? "";
    expect(description).toMatch(/partial/i);
    expect(description).toMatch(/does not|only the newest|cut short/i);
    expect(schema.example?.truncated).toBe(false);
  });

  it("carries truncated through to TourRouteTrack (which extends TourRouteTrackMeta)", () => {
    const schema = doc.components?.schemas?.TourRouteTrack as any;
    expect(schema).toBeDefined();
    // Composed via allOf ($ref to TourRouteTrackMeta + the geometry-only
    // extension), so the field itself lives on the referenced schema —
    // what we can assert here is that the generated EXAMPLE, which zod-to-
    // openapi flattens, actually carries the field through.
    expect(schema.example?.truncated).toBe(false);
  });
});
