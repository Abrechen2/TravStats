import {
  batchIdParamsSchema,
  lodgingImportCandidateSchema,
  lodgingImportCommitRequestSchema,
  lodgingImportPreviewRequestSchema,
  MAX_LODGING_IMPORT_ROWS,
  suggestMappingRequestSchema,
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

  // ---- Finding 3: DELETE /batches/:id was the only client-supplied value ----
  // ---- that never touched Zod                                            ----

  describe("batchIdParamsSchema", () => {
    it("accepts a well-formed uuid", () => {
      const result = batchIdParamsSchema.safeParse({ id: "00000000-0000-0000-0000-000000000000" });
      expect(result.success).toBe(true);
    });

    it("rejects a non-uuid id before any DB work would run", () => {
      const result = batchIdParamsSchema.safeParse({ id: "../../etc/passwd" });
      expect(result.success).toBe(false);
    });

    it("rejects a missing id", () => {
      const result = batchIdParamsSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  // ---- Finding 4: sampleRows had an unbounded key count per record ----

  describe("suggestMappingRequestSchema", () => {
    it("accepts a normal set of headers and sample rows", () => {
      const result = suggestMappingRequestSchema.safeParse({
        headers: ["Hotel", "Anreise", "Abreise"],
        sampleRows: [{ Hotel: "NH", Anreise: "2026-03-30", Abreise: "2026-03-31" }],
      });
      expect(result.success).toBe(true);
    });

    it("rejects a sample row with more than 80 keys — an unbounded key count would be JSON.stringify'd straight into the LLM prompt", () => {
      const hugeRow: Record<string, string> = {};
      for (let i = 0; i < 81; i++) hugeRow[`col${i}`] = "x";
      const result = suggestMappingRequestSchema.safeParse({
        headers: ["Hotel"],
        sampleRows: [hugeRow],
      });
      expect(result.success).toBe(false);
    });

    it("accepts exactly 80 keys in a sample row (the boundary)", () => {
      const row: Record<string, string> = {};
      for (let i = 0; i < 80; i++) row[`col${i}`] = "x";
      const result = suggestMappingRequestSchema.safeParse({
        headers: ["Hotel"],
        sampleRows: [row],
      });
      expect(result.success).toBe(true);
    });
  });
});
