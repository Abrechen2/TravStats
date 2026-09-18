import fs from "fs";
import path from "path";
import { applyTemplate } from "../engine";
import { isValidAirlineTemplate, type AirlineTemplate, type SelectorKey } from "../types";

/**
 * The built-in airline templates, checked as data and then RUN.
 *
 * Measured 2026-09-17, and the reason this file exists: the nine templates
 * shipped in `templates/airlines/` had no test of their own at all. Seven of
 * them carry zero `testCases`, and the two that carry one had nobody
 * executing it — so the field looked like coverage and was decoration. The
 * owner's corpus only exercises Lufthansa (measured: `LH-old` 19 mails, `LH`
 * 8, generic regex 4), which means a change to the registry or the engine
 * could break EW, FR, LX, OS, SN, U2 or W6 and every check we have would
 * still pass.
 *
 * Two things are pinned here. The templates are valid and uniquely keyed —
 * cheap, and it catches a hand-edited JSON before a user's import does. And
 * every `testCases` entry actually runs through the engine, so writing one is
 * now worth something.
 *
 * The third thing is a ratchet rather than a rule: the seven without a test
 * case are listed, and the list may only shrink. A template added from today
 * carries its own example.
 */
const DIR = path.join(__dirname, "..", "airlines");

/**
 * Frozen 2026-09-17. Each of these predates the rule, and each is a template
 * nobody can currently prove works. Removing a name from this list means
 * adding a `testCases` entry to that file — never the other way round.
 */
const WITHOUT_TEST_CASES = ["EW", "FR", "LX", "OS", "SN", "U2", "W6"];

function loadAll(): Array<{ file: string; template: AirlineTemplate }> {
  return fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .map((file) => {
      const raw: unknown = JSON.parse(fs.readFileSync(path.join(DIR, file), "utf-8"));
      if (!isValidAirlineTemplate(raw)) throw new Error(`${file} is not a valid AirlineTemplate`);
      return { file, template: raw };
    });
}

describe("the built-in airline templates", () => {
  const all = loadAll();

  it("ships at least the nine the registry was measured with", () => {
    expect(all.length).toBeGreaterThanOrEqual(9);
  });

  it("is valid JSON in the template shape, every file", () => {
    // `loadAll` throws otherwise; this states the expectation out loud.
    expect(all.map((t) => t.file).sort()).toEqual(
      fs
        .readdirSync(DIR)
        .filter((f) => f.endsWith(".json"))
        .sort()
    );
  });

  // Measured while writing this: the key is NOT always an IATA code. `LH-old`
  // keys itself that way on purpose — the registry stores one template per
  // key, so an older mail format needs a key of its own or the current one
  // would shadow it. The corpus says it earns its place: 19 of the owner's 31
  // flight mails are read by `LH-old` and 8 by `LH`.
  it("keys each template distinctly, by an IATA code or a named variant of one", () => {
    const keys = all.map((t) => t.template.iata);
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
    for (const { file, template } of all) {
      expect({ file, key: template.iata }).toEqual({
        file,
        key: expect.stringMatching(/^[A-Z0-9]{2}(-[a-z]+)?$/) as unknown as string,
      });
    }
  });

  it("names an airline and a version in every file", () => {
    for (const { file, template } of all) {
      expect({ file, airline: template.airline.length > 0 }).toEqual({ file, airline: true });
      expect({ file, version: template.version.length > 0 }).toEqual({ file, version: true });
    }
  });

  // The ratchet. It fails on a NEW template without an example, and on a
  // stale entry — a file that has gained one but is still on the list.
  it("carries at least one test case, except for the seven frozen on 2026-09-17", () => {
    const without = all
      .filter(({ template }) => template.testCases.length === 0)
      .map(({ template }) => template.iata)
      .sort();
    expect(without).toEqual([...WITHOUT_TEST_CASES].sort());
  });

  describe("every test case a template carries", () => {
    const cases = all.flatMap(({ file, template }) =>
      template.testCases.map((testCase, index) => ({ file, template, testCase, index }))
    );

    it("there is at least one to run", () => {
      expect(cases.length).toBeGreaterThan(0);
    });

    it.each(cases.map((c) => [`${c.file} #${c.index}`, c] as const))(
      "%s extracts what it says it does",
      (_name, { template, testCase }) => {
        const parsed = applyTemplate(template, testCase.input, "");
        const actual: Record<string, unknown> = {};
        for (const key of Object.keys(testCase.expected) as SelectorKey[]) {
          // The booking key and the selector key agree for everything a test
          // case states today; a template that needs the mapping can add it
          // here rather than in each case.
          actual[key] = (parsed as unknown as Record<string, unknown>)[key];
        }
        expect(actual).toEqual(testCase.expected);
      }
    );
  });
});
