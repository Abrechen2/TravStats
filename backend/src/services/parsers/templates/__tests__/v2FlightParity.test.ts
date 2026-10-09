import fs from "fs";
import path from "path";
import { applyTemplateAll } from "../engine";
import { isValidAirlineTemplate, type AirlineTemplate } from "../types";
import { applyV2FlightTemplate, flightTemplateName } from "../v2Flight";
import { createMemoryTemplateCache } from "../v2/cache";
import { V2TemplateStore } from "../v2/loader";
import { createDirSnapshot } from "../v2/snapshot";
import { testInputHaystack } from "../v2/runners";
import type { TemplateEnvelope } from "../v2/envelope";

/**
 * Plan 2026-10-09 P4a: the six airline templates that read text (LH-old, LH,
 * 4U, EK, EK-old, AB) became v2 template files. This is the proof that the
 * move lost nothing — every match input of every file, read by the v1 engine
 * with the v1 template and by the v2 file, gives the same legs field for
 * field, including `parserTemplate`, `parserConfidence`, `missing` and the
 * "+1" arrival.
 *
 * The end-to-end suites (`templateParser.*`, `segments`) run through the v2
 * path and pin the same values from the parser's side.
 */
const V1_DIR = path.join(__dirname, "fixtures", "v1-airlines");
const CONVERTED = ["LH-old", "LH", "4U", "EK", "EK-old", "AB"];

function v1(name: string): AirlineTemplate {
  const raw: unknown = JSON.parse(fs.readFileSync(path.join(V1_DIR, `${name}.json`), "utf-8"));
  if (!isValidAirlineTemplate(raw)) throw new Error(`${name} is not a v1 template`);
  return raw;
}

function snapshotFlights(): TemplateEnvelope[] {
  const store = new V2TemplateStore({
    fetchJson: () => Promise.reject(new Error("offline")),
    baseUrl: "https://templates.example.test",
    appVersion: "99.0.0",
    cache: createMemoryTemplateCache(),
    snapshot: createDirSnapshot(),
  });
  store.loadFromCache();
  return store.getActive().filter((t) => t.domain === "flight");
}

const withoutNotice = (legs: object[]): object[] =>
  legs.map((leg) => JSON.parse(JSON.stringify({ ...leg, airlineNotice: undefined })) as object);

describe("airline templates — v1 engine and v2 file agree", () => {
  const flights = snapshotFlights();

  it("the snapshot activates a v2 file for every converted airline, in v1 detection order", () => {
    expect(flights.map(flightTemplateName)).toEqual(CONVERTED);
  });

  const cases = flights.flatMap((t) =>
    t.testCases
      .filter((c) => c.expect === "match")
      .map((c) => [flightTemplateName(t), c.name, t, c.input] as const)
  );

  it("has fixtures to compare", () => {
    expect(cases.length).toBeGreaterThanOrEqual(CONVERTED.length * 2);
  });

  it.each(cases)("%s — %s", (name, _case, template, input) => {
    const text = typeof input === "string" ? input : input.text;
    const outcome = applyV2FlightTemplate(template, input);
    expect(outcome.kind).toBe("legs");
    const legs = outcome.kind === "legs" ? outcome.legs : [];
    expect(withoutNotice(legs)).toEqual(withoutNotice(applyTemplateAll(v1(name), text, "")));
    expect(testInputHaystack(input)).toContain(text);
  });
});
