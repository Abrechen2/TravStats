import { describe, expect, it } from "vitest";
import { buildPlaceCandidates, buildPlaceMappingFields, PLACE_FIELD_ALIASES } from "../placeCsv";

/**
 * POI Phase D §5.
 *
 * Two things are worth pinning here, and neither is "the parser parses".
 *
 * A coordinate written the German way is the same latitude to a person and a
 * different number to `Number()`. A misread one does not look broken — it looks
 * like a place somewhere else entirely, which is the worst failure this file
 * can have.
 *
 * And a row with no coordinates is NOT an error. Every row of a Google Takeout
 * export looks like that, and dropping it here would throw away the user's own
 * note before anyone had the chance to offer it back to them.
 */
describe("reading a places CSV", () => {
  const mapping = {
    name: "Name",
    lat: "Breitengrad",
    lon: "Längengrad",
    notes: "Notiz",
    externalRef: "URL",
  };

  it("reads a German decimal comma as a decimal point", () => {
    const { candidates } = buildPlaceCandidates(
      [{ Name: "Colosseo", Breitengrad: "41,8902", Längengrad: "12,4922" }],
      mapping
    );

    expect(candidates[0].lat).toBeCloseTo(41.8902, 4);
    expect(candidates[0].lon).toBeCloseTo(12.4922, 4);
  });

  it("does not turn a thousands separator into a decimal point", () => {
    // "1.234,5" and "1,234.5" are different numbers, and guessing between them
    // is the same wrong-coordinate risk the comma handling exists to avoid.
    const { candidates } = buildPlaceCandidates(
      [{ Name: "Somewhere", Breitengrad: "1.234", Längengrad: "5.678" }],
      mapping
    );

    expect(candidates[0].lat).toBeCloseTo(1.234, 3);
  });

  it("keeps a row that has no coordinates, with the note intact", () => {
    const { candidates, errors } = buildPlaceCandidates(
      [{ Name: "Trattoria da Enzo", Notiz: "best carbonara" }],
      mapping
    );

    expect(errors).toEqual([]);
    expect(candidates[0].lat).toBeNull();
    expect(candidates[0].notes).toBe("best carbonara");
  });

  it("treats one coordinate without the other as no position", () => {
    // A half-position cannot place anything, and carrying it forward would make
    // the row look more complete than it is.
    const { candidates } = buildPlaceCandidates(
      [{ Name: "Half", Breitengrad: "41,8902" }],
      mapping
    );

    expect(candidates[0].lat).toBeNull();
    expect(candidates[0].lon).toBeNull();
  });

  it("rejects only a row with no name", () => {
    const { candidates, errors } = buildPlaceCandidates(
      [{ Name: "", Notiz: "orphan" }, { Name: "Pantheon" }],
      mapping
    );

    expect(errors).toEqual([{ sourceRowIndex: 0, code: "missing_name" }]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].sourceRowIndex).toBe(1);
  });

  it("carries the identity column through", () => {
    const { candidates } = buildPlaceCandidates(
      [{ Name: "Colosseo", URL: "gmaps:12345" }],
      mapping
    );

    expect(candidates[0].externalRef).toBe("gmaps:12345");
  });

  it("offers both spellings of an umlaut header", () => {
    // `autoMapHeaders` strips umlauts rather than transliterating them, so
    // "Längengrad" and "Laengengrad" normalise to DIFFERENT strings and each
    // needs its own alias. The lodging list learned this the hard way.
    expect(PLACE_FIELD_ALIASES.lon).toEqual(expect.arrayContaining(["laengengrad", "längengrad"]));
  });

  it("asks for a name and nothing else", () => {
    const fields = buildPlaceMappingFields((f) => f);
    expect(fields.filter((f) => f.required).map((f) => f.key)).toEqual(["name"]);
  });
});
