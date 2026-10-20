import { describe, it, expect } from "vitest";
import { describeParseResult, parserErrorLine } from "../parserErrorCopy";

/** Echoes the key and its options, so the test sees what was asked for. */
const t = (key: string, options?: Record<string, unknown>): string =>
  options ? `${key} ${JSON.stringify(options)}` : key;

describe("parser error copy — tracker exports (forgejo#311)", () => {
  it("names the file's own line when the parser knows it", () => {
    // App in the Air's lines are not "header + one per row"; rowIndex + 2
    // would point at the wrong line.
    const line = parserErrorLine(
      { rowIndex: 1, line: 23, code: "malformedEntry", message: "x" },
      t
    );
    expect(line).toContain('"line":23');
  });

  it("names the entry of a JSON export, which has no lines", () => {
    const line = parserErrorLine(
      { rowIndex: 3, entry: 4, code: "malformedEntry", message: "x" },
      t
    );
    expect(line).toContain("settings:import.parserErrors.entry");
    expect(line).toContain('"entry":4');
  });

  it("lists what each format is recognised by when the file is unknown", () => {
    const outcome = describeParseResult(
      {
        rows: [],
        parserErrors: [{ rowIndex: -1, code: "unknownFormat", message: "Unrecognised file" }],
      },
      t,
      { expected: { jetlog: ["date", "origin", "destination"], fr24: ["Date", "Flight number"] } }
    );
    expect(outcome.fatal).toContain("settings:import.parserErrors.unknownFormat");
    expect(outcome.fatal).toContain("settings:import.tile.tracker.formats.jetlog");
    expect(outcome.fatal).toContain("date, origin, destination");
    expect(outcome.fatal).toContain("Date, Flight number");
  });
});
