import { describe, it, expect } from "vitest";
import { stripMarkdown } from "./markdownPreview";

describe("stripMarkdown", () => {
  it("drops bold markers but keeps the word", () => {
    expect(stripMarkdown("Heute hat unsere **Keniareise** begonnen.")).toBe(
      "Heute hat unsere Keniareise begonnen.",
    );
  });

  it("drops italic and inline-code markers", () => {
    expect(stripMarkdown("Ein *schöner* Tag mit `Code`")).toBe("Ein schöner Tag mit Code");
  });

  it("keeps a link's text and drops its target", () => {
    expect(stripMarkdown("Siehe [die Karte](https://example.com/a_b) dort")).toBe(
      "Siehe die Karte dort",
    );
  });

  it("drops heading and list markers", () => {
    expect(stripMarkdown("## Tag 1\n- Bahnhof\n- Hotel")).toBe("Tag 1 Bahnhof Hotel");
  });

  it("collapses newlines into single spaces so the preview stays one run of text", () => {
    expect(stripMarkdown("Erste Zeile\n\nZweite Zeile")).toBe("Erste Zeile Zweite Zeile");
  });

  it("leaves plain text untouched", () => {
    expect(stripMarkdown("Angekommen am Bahnhof, fuhr auch...")).toBe(
      "Angekommen am Bahnhof, fuhr auch...",
    );
  });

  it("does not treat a bare asterisk between words as a marker", () => {
    expect(stripMarkdown("3 * 4 Zimmer")).toBe("3 * 4 Zimmer");
  });

  it("drops an image entirely rather than leaving a stray exclamation mark", () => {
    expect(stripMarkdown("Vorher ![Strand](https://example.com/s.jpg) nachher")).toBe(
      "Vorher nachher",
    );
  });

  it("drops strikethrough markers", () => {
    expect(stripMarkdown("Zug ~~gestrichen~~ gefahren")).toBe("Zug gestrichen gefahren");
  });

  it("drops underscore emphasis", () => {
    expect(stripMarkdown("Ein __wichtiger__ und _schöner_ Tag")).toBe(
      "Ein wichtiger und schöner Tag",
    );
  });

  it("keeps underscores inside an identifier, which Markdown does not emphasise either", () => {
    expect(stripMarkdown("die Datei trip_photo_id bleibt")).toBe("die Datei trip_photo_id bleibt");
  });

  it("drops blockquote markers", () => {
    expect(stripMarkdown("> Zitat des Tages")).toBe("Zitat des Tages");
  });

  it("drops ordered-list numbering", () => {
    expect(stripMarkdown("1. Bahnhof\n2. Hotel")).toBe("Bahnhof Hotel");
  });

  it("drops a horizontal rule", () => {
    expect(stripMarkdown("Oben\n\n---\n\nUnten")).toBe("Oben Unten");
  });

  it("drops a fenced code block's content", () => {
    expect(stripMarkdown("Vorher\n```\nnicht sichtbar\n```\nNachher")).toBe("Vorher Nachher");
  });
});
