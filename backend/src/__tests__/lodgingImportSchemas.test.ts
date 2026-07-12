import {
  batchIdParamsSchema,
  lodgingImportCandidateSchema,
  lodgingImportCommitRequestSchema,
  lodgingImportPreviewRequestSchema,
  MAX_LODGING_IMPORT_ROWS,
  stayCandidateFieldsSchema,
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
    const candidates = Array.from(
      { length: MAX_LODGING_IMPORT_ROWS + 1 },
      (_, i) => ({
        sourceRowIndex: i,
        lodging: { name: `Hotel ${i}` },
        stay: null,
      }),
    );
    const result = lodgingImportPreviewRequestSchema.safeParse({ candidates });
    expect(result.success).toBe(false);
  });

  it("accepts a commit request with a skip row", () => {
    const parsed = lodgingImportCommitRequestSchema.parse({
      source: "csv",
      fileName: "hotels.csv",
      rows: [
        {
          sourceRowIndex: 0,
          action: "skip",
          lodging: { name: "Dup" },
          stay: null,
        },
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
      rows: [
        {
          sourceRowIndex: 0,
          action: "needs_input",
          lodging: { name: "X" },
          stay: null,
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  // ---- Finding 4: the regex alone accepted calendar-impossible days, and ----
  // ---- Date.parse silently rolled them over to a DIFFERENT real day      ----

  describe("isoDay calendar validation (Finding 4)", () => {
    it("rejects 2026-02-31 — the regex matches, but the day does not exist", () => {
      const result = stayCandidateFieldsSchema.safeParse({
        checkIn: "2026-02-31",
        checkOut: "2026-03-05",
      });
      expect(result.success).toBe(false);
    });

    it("rejects 2027-02-29 — 2027 is not a leap year", () => {
      const result = stayCandidateFieldsSchema.safeParse({
        checkIn: "2027-02-29",
        checkOut: "2027-03-01",
      });
      expect(result.success).toBe(false);
    });

    it("accepts 2028-02-29 — 2028 IS a leap year (the boundary case)", () => {
      const result = stayCandidateFieldsSchema.safeParse({
        checkIn: "2028-02-29",
        checkOut: "2028-03-01",
      });
      expect(result.success).toBe(true);
    });

    it("rejects an impossible checkOut even when checkIn is a real day", () => {
      const result = stayCandidateFieldsSchema.safeParse({
        checkIn: "2026-04-01",
        checkOut: "2026-04-31",
      });
      expect(result.success).toBe(false);
    });

    it("rejects an impossible calendar day inside a full commit row, not just in isolation", () => {
      const result = lodgingImportCommitRequestSchema.safeParse({
        source: "csv",
        fileName: null,
        rows: [
          {
            sourceRowIndex: 0,
            action: "create",
            lodging: { name: "Impossible Date Hotel" },
            stay: { checkIn: "2026-02-31", checkOut: "2026-03-03" },
          },
        ],
      });
      expect(result.success).toBe(false);
    });
  });

  // ---- Finding 3: DELETE /batches/:id was the only client-supplied value ----
  // ---- that never touched Zod                                            ----

  describe("batchIdParamsSchema", () => {
    it("accepts a well-formed uuid", () => {
      const result = batchIdParamsSchema.safeParse({
        id: "00000000-0000-0000-0000-000000000000",
      });
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
        sampleRows: [
          { Hotel: "NH", Anreise: "2026-03-30", Abreise: "2026-03-31" },
        ],
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

    it("rejects a sample row whose KEY is longer than 500 characters — the key cap must mirror the value cap, not just the count", () => {
      const longKey = "x".repeat(501);
      const result = suggestMappingRequestSchema.safeParse({
        headers: ["Hotel"],
        sampleRows: [{ [longKey]: "NH" }],
      });
      expect(result.success).toBe(false);
    });

    it("accepts a sample row whose key is exactly 500 characters (the boundary)", () => {
      const boundaryKey = "x".repeat(500);
      const result = suggestMappingRequestSchema.safeParse({
        headers: ["Hotel"],
        sampleRows: [{ [boundaryKey]: "NH" }],
      });
      expect(result.success).toBe(true);
    });
  });
});
