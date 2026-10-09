import { describe, it, expect } from "@jest/globals";
import { extractionSchema, type Extraction } from "../extraction";
import { extract } from "../extract";
import { testInputHaystack } from "../runners";

/**
 * The rule options P4a added so the compiled-in issuer readers can become
 * template files: `stacked` + `labels`, `format`, `yearFrom`, and the split
 * options `prependHeader`, `wholeTextUnlessSplit` and a `lenient` fence.
 */
function spec(raw: unknown): Extraction {
  return extractionSchema.parse(raw);
}

function issues(raw: unknown): string[] {
  const result = extractionSchema.safeParse(raw);
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
}

describe("v2 extraction — stacked labels", () => {
  const x = spec({
    labels: ["Anreise", "Abreise", "Buchungspreis"],
    fields: {
      checkIn: { stacked: "Anreise", transform: ["dropFirstWord", "germanDate"] },
      checkOut: { stacked: "Abreise", transform: ["dropFirstWord", "germanDate"] },
      price: { stacked: "Buchungspreis", transform: "money" },
    },
  });

  it("steps over blank lines to the value under its label", () => {
    const text =
      "Anreise\n\nDi. 10. März 2026\nAbreise\n\nMi. 11. März 2026\nBuchungspreis\n89,00 €";
    expect(extract(x, text).values).toEqual({
      checkIn: "2026-03-10",
      checkOut: "2026-03-11",
      price: 89,
    });
  });

  it("never reports the next label's value for an empty field", () => {
    const text = "Anreise\n\nAbreise\nMi. 11. März 2026";
    expect(extract(x, text).values.checkIn).toBeNull();
    expect(extract(x, text).values.checkOut).toBe("2026-03-11");
  });

  it("refuses a rule that mixes stacked with patterns", () => {
    expect(issues({ fields: { a: { stacked: "X", patterns: ["(x)"] } } })[0]).toMatch(
      /exactly one of patterns, value or stacked/
    );
  });
});

describe("v2 extraction — format and yearFrom", () => {
  it("assembles a value from several groups, named or numbered", () => {
    const x = spec({
      fields: {
        dep: { patterns: ["^(\\d{2}\\.\\d{2}\\.\\d{4}) - (\\d{2}:\\d{2})$"], format: "{1}T{2}" },
        named: {
          patterns: ["(?<d>\\d{2})\\.(?<m>\\d{2}) (?<t>\\d{2}:\\d{2})"],
          format: "{d}.{m}.2010T{t}",
          transform: "dateTime",
        },
      },
    });
    const out = extract(x, "23.05.2025 - 12:25\n08.02 07:15").values;
    expect(out.dep).toBe("23.05.2025T12:25");
    expect(out.named).toBe("2010-02-08T07:15");
  });

  it("refuses a format naming a group the pattern does not have", () => {
    expect(issues({ fields: { a: { patterns: ["(x)"], format: "{1}T{2}" } } })[0]).toMatch(
      /\{2\} is not a group of pattern 0/
    );
    expect(issues({ fields: { a: { value: "x", format: "{1}" } } })[0]).toMatch(
      /format applies to patterns only/
    );
  });

  it("dates a year-less day with the year a sibling field read", () => {
    const x = spec({
      fields: {
        year: { patterns: ["^[^\\n]*?\\b(20\\d{2})\\b"], flags: "i", transform: "integer" },
        checkIn: {
          patterns: ["Check In: (\\w+ \\d+)"],
          transform: "englishDate",
          yearFrom: "year",
        },
      },
    });
    expect(extract(x, "Your 01 Oct 2018 Confirmation\nCheck In: Oct 01").values.checkIn).toBe(
      "2018-10-01"
    );
    expect(extract(x, "No year here\nCheck In: Oct 01").values.checkIn).toBeNull();
  });

  it("refuses a yearFrom that names itself, nothing, or another year-dependent field", () => {
    expect(issues({ fields: { a: { value: "x", yearFrom: "a" } } })[0]).toMatch(/yearFrom/);
    expect(issues({ fields: { a: { value: "x", yearFrom: "nope" } } })[0]).toMatch(/yearFrom/);
    expect(
      issues({
        fields: {
          y: { value: "2020" },
          a: { value: "x", yearFrom: "y" },
          b: { value: "x", yearFrom: "a" },
        },
      })
    ).toHaveLength(1);
  });
});

describe("v2 extraction — split repeats with a header", () => {
  const legs = (extra: Record<string, unknown> = {}): Extraction =>
    spec({
      repeats: {
        legs: {
          mode: "split",
          splitPattern: "^Leg \\d$",
          prependHeader: true,
          ...extra,
          fields: {
            ref: { patterns: ["Code: (\\w+)"] },
            flight: { patterns: ["^Flight (\\w+)$"] },
          },
        },
      },
    });

  it("puts the header in front of every block and reads the shared code in each", () => {
    const text = "Code: QX7TST\nLeg 1\nFlight LH1\nLeg 2\nFlight LH2";
    expect(extract(legs(), text).values.legs).toEqual([
      { ref: "QX7TST", flight: "LH1" },
      { ref: "QX7TST", flight: "LH2" },
    ]);
  });

  it("reads the whole text as one item when fewer than two blocks are found", () => {
    const text = "Code: QX7TST\nFlight LH9";
    const fenced = { within: { startAfter: "^Overview$" } };
    expect(extract(legs({ ...fenced, wholeTextUnlessSplit: true }), text).values.legs).toEqual([
      { ref: "QX7TST", flight: "LH9" },
    ]);
    expect(extract(legs(fenced), text).values.legs).toEqual([]);
  });

  it("a lenient fence that does not occur widens the scope; a strict one empties it", () => {
    const text = "Code: QX7TST\nLeg 1\nFlight LH1\nLeg 2\nFlight LH2\nEnd\nLeg 3\nFlight LH3";
    const fence = { startAfter: "^Overview$", endBefore: "^End$" };
    expect(extract(legs({ within: { ...fence, lenient: true } }), text).values.legs).toHaveLength(
      2
    );
    expect(extract(legs({ within: fence }), text).values.legs).toEqual([]);
  });
});

describe("testInputHaystack", () => {
  it("adds no line for a part the input does not carry, so the subject stays first", () => {
    expect(testInputHaystack({ subject: "S", text: "T" })).toBe("S\nT");
    expect(testInputHaystack({ from: "F", subject: "S", text: "T" })).toBe("F\nS\nT");
    expect(testInputHaystack({ text: "T" })).toBe("T");
  });
});
