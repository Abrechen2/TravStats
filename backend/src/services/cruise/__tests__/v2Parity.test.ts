import fs from "fs";
import path from "path";
import {
  snapshotStatus,
  snapshotTemplate,
  snapshotTemplates,
} from "../../parsers/templates/v2/__tests__/snapshotTemplates";
import { testInputHaystack } from "../../parsers/templates/v2/runners";
import { applyV2CruiseTemplate } from "../v2Cruise";
import { parseTuiCruisesConfirmation } from "./legacy/tuiCruisesTemplate";

/**
 * Plan 2026-10-09 P4b: the TUI Cruises reader became a v2 template file. This
 * is the proof nothing was lost in the move — every cruise fixture in the
 * repository (the reader's own suite, the parser suites, the sample mails
 * under `test-samples/Kreuzfahrt-emails/`) and every test input of the file,
 * read by the old reader and by the file, gives the same cruises, down to
 * `parserTemplate`, `parserConfidence` and `missing`.
 */
const v2Read = (text: string) =>
  applyV2CruiseTemplate(snapshotTemplate("cruise:tui-cruises-confirmation"), text);

/** Every template-literal fixture of a test file, by name. */
function fixturesOf(file: string): Array<[string, string]> {
  const source = fs.readFileSync(file, "utf-8");
  return Array.from(
    source.matchAll(/const ([A-Z_][A-Z0-9_]*) = `([\s\S]*?)`;/g),
    (m) => [`${path.basename(file)}:${m[1]}`, m[2]] as [string, string]
  ).filter(([, text]) => !text.includes("${"));
}

const SAMPLE_DIR = path.resolve(__dirname, "../../../../../test-samples/Kreuzfahrt-emails");
const samples: Array<[string, string]> = fs.existsSync(SAMPLE_DIR)
  ? fs
      .readdirSync(SAMPLE_DIR)
      .filter((f) => /\.(txt|eml)$/i.test(f))
      .map((f) => [`sample:${f}`, fs.readFileSync(path.join(SAMPLE_DIR, f), "utf-8")])
  : [];

const own = fixturesOf(path.join(__dirname, "tuiCruisesTemplate.test.ts"));
const single = own.find(([name]) => name.endsWith(":SINGLE"))?.[1] ?? "";

const fixtures: Array<[string, string]> = [
  ...own,
  ["SINGLE without its price line", single.replace(/2 x Kreuzfahrtpreis.*\n/, "")],
  ["SINGLE without its cabin category", single.replace(/^Verandakabine.*\n/m, "")],
  ["SINGLE with CRLF line ends", single.replace(/\n/g, "\r\n")],
  ["SINGLE without the booking number", single.replace(/^Vorgang-Nr.*\n/m, "")],
  ...fixturesOf(path.join(__dirname, "../../__tests__/cruiseBookingParser.test.ts")),
  ...fixturesOf(path.join(__dirname, "../../__tests__/cruiseBookingParser.templateFirst.test.ts")),
  ...samples,
  ...snapshotTemplates("cruise").flatMap((t) =>
    t.testCases.map((c) => [`${t.id}: ${c.name}`, testInputHaystack(c.input)] as [string, string])
  ),
];

describe("cruise templates — legacy reader and v2 file agree", () => {
  it("the snapshot activates the TUI Cruises file and rejects none", () => {
    const status = snapshotStatus("cruise");
    expect(status.filter((t) => t.state !== "active")).toEqual([]);
    expect(status.map((t) => t.id)).toEqual(["cruise:tui-cruises-confirmation"]);
  });

  it("has fixtures to compare, including ones the reader reads", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(6);
    expect(
      fixtures.filter(([, text]) => parseTuiCruisesConfirmation(text).length > 0).length
    ).toBeGreaterThanOrEqual(3);
  });

  it.each(fixtures)("%s", (_name, text) => {
    expect(v2Read(text)).toEqual(parseTuiCruisesConfirmation(text));
  });
});
