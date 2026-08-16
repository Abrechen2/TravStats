import { describe, it, expect } from "@jest/globals";
import { lodgingCandidateFieldsSchema, type LodgingImportFlag } from "../../../schemas/lodgingImport";

/**
 * The commit used to create ANY unknown chain name it was handed
 * (`isUserAdded: true`), silently. That was tolerable while nothing produced
 * chain names; the parser now recognises the group behind a brand, so the
 * catalogue would grow by whatever a language model took for a chain —
 * "KOA", "Kampgrounds of America" and "Koa Resorts" as three chains.
 *
 * Owner decision, 2026-08-16: offer it, do not create it. The preview flags an
 * unknown chain and the user ticks it once.
 */
describe("createChain consent flag", () => {
  it("defaults to absent — an import that does not ask does not create", () => {
    const parsed = lodgingCandidateFieldsSchema.parse({ name: "Canton KOA Holiday", chainName: "KOA" });
    expect(parsed.createChain).toBeUndefined();
  });

  it("is carried when the user ticked it", () => {
    const parsed = lodgingCandidateFieldsSchema.parse({
      name: "Canton KOA Holiday",
      chainName: "KOA",
      createChain: true,
    });
    expect(parsed.createChain).toBe(true);
  });

  it("keeps `unknown_chain` in the flag vocabulary the UI reads", () => {
    const flag: LodgingImportFlag = "unknown_chain";
    expect(flag).toBe("unknown_chain");
  });
});
