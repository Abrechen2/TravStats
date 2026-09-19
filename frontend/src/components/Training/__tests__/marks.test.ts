import { describe, it, expect } from "vitest";
import { markFromSelection, marksAlign } from "../marks";

/**
 * One mark, one meaning — beta audit follow-up, 2026-09-19.
 *
 * The view trimmed the selected TEXT and kept the raw offsets, so a selection
 * that caught the newline in front of a value stored a value its own offsets
 * did not point at. `labelContextOf` then looked back from the whitespace and
 * reported the previous line's label for a value that had one of its own.
 */

const TEXT = ["Unterkunft:", "Hotel Seeblick Garni", "Anreise: 10. März 2026"].join("\n");

describe("markFromSelection", () => {
  it("moves the offsets with the trim", () => {
    // A drag that started at the end of the line above — the ordinary way a
    // whole line gets selected with a mouse.
    const start = TEXT.indexOf("\nHotel Seeblick Garni");
    const mark = markFromSelection(TEXT, {
      start,
      end: start + "\nHotel Seeblick Garni".length,
      label: "hotelName",
    });
    expect(mark).not.toBeNull();
    expect(mark?.text).toBe("Hotel Seeblick Garni");
    expect(TEXT.slice(mark!.start, mark!.end)).toBe("Hotel Seeblick Garni");
    // And the offset now points at the value, not at the newline before it,
    // which is what decides whose label the deriver reads.
    expect(TEXT[mark!.start]).toBe("H");
  });

  it("keeps an exact selection exactly where it was", () => {
    const start = TEXT.indexOf("Hotel Seeblick Garni");
    const mark = markFromSelection(TEXT, {
      start,
      end: start + "Hotel Seeblick Garni".length,
      label: "hotelName",
      flightIndex: 0,
    });
    expect(mark).toEqual({
      start,
      end: start + "Hotel Seeblick Garni".length,
      text: "Hotel Seeblick Garni",
      label: "hotelName",
      flightIndex: 0,
    });
  });

  it("refuses a selection that holds nothing but whitespace", () => {
    const start = TEXT.indexOf("\nHotel");
    expect(markFromSelection(TEXT, { start, end: start + 1, label: "hotelName" })).toBeNull();
  });
});

describe("marksAlign", () => {
  it("answers false for offsets measured against another version of the text", () => {
    const start = TEXT.indexOf("Hotel Seeblick Garni");
    const marks = [
      {
        start,
        end: start + "Hotel Seeblick Garni".length,
        text: "Hotel Seeblick Garni",
        label: "hotelName",
      },
    ];
    expect(marksAlign(TEXT, marks)).toBe(true);
    expect(marksAlign(TEXT.replace("Unterkunft:\n", ""), marks)).toBe(false);
  });
});
