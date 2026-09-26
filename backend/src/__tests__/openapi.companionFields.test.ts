import "../services/openapi/paths";
import { buildOpenApiDocument } from "../services/openapi/registry";

/**
 * Fields the Companion reads that the spec must NAME, not just carry as an
 * anonymous column (forgejo#132). A generated client types what the spec
 * says; a bare `string | null` with no format told it nothing about what the
 * value points at.
 */
type Schema = { properties?: Record<string, Record<string, unknown>> };
const schemas = (buildOpenApiDocument() as { components: { schemas: Record<string, Schema> } })
  .components.schemas;

describe("OpenAPI fields the Companion reads", () => {
  it("documents Place.coverPhotoId as the id of a visit photo, or null (item 12)", () => {
    const field = schemas.Place.properties?.coverPhotoId;
    expect(field).toMatchObject({ type: "string", format: "uuid", nullable: true });
    expect(String(field?.description)).toMatch(/visit photo/i);
  });
});
