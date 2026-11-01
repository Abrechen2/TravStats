import "../services/openapi/paths";
import { buildOpenApiDocument } from "../services/openapi/registry";

// forgejo#407 (owner decision 2026-10-29): four stats routes have no client of
// their own, and the route-estimation endpoint was retired.
describe("endpoints no client calls (forgejo#407)", () => {
  const doc = buildOpenApiDocument() as unknown as {
    paths: Record<string, { get?: { description?: string } }>;
  };

  it.each(["/stats/fun", "/stats/business", "/stats/unique", "/stats/seats"])(
    "%s is marked as having no own client",
    (path) => {
      expect(doc.paths[path]?.get?.description).toMatch(/No own client/);
    }
  );

  it("no longer documents the retired /flights/{id}/route-estimation", () => {
    expect(doc.paths["/flights/{id}/route-estimation"]).toBeUndefined();
  });
});
