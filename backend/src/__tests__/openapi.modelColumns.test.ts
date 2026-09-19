import type { Prisma } from "../prisma";

import "../services/openapi/paths";
import { buildOpenApiDocument } from "../services/openapi/registry";
import { prismaColumnNames } from "../services/openapi/prismaColumns";

/**
 * A schema that describes a returned Prisma row publishes every column of it
 * (forgejo#120).
 *
 * The hand-written schemas had drifted by dozens of fields — `Flight` showed
 * 36 of its 94 columns — and a client generated from, or checked against, the
 * spec could not see them. The columns are now spread from the model
 * (`prismaColumns`), and this fails the day a schema stops doing that.
 */
const ROW_SCHEMAS: ReadonlyArray<[schema: string, model: Prisma.ModelName]> = [
  ["Flight", "Flight"],
  ["Trip", "Trip"],
  ["Cruise", "Cruise"],
  ["CruiseStop", "CruiseStop"],
  ["Lodging", "Lodging"],
  ["Stay", "LodgingStay"],
  ["Place", "Place"],
  ["PlaceList", "PlaceList"],
  ["Achievement", "Achievement"],
];

type SchemaDoc = { properties?: Record<string, unknown> };

describe("OpenAPI row schemas", () => {
  const schemas = (buildOpenApiDocument() as { components: { schemas: Record<string, SchemaDoc> } })
    .components.schemas;

  it.each(ROW_SCHEMAS)("%s publishes every column of %s", (schema, model) => {
    const published = Object.keys(schemas[schema]?.properties ?? {});
    expect(prismaColumnNames(model).filter((column) => !published.includes(column))).toEqual([]);
  });

  it("names the achievement flag the way the route sends it", () => {
    const properties = Object.keys(schemas.Achievement.properties ?? {});
    expect(properties).toContain("isUnlocked");
    expect(properties).not.toContain("unlocked");
    expect(properties).toContain("progressPercentage");
  });

  it("describes no stay field the model does not have", () => {
    const properties = Object.keys(schemas.Stay.properties ?? {});
    expect(properties).not.toContain("roomType");
    expect(properties).not.toContain("price");
  });
});
