import { describe, it, expect } from "vitest";

import { parseCsv } from "../lib/csvParser";

/**
 * The old import flow used `line.split(",")` which broke the moment a
 * cell contained a comma — and our own export quotes such cells, so the
 * round-trip silently lost data. These tests pin the contract we now
 * rely on for CSV → record conversion.
 */
describe("parseCsv", () => {
  it("parses a simple comma-separated body", () => {
    const out = parseCsv("a,b\n1,2\n3,4");
    expect(out).toEqual([
      { a: "1", b: "2" },
      { a: "3", b: "4" },
    ]);
  });

  it("preserves commas inside quoted fields", () => {
    const out = parseCsv('a,b\n"hello, world",2');
    expect(out).toEqual([{ a: "hello, world", b: "2" }]);
  });

  it("decodes escaped double-quotes inside quoted fields", () => {
    const out = parseCsv('a,b\n"she said ""hi""",1');
    expect(out).toEqual([{ a: 'she said "hi"', b: "1" }]);
  });

  it("supports newlines inside quoted fields", () => {
    const out = parseCsv('a,b\n"line1\nline2",x');
    expect(out).toEqual([{ a: "line1\nline2", b: "x" }]);
  });

  it("handles CRLF line endings", () => {
    const out = parseCsv("a,b\r\n1,2\r\n3,4\r\n");
    expect(out).toEqual([
      { a: "1", b: "2" },
      { a: "3", b: "4" },
    ]);
  });

  it("strips a leading UTF-8 BOM", () => {
    const out = parseCsv("﻿a,b\n1,2");
    expect(out).toEqual([{ a: "1", b: "2" }]);
  });

  it("trims surrounding whitespace from cells and headers", () => {
    const out = parseCsv("  a , b \n 1 , 2 ");
    expect(out).toEqual([{ a: "1", b: "2" }]);
  });

  it("fills missing trailing cells with empty strings", () => {
    const out = parseCsv("a,b,c\n1,2");
    expect(out).toEqual([{ a: "1", b: "2", c: "" }]);
  });

  it("skips fully empty lines but preserves empty cells in real rows", () => {
    const out = parseCsv("a,b\n\n,2\n3,");
    expect(out).toEqual([
      { a: "", b: "2" },
      { a: "3", b: "" },
    ]);
  });

  it("returns an empty array on an empty document", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("   ")).toEqual([]);
  });

  /**
   * German Excel writes CSV with a SEMICOLON separator by default (the comma
   * is the decimal mark in that locale), and "Save as → Text (tab delimited)"
   * writes tabs. Both used to parse as ONE giant column: the mapping wizard
   * then offered a single nonsense header, every date cell came back empty
   * and the lodging importer dropped every row with "not a single row could
   * be read" — the file was fine, the parser was not.
   *
   * Detection reads the HEADER ROW ONLY and is deliberately conservative: a
   * header containing even one comma keeps the comma behaviour, byte for
   * byte. So no file that parses correctly today can change meaning — only
   * files that are currently unreadable start working.
   */
  describe("delimiter detection", () => {
    it("parses a semicolon-separated document (German Excel default)", () => {
      const out = parseCsv("Hotel;Anreise;Abreise\nNH München;07.03.2026;09.03.2026");
      expect(out).toEqual([
        { Hotel: "NH München", Anreise: "07.03.2026", Abreise: "09.03.2026" },
      ]);
    });

    it("parses a tab-separated document", () => {
      const out = parseCsv("Hotel\tAnreise\nNH München\t07.03.2026");
      expect(out).toEqual([{ Hotel: "NH München", Anreise: "07.03.2026" }]);
    });

    it("keeps the comma delimiter when the header has one, even if cells hold semicolons", () => {
      const out = parseCsv("a,b\n1;2,3");
      expect(out).toEqual([{ a: "1;2", b: "3" }]);
    });

    it("honours quoting under a detected delimiter", () => {
      const out = parseCsv('a;b\n"hallo; welt";2');
      expect(out).toEqual([{ a: "hallo; welt", b: "2" }]);
    });

    it("treats a single-column file as comma-delimited", () => {
      const out = parseCsv("Hotel\nNH München");
      expect(out).toEqual([{ Hotel: "NH München" }]);
    });
  });
});
