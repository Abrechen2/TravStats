import { testInputHaystack } from "../../../parsers/templates/v2/runners";
import { createMemoryTemplateCache } from "../../../parsers/templates/v2/cache";
import { V2TemplateStore } from "../../../parsers/templates/v2/loader";
import { createDirSnapshot } from "../../../parsers/templates/v2/snapshot";
import { LEGACY_IDS, legacyReader, snapshotTemplates, v2Reader } from "./readers";

/**
 * Plan 2026-10-09 P4a: every compiled-in lodging reader became a v2 template
 * file. This is the proof that nothing was lost in the move — each file's own
 * test inputs (match AND decline), read by the old reader and by the file,
 * give the same stay field for field, down to `parserTemplate`,
 * `parserConfidence` and `missing`.
 *
 * The per-issuer suites (`builtins`, `hrs`, `nh`, `armani`,
 * `bookingComLegacy`) run every one of their cases through both readers too.
 */
describe("lodging templates — legacy reader and v2 file agree", () => {
  it("the snapshot activates a v2 file for every legacy reader, and rejects none", () => {
    const store = new V2TemplateStore({
      fetchJson: () => Promise.reject(new Error("offline")),
      baseUrl: "https://templates.example.test",
      appVersion: "99.0.0",
      cache: createMemoryTemplateCache(),
      snapshot: createDirSnapshot(),
    });
    store.loadFromCache();
    const lodging = store.getStatus().templates.filter((t) => t.domain === "lodging");
    expect(lodging.filter((t) => t.state !== "active")).toEqual([]);
    expect(lodging.map((t) => t.id).sort()).toEqual([...LEGACY_IDS].sort());
    expect(lodging.every((t) => t.source === "snapshot")).toBe(true);
  });

  const cases = snapshotTemplates()
    .filter((t) => t.domain === "lodging")
    .flatMap((t) =>
      t.testCases.map((c) => {
        const [subject, ...rest] = testInputHaystack(c.input).split("\n");
        return [t.id, c.name, subject, rest.join("\n")] as const;
      })
    );

  it("has fixtures to compare", () => {
    expect(cases.length).toBeGreaterThanOrEqual(LEGACY_IDS.length * 2);
  });

  it.each(cases)("%s — %s", (id, _name, subject, body) => {
    expect(v2Reader(id, subject, body)).toEqual(legacyReader(id, subject, body));
  });
});
