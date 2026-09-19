import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { markFromSelection } from "../../../components/Training/marks";
import de from "../../../i18n/resources/de/training.json";
import en from "../../../i18n/resources/en/training.json";

/**
 * The last four literals in the annotation view, and the one that was also
 * wrong — review of `fix/workshop-lodging-derivation`, finding 5.
 *
 * "Email Text", "Tags", "Kein Text verfügbar" and "Ausgewählter Text:" were
 * written into the markup, so three of them could not be read in English and
 * one could not be read in German. The fourth is the interesting one: the
 * selection preview printed the RAW selection while the mark stores the
 * trimmed value, so a drag that caught the newline in front of a value offered
 * to label something the saved mark would not contain — two answers to one
 * question, which is what `markFromSelection` exists to end.
 *
 * The source scan is deliberate. The rendered-output tests beside this file
 * cover what a reader sees; this covers what a future edit might put back, and
 * a guard that reads the file is the only kind that can (CLAUDE.md: a
 * source-scanning guard ages, so it names exactly what it looks for).
 */

const SOURCE = readFileSync(
  resolve(__dirname, "../../../components/Training/EmailAnnotation.tsx"),
  "utf-8"
);

describe("the annotation view's remaining copy", () => {
  it("carries no hard-coded label text", () => {
    for (const literal of [
      ">Email Text<",
      ">Tags<",
      '"Kein Text verfügbar"',
      "Ausgewählter Text:",
    ]) {
      expect(SOURCE).not.toContain(literal);
    }
  });

  it("has a DE and an EN side for each of them", () => {
    for (const key of ["emailText", "tags", "noText", "selectedText"] as const) {
      expect(de.annotation[key].length).toBeGreaterThan(0);
      expect(en.annotation[key].length).toBeGreaterThan(0);
      expect(de.annotation[key]).not.toBe(en.annotation[key]);
    }
    // The preview interpolates the value rather than concatenating around it,
    // so a translator can move the quotation marks.
    expect(de.annotation.selectedText).toContain("{{value}}");
    expect(en.annotation.selectedText).toContain("{{value}}");
  });

  it("previews the value the mark would store, not the raw selection", () => {
    const text = ["Unterkunft:", "Hotel Seeblick Garni"].join("\n");
    const start = text.indexOf("\nHotel Seeblick Garni");
    const raw = { start, end: start + "\nHotel Seeblick Garni".length, label: "hotelName" };
    // What the preview used to print, and what it prints now.
    expect(text.slice(raw.start, raw.end)).not.toBe("Hotel Seeblick Garni");
    expect(markFromSelection(text, raw)?.text).toBe("Hotel Seeblick Garni");
    expect(SOURCE).toContain("markFromSelection(displayText, selectedText)?.text");
  });
});
