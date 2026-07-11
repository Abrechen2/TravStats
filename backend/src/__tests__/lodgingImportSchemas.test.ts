import {
  lodgingImportCandidateSchema,
  lodgingImportCommitRequestSchema,
  lodgingImportPreviewRequestSchema,
  MAX_LODGING_IMPORT_ROWS,
} from "../schemas/lodgingImport";

describe("lodgingImport schemas", () => {
  it("accepts a places-only candidate (no stay)", () => {
    const parsed = lodgingImportCandidateSchema.parse({
      sourceRowIndex: 0,
      lodging: {
        name: "Hotel Adlon",
        type: "hotel",
        city: "Berlin",
        country: "Deutschland",
        lat: 52.5163,
        lon: 13.3807,
        externalRef: "google:ChIJabc",
      },
      stay: null,
    });
    expect(parsed.lodging?.name).toBe("Hotel Adlon");
    expect(parsed.stay).toBeNull();
  });

  it("accepts a stays-only candidate joined by lodgingName, with no price", () => {
    const parsed = lodgingImportCandidateSchema.parse({
      sourceRowIndex: 3,
      lodging: null,
      lodgingName: "NH Ludwigsburg",
      stay: { checkIn: "2026-03-30", checkOut: "2026-03-31", ratingRoom: 4 },
    });
    expect(parsed.stay?.totalPrice).toBeUndefined();
    expect(parsed.lodgingName).toBe("NH Ludwigsburg");
  });

  it("rejects a stay whose dates are not YYYY-MM-DD", () => {
    const result = lodgingImportCandidateSchema.safeParse({
      sourceRowIndex: 0,
      lodging: null,
      lodgingName: "X",
      stay: { checkIn: "30.03.2026", checkOut: "2026-03-31" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a candidate with neither a lodging nor a lodgingName", () => {
    const result = lodgingImportCandidateSchema.safeParse({
      sourceRowIndex: 0,
      lodging: null,
      stay: { checkIn: "2026-03-30", checkOut: "2026-03-31" },
    });
    expect(result.success).toBe(false);
  });

  it("caps the preview payload at MAX_LODGING_IMPORT_ROWS", () => {
    const candidates = Array.from({ length: MAX_LODGING_IMPORT_ROWS + 1 }, (_, i) => ({
      sourceRowIndex: i,
      lodging: { name: `Hotel ${i}` },
      stay: null,
    }));
    const result = lodgingImportPreviewRequestSchema.safeParse({ candidates });
    expect(result.success).toBe(false);
  });

  it("accepts a commit request with a skip row", () => {
    const parsed = lodgingImportCommitRequestSchema.parse({
      source: "csv",
      fileName: "hotels.csv",
      rows: [
        { sourceRowIndex: 0, action: "skip", lodging: { name: "Dup" }, stay: null },
        {
          sourceRowIndex: 1,
          action: "create",
          matchedLodgingId: null,
          lodging: { name: "New Hotel" },
          stay: { checkIn: "2026-01-01", checkOut: "2026-01-02" },
        },
      ],
    });
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.source).toBe("csv");
  });

  it("rejects a commit row with action needs_input", () => {
    const result = lodgingImportCommitRequestSchema.safeParse({
      source: "csv",
      fileName: null,
      rows: [{ sourceRowIndex: 0, action: "needs_input", lodging: { name: "X" }, stay: null }],
    });
    expect(result.success).toBe(false);
  });
});
