import { describe, it, expect } from "@jest/globals";
import { extractionSchema, type Extraction } from "../extraction";
import { boundedTest, extract, MAX_REPEAT_ITEMS, EXTRACT_TIMEOUT_MS } from "../extract";

/** Parses through the real schema, so every test reads a VALIDATED extraction. */
function spec(raw: unknown): Extraction {
  return extractionSchema.parse(raw);
}

function issues(raw: unknown): string[] {
  const result = extractionSchema.safeParse(raw);
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
}

describe("v2 extraction — validation", () => {
  it("accepts an empty block and a full one", () => {
    expect(issues({})).toEqual([]);
    expect(
      issues({
        fields: { ref: { patterns: ["Nr\\.\\s*(\\w+)"] }, kind: { value: "tour" } },
        repeats: {
          legs: {
            mode: "matchAll",
            pattern: "(?<from>[A-Z]{3})-(\\w+)",
            fields: { a: { group: "from" }, b: { group: 2 } },
          },
        },
        required: ["ref", "legs"],
      })
    ).toEqual([]);
  });

  it("rejects a regex that does not compile, wherever it sits", () => {
    expect(issues({ fields: { a: { patterns: ["(unclosed"] } } })[0]).toMatch(
      /^fields\.a\.patterns\.0: invalid regex/
    );
    expect(issues({ repeats: { r: { mode: "matchAll", pattern: "[", fields: {} } } })[0]).toMatch(
      /^repeats\.r\.pattern: invalid regex/
    );
    expect(
      issues({
        repeats: {
          r: { mode: "split", splitPattern: "x", within: { startAfter: "(" }, fields: {} },
        },
      })[0]
    ).toMatch(/^repeats\.r\.within\.startAfter: invalid regex/);
    expect(
      issues({
        repeats: { r: { mode: "split", splitPattern: "x", fields: { f: { patterns: ["*"] } } } },
      })[0]
    ).toMatch(/^repeats\.r\.fields\.f\.patterns\.0: invalid regex/);
  });

  it("rejects a repeat pattern that matches the empty string", () => {
    expect(issues({ repeats: { r: { mode: "matchAll", pattern: "a*", fields: {} } } })).toEqual([
      "repeats.r.pattern: pattern matches the empty string",
    ]);
  });

  it("rejects unknown transforms, bad flags and a missing matchAll group", () => {
    expect(
      issues({ fields: { a: { patterns: ["(x)"], transform: "shout" } } }).length
    ).toBeGreaterThan(0);
    expect(
      issues({ fields: { a: { patterns: ["(x)"], transform: ["trim", "shout"] } } }).length
    ).toBeGreaterThan(0);
    expect(issues({ fields: { a: { patterns: ["(x)"], flags: "iy" } } })[0]).toMatch(
      /flags must be drawn from gimsu/
    );
    expect(issues({ fields: { a: { patterns: ["(x)"], flags: "ii" } } })[0]).toMatch(
      /must not repeat/
    );
    expect(
      issues({
        repeats: {
          r: {
            mode: "matchAll",
            pattern: "(?<a>x)",
            fields: { f: { group: "b" }, g: { group: 2 } },
          },
        },
      })
    ).toEqual([
      'repeats.r.fields.f.group: group "b" is not in the pattern',
      "repeats.r.fields.g.group: group 2 is not in the pattern",
    ]);
  });

  it("rejects patterns AND value, neither, a bad required name and a name used twice", () => {
    expect(issues({ fields: { a: { patterns: ["(x)"], value: "x" } } })[0]).toMatch(
      /exactly one of patterns, value or stacked/
    );
    expect(issues({ fields: { a: {} } })[0]).toMatch(/exactly one of patterns, value or stacked/);
    expect(issues({ fields: { a: { value: "x" } }, required: ["b"] })).toEqual([
      'required.0: "b" names no field or repeat',
    ]);
    expect(
      issues({
        fields: { a: { value: "x" } },
        repeats: { a: { mode: "matchAll", pattern: "(x)", fields: {} } },
      })
    ).toEqual(['repeats.a: "a" is both a field and a repeat']);
    expect(issues({ field: {} }).length).toBeGreaterThan(0);
  });
});

describe("v2 extraction — fields", () => {
  it("reads named group v, else group 1, else the whole match; first surviving pattern wins", () => {
    const x = spec({
      fields: {
        named: { patterns: ["(Ref) (?<v>\\w+)"] },
        first: { patterns: ["Total: (\\S+) (\\w+)"], transform: "money" },
        whole: { patterns: ["[A-Z]{2}-\\d+"] },
        fallback: { patterns: ["Datum: (\\S+)", "Date: (\\S+)"], transform: "date" },
        constant: { value: "tour" },
        absent: { patterns: ["Nope: (\\w+)"] },
      },
    });
    const text = "Ref ABC123\nTotal: 1.234,50 EUR\nCode SW-42\nDatum: kaputt\nDate: 18.05.26";
    expect(extract(x, text)).toEqual({
      values: {
        named: "ABC123",
        first: 1234.5,
        whole: "SW-42",
        fallback: "2026-05-18",
        constant: "tour",
        absent: null,
      },
      missing: [],
    });
  });

  it("is case-insensitive and multiline by default, and flags override", () => {
    const x = spec({
      fields: {
        lineStart: { patterns: ["^buchung: (\\w+)$"] },
        strict: { patterns: ["^buchung: (\\w+)$"], flags: "m" },
      },
    });
    expect(extract(x, "Kopf\nBUCHUNG: x1\nFuß").values).toEqual({ lineStart: "x1", strict: null });
  });

  it("names every required field that came out empty", () => {
    const x = spec({
      fields: {
        ref: { patterns: ["Ref (\\w+)"] },
        total: { patterns: ["Total (\\S+)"], transform: "money" },
      },
      required: ["ref", "total"],
    });
    expect(extract(x, "Ref A1\nTotal abc").missing).toEqual(["total"]);
    expect(extract(x, "Ref A1\nTotal 12,00").missing).toEqual([]);
  });
});

describe("v2 extraction — repeats", () => {
  it("matchAll reads named and numbered groups per occurrence", () => {
    const x = spec({
      repeats: {
        legs: {
          mode: "matchAll",
          pattern: "^(?<from>[A-Z]{3}) - (?<to>[A-Z]{3}) (\\w{2} ?\\d+)(?<off>\\+\\d)?$",
          fields: {
            from: { group: "from" },
            to: { group: "to", transform: "lower" },
            flight: { group: 3, transform: "flightNumber" },
            offset: { group: "off", transform: "dayOffset" },
          },
        },
      },
    });
    expect(extract(x, "FRA - ADD ET 707+1\nnoise\nADD - NBO ET 308").values).toEqual({
      legs: [
        { from: "FRA", to: "add", flight: "ET707", offset: 1 },
        { from: "ADD", to: "nbo", flight: "ET308", offset: 0 },
      ],
    });
  });

  it("forces the global flag even when the template leaves it out", () => {
    const x = spec({
      repeats: {
        r: {
          mode: "matchAll",
          pattern: "#(\\d)",
          flags: "i",
          fields: { n: { group: 1, transform: "integer" } },
        },
      },
    });
    expect(extract(x, "#1 #2 #3").values.r).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
  });

  it("split mode applies field rules per block, the header line belonging to its block", () => {
    const x = spec({
      repeats: {
        stays: {
          mode: "split",
          splitPattern: "^Hotel:",
          fields: {
            name: { patterns: ["^Hotel: (.+)$"], transform: "text" },
            nights: { patterns: ["(\\d+) Nächte"], transform: "integer" },
            kind: { value: "stay" },
          },
        },
      },
    });
    const text =
      "Einleitung ohne Inhalt\nHotel: Haus Muster\n3 Nächte\nHotel:   Pension  Beispiel\nkeine Angabe";
    expect(extract(x, text).values.stays).toEqual([
      { name: "Haus Muster", nights: 3, kind: "stay" },
      { name: "Pension Beispiel", nights: null, kind: "stay" },
    ]);
  });

  it("within slices the text first; a missing start anchor means no items", () => {
    const x = spec({
      repeats: {
        r: {
          mode: "matchAll",
          within: { startAfter: "^Flüge$", endBefore: "^Hotels$" },
          pattern: "\\b([A-Z]{3})\\b",
          fields: { code: { group: 1 } },
        },
      },
    });
    expect(extract(x, "ABC\nFlüge\nFRA ADD\nHotels\nXYZ").values.r).toEqual([
      { code: "FRA" },
      { code: "ADD" },
    ]);
    expect(extract(x, "FRA ADD\nHotels").values.r).toEqual([]);
    expect(extract(x, "flüge\nFRA").values.r).toEqual([{ code: "FRA" }]);
  });

  it("drops an item the text contributed nothing to", () => {
    const x = spec({
      repeats: {
        r: { mode: "matchAll", pattern: "row(?:: (\\w+))?", fields: { v: { group: 1 } } },
      },
    });
    expect(extract(x, "row: a\nrow\nrow: b").values.r).toEqual([{ v: "a" }, { v: "b" }]);
  });

  it("a required repeat must reach its minimum (default 1)", () => {
    const x = spec({
      repeats: {
        one: { mode: "matchAll", pattern: "A(\\d)", fields: { n: { group: 1 } } },
        three: { mode: "matchAll", pattern: "B(\\d)", minimum: 3, fields: { n: { group: 1 } } },
        optional: { mode: "matchAll", pattern: "C(\\d)", minimum: 5, fields: { n: { group: 1 } } },
      },
      required: ["one", "three"],
    });
    expect(extract(x, "B1 B2").missing).toEqual(["one", "three"]);
    expect(extract(x, "A1 B1 B2 B3").missing).toEqual([]);
  });

  it("caps a repeat at MAX_REPEAT_ITEMS items", () => {
    const x = spec({
      repeats: {
        m: { mode: "matchAll", pattern: "x(\\d)", fields: { n: { group: 1 } } },
        s: { mode: "split", splitPattern: "x", fields: { n: { patterns: ["x(\\d)"] } } },
      },
    });
    const text = "x1 ".repeat(MAX_REPEAT_ITEMS + 50);
    const { values } = extract(x, text);
    expect(values.m).toHaveLength(MAX_REPEAT_ITEMS);
    expect(values.s).toHaveLength(MAX_REPEAT_ITEMS);
  });

  it("compiles once per extraction object and stays stateless across calls", () => {
    const x = spec({ fields: { a: { patterns: ["a(\\d)"], flags: "gi" } } });
    expect(extract(x, "a1").values.a).toBe("1");
    expect(extract(x, "a2").values.a).toBe("2");
    expect(extract(x, "a3").values.a).toBe("3");
  });
});

describe("v2 extraction — catastrophic backtracking", () => {
  it("stops a pathological pattern that slipped past validation within the time bound", () => {
    // Template regexes come from a remote repo; a static ReDoS check refuses
    // common optional groups, so the time bound is the guard that holds.
    const extraction = {
      fields: { x: { patterns: ["^(a+)+$"] } },
      required: ["x"],
    } as unknown as Extraction;
    const started = Date.now();
    const result = extract(extraction, `${"a".repeat(40)}!`);
    expect(Date.now() - started).toBeLessThan(EXTRACT_TIMEOUT_MS + 1500);
    expect(result.timedOut).toBe(true);
    expect(result.missing).toEqual(["x"]);
  });
});

describe("v2 extraction — every template regex is bounded", () => {
  it("bounds a template regex tested outside extract (e.g. match.notBookingIf)", () => {
    const started = Date.now();
    expect(boundedTest("^(a+)+$", "im", `${"a".repeat(40)}!`)).toBe(false);
    expect(Date.now() - started).toBeLessThan(EXTRACT_TIMEOUT_MS + 1500);
    expect(boundedTest("storniert", "im", "Ihre Buchung wurde storniert")).toBe(true);
  });
});
