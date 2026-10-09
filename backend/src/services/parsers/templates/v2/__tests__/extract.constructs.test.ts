import { describe, it, expect } from "@jest/globals";
import { extractionSchema, type Extraction } from "../extraction";
import { extract } from "../extract";

/**
 * The generic constructs plan 2026-10-09 P4b added so the last issuer readers
 * could become template files: value steps (`replace`, `map`, `scan`, `in`),
 * item fields (`format`, `value`, `lastBefore`, `find`), the `columns` and
 * `pairs` modes, `zip`, `compute`, nested repeats with `emit`, `skipPreamble`,
 * `skipItemsWithout` and `preprocess`. Every input is invented.
 */
function spec(raw: unknown): Extraction {
  return extractionSchema.parse(raw);
}

function issues(raw: unknown): string[] {
  const result = extractionSchema.safeParse(raw);
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
}

describe("v2 extraction — value steps", () => {
  it("replace runs on the raw text, then the transforms, then map", () => {
    const x = spec({
      fields: {
        tariff: { patterns: ["^Tarif: (.+)$"], replace: [[",?\\s*[12]\\.\\s*Klasse.*$", "", "i"]] },
        direction: {
          patterns: ["^(Hinfahrt|Rückfahrt)$"],
          map: [
            ["^h", "outbound"],
            ["^r", "return"],
          ],
        },
        sea: { patterns: ["^Tag 2: (\\w+)$"], map: [["^seetag$", true]] },
        unknown: { patterns: ["^Tag 1: (\\w+)$"], map: [["^seetag$", true]] },
      },
    });
    const text = "Tarif: Sparpreis, 2. Klasse\nRückfahrt\nTag 1: Hafen\nTag 2: Seetag";
    expect(extract(x, text).values).toEqual({
      tariff: "Sparpreis",
      direction: "return",
      sea: true,
      unknown: null,
    });
  });

  it("scan tries every match of a pattern until one survives the transforms", () => {
    const rule = { patterns: ["^Gesamtpreis\\n(.+)$"], transform: "leadingAmount" };
    const text = "Gesamtpreis\nTEL 1.234,50\nGesamtpreis\nCHF 99,00";
    expect(extract(spec({ fields: { total: rule } }), text).values.total).toBeNull();
    expect(extract(spec({ fields: { total: { ...rule, scan: true } } }), text).values.total).toBe(
      99
    );
  });

  it("a field confined to the subject (`in`) does not read the body", () => {
    const x = spec({ fields: { invoice: { patterns: ["Rechnung (\\d{6})"], in: "subject" } } });
    expect(
      extract(x, "Rechnung 111111\nRechnung 222222", {
        subject: "Ihre Rechnung 333333",
        text: "Rechnung 222222",
      }).values.invoice
    ).toBe("333333");
    expect(extract(x, "Rechnung 222222", { text: "Rechnung 222222" }).values.invoice).toBeNull();
  });

  it("preprocess cleans the text before extraction", () => {
    const zw = String.fromCharCode(0x200c);
    const x = spec({
      preprocess: [
        "stripZeroWidth",
        "stripCarriageReturns",
        "stripLinks",
        "collapseSpaces",
        "trimLines",
        "dropBlankLines",
      ],
      fields: { ref: { patterns: ["^Buchung: (\\d+)\\nAbholung"], flags: "m" } },
    });
    const text = `<https://x.invalid/a>  \tBuchung: \t${zw}12345${zw}\r\n\r\n   Abholung`;
    expect(extract(x, text).values.ref).toBe("12345");
  });
});

describe("v2 extraction — matchAll item fields", () => {
  const x = spec({
    repeats: {
      legs: {
        mode: "matchAll",
        pattern: "^von (?<dep>\\w+) (?<time>\\d\\d:\\d\\d)(?<rest>[^\\n]*)$",
        fields: {
          dep: { group: "dep" },
          label: { format: "{dep} um {time}" },
          operator: { value: "Bahn" },
          direction: {
            lastBefore: "^(Hinfahrt|Rückfahrt)$",
            map: [
              ["^h", "outbound"],
              ["^r", "return"],
            ],
          },
          train: {
            group: "rest",
            find: { pattern: "\\b(ICE|IC)\\s?(\\d+)", flags: "" },
            transform: "trim",
          },
        },
      },
    },
  });

  it("reads groups, formats, constants, the heading in force and a found token", () => {
    const text = "Hinfahrt\nvon Kiel 08:05 mit ICE 578\nRückfahrt\nvon Bremen 17:10 ice 1";
    expect(extract(x, text).values.legs).toEqual([
      {
        dep: "Kiel",
        label: "Kiel um 08:05",
        operator: "Bahn",
        direction: "outbound",
        train: "ICE",
      },
      {
        dep: "Bremen",
        label: "Bremen um 17:10",
        operator: "Bahn",
        direction: "return",
        train: null,
      },
    ]);
  });

  it("an item before any heading has none", () => {
    expect(extract(x, "von Kiel 08:05").values.legs).toEqual([
      expect.objectContaining({ direction: null }),
    ]);
  });
});

describe("v2 extraction — columns, pairs and zip", () => {
  const table = spec({
    repeats: {
      stops: {
        mode: "columns",
        columns: {
          station: { pattern: "^(?![\\d]|ab |an |ICE |IC )([^\\n]+)$" },
          date: { pattern: "^(\\d\\d\\.\\d\\d\\.)$" },
          kind: { pattern: "^(ab|an) \\d\\d:\\d\\d$" },
          time: { pattern: "^(?:ab|an) (\\d\\d:\\d\\d)$" },
        },
        flags: "gm",
        minimum: 0,
      },
      products: {
        mode: "matchAll",
        pattern: "^(?<cat>ICE|IC) (?<num>\\d+)",
        flags: "gm",
        fields: { cat: { group: "cat" }, num: { group: "num" } },
        minimum: 0,
      },
      legs: {
        mode: "pairs",
        of: "stops",
        open: { field: "kind", pattern: "^ab$" },
        close: { field: "kind", pattern: "^an$" },
        fields: {
          from: { from: "open", field: "station" },
          to: { from: "close", field: "station" },
          dep: { from: "open", field: "time" },
        },
        zip: { with: "products", strict: true },
        compute: { label: { format: "{from}–{to} {cat}{num}" } },
        minimum: 0,
      },
    },
  });

  it("zips the columns of a table printed column by column, pairs ab with an, and adds the products", () => {
    const text = [
      "Kiel",
      "Hamburg",
      "Hamburg",
      "Bremen",
      "01.03.",
      "01.03.",
      "01.03.",
      "01.03.",
      "ab 08:05",
      "an 09:17",
      "ab 09:46",
      "an 10:43",
      "ICE 1507",
      "IC 2217",
    ].join("\n");
    const { legs } = extract(table, text).values as { legs: unknown[] };
    expect(legs).toEqual([
      {
        from: "Kiel",
        to: "Hamburg",
        dep: "08:05",
        cat: "ICE",
        num: "1507",
        label: "Kiel–Hamburg ICE1507",
      },
      {
        from: "Hamburg",
        to: "Bremen",
        dep: "09:46",
        cat: "IC",
        num: "2217",
        label: "Hamburg–Bremen IC2217",
      },
    ]);
  });

  it("reads nothing when a column lost a cell, and zips nothing when the counts differ", () => {
    const ragged = ["Kiel", "Hamburg", "Bremen", "01.03.", "01.03.", "ab 08:05", "an 09:17"].join(
      "\n"
    );
    expect(extract(table, ragged).values.stops).toEqual([]);
    const oneProduct = [
      "Kiel",
      "Hamburg",
      "01.03.",
      "01.03.",
      "ab 08:05",
      "an 09:17",
      "ICE 1",
      "IC 2",
    ].join("\n");
    expect(extract(table, oneProduct).values.legs).toEqual([
      { from: "Kiel", to: "Hamburg", dep: "08:05", label: null },
    ]);
  });

  it("a later open replaces an earlier one; a close without an open is ignored", () => {
    const text = [
      "A",
      "B",
      "C",
      "D",
      "01.03.",
      "01.03.",
      "01.03.",
      "01.03.",
      "an 07:00",
      "ab 08:00",
      "ab 08:30",
      "an 09:00",
    ].join("\n");
    expect(extract(table, text).values.legs).toEqual([
      expect.objectContaining({ from: "C", to: "D", dep: "08:30" }),
    ]);
  });
});

describe("v2 extraction — nested repeats", () => {
  const sections = spec({
    repeats: {
      routes: {
        mode: "matchAll",
        pattern: "^Route: (?<r>.+)$",
        flags: "gm",
        fields: { route: { group: "r" } },
        minimum: 0,
      },
      cruises: {
        mode: "split",
        splitPattern: "^Schiff \\w+",
        flags: "gm",
        skipPreamble: true,
        zip: { with: "routes" },
        fields: { ship: { patterns: ["^Schiff (\\w+)"] } },
        repeats: {
          stops: {
            mode: "matchAll",
            pattern: "^(?<d>\\d\\d\\.\\d\\d\\.) (?<port>.+)$",
            flags: "gm",
            fields: { day: { group: "d" }, port: { group: "port" } },
            compute: { where: { format: "{port} ({parent.ship})" } },
            skipItemsWithout: ["port"],
          },
        },
      },
    },
  });

  it("each block reads its own repeat; the preamble is skipped; the header routes zip by position", () => {
    const text =
      "Kopfzeile\nRoute: Nord\nRoute: Süd\nSchiff Alpha\n01.06. Kiel\n02.06. Oslo\nSchiff Beta\n03.06. Riga";
    expect(extract(sections, text).values.cruises).toEqual([
      {
        ship: "Alpha",
        route: "Nord",
        stops: [
          { day: "01.06.", port: "Kiel", where: "Kiel (Alpha)" },
          { day: "02.06.", port: "Oslo", where: "Oslo (Alpha)" },
        ],
      },
      {
        ship: "Beta",
        route: "Süd",
        stops: [{ day: "03.06.", port: "Riga", where: "Riga (Beta)" }],
      },
    ]);
  });

  it("emit makes the nested items the repeat's items", () => {
    const emitting = spec({
      repeats: {
        legs: {
          mode: "split",
          splitPattern: "^Abschnitt am (\\d\\d\\.\\d\\d\\.\\d{4})$",
          flags: "gm",
          skipPreamble: true,
          fields: { date: { patterns: ["^Abschnitt am (\\S+)$"], transform: "date" } },
          repeats: {
            rows: {
              mode: "matchAll",
              pattern: "^(?<s>\\w+) (?<dm>\\d\\d\\.\\d\\d\\.)$",
              flags: "gm",
              fields: { station: { group: "s" }, dm: { group: "dm" } },
              compute: { day: { format: "{dm} {parent.date}", transform: "dayMonthNear" } },
            },
          },
          emit: ["rows"],
        },
      },
    });
    const text =
      "Kopf\nAbschnitt am 30.12.2024\nKiel 31.12.\nBremen 01.01.\nAbschnitt am 05.01.2025\nRiga 05.01.";
    expect(extract(emitting, text).values.legs).toEqual([
      { station: "Kiel", dm: "31.12.", day: "2024-12-31" },
      { station: "Bremen", dm: "01.01.", day: "2025-01-01" },
      { station: "Riga", dm: "05.01.", day: "2025-01-05" },
    ]);
  });
});

describe("v2 extraction — validation of the new constructs", () => {
  it("a repeat may only name EARLIER siblings", () => {
    expect(
      issues({
        repeats: {
          legs: {
            mode: "pairs",
            of: "stops",
            open: { field: "k", pattern: "a" },
            close: { field: "k", pattern: "b" },
            fields: {},
          },
          stops: { mode: "columns", columns: { k: { pattern: "x" } } },
        },
      })
    ).toEqual(['repeats.legs.of: "stops" is no earlier sibling repeat']);
    expect(
      issues({
        repeats: {
          a: { mode: "matchAll", pattern: "x", fields: { v: { group: 0 } }, zip: { with: "b" } },
          b: { mode: "matchAll", pattern: "y", fields: { v: { group: 0 } } },
        },
      })
    ).toEqual(['repeats.a.zip.with: "b" is no earlier sibling repeat']);
  });

  it("pairs name values the source repeat has; emit names nested repeats", () => {
    expect(
      issues({
        repeats: {
          stops: { mode: "columns", columns: { k: { pattern: "x" } } },
          legs: {
            mode: "pairs",
            of: "stops",
            open: { field: "nope", pattern: "a" },
            close: { field: "k", pattern: "b" },
            fields: { s: { from: "open", field: "gone" } },
          },
        },
      })
    ).toEqual([
      'repeats.legs.open.field: "nope" is not a value',
      'repeats.legs.fields.s.field: "gone" is not a value of "stops"',
    ]);
    expect(
      issues({
        repeats: { r: { mode: "split", splitPattern: "x", fields: {}, emit: ["missing"] } },
      })
    ).toEqual(['repeats.r.emit.0: "missing" is no nested repeat']);
  });

  it("an item field needs exactly one source, and its groups and regexes must exist", () => {
    expect(
      issues({ repeats: { r: { mode: "matchAll", pattern: "(a)", fields: { v: {} } } } })[0]
    ).toMatch(/needs exactly one of group, format, value or lastBefore/);
    expect(
      issues({
        repeats: { r: { mode: "matchAll", pattern: "(a)", fields: { v: { format: "{zz}" } } } },
      })
    ).toEqual(["repeats.r.fields.v.format: {zz} is not in the pattern"]);
    expect(
      issues({
        repeats: {
          r: { mode: "matchAll", pattern: "(a)", fields: { v: { group: 1, find: "(" } } },
        },
      })[0]
    ).toMatch(/^repeats\.r\.fields\.v\.find: invalid regex/);
    expect(issues({ fields: { v: { patterns: ["a"], map: [["(", "x"]] } } })[0]).toMatch(
      /^fields\.v\.map\.0: invalid regex/
    );
  });

  it("scan and in apply to patterns only; preprocess names known steps", () => {
    expect(issues({ fields: { v: { value: "x", scan: true } } })[0]).toMatch(
      /scan applies to patterns only/
    );
    expect(issues({ preprocess: ["shout"] }).length).toBeGreaterThan(0);
  });
});
