import { describe, it, expect } from "@jest/globals";
import { extractionSchema, type Extraction } from "../extraction";
import { extract } from "../extract";
import { TRANSFORMS } from "../transforms";

/**
 * forgejo#124: the `lines` repeat — one item printed over consecutive lines
 * (an itinerary's day above its port) — and the year-less day a cruise
 * itinerary prints. Every input is invented.
 */
function spec(raw: unknown): Extraction {
  return extractionSchema.parse(raw);
}

function issues(raw: unknown): string[] {
  const result = extractionSchema.safeParse(raw);
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
}

const ROW = {
  mode: "lines",
  rowLines: ["^(?<date>\\d{2}\\.\\d{2}\\.\\d{4})$", "^(?<port>[^\\d\\n].{0,60}?)$"],
  fields: { date: { group: "date", transform: "date" }, port: { group: "port" } },
  minimum: 0,
};

describe("v2 extraction — lines", () => {
  it("reads a row whose values sit on two consecutive lines", () => {
    const x = spec({ repeats: { stops: ROW } });
    const text =
      "Reiseverlauf\n01.06.2027\nMusterhafen\n02.06.2027\nAuf See\n03.06.2027\nProbeport";
    expect(extract(x, text).values.stops).toEqual([
      { date: "2027-06-01", port: "Musterhafen" },
      { date: "2027-06-02", port: "Auf See" },
      { date: "2027-06-03", port: "Probeport" },
    ]);
  });

  it("steps over blank lines between a row's lines only when asked", () => {
    const text = "01.06.2027\n\nMusterhafen\n02.06.2027\n\n\nProbeport";
    expect(extract(spec({ repeats: { stops: ROW } }), text).values.stops).toEqual([]);
    const lenient = spec({ repeats: { stops: { ...ROW, skipBlankLines: true } } });
    expect(extract(lenient, text).values.stops).toEqual([
      { date: "2027-06-01", port: "Musterhafen" },
      { date: "2027-06-02", port: "Probeport" },
    ]);
  });

  it("drops a row that breaks off, without consuming the line after it", () => {
    const text = "01.06.2027\n02.06.2027\nProbeport";
    expect(extract(spec({ repeats: { stops: ROW } }), text).values.stops).toEqual([
      { date: "2027-06-02", port: "Probeport" },
    ]);
  });

  it("never matches a line longer than the row-line limit", () => {
    const text = `01.06.2027\n${"P".repeat(501)}`;
    const wide = {
      ...ROW,
      rowLines: ["^(?<date>\\d{2}\\.\\d{2}\\.\\d{4})$", "^(?<port>P+)$"],
    };
    expect(extract(spec({ repeats: { stops: wide } }), text).values.stops).toEqual([]);
  });

  it("refuses a row line that matches nothing, a group twice, a numbered or unknown group", () => {
    expect(issues({ repeats: { s: { ...ROW, rowLines: ["^(?<date>x)$", "^$"] } } })).toEqual(
      expect.arrayContaining([expect.stringMatching(/rowLines\.1: .*empty string/)])
    );
    expect(
      issues({ repeats: { s: { ...ROW, rowLines: ["^(?<date>\\d+)$", "^(?<date>\\w+)$"] } } })
    ).toEqual(expect.arrayContaining([expect.stringMatching(/rowLines: invalid regex/)]));
    expect(issues({ repeats: { s: { ...ROW, fields: { a: { group: 1 } } } } })).toEqual(
      expect.arrayContaining([expect.stringMatching(/a row names its groups/)])
    );
    expect(issues({ repeats: { s: { ...ROW, fields: { a: { group: "nope" } } } } })).toEqual(
      expect.arrayContaining([expect.stringMatching(/group "nope" is not in the pattern/)])
    );
    expect(issues({ repeats: { s: { ...ROW, rowLines: ["^(?<date>x)$"] } } })).not.toEqual([]);
  });
});

describe("v2 transform — dateOrMonthDay", () => {
  it("keeps a full date, and writes a day without a year as --MM-DD", () => {
    const read = TRANSFORMS.dateOrMonthDay;
    expect(read("02.06.2027")).toBe("2027-06-02");
    expect(read("02.06.")).toBe("--06-02");
    expect(read("2. Juni")).toBe("--06-02");
    expect(read("June 2")).toBe("--06-02");
    expect(read("29.02.")).toBe("--02-29");
    expect(read("31.04.")).toBeNull();
    expect(read("Musterhafen")).toBeNull();
  });
});
