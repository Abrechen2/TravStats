import { readFileSync } from "fs";
import { join } from "path";
import { pluginContractSchema, serialiseContract } from "../contractSchema";

/**
 * OpenAPI ↔ contract equality (spec 2026-11-23-plugins-and-calendar.md, P5): the
 * template's v1.schema.json is the server's own components, byte for byte. A
 * change to services/plugins/contract.ts must be exported
 * (`npx tsx scripts/export-plugin-contract.ts`) before this passes.
 */
const FILE = join(
  __dirname,
  "../../../../../packages/travstats-plugin-template/contract/v1.schema.json"
);

describe("plugin contract schema", () => {
  it("equals the server's OpenAPI components", () => {
    expect(readFileSync(FILE, "utf8")).toBe(serialiseContract(pluginContractSchema()));
  });

  it("holds the rules the server enforces", () => {
    const defs = pluginContractSchema().$defs as Record<
      string,
      { properties: Record<string, unknown>; required?: string[] }
    >;
    const suggestion = defs.SuggestionPluginSuggestionV1;
    expect(suggestion.required).toEqual(expect.arrayContaining(["name", "confidence"]));
    expect(suggestion.properties.confidence).toMatchObject({ minimum: 0, maximum: 1 });
    expect(defs.SuggestionPluginResponseV1.properties.suggestions).toMatchObject({ maxItems: 5 });
  });

  // rc.47: the object externalRef referenced a component the export left out, so every
  // validator of the vendored file failed on "can't resolve reference".
  it("resolves every $ref inside the exported file", () => {
    const schema = pluginContractSchema();
    const defs = Object.keys(schema.$defs as Record<string, unknown>);
    const refs = [...serialiseContract(schema).matchAll(/"\$ref":\s*"#\/\$defs\/([^"]+)"/g)].map(
      (m) => m[1]
    );
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.filter((r) => !defs.includes(r))).toEqual([]);
  });
});
