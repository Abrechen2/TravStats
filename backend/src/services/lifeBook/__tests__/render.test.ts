import { renderHead, renderLoose, renderTail, renderTrip, flagOf, esc } from "../render";
import type { BookEntry, BookFrame, BookTrip } from "../types";

const frame: BookFrame = {
  lang: "de",
  generatedOn: "2026-11-22",
  username: "dennis",
  scopeTitle: "Alles",
};

function entry(over: Partial<BookEntry>): BookEntry {
  return {
    kind: "flight",
    id: "flight:1",
    day: "2025-03-03",
    time: "10:05",
    sortMs: 1,
    endDay: null,
    title: "LH 400 FRA → JFK",
    detail: [],
    notes: null,
    evidence: [],
    photos: [],
    ...over,
  };
}

function trip(over: Partial<BookTrip> = {}): BookTrip {
  return {
    id: "t1",
    name: "New York",
    startDay: "2025-03-03",
    endDay: "2025-03-10",
    countries: ["US", "DE"],
    travellers: ["dennis", "Anna"],
    description: null,
    notes: null,
    evidence: [],
    entries: [],
    photos: [],
    points: [],
    legs: [],
    ...over,
  };
}

const book = (t: BookTrip, f = frame): string =>
  renderHead(f, [{ id: t.id, name: t.name, startDay: t.startDay }], false) +
  renderTrip(t, f) +
  renderTail(f);

describe("life book rendering", () => {
  it("renders an undated entry under 'no known date', never on an invented day", () => {
    const html = book(
      trip({
        entries: [
          entry({ id: "flight:dated" }),
          entry({
            id: "flight:undated",
            day: null,
            time: null,
            sortMs: null,
            title: "Mystery leg",
          }),
        ],
      })
    );
    const undated = html.slice(html.indexOf('class="day undated"'));
    expect(undated).toContain("Ohne bekanntes Datum");
    expect(undated).toContain("Mystery leg");
    // the dated section does not hold it
    expect(html.slice(0, html.indexOf('class="day undated"'))).not.toContain("Mystery leg");
  });

  it("shows an unknown trip period as unknown instead of a date", () => {
    const html = book(trip({ startDay: null, endDay: null }));
    expect(html).toContain("unbekannt");
    expect(html).toContain("Datum unbekannt"); // the contents list
  });

  it("makes no external request: nothing outside the file is referenced", () => {
    const html = book(
      trip({
        notes: "see http://example.com/x and <script>alert(1)</script>",
        entries: [
          entry({
            photos: [{ dataUri: "data:image/jpeg;base64,AAAA", caption: "a", takenDay: null }],
            notes: "https://evil.example/track.png",
          }),
        ],
        points: [
          { lat: 50, lon: 8, label: "FRA" },
          { lat: 40, lon: -73, label: "JFK" },
        ],
        legs: [
          [
            { lat: 50, lon: 8, label: "FRA" },
            { lat: 40, lon: -73, label: "JFK" },
          ],
        ],
      })
    );
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<link[\s>]/i);
    expect(html).not.toMatch(/\b(?:src|href|action|poster)=["']\s*(?:https?:)?\/\//i);
    expect(html).not.toMatch(/url\(\s*["']?\s*(?:https?:)?\/\//i);
    expect(html).not.toMatch(/@import/i);
    // user text that looks like a URL is escaped text, not markup
    expect(html).toContain("http://example.com/x");
    expect(html).toContain("&lt;script&gt;");
    // every src is an embedded image
    for (const m of html.matchAll(/\bsrc="([^"]*)"/g)) expect(m[1]).toMatch(/^data:image\//);
  });

  it("is deterministic and orders a day by time, not by input order", () => {
    const entries = [
      entry({ id: "flight:b", sortMs: 20, time: "12:00", title: "Second" }),
      entry({ id: "flight:a", sortMs: 10, time: "08:00", title: "First" }),
    ];
    const a = book(trip({ entries }));
    const b = book(trip({ entries: [...entries].reverse() }));
    expect(a).toBe(b);
    expect(a.indexOf("First")).toBeLessThan(a.indexOf("Second"));
  });

  it("has the book's structure: cover, contents, one trip article with facts, map, days, print rules", () => {
    const html = book(
      trip({
        evidence: ["booking"],
        entries: [entry({ evidence: ["boardingPass", "booking"] })],
        points: [{ lat: 50, lon: 8, label: "FRA" }],
      })
    );
    const outline = [...html.matchAll(/<(h1|h2|h3|article|nav|footer|svg)[ >]/g)].map((m) => m[1]);
    expect(outline).toEqual([
      "h1",
      "h2",
      "nav",
      "h2",
      "article",
      "h2",
      "h3",
      "svg",
      "h3",
      "footer",
    ]);
    expect(html).toContain("Beleg: Buchung, Bordkarte");
    expect(html).toContain("🇺🇸 ");
    expect(html).toContain("@page{size:A4");
    expect(html).toContain(".trip{break-before:page");
    expect(html).toContain("Tag 1");
  });

  it("follows the chosen language", () => {
    const en = book(trip({ entries: [entry({ evidence: ["ticket"] })] }), { ...frame, lang: "en" });
    expect(en).toContain('<html lang="en">');
    expect(en).toContain("Evidence: Ticket");
    expect(en).toContain("Countries");
    expect(en).not.toContain("Beleg");
  });

  it("draws no map when the trip has no coordinates, and says what the map is when it has", () => {
    expect(book(trip())).not.toContain("<svg");
    const withMap = book(trip({ points: [{ lat: 1, lon: 2, label: "X" }] }));
    expect(withMap).toContain("ohne Kartenhintergrund");
    expect(withMap).toContain("(1.0000, 2.0000)");
  });

  it("puts entries without a trip into their own chapter", () => {
    const html = renderLoose([entry({ day: null, time: null })], frame);
    expect(html).toContain('id="no-trip"');
    expect(html).toContain("Einträge ohne Reise");
  });

  it("escapes markup and builds flags from region codes", () => {
    expect(esc(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
    expect(flagOf("de")).toBe("🇩🇪");
    expect(flagOf("Germany")).toBe("");
  });
});
