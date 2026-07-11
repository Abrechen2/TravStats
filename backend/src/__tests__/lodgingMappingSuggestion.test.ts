import {
  LODGING_CSV_FIELDS,
  suggestLodgingCsvMapping,
} from "../services/lodging/mappingSuggestion";

jest.mock("../services/parserSettings", () => ({
  getAdminParserSettings: jest.fn(async () => ({ ollamaUrl: null, ollamaModel: null })),
}));

describe("suggestLodgingCsvMapping", () => {
  it("returns an empty mapping when Ollama is unreachable — never throws", async () => {
    const mapping = await suggestLodgingCsvMapping(
      ["Hotel", "Anreise"],
      [{ Hotel: "NH", Anreise: "30.03.2026" }],
      {
        url: "http://127.0.0.1:1",
        model: "nonexistent",
      },
    );
    expect(mapping).toEqual({});
  });

  it("exposes every field the CSV importer can map", () => {
    expect(LODGING_CSV_FIELDS).toContain("name");
    expect(LODGING_CSV_FIELDS).toContain("googlePlaceId");
    expect(LODGING_CSV_FIELDS).toContain("checkIn");
    expect(LODGING_CSV_FIELDS).toContain("ratingBreakfast");
    expect(new Set(LODGING_CSV_FIELDS).size).toBe(LODGING_CSV_FIELDS.length);
  });
});
