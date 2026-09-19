import { Prisma } from "../../../prisma";
import { prismaModelFields, prismaModelNames } from "../prismaDatamodel";

/**
 * The reader that replaced `Prisma.dmmf` (removed in Prisma 7).
 *
 * `openapi.modelColumns.test.ts` compares the published schema against what
 * this reader reports, so it cannot catch a reader that reports too LITTLE —
 * fewer columns would only make that assertion easier. These cases pin the
 * reader against the schema itself, and against the generator's own list of
 * models, which is the one thing here that does not come from the same parse.
 */
describe("prismaDatamodel", () => {
  it("finds every model the generated client knows about", () => {
    const declared = new Set(prismaModelNames());
    const generated = Object.values(Prisma.ModelName);
    expect(generated.length).toBeGreaterThan(50);
    expect(generated.filter((model) => !declared.has(model))).toEqual([]);
  });

  it("reads the modifier, which the runtime datamodel no longer carries", () => {
    const credential = prismaModelFields("WebAuthnCredential");
    // `transports String[] @default([])` — the one scalar list in the schema,
    // and the reason `isList` cannot be assumed false.
    expect(credential.find((f) => f.name === "transports")).toMatchObject({
      kind: "scalar",
      type: "String",
      isList: true,
      isRequired: true,
    });

    const user = prismaModelFields("User");
    expect(user.find((f) => f.name === "id")).toMatchObject({
      isRequired: true,
      isList: false,
    });
    // `firstName String?` — nullable, which is what the OpenAPI schema says.
    expect(user.find((f) => f.name === "firstName")).toMatchObject({
      kind: "scalar",
      isRequired: false,
    });
  });

  it("marks a relation as an object so the column list can drop it", () => {
    const user = prismaModelFields("User");
    expect(user.find((f) => f.name === "flights")).toMatchObject({
      kind: "object",
      type: "Flight",
      isList: true,
    });
  });

  it("raises on a model that does not exist rather than reporting no columns", () => {
    expect(() => prismaModelFields("NoSuchModel")).toThrow(/no Prisma model named/);
  });
});
