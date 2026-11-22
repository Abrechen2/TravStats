import "../services/openapi/paths";
import { buildOpenApiDocument } from "../services/openapi/registry";

/**
 * The cover crop and the cover's origin are trip fields every client reads to draw the
 * card. Without a typed schema the spec carried them only as untyped columns, so a client
 * generated from it could not know the crop's shape or the two values of `coverSource`.
 */
it("documents the trip's coverCrop shape and coverSource values", () => {
  const schemas = buildOpenApiDocument().components?.schemas ?? {};
  const trip = schemas.Trip as { properties: Record<string, Record<string, unknown>> };
  const crop = JSON.stringify(trip.properties.coverCrop);
  for (const key of ["x", "y", "zoom"]) expect(crop).toContain(`"${key}"`);
  expect(JSON.stringify(trip.properties.coverSource)).toContain('"manual"');
  expect(JSON.stringify(trip.properties.coverSource)).toContain('"auto"');
});
